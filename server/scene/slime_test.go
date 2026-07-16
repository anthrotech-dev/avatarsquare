package scene

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/totegamma/avatarsquare/server/world"
)

// slime.wasm(コミット済みの実wasm)の結合テスト。
// pull型players ABI・event(gevent)・追跡AI・retarget・despawnを固定する。
// テスト用に高速パラメータ(speed 5m/s、attackMs 300)を使う。

const slimeWorldJSON = `{
  "id": "slimetest",
  "name": "スライムテスト",
  "size": 60,
  "spawn": {"x": 0, "z": 0},
  "scene": [
    {"id": "slime-button", "kind": "cylinder", "x": 0, "z": 0, "r": 0.4,
     "collider": 0.5, "interactable": true,
     "slime": {"hp": 30, "speed": 5.0, "aggroRange": 6, "attackRange": 1.0,
               "attackMs": 300, "image": "square/slime.png", "spawnOffset": [2, 0]}}
  ],
  "scripts": ["../gimmicks/slime.wasm"]
}`

func newSlimeSession(t *testing.T) (*Session, chan broadcastRec) {
	t.Helper()
	if _, err := os.Stat("../../client/public/gimmicks/slime.wasm"); err != nil {
		t.Skipf("ビルド済みwasmがありません(gimmicks/build.sh を実行してください): %v", err)
	}
	def, err := world.Parse([]byte(slimeWorldJSON), testWorldSource(t))
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := NewRuntime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { runtime.Close(context.Background()) })

	ch := make(chan broadcastRec, 256)
	session := NewSession(def, runtime, func(data []byte, to []string) {
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Errorf("broadcast is not json: %v", err)
			return
		}
		ch <- broadcastRec{msg: msg, to: to}
	})
	t.Cleanup(session.Close)
	if len(session.scripts) != 1 {
		t.Fatalf("scripts loaded = %d, want 1", len(session.scripts))
	}
	return session, ch
}

func posMsg(x, z float64) []byte {
	data, _ := json.Marshal(map[string]any{"t": "pos", "x": x, "z": z, "yaw": 0, "moving": false})
	return data
}

func interactMsg(id string) []byte {
	data, _ := json.Marshal(map[string]any{"t": "ginput", "id": id, "action": "interact"})
	return data
}

func num2(v any) float64 {
	f, _ := v.(float64)
	return f
}

func TestSlimeSpawnChaseAttackAndDeath(t *testing.T) {
	session, ch := newSlimeSession(t)
	const slimeID = "slime-button-s1"

	// 遠距離(20m)からのinteractは無視される → 後続のスポーンがs1であることで確認
	session.HandleMessage("alice", posMsg(20, 0))
	session.HandleMessage("alice", interactMsg("slime-button"))

	// 近づいてinteract → スライムがspawnOffset(2,0)にスポーン
	session.HandleMessage("alice", posMsg(1, 0))
	session.HandleMessage("alice", interactMsg("slime-button"))
	rec := waitFor(t, ch, "gspawn", func(r broadcastRec) bool { return r.msg["t"] == "gspawn" })
	node, _ := rec.msg["node"].(map[string]any)
	if node["id"] != slimeID {
		t.Fatalf("spawned id = %v, want %s (遠距離interactが数えられている?)", node["id"], slimeID)
	}
	if node["kind"] != "group" || node["targetable"] != true || node["name"] != "スライム" {
		t.Errorf("entity root = %v", node)
	}
	if num2(node["hp"]) != 30 || num2(node["hpMax"]) != 30 {
		t.Errorf("hp/hpMax = %v/%v, want 30/30", node["hp"], node["hpMax"])
	}
	if num2(node["x"]) != 2 || num2(node["z"]) != 0 {
		t.Errorf("spawn pos = (%v, %v), want (2, 0)", node["x"], node["z"])
	}
	children, _ := node["children"].([]any)
	if len(children) != 2 {
		t.Fatalf("children = %d, want 2 (sprite+bar)", len(children))
	}
	bar, _ := children[1].(map[string]any)
	if bar["kind"] != "bar" || bar["source"] != "parent" {
		t.Errorf("bar child = %v", bar)
	}

	// alice(6,0)はアグロ範囲(6m)内 → スライムが近づく(gpatchのx/zがaliceへ単調接近)
	session.HandleMessage("alice", posMsg(6, 0))
	distToAlice := func(r broadcastRec) float64 {
		return math.Hypot(num2(attrs(r)["x"])-6, num2(attrs(r)["z"])-0)
	}
	isMove := func(r broadcastRec) bool {
		if !isPatch(r, slimeID) {
			return false
		}
		_, hasX := attrs(r)["x"]
		return hasX
	}
	first := waitFor(t, ch, "move patch 1", isMove)
	second := waitFor(t, ch, "move patch 2", isMove)
	if !(distToAlice(second) < distToAlice(first) && distToAlice(first) < 4.0) {
		t.Errorf("接近していない: %v -> %v", distToAlice(first), distToAlice(second))
	}

	// attackRange(1.0m)到達 → 攻撃演出gevent(data.x/z=プレイヤー位置)が繰り返し出る
	rec = waitFor(t, ch, "attack gevent", func(r broadcastRec) bool {
		return r.msg["t"] == "gevent" && r.msg["id"] == slimeID && r.msg["name"] == "hit"
	})
	data, _ := rec.msg["data"].(map[string]any)
	if math.Hypot(num2(data["x"])-6, num2(data["z"])-0) > 0.1 {
		t.Errorf("attack data = %v, want ≒(6, 0)", data)
	}

	// bob(7,1)が斬撃 → hp減少+対象がbobに切り替わり移動方向が変わる
	// (スライムはalice境界の(5,0)付近。bobまで約2.2mで射程内)
	session.HandleMessage("bob", posMsg(7, 1))
	session.HandleMessage("bob", targetedActMsg("slash", 7, 1, slimeID))
	rec = waitFor(t, ch, "hp patch 20", func(r broadcastRec) bool {
		return isPatch(r, slimeID) && attrs(r)["hp"] != nil
	})
	if num2(attrs(rec)["hp"]) != 20 {
		t.Errorf("hp = %v, want 20", attrs(rec)["hp"])
	}
	distToBob := func(r broadcastRec) float64 {
		return math.Hypot(num2(attrs(r)["x"])-7, num2(attrs(r)["z"])-1)
	}
	move := waitFor(t, ch, "move toward bob", isMove)
	move2 := waitFor(t, ch, "move toward bob 2", isMove)
	if !(distToBob(move2) < distToBob(move)) {
		t.Errorf("retarget後にbobへ接近していない: %v -> %v", distToBob(move), distToBob(move2))
	}

	// あと2発で消滅(gdespawn)。復活はしない
	session.HandleMessage("bob", targetedActMsg("slash", 7, 1, slimeID))
	session.HandleMessage("bob", targetedActMsg("slash", 7, 1, slimeID))
	waitFor(t, ch, "gdespawn", func(r broadcastRec) bool {
		return r.msg["t"] == "gdespawn" && r.msg["id"] == slimeID
	})

	// 2体目を湧かせて途中入室者へのgsnapを確認
	// (despawn済みのs1はspawns/patchesから消えている)
	session.HandleMessage("alice", posMsg(1, 0))
	session.HandleMessage("alice", interactMsg("slime-button"))
	waitFor(t, ch, "gspawn s2", func(r broadcastRec) bool {
		if r.msg["t"] != "gspawn" {
			return false
		}
		n, _ := r.msg["node"].(map[string]any)
		return n["id"] == "slime-button-s2"
	})
	session.SyncTo("carol")
	rec = waitFor(t, ch, "gsnap", func(r broadcastRec) bool { return r.msg["t"] == "gsnap" })
	spawns, _ := rec.msg["spawns"].([]any)
	if len(spawns) != 1 {
		t.Fatalf("gsnap spawns = %d, want 1 (生存中のs2のみ)", len(spawns))
	}
	entry, _ := spawns[0].(map[string]any)
	entryNode, _ := entry["node"].(map[string]any)
	if entryNode["id"] != "slime-button-s2" {
		t.Errorf("gsnap spawn id = %v, want slime-button-s2", entryNode["id"])
	}
	patches, _ := rec.msg["patches"].(map[string]any)
	if _, stale := patches[slimeID]; stale {
		t.Error("despawn済みスライムの累積patchはgsnapから消えるべき")
	}
}
