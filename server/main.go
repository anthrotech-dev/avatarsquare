// avatarsquareのトークンサーバー。
// LiveKitへの入室トークン(JWT)の発行と、必要に応じてLiveKitシグナリングへの
// リバースプロキシ(wssのTLS終端)を担う。
// ゲームロジックのメッセージはクライアント間でLiveKit DataChannelを流れるため、
// このサーバーは中身を解釈しない。
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
