package scene

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path"
	"time"

	"github.com/tetratelabs/wazero/api"
)

const (
	// スクリプト呼び出し1回のタイムアウト。超えたらモジュールが閉じられdead化する
	callTimeout = 100 * time.Millisecond
	// 連続エラーがこの回数に達したらdead化(以後呼ばない)
	maxConsecutiveErrors = 10
	// emit(patch)の1回あたりのサイズ上限
	maxPatchBytes = 8 << 10
)

// script は1つのwasmスクリプトのインスタンス。
// セッションのゴルーチンからのみ触る(wasmインスタンスはスレッドセーフでない)。
type script struct {
	// name はログ用(URLのファイル名)
	name   string
	module api.Module
	// dead はタイムアウト・連続エラーで隔離済み。以後呼ばない
	dead      bool
	errStreak int
}

func (s *script) label() string {
	return path.Base(s.name)
}

// callCtx はホスト関数(asq)がセッションへアクセスするためのコンテキスト。
// wazeroは呼び出し時のcontextをそのままホスト関数へ渡す
type hostEnvKey struct{}

func callContext(env *hostEnv) (context.Context, context.CancelFunc) {
	ctx := context.WithValue(context.Background(), hostEnvKey{}, env)
	return context.WithTimeout(ctx, callTimeout)
}

func envFrom(ctx context.Context) *hostEnv {
	env, _ := ctx.Value(hostEnvKey{}).(*hostEnv)
	return env
}

// call はスクリプトのexport関数をJSON文字列引数で呼ぶ。
// 入力は asq_alloc で確保したゲストバッファへ書いてから渡す(ABI v1)。
func (s *script) call(env *hostEnv, fn string, payload []byte) error {
	if s.dead {
		return nil
	}
	export := s.module.ExportedFunction(fn)
	if export == nil {
		return nil // 省略可能なexport(asq_tick等)
	}
	ctx, cancel := callContext(env)
	defer cancel()

	ptr := uint64(0)
	if len(payload) > 0 {
		alloc := s.module.ExportedFunction("asq_alloc")
		if alloc == nil {
			s.kill("asq_allocがexportされていません")
			return errors.New("missing asq_alloc")
		}
		results, err := alloc.Call(ctx, uint64(len(payload)))
		if err != nil || len(results) == 0 {
			return s.callFailed("asq_alloc", err)
		}
		ptr = results[0]
		if !s.module.Memory().Write(uint32(ptr), payload) {
			s.kill("入力バッファへの書き込みに失敗")
			return errors.New("memory write failed")
		}
	}
	if _, err := export.Call(ctx, ptr, uint64(len(payload))); err != nil {
		return s.callFailed(fn, err)
	}
	s.errStreak = 0
	return nil
}

// tick は asq_tick(dt_ms) を呼ぶ(exportされていなければ何もしない)
func (s *script) tick(env *hostEnv, dtMs uint32) {
	if s.dead {
		return
	}
	export := s.module.ExportedFunction("asq_tick")
	if export == nil {
		return
	}
	ctx, cancel := callContext(env)
	defer cancel()
	if _, err := export.Call(ctx, uint64(dtMs)); err != nil {
		_ = s.callFailed("asq_tick", err)
		return
	}
	s.errStreak = 0
}

// callFailed はエラーを記録し、タイムアウト(=モジュールが閉じられた)や
// 連続エラーでdead化する。スクリプトの不具合でサーバー全体は落とさない
func (s *script) callFailed(fn string, err error) error {
	if err == nil {
		err = errors.New("no result")
	}
	s.errStreak++
	log.Printf("[script %s] %s failed (%d/%d): %v", s.label(), fn, s.errStreak, maxConsecutiveErrors, err)
	// WithCloseOnContextDoneによりタイムアウト時はモジュール自体が閉じられている
	if errors.Is(err, context.DeadlineExceeded) || s.errStreak >= maxConsecutiveErrors {
		s.kill("タイムアウトまたは連続エラー")
	}
	return fmt.Errorf("%s: %w", fn, err)
}

func (s *script) kill(reason string) {
	if s.dead {
		return
	}
	s.dead = true
	log.Printf("[script %s] 停止しました: %s", s.label(), reason)
	_ = s.module.Close(context.Background())
}

// hostEnv はホスト関数(asqモジュール)からセッションへの橋渡し。
// セッションは1ゴルーチンで直列に動くため、呼び出し中のスクリプトを
// currentに立ててからwasmを呼ぶ(ロック不要)。ホストモジュール自体は
// ランタイム共有なので、envは呼び出しコンテキストで届く(callContext)。
type hostEnv struct {
	current *script
	// onListen はlisten(nodeID, event)の登録先
	onListen func(s *script, nodeID, event string)
	// onPatch は検証済みパッチの適用+配信
	onPatch func(id string, attrs map[string]any)
}

// readString はゲストメモリから文字列を読む
func readString(m api.Module, ptr, len uint32) (string, bool) {
	raw, ok := m.Memory().Read(ptr, len)
	if !ok {
		return "", false
	}
	return string(raw), true
}

func hostLog(ctx context.Context, m api.Module, ptr, len uint32) {
	env := envFrom(ctx)
	message, ok := readString(m, ptr, len)
	if env == nil || !ok {
		return
	}
	log.Printf("[script %s] %s", env.current.label(), message)
}

func hostListen(ctx context.Context, m api.Module, idPtr, idLen, evPtr, evLen uint32) {
	env := envFrom(ctx)
	nodeID, ok1 := readString(m, idPtr, idLen)
	event, ok2 := readString(m, evPtr, evLen)
	if env == nil || !ok1 || !ok2 {
		return
	}
	env.onListen(env.current, nodeID, event)
}

func hostPatch(ctx context.Context, m api.Module, ptr, len uint32) {
	env := envFrom(ctx)
	if env == nil {
		return
	}
	if len > maxPatchBytes {
		log.Printf("[script %s] patchが大きすぎます(%dB > %dB)", env.current.label(), len, maxPatchBytes)
		return
	}
	raw, ok := m.Memory().Read(ptr, len)
	if !ok {
		return
	}
	var payload struct {
		ID    string         `json:"id"`
		Attrs map[string]any `json:"attrs"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || payload.ID == "" || payload.Attrs == nil {
		log.Printf("[script %s] 不正なpatchを無視しました", env.current.label())
		return
	}
	env.onPatch(payload.ID, payload.Attrs)
}
