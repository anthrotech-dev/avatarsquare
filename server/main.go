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

func main() {
	apiKey := getenv("LIVEKIT_API_KEY", "devkey")
	apiSecret := getenv("LIVEKIT_API_SECRET", "secret")
	livekitURL := getenv("LIVEKIT_URL", "ws://localhost:7880")
	addr := getenv("ADDR", ":8787")
	// 証明書と鍵を指定するとHTTPSで待ち受ける(.dev TLDはHSTSプリロードのため必須)
	tlsCert := os.Getenv("TLS_CERT")
	tlsKey := os.Getenv("TLS_KEY")
	// 指定するとトークン以外のパスをLiveKitへ転送する(wssのTLS終端として動く)
	proxyTarget := os.Getenv("LIVEKIT_PROXY_TARGET")

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
