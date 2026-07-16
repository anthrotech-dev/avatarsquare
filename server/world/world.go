// Package world はワールド定義(JSON)の取得・検証・キャッシュを担う。
// ワールドJSONは「シーン=汎用ノードの列」と「スクリプト=wasm URL」で構成され、
// サーバーはシーンの中身をほとんど解釈しない(通行判定やHP等の意味論は
// wasmスクリプトとクライアント描画の領分)。ここでは配信と、後段の
// ギミック実行に必要な最小限のフィールドだけを取り出す。
package world

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// ワールドid = LiveKitルーム名。トークンサーバーのnameReと同じ制約
var idRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

// ワールドJSONの取得サイズ上限。信頼済みURLのみだが事故防止に絞る
const maxWorldBytes = 4 << 20

// Node はシーンノード。既知の共通属性以外はAttrsにそのまま残す
type Node struct {
	ID           string
	Kind         string
	X, Z         float64
	Collider     float64 // 足元の通行不可半径(m)。当たり判定の既定半径にも使う
	Interactable bool
	Attrs        map[string]any
}

// Def はパース済みのワールド定義
type Def struct {
	ID      string
	Name    string
	Spawn   struct{ X, Z float64 }
	Scene   []Node
	Scripts []string
	// SourceURL はワールドJSONの取得元。スクリプト等の相対URL解決の基準
	SourceURL string
	// Raw は検証済みのJSON生バイト。/worlds/{id} でそのまま配信する
	Raw []byte
}

func num(v any) float64 {
	f, _ := v.(float64)
	return f
}

// Parse はワールドJSONを検証してDefを返す。
// クライアント(WorldDef.parseWorld)と同じ方針: 壊れたワールドは早めに弾き、
// ノード単位の欠落・未知kindは許容する(前方互換)。
func Parse(raw []byte, sourceURL string) (*Def, error) {
	var doc struct {
		ID      string                 `json:"id"`
		Name    string                 `json:"name"`
		Spawn   struct{ X, Z float64 } `json:"spawn"`
		Scene   []map[string]any       `json:"scene"`
		Scripts []string               `json:"scripts"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("invalid world json: %w", err)
	}
	if !idRe.MatchString(doc.ID) {
		return nil, fmt.Errorf("invalid world id: %q", doc.ID)
	}
	def := &Def{
		ID:        doc.ID,
		Name:      doc.Name,
		Spawn:     doc.Spawn,
		Scripts:   doc.Scripts,
		SourceURL: sourceURL,
		Raw:       raw,
	}
	if def.Name == "" {
		def.Name = doc.ID
	}
	seen := map[string]bool{}
	for _, n := range doc.Scene {
		id, _ := n["id"].(string)
		kind, _ := n["kind"].(string)
		if id == "" || kind == "" || seen[id] {
			continue
		}
		seen[id] = true
		interactable, _ := n["interactable"].(bool)
		def.Scene = append(def.Scene, Node{
			ID:           id,
			Kind:         kind,
			X:            num(n["x"]),
			Z:            num(n["z"]),
			Collider:     num(n["collider"]),
			Interactable: interactable,
			Attrs:        n,
		})
	}
	return def, nil
}

// ResolveURL はワールドJSONのURLを基準に相対URL(スクリプト等)を解決する
func (d *Def) ResolveURL(ref string) (string, error) {
	base, err := url.Parse(d.SourceURL)
	if err != nil {
		return "", err
	}
	r, err := url.Parse(ref)
	if err != nil {
		return "", err
	}
	return base.ResolveReference(r).String(), nil
}

// Registry は起動設定(WORLD_URLS)で指定されたワールドのメモリキャッシュ
type Registry struct {
	worlds []*Def
	byID   map[string]*Def
}

// Load はカンマ区切りのURLリストからワールドを取得する。
// 個々の失敗はエラーとして返しつつ(呼び出し側でログ)、残りは提供を続ける。
func Load(urls string) (*Registry, []error) {
	reg := &Registry{byID: map[string]*Def{}}
	var errs []error
	for u := range strings.SplitSeq(urls, ",") {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		def, err := fetchWorld(u)
		if err != nil {
			errs = append(errs, fmt.Errorf("world %s: %w", u, err))
			continue
		}
		if _, dup := reg.byID[def.ID]; dup {
			errs = append(errs, fmt.Errorf("world %s: duplicate id %q", u, def.ID))
			continue
		}
		reg.worlds = append(reg.worlds, def)
		reg.byID[def.ID] = def
	}
	return reg, errs
}

// fetchWorld はURL(http/https)またはローカルパスからワールドJSONを読む。
// ローカルパスは開発用(サーバーとワールドを同じマシンで動かす場合)。
func fetchWorld(source string) (*Def, error) {
	var raw []byte
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		client := &http.Client{Timeout: 15 * time.Second}
		res, err := client.Get(source)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("unexpected status %s", res.Status)
		}
		raw, err = io.ReadAll(io.LimitReader(res.Body, maxWorldBytes+1))
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
	if len(raw) > maxWorldBytes {
		return nil, fmt.Errorf("world json too large (> %d bytes)", maxWorldBytes)
	}
	return Parse(raw, source)
}

// All は読み込み順のワールド一覧(先頭が既定ワールド)
func (r *Registry) All() []*Def {
	return r.worlds
}

// Get はidでワールドを引く。無ければnil
func (r *Registry) Get(id string) *Def {
	return r.byID[id]
}
