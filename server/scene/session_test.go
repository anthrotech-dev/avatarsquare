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
    {"id": "scarecrow", "kind": "group", "x": 0, "z": 5, "collider": 0.5,
     "targetable": true, "name": "かかし", "hp": 30, "hpMax": 30,
     "scarecrow": {"hp": 30, "respawnMs": 300},
     "children": [
       {"id": "scarecrow-visual", "kind": "sprite", "w": 1.2, "h": 1.6},
       {"id": "scarecrow-hp", "kind": "bar", "y": 2,
        "source": "parent", "valueFrom": "hp", "maxFrom": "hpMax"}
     ]},
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

func targetedActMsg(name string, x, z float64, tid string) []byte {
	data, _ := json.Marshal(map[string]any{
		"t": "act", "name": name, "x": x, "z": z, "yaw": 0, "tid": tid,
	})
	return data
}

func TestScarecrowHitAndRespawn(t *testing.T) {
	session, ch := newTestSession(t)

	// かかし(0,5)の手前からyaw=0(+Z向き)で斬撃 → gevent hit + hp属性の減少パッチ
	session.HandleMessage("alice", actMsg("slash", 0, 3.5, 0, nil, nil))
	waitFor(t, ch, "gevent hit", func(r broadcastRec) bool {
		return r.msg["t"] == "gevent" && r.msg["id"] == "scarecrow" && r.msg["name"] == "hit"
	})
	rec := waitFor(t, ch, "hp patch", func(r broadcastRec) bool { return isPatch(r, "scarecrow") })
	if v := attrs(rec)["hp"].(float64); v != 20 {
		t.Errorf("hp = %v, want 20", v)
	}

	// 射程外からの斬撃は当たらない(パッチが来ない)
	session.HandleMessage("alice", actMsg("slash", 0, -5, 0, nil, nil))
	// 後ろ向きの斬撃も当たらない
	session.HandleMessage("alice", actMsg("slash", 0, 3.5, 3.14159, nil, nil))

	// 射撃(手前の的を射線が貫く)であと2発 → HP 0で消滅(gdespawn)
	tx, tz := 0.0, 6.0
	session.HandleMessage("alice", actMsg("shoot", 0, 0, 0, &tx, &tz))
	session.HandleMessage("alice", actMsg("shoot", 0, 0, 0, &tx, &tz))
	waitFor(t, ch, "gdespawn", func(r broadcastRec) bool {
		return r.msg["t"] == "gdespawn" && r.msg["id"] == "scarecrow"
	})

	// 消滅中は当たらない(ノード自体が無い)
	session.HandleMessage("alice", actMsg("slash", 0, 3.5, 0, nil, nil))

	// respawnMs(300ms)+tick後に「別のかかし」がスポーンする(世代id)
	rec = waitFor(t, ch, "gspawn", func(r broadcastRec) bool { return r.msg["t"] == "gspawn" })
	spawned, _ := rec.msg["node"].(map[string]any)
	if spawned["id"] != "scarecrow@1" {
		t.Fatalf("spawned id = %v, want scarecrow@1", spawned["id"])
	}
	if spawned["hp"].(float64) != 30 {
		t.Errorf("spawned hp = %v, want 30", spawned["hp"])
	}
	children, _ := spawned["children"].([]any)
	if len(children) != 2 {
		t.Errorf("spawned children = %d, want 2 (sprite+bar)", len(children))
	}

	// 新しいかかしにも攻撃が通る(listenの引き継ぎ)
	session.HandleMessage("alice", actMsg("slash", 0, 3.5, 0, nil, nil))
	waitFor(t, ch, "gevent hit on respawned", func(r broadcastRec) bool {
		return r.msg["t"] == "gevent" && r.msg["id"] == "scarecrow@1" && r.msg["name"] == "hit"
	})
	rec = waitFor(t, ch, "hp patch on respawned", func(r broadcastRec) bool {
		return isPatch(r, "scarecrow@1")
	})
	if v := attrs(rec)["hp"].(float64); v != 20 {
		t.Errorf("respawned hp = %v, want 20", v)
	}

	// 途中参加者へのgsnap: 初期かかしの消滅と新かかしのスポーンが再現される
	session.SyncTo("bob")
	rec = waitFor(t, ch, "gsnap", func(r broadcastRec) bool { return r.msg["t"] == "gsnap" })
	despawns, _ := rec.msg["despawns"].([]any)
	if len(despawns) != 1 || despawns[0] != "scarecrow" {
		t.Errorf("gsnap despawns = %v, want [scarecrow]", despawns)
	}
	spawns, _ := rec.msg["spawns"].([]any)
	if len(spawns) != 1 {
		t.Fatalf("gsnap spawns = %v, want 1 entry", spawns)
	}
	entry, _ := spawns[0].(map[string]any)
	entryNode, _ := entry["node"].(map[string]any)
	if entryNode["id"] != "scarecrow@1" {
		t.Errorf("gsnap spawn id = %v, want scarecrow@1", entryNode["id"])
	}
	patches, _ := rec.msg["patches"].(map[string]any)
	respawnedPatch, _ := patches["scarecrow@1"].(map[string]any)
	if respawnedPatch["hp"].(float64) != 20 {
		t.Errorf("gsnap patches[scarecrow@1].hp = %v, want 20", respawnedPatch["hp"])
	}
	if _, stale := patches["scarecrow"]; stale {
		t.Error("despawn済みノードの累積patchはgsnapから消えるべき")
	}
}

func TestTargetedSlash(t *testing.T) {
	session, ch := newTestSession(t)

	// 対象指定は角度不問: かかし(0,5)の奥側(0,6.5)から後ろ向き相当でも射程内なら当たる
	session.HandleMessage("alice", targetedActMsg("slash", 0, 6.5, "scarecrow"))
	waitFor(t, ch, "gevent hit (targeted)", func(r broadcastRec) bool {
		return r.msg["t"] == "gevent" && r.msg["id"] == "scarecrow" && r.msg["name"] == "hit"
	})
	rec := waitFor(t, ch, "hp patch", func(r broadcastRec) bool { return isPatch(r, "scarecrow") })
	if v := attrs(rec)["hp"].(float64); v != 20 {
		t.Errorf("hp = %v, want 20", v)
	}

	// 射程外(距離4.5-r0.5 > 2.2)は不発。targetableでないノード指定も不発
	session.HandleMessage("alice", targetedActMsg("slash", 0, 0.5, "scarecrow"))
	session.HandleMessage("alice", targetedActMsg("slash", 3, 1, "counter-button"))
	// 存在しないtidも不発。その後の正常な攻撃だけが通ることで上3つの不発を確認する
	session.HandleMessage("alice", targetedActMsg("slash", 0, 4, "no-such-node"))
	session.HandleMessage("alice", targetedActMsg("slash", 0, 4, "scarecrow"))
	rec = waitFor(t, ch, "hp patch 2", func(r broadcastRec) bool { return isPatch(r, "scarecrow") })
	if v := attrs(rec)["hp"].(float64); v != 10 {
		t.Errorf("hp = %v, want 10 (不発のはずの攻撃が当たっている?)", v)
	}
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
