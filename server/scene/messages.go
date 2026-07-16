package scene

import "encoding/json"

// DataChannelメッセージのGo側ミラー(正本は client/src/net/protocol.ts)。
// サーバーが解釈するのは pos / act / ginput(受信)と
// gpatch / gsnap / gevent(送信、ワールドボットのみが発行する権威更新)。

// WorldBotID はワールドボットのidentity。/tokenが"__"始まりを拒否するため
// プレイヤーは名乗れない(クライアントはこのidentityからのシーン系のみ受理する)
const WorldBotID = "__world"

// incomingMessage は受信メッセージの必要フィールドだけを取り出す
type incomingMessage struct {
	T string `json:"t"`
	// pos / act
	X   float64  `json:"x"`
	Z   float64  `json:"z"`
	Yaw float64  `json:"yaw"`
	Tx  *float64 `json:"tx"`
	Tz  *float64 `json:"tz"`
	// act: アクション名 / ginput: 対象ノードid・操作
	Name   string `json:"name"`
	ID     string `json:"id"`
	Action string `json:"action"`
}

type patchMessage struct {
	T     string         `json:"t"`
	ID    string         `json:"id"`
	Attrs map[string]any `json:"attrs"`
}

type snapshotMessage struct {
	T       string                    `json:"t"`
	Patches map[string]map[string]any `json:"patches"`
}

type eventMessage struct {
	T    string         `json:"t"`
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Data map[string]any `json:"data,omitempty"`
}

func mustJSON(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		// 送信メッセージは全てこちらが組み立てた構造体なので失敗しない
		panic(err)
	}
	return data
}
