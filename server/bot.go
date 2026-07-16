package main

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/totegamma/avatarsquare/server/scene"
	"github.com/totegamma/avatarsquare/server/world"
)

// worldBot は1ワールドぶんのLiveKitルーム常駐ボット(identity: __world)。
// DataChannelの受信をSessionへ流し、Sessionからの配信をルームへ送る。
// トラックはpublishしない(データ専用)。切断時は指数バックオフで再接続する。
type worldBot struct {
	def       *world.Def
	session   *scene.Session
	url       string
	apiKey    string
	apiSecret string
	// room は現在の接続(未接続はnil)。Sessionのbroadcastコールバックが
	// 別ゴルーチンから読むためatomicに持つ
	room atomic.Pointer[lksdk.Room]
}

// startWorldBots は各ワールドのセッションを起動し、ルームへの常駐を始める
func startWorldBots(worlds *world.Registry, url, apiKey, apiSecret string) {
	runtime, err := scene.NewRuntime(context.Background())
	if err != nil {
		log.Printf("world bot: wasm runtime: %v", err)
		return
	}
	for _, def := range worlds.All() {
		bot := &worldBot{def: def, url: url, apiKey: apiKey, apiSecret: apiSecret}
		bot.session = scene.NewSession(def, runtime, bot.broadcast)
		go bot.connectLoop()
	}
}

// broadcast はSessionからの配信(to=nilで全員、指定ありでその参加者のみ)
func (b *worldBot) broadcast(data []byte, to []string) {
	room := b.room.Load()
	if room == nil {
		return // 未接続の間の更新は捨てる(遅延参加者はgsnapで追いつく)
	}
	opts := []lksdk.DataPublishOption{lksdk.WithDataPublishReliable(true)}
	if len(to) > 0 {
		opts = append(opts, lksdk.WithDataPublishDestination(to))
	}
	if err := room.LocalParticipant.PublishDataPacket(lksdk.UserData(data), opts...); err != nil {
		log.Printf("world %s: publish data: %v", b.def.ID, err)
	}
}

func (b *worldBot) connectLoop() {
	backoff := time.Second
	for {
		disconnected := make(chan struct{})
		room, err := b.connect(disconnected)
		if err != nil {
			log.Printf("world %s: bot connect failed (retry in %v): %v", b.def.ID, backoff, err)
		} else {
			log.Printf("world %s: bot connected to room", b.def.ID)
			b.room.Store(room)
			backoff = time.Second // 接続成功でリセット
			<-disconnected
			b.room.Store(nil)
			log.Printf("world %s: bot disconnected (reconnect in %v)", b.def.ID, backoff)
		}
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (b *worldBot) connect(disconnected chan struct{}) (*lksdk.Room, error) {
	callback := &lksdk.RoomCallback{
		OnDisconnected: func() { close(disconnected) },
		OnParticipantConnected: func(rp *lksdk.RemoteParticipant) {
			// 新規参加者に現在のシーン差分を送る(profile再送と同じパターン)
			b.session.SyncTo(rp.Identity())
		},
		OnParticipantDisconnected: func(rp *lksdk.RemoteParticipant) {
			b.session.Forget(rp.Identity())
		},
		ParticipantCallback: lksdk.ParticipantCallback{
			OnDataPacket: func(packet lksdk.DataPacket, params lksdk.DataReceiveParams) {
				user, ok := packet.(*lksdk.UserDataPacket)
				if !ok {
					return
				}
				// SenderIdentityはLiveKitが検証済み(詐称不可)
				b.session.HandleMessage(params.SenderIdentity, user.Payload)
			},
		},
	}
	return lksdk.ConnectToRoom(b.url, lksdk.ConnectInfo{
		APIKey:              b.apiKey,
		APISecret:           b.apiSecret,
		RoomName:            b.def.ID,
		ParticipantIdentity: scene.WorldBotID,
		ParticipantName:     b.def.Name,
	}, callback)
}
