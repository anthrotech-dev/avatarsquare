package scene

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/tetratelabs/wazero"
)

// wasm取得のサイズ上限。管理者が信頼したワールド由来だが事故防止に絞る
const maxWasmBytes = 4 << 20

// Runtime はワールドスクリプト(wasm)の実行基盤。
// wazeroのランタイムとURL別のコンパイル済みモジュールキャッシュを保持し、
// 全ワールドのセッションで共有する。
type Runtime struct {
	wazero   wazero.Runtime
	compiled map[string]wazero.CompiledModule
}

func NewRuntime(ctx context.Context) (*Runtime, error) {
	config := wazero.NewRuntimeConfig().
		// 呼び出しごとのタイムアウト(コンテキスト打ち切り)で暴走ループを止める
		WithCloseOnContextDone(true).
		// スクリプト1つあたりのメモリ上限: 256ページ = 16MB
		WithMemoryLimitPages(256)
	r := &Runtime{
		wazero:   wazero.NewRuntimeWithConfig(ctx, config),
		compiled: map[string]wazero.CompiledModule{},
	}
	// ホストモジュール"asq"はランタイムに一度だけ登録する。
	// セッション(ワールド)ごとの状態は呼び出しコンテキスト経由で渡す(script.go)
	_, err := r.wazero.NewHostModuleBuilder("asq").
		NewFunctionBuilder().WithFunc(hostLog).Export("log").
		NewFunctionBuilder().WithFunc(hostListen).Export("listen").
		NewFunctionBuilder().WithFunc(hostPatch).Export("patch").
		NewFunctionBuilder().WithFunc(hostSpawn).Export("spawn").
		NewFunctionBuilder().WithFunc(hostDespawn).Export("despawn").
		NewFunctionBuilder().WithFunc(hostPlayers).Export("players").
		NewFunctionBuilder().WithFunc(hostEvent).Export("event").
		Instantiate(ctx)
	if err != nil {
		r.Close(ctx)
		return nil, fmt.Errorf("host module: %w", err)
	}
	return r, nil
}

// compile はwasmを取得してコンパイルする(URL別にキャッシュ)
func (r *Runtime) compile(ctx context.Context, url string) (wazero.CompiledModule, error) {
	if compiled, ok := r.compiled[url]; ok {
		return compiled, nil
	}
	raw, err := fetchWasm(url)
	if err != nil {
		return nil, err
	}
	compiled, err := r.wazero.CompileModule(ctx, raw)
	if err != nil {
		return nil, fmt.Errorf("compile: %w", err)
	}
	r.compiled[url] = compiled
	return compiled, nil
}

func (r *Runtime) Close(ctx context.Context) {
	_ = r.wazero.Close(ctx)
}

// fetchWasm はURL(http/https)またはローカルパスからwasmを読む(ワールドJSONと同じ規則)
func fetchWasm(source string) ([]byte, error) {
	var raw []byte
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		client := &http.Client{Timeout: 30 * time.Second}
		res, err := client.Get(source)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("unexpected status %s", res.Status)
		}
		raw, err = io.ReadAll(io.LimitReader(res.Body, maxWasmBytes+1))
		if err != nil {
			return nil, err
		}
	} else {
		var err error
		raw, err = os.ReadFile(source)
		if err != nil {
			return nil, err
		}
	}
	if len(raw) > maxWasmBytes {
		return nil, fmt.Errorf("wasm too large (> %d bytes)", maxWasmBytes)
	}
	return raw, nil
}
