// avatarsquareのトークンサーバー兼ワールドサーバー。
// LiveKitへの入室トークン(JWT)の発行、必要に応じてLiveKitシグナリングへの
// リバースプロキシ(wssのTLS終端)、そして起動設定(WORLD_URLS)で信頼した
// ワールドJSONの一覧・配信を担う。
// プレイヤー間のゲームメッセージはクライアント間でLiveKit DataChannelを流れる。
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/totegamma/avatarsquare/server/world"
)

var nameRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadDotEnv はカレントディレクトリの .env (KEY=VALUE形式) を読み、
// 未設定の環境変数にだけ反映する。シークレットをgit管理外に置くための仕組み。
func loadDotEnv() {
	data, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	for line := range strings.SplitSeq(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if os.Getenv(key) == "" {
			os.Setenv(key, strings.TrimSpace(value))
		}
	}
}

func main() {
	loadDotEnv()
	apiKey := getenv("LIVEKIT_API_KEY", "devkey")
	apiSecret := getenv("LIVEKIT_API_SECRET", "secret")
	// 開発サーバーのLiveKit(nginxでSSL終端、メディアはUDP 7882/TCP 7881直通)
	livekitURL := getenv("LIVEKIT_URL", "wss://livekit.anthrotech.dev")
	addr := getenv("ADDR", ":8787")
	// 証明書と鍵を指定するとHTTPSで待ち受ける(.dev TLDはHSTSプリロードのため必須)
	tlsCert := os.Getenv("TLS_CERT")
	tlsKey := os.Getenv("TLS_KEY")
	// 指定するとトークン以外のパスをLiveKitへ転送する(wssのTLS終端として動く)
	proxyTarget := os.Getenv("LIVEKIT_PROXY_TARGET")
	// 提供するワールドJSONのURL(カンマ区切り)。サーバー管理者が信頼できる
	// ワールドだけを列挙する。未設定なら従来どおりトークンサーバーとしてだけ動く
	worldURLs := os.Getenv("WORLD_URLS")

	var worlds *world.Registry
	if worldURLs != "" {
		var errs []error
		worlds, errs = world.Load(worldURLs)
		for _, err := range errs {
			log.Printf("world load: %v", err)
		}
		for _, w := range worlds.All() {
			log.Printf("world loaded: %s (%s) from %s", w.ID, w.Name, w.SourceURL)
		}
		// 各ワールドのルームにボット(__world)として常駐し、
		// ギミック(wasmスクリプト)の状態をサーバー権威で同期する
		startWorldBots(worlds, livekitURL, apiKey, apiSecret)
	}

	// k8s等のliveness/readiness probe用。プロキシ有効時も/tokenと同様に優先される
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	http.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		room := r.URL.Query().Get("room")
		name := r.URL.Query().Get("name")
		if !nameRe.MatchString(room) || !nameRe.MatchString(name) {
			http.Error(w, "room and name must match [A-Za-z0-9_-]{1,32}", http.StatusBadRequest)
			return
		}
		// "__"始まりはシステム参加者(ワールドボット__world等)の予約名。
		// 発行を許すとボットへのなりすまし・蹴落としができてしまう
		if strings.HasPrefix(name, "__") {
			http.Error(w, "names starting with __ are reserved", http.StatusForbidden)
			return
		}

		token, err := auth.NewAccessToken(apiKey, apiSecret).
			SetVideoGrant(&auth.VideoGrant{RoomJoin: true, Room: room}).
			SetIdentity(name).
			SetValidFor(6 * time.Hour).
			ToJWT()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"token": token,
			"url":   livekitURL,
		}); err != nil {
			log.Printf("failed to write response: %v", err)
		}
	})

	// ワールド一覧と個別ワールドJSONの配信。
	// JSONはURL直接返却ではなく検証済みキャッシュをプロキシ配信する:
	// ワールドホスト側のCORS設定に依存せず、検証を通った内容だけを配れる
	if worlds != nil {
		http.HandleFunc("/worlds", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			type entry struct {
				ID   string `json:"id"`
				Name string `json:"name"`
				// URL はワールドJSONの取得元。クライアントはこれを基準に
				// テクスチャ等の相対URLを解決する(JSON本体はプロキシ配信のため)
				URL string `json:"url"`
			}
			list := []entry{}
			for _, def := range worlds.All() {
				list = append(list, entry{ID: def.ID, Name: def.Name, URL: def.SourceURL})
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(list); err != nil {
				log.Printf("failed to write response: %v", err)
			}
		})
		http.HandleFunc("/worlds/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			def := worlds.Get(strings.TrimPrefix(r.URL.Path, "/worlds/"))
			if def == nil {
				http.Error(w, "world not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			// 相対アセット解決の基準(プロキシ配信でベースURLが変わるため)
			w.Header().Set("X-World-Source", def.SourceURL)
			w.Header().Set("Access-Control-Expose-Headers", "X-World-Source")
			if _, err := w.Write(def.Raw); err != nil {
				log.Printf("failed to write response: %v", err)
			}
		})
	}

	if proxyTarget != "" {
		target, err := url.Parse(proxyTarget)
		if err != nil {
			log.Fatalf("invalid LIVEKIT_PROXY_TARGET: %v", err)
		}
		// httputil.ReverseProxyはUpgrade(WebSocket)も転送できる
		http.Handle("/", httputil.NewSingleHostReverseProxy(target))
		log.Printf("proxying non-/token traffic to %s", proxyTarget)
	}

	log.Printf("token server listening on %s (livekit: %s, tls: %v)", addr, livekitURL, tlsCert != "")
	if tlsCert != "" && tlsKey != "" {
		log.Fatal(http.ListenAndServeTLS(addr, tlsCert, tlsKey, nil))
	}
	log.Fatal(http.ListenAndServe(addr, nil))
}
