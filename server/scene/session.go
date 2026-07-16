package scene

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/totegamma/avatarsquare/server/world"
)

// tickInterval はスクリプトのasq_tick呼び出し間隔(約10Hz)
const tickInterval = 100 * time.Millisecond

// interactRange はginputを受理する距離(m)。位置詐称は許容するゆるい検証
// (READMEの方針: 厳密さより自由)。posが未着なら通す
const interactRange = 3.0

// nodeState はノードの現在値のうちサーバーが解釈する分。
// 初期値はワールドJSON、以後はスクリプトのpatchで更新される
type nodeState struct {
	def     *world.Node
	parent  string  // 親ノードid(x,zは親相対)。トップレベルは空
	x, z    float64 // 親相対座標
	radius  float64 // hit判定・通行の半径
	visible bool
}

// Session は1ワールドぶんの権威シーンとスクリプト実行。
// 全処理を1つのゴルーチン(run)に直列化し、通信層(ボット)からは
// HandleMessage / SyncTo だけを呼ぶ。
type Session struct {
	world     *world.Def
	broadcast func(data []byte, to []string)

	ops    chan func()
	closed chan struct{}

	nodes map[string]*nodeState
	// patches は初期シーンからの累積差分。新規参加者へのgsnapの中身
	patches map[string]map[string]any
	// listeners[nodeID][event] = 購読スクリプト
	listeners map[string]map[string][]*script
	scripts   []*script
	env       *hostEnv
	// positions は参加者の最新位置(interactの距離検証用)
	positions map[string]struct{ x, z float64 }
}

// NewSession はワールドのスクリプトをロード・初期化してセッションを開始する。
// broadcastは全員宛て(to=nil)または特定参加者宛ての送信コールバック。
// スクリプトのロード失敗はそのスクリプトだけスキップする(ワールドは提供継続)。
func NewSession(def *world.Def, runtime *Runtime, broadcast func(data []byte, to []string)) *Session {
	s := &Session{
		world:     def,
		broadcast: broadcast,
		ops:       make(chan func(), 256),
		closed:    make(chan struct{}),
		nodes:     map[string]*nodeState{},
		patches:   map[string]map[string]any{},
		listeners: map[string]map[string][]*script{},
		positions: map[string]struct{ x, z float64 }{},
	}
	for i := range def.Scene {
		node := &def.Scene[i]
		radius := node.Collider
		if radius <= 0 {
			radius = defaultHitRadius
		}
		s.nodes[node.ID] = &nodeState{
			def: node, parent: node.Parent,
			x: node.X, z: node.Z, radius: radius, visible: true,
		}
	}
	s.env = &hostEnv{
		onListen: func(sc *script, nodeID, event string) {
			if _, ok := s.nodes[nodeID]; !ok {
				log.Printf("[script %s] listen: ノード%qがありません", sc.label(), nodeID)
				return
			}
			byEvent, ok := s.listeners[nodeID]
			if !ok {
				byEvent = map[string][]*script{}
				s.listeners[nodeID] = byEvent
			}
			byEvent[event] = append(byEvent[event], sc)
		},
		onPatch: s.applyPatch,
	}
	s.loadScripts(runtime)
	go s.run()
	return s
}

// loadScripts はワールドのwasmを取得・インスタンス化しasq_mainを呼ぶ。
// ホストモジュール"asq"はセッション専用の名前空間に一度だけ登録する
func (s *Session) loadScripts(runtime *Runtime) {
	ctx := context.Background()
	for i, ref := range s.world.Scripts {
		url, err := s.world.ResolveURL(ref)
		if err != nil {
			log.Printf("world %s: script %s: %v", s.world.ID, ref, err)
			continue
		}
		compiled, err := runtime.compile(ctx, url)
		if err != nil {
			log.Printf("world %s: script %s: %v", s.world.ID, url, err)
			continue
		}
		// モジュール名はランタイム全体で一意にする(同じwasmを複数ワールドで使える)
		config := wazero.NewModuleConfig().WithName(fmt.Sprintf("%s-%d", s.world.ID, i))
		module, err := runtime.wazero.InstantiateModule(ctx, compiled, config)
		if err != nil {
			log.Printf("world %s: script %s: instantiate: %v", s.world.ID, url, err)
			continue
		}
		sc := &script{name: url, module: module}
		s.scripts = append(s.scripts, sc)
		s.env.current = sc
		if err := sc.call(s.env, "asq_main", s.world.Raw); err != nil {
			log.Printf("world %s: script %s: main: %v", s.world.ID, sc.label(), err)
		}
	}
}

// run はセッションの単一ゴルーチン。opsの直列実行と10Hzのtickを回す
func (s *Session) run() {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for {
		select {
		case op, ok := <-s.ops:
			if !ok {
				return
			}
			op()
		case <-ticker.C:
			for _, sc := range s.scripts {
				s.env.current = sc
				sc.tick(s.env, uint32(tickInterval.Milliseconds()))
			}
		}
	}
}

// Close はセッションを停止する(以後のHandleMessage/SyncToは無視される)
func (s *Session) Close() {
	select {
	case <-s.closed:
		return
	default:
		close(s.closed)
		close(s.ops)
	}
}

// enqueue はセッションゴルーチンへの投入。停止後・詰まり時は捨てる
// (posの取りこぼしは無害。reliable系が詰まるのはセッション自体の異常)
func (s *Session) enqueue(op func()) {
	select {
	case <-s.closed:
	default:
		select {
		case s.ops <- op:
		default:
			log.Printf("world %s: session busy, dropping message", s.world.ID)
		}
	}
}

// HandleMessage は通信層(ボット)がDataChannel受信ごとに呼ぶ。
// senderはLiveKitが検証したparticipant identity(詐称不可)
func (s *Session) HandleMessage(sender string, data []byte) {
	var msg incomingMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}
	switch msg.T {
	case "pos":
		s.enqueue(func() { s.positions[sender] = struct{ x, z float64 }{msg.X, msg.Z} })
	case "act":
		s.enqueue(func() { s.handleAct(sender, msg) })
	case "ginput":
		s.enqueue(func() { s.handleInput(sender, msg) })
	}
}

// SyncTo は新規参加者へ現在の累積差分(gsnap)を送る
func (s *Session) SyncTo(identity string) {
	s.enqueue(func() {
		s.broadcast(mustJSON(snapshotMessage{T: "gsnap", Patches: s.patches}), []string{identity})
	})
}

// Forget は退室した参加者の位置記憶を消す
func (s *Session) Forget(identity string) {
	s.enqueue(func() { delete(s.positions, identity) })
}

// worldXZ はノードのワールド座標(親チェーンの相対座標を合算)。
// 循環・異常な深さはdepth上限で打ち切る
func (s *Session) worldXZ(node *nodeState) (float64, float64) {
	x, z := node.x, node.z
	for depth := 0; node.parent != "" && depth < 16; depth++ {
		parent, ok := s.nodes[node.parent]
		if !ok {
			break
		}
		node = parent
		x += node.x
		z += node.z
	}
	return x, z
}

// handleAct は攻撃(act)のジオメトリ判定。hitリスナーのあるノードに当たれば
// スクリプトへhitイベントを配送し、全員へgevent(演出トリガー)を配る
func (s *Session) handleAct(sender string, msg incomingMessage) {
	for nodeID, byEvent := range s.listeners {
		scripts := byEvent["hit"]
		if len(scripts) == 0 {
			continue
		}
		node, ok := s.nodes[nodeID]
		if !ok || !node.visible {
			continue
		}
		nx, nz := s.worldXZ(node)
		hit := false
		switch msg.Name {
		case "slash":
			hit = slashHits(msg.X, msg.Z, msg.Yaw, nx, nz, node.radius)
		case "shoot":
			if msg.Tx != nil && msg.Tz != nil {
				hit = shootHits(msg.X, msg.Z, *msg.Tx, *msg.Tz, nx, nz, node.radius)
			}
		}
		if !hit {
			continue
		}
		s.broadcast(mustJSON(eventMessage{
			T: "gevent", ID: nodeID, Name: "hit", Data: map[string]any{"kind": msg.Name},
		}), nil)
		event := mustJSON(map[string]any{"node": nodeID, "type": "hit", "kind": msg.Name, "by": sender})
		s.dispatch(scripts, event)
	}
}

// handleInput はクリックインタラクト等の入力。interactableかつ購読ノードのみ、
// 送信者の最新位置から3m以内で受理する(ゆるい検証)
func (s *Session) handleInput(sender string, msg incomingMessage) {
	if msg.Action != "interact" {
		return
	}
	node, ok := s.nodes[msg.ID]
	if !ok || !node.def.Interactable || !node.visible {
		return
	}
	if pos, known := s.positions[sender]; known {
		nx, nz := s.worldXZ(node)
		if math.Hypot(pos.x-nx, pos.z-nz) > interactRange+node.radius {
			return
		}
	}
	scripts := s.listeners[msg.ID]["interact"]
	if len(scripts) == 0 {
		return
	}
	event := mustJSON(map[string]any{"node": msg.ID, "type": "interact", "by": sender})
	s.dispatch(scripts, event)
}

func (s *Session) dispatch(scripts []*script, event []byte) {
	for _, sc := range scripts {
		s.env.current = sc
		if err := sc.call(s.env, "asq_event", event); err != nil {
			log.Printf("world %s: %v", s.world.ID, err)
		}
	}
}

// applyPatch はスクリプトからのpatchを権威シーンに適用し全員へ配信する。
// 属性の意味は解釈しないが、当たり判定に関わる既知の属性だけ内部状態に反映する
func (s *Session) applyPatch(id string, attrs map[string]any) {
	node, ok := s.nodes[id]
	if !ok {
		return
	}
	merged, ok := s.patches[id]
	if !ok {
		merged = map[string]any{}
		s.patches[id] = merged
	}
	for key, value := range attrs {
		merged[key] = value
		switch key {
		case "x":
			if f, ok := value.(float64); ok {
				node.x = f
			}
		case "z":
			if f, ok := value.(float64); ok {
				node.z = f
			}
		case "collider":
			if f, ok := value.(float64); ok && f > 0 {
				node.radius = f
			}
		case "visible":
			if b, ok := value.(bool); ok {
				node.visible = b
			}
		}
	}
	s.broadcast(mustJSON(patchMessage{T: "gpatch", ID: id, Attrs: attrs}), nil)
}
