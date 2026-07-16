package scene

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/totegamma/avatarsquare/server/world"
)

// コミット済みの実wasm(client/public/gimmicks/)をロードする結合テスト。
// ABI(asq_main/asq_event/asq_tick、listen/patch)がRust SDKと噛み合うことを固定する。

const testWorldJSON = `{
  "id": "testworld",
  "name": "テスト",
  "size": 60,
  "spawn": {"x": 0, "z": 0},
  "scene": [
    {"id": "scarecrow", "kind": "sprite", "x": 0, "z": 5, "collider": 0.5,
     "scarecrow": {"hp": 30, "respawnMs": 300, "bar": "scarecrow-hp"}},
    {"id": "scarecrow-hp", "kind": "bar", "x": 0, "z": 5, "y": 2, "value": 1},
    {"id": "counter-button", "kind": "cylinder", "x": 3, "z": 0, "r": 0.4, "interactable": true,
     "counter": {"label": "counter-label"}},
    {"id": "counter-label", "kind": "text", "x": 3, "z": 0, "y": 1.5, "text": "0"}
  ],
  "scripts": ["../gimmicks/scarecrow.wasm", "../gimmicks/counter.wasm"]
}`

type broadcastRec struct {
	msg map[string]any
	to  []string
}

// testWorldSource はスクリプトの相対URL(../gimmicks/)の解決基準。
// 相対パスだとurl.ResolveReferenceが先頭の..を落とすため絶対パスにする
func testWorldSource(t *testing.T) string {
	t.Helper()
	source, err := filepath.Abs("../../client/public/worlds/test.json")
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func newTestSession(t *testing.T) (*Session, chan broadcastRec) {
	t.Helper()
	source := testWorldSource(t)
	if _, err := os.Stat("../../client/public/gimmicks/scarecrow.wasm"); err != nil {
		t.Skipf("ビルド済みwasmがありません(gimmicks/build.sh を実行してください): %v", err)
	}
	def, err := world.Parse([]byte(testWorldJSON), source)
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := NewRuntime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { runtime.Close(context.Background()) })

	ch := make(chan broadcastRec, 64)
	session := NewSession(def, runtime, func(data []byte, to []string) {
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Errorf("broadcast is not json: %v", err)
			return
		}
		ch <- broadcastRec{msg: msg, to: to}
	})
	t.Cleanup(session.Close)
	if len(session.scripts) != 2 {
		t.Fatalf("scripts loaded = %d, want 2", len(session.scripts))
	}
	return session, ch
}

// waitFor はchから条件を満たすメッセージが届くまで待つ(それ以外は読み捨て)
func waitFor(t *testing.T, ch chan broadcastRec, what string, match func(broadcastRec) bool) broadcastRec {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case rec := <-ch:
			if match(rec) {
				return rec
			}
		case <-deadline:
			t.Fatalf("timeout waiting for %s", what)
		}
	}
}

func isPatch(rec broadcastRec, nodeID string) bool {
	return rec.msg["t"] == "gpatch" && rec.msg["id"] == nodeID
}

func attrs(rec broadcastRec) map[string]any {
	m, _ := rec.msg["attrs"].(map[string]any)
	return m
}

func actMsg(name string, x, z, yaw float64, tx, tz *float64) []byte {
	m := map[string]any{"t": "act", "name": name, "x": x, "z": z, "yaw": yaw}
	if tx != nil {
		m["tx"] = *tx
		m["tz"] = *tz
	}
	data, _ := json.Marshal(m)
	return data
}

func TestScarecrowHitAndRespawn(t *testing.T) {
	session, ch := newTestSession(t)

	// かかし(0,5)の手前からyaw=0(+Z向き)で斬撃 → gevent hit + HPバー減少
	session.HandleMessage("alice", actMsg("slash", 0, 3.5, 0, nil, nil))
	waitFor(t, ch, "gevent hit", func(r broadcastRec) bool {
		return r.msg["t"] == "gevent" && r.msg["id"] == "scarecrow" && r.msg["name"] == "hit"
	})
	rec := waitFor(t, ch, "hp bar patch", func(r broadcastRec) bool { return isPatch(r, "scarecrow-hp") })
	if v := attrs(rec)["value"].(float64); v < 0.66 || v > 0.67 {
		t.Errorf("hp bar value = %v, want ~0.667 (20/30)", v)
	}

	// 射程外からの斬撃は当たらない(パッチが来ない)
	session.HandleMessage("alice", actMsg("slash", 0, -5, 0, nil, nil))
	// 後ろ向きの斬撃も当たらない
	session.HandleMessage("alice", actMsg("slash", 0, 3.5, 3.14159, nil, nil))

	// 射撃(手前の的を射線が貫く)であと2発 → HP 0で倒れる(visible false)
	tx, tz := 0.0, 6.0
	session.HandleMessage("alice", actMsg("shoot", 0, 0, 0, &tx, &tz))
	session.HandleMessage("alice", actMsg("shoot", 0, 0, 0, &tx, &tz))
	rec = waitFor(t, ch, "down patch", func(r broadcastRec) bool {
		return isPatch(r, "scarecrow") && attrs(r)["visible"] == false
	})
	_ = rec

	// 倒れている間は当たらない(nodeState.visible=falseでスキップ)
	session.HandleMessage("alice", actMsg("slash", 0, 3.5, 0, nil, nil))

	// respawnMs(300ms)+tick後に復活(visible true + バー全快)
	waitFor(t, ch, "respawn patch", func(r broadcastRec) bool {
		return isPatch(r, "scarecrow") && attrs(r)["visible"] == true
	})
	rec = waitFor(t, ch, "hp bar refill", func(r broadcastRec) bool {
		return isPatch(r, "scarecrow-hp") && attrs(r)["value"] == 1.0
	})
}

func TestCounterInteractAndSnapshot(t *testing.T) {
	session, ch := newTestSession(t)

	input, _ := json.Marshal(map[string]any{"t": "ginput", "id": "counter-button", "action": "interact"})

	// 位置が遠い(10m)とinteractは無視される
	pos, _ := json.Marshal(map[string]any{"t": "pos", "x": 3, "z": 10, "yaw": 0, "moving": false})
	session.HandleMessage("alice", pos)
	session.HandleMessage("alice", input)

	// 近づいてからのinteractはカウントされる
	pos, _ = json.Marshal(map[string]any{"t": "pos", "x": 3, "z": 1, "yaw": 0, "moving": false})
	session.HandleMessage("alice", pos)
	session.HandleMessage("alice", input)
	rec := waitFor(t, ch, "counter patch", func(r broadcastRec) bool { return isPatch(r, "counter-label") })
	if attrs(rec)["text"] != "1" {
		t.Errorf("counter text = %v, want 1 (遠距離のinteractが数えられている?)", attrs(rec)["text"])
	}

	session.HandleMessage("alice", input)
	waitFor(t, ch, "counter=2", func(r broadcastRec) bool {
		return isPatch(r, "counter-label") && attrs(r)["text"] == "2"
	})

	// 新規参加者へのスナップショット(累積差分)
	session.SyncTo("bob")
	rec = waitFor(t, ch, "gsnap", func(r broadcastRec) bool { return r.msg["t"] == "gsnap" })
	if len(rec.to) != 1 || rec.to[0] != "bob" {
		t.Errorf("gsnap to = %v, want [bob]", rec.to)
	}
	patches, _ := rec.msg["patches"].(map[string]any)
	label, _ := patches["counter-label"].(map[string]any)
	if label["text"] != "2" {
		t.Errorf("snapshot counter = %v, want 2", label["text"])
	}
}

func TestWorldXZ(t *testing.T) {
	s := &Session{nodes: map[string]*nodeState{
		"root":  {x: 10, z: -5},
		"child": {parent: "root", x: 1, z: 2},
		"grand": {parent: "child", x: 0.5, z: -0.5},
		"loopA": {parent: "loopB", x: 1, z: 1},
		"loopB": {parent: "loopA", x: 1, z: 1},
	}}
	if x, z := s.worldXZ(s.nodes["root"]); x != 10 || z != -5 {
		t.Errorf("root = (%v, %v)", x, z)
	}
	if x, z := s.worldXZ(s.nodes["grand"]); x != 11.5 || z != -3.5 {
		t.Errorf("grand = (%v, %v), want (11.5, -3.5)", x, z)
	}
	// 循環参照でも無限ループしない(depth上限で打ち切り)
	s.worldXZ(s.nodes["loopA"])
}

func TestBrokenScriptIsSkipped(t *testing.T) {
	// 存在しないwasm URL → そのスクリプトだけスキップされ、セッションは生きる
	def, err := world.Parse([]byte(`{
		"id": "broken", "scene": [],
		"scripts": ["./no-such.wasm", "../gimmicks/counter.wasm"]
	}`), testWorldSource(t))
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := NewRuntime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { runtime.Close(context.Background()) })
	session := NewSession(def, runtime, func([]byte, []string) {})
	t.Cleanup(session.Close)
	if len(session.scripts) != 1 {
		t.Errorf("scripts loaded = %d, want 1 (壊れた方だけスキップ)", len(session.scripts))
	}
}
