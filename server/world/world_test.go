package world

import "testing"

const sample = `{
  "version": 1,
  "id": "square",
  "name": "はじまりの広場",
  "size": 60,
  "spawn": {"x": 3, "z": 5},
  "scene": [
    {"id": "ground", "kind": "ground", "texture": "square/ground.webp"},
    {"id": "fountain", "kind": "collider", "shape": "circle", "x": 0, "z": 0, "r": 2.4},
    {"id": "tree-1", "kind": "sprite", "image": "/sprites/tree-pine.png", "x": -22, "z": -16, "w": 2.47, "h": 4.94, "collider": 0.715},
    {"id": "button-1", "kind": "cylinder", "x": 4, "z": 9, "r": 0.4, "interactable": true},
    {"id": "tree-1", "kind": "sprite"},
    {"kind": "sprite"}
  ],
  "scripts": ["../gimmicks/scarecrow.wasm"]
}`

func TestParse(t *testing.T) {
	def, err := Parse([]byte(sample), "https://example.com/worlds/square.json")
	if err != nil {
		t.Fatal(err)
	}
	if def.ID != "square" || def.Name != "はじまりの広場" {
		t.Errorf("id/name = %q/%q", def.ID, def.Name)
	}
	if def.Spawn.X != 3 || def.Spawn.Z != 5 {
		t.Errorf("spawn = %+v", def.Spawn)
	}
	// 重複id・id欠落はスキップされる
	if len(def.Scene) != 4 {
		t.Fatalf("scene nodes = %d, want 4", len(def.Scene))
	}
	tree := def.Scene[2]
	if tree.X != -22 || tree.Collider != 0.715 {
		t.Errorf("tree = %+v", tree)
	}
	if !def.Scene[3].Interactable {
		t.Error("button should be interactable")
	}
	if len(def.Raw) != len(sample) {
		t.Error("Raw should keep original bytes")
	}
}

func TestParseNested(t *testing.T) {
	nested := `{
	  "id": "w",
	  "scene": [
	    {"id": "entity", "kind": "group", "x": -6, "z": -3, "targetable": true, "children": [
	      {"id": "visual", "kind": "sprite", "w": 1.2},
	      {"id": "hpbar", "kind": "bar", "y": 2.0},
	      {"id": "entity", "kind": "sprite"},
	      {"kind": "sprite"}
	    ]},
	    {"id": "dup", "kind": "group", "children": [{"id": "dup-child", "kind": "sprite"}]},
	    {"id": "dup", "kind": "group", "children": [{"id": "dup-child2", "kind": "sprite"}]}
	  ]
	}`
	def, err := Parse([]byte(nested), "")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Node{}
	for _, n := range def.Scene {
		got[n.ID] = n
	}
	// 重複id(entity, dup2つ目)とid欠落はsubtreeごとスキップされる
	want := []string{"entity", "visual", "hpbar", "dup", "dup-child"}
	if len(def.Scene) != len(want) {
		t.Fatalf("scene nodes = %d (%v), want %d", len(def.Scene), def.Scene, len(want))
	}
	for _, id := range want {
		if _, ok := got[id]; !ok {
			t.Errorf("node %q missing", id)
		}
	}
	if _, ok := got["dup-child2"]; ok {
		t.Error("duplicate parent's children should be skipped")
	}
	if got["entity"].Parent != "" || !got["entity"].Targetable {
		t.Errorf("entity = %+v", got["entity"])
	}
	if got["visual"].Parent != "entity" || got["hpbar"].Parent != "entity" {
		t.Errorf("children parent = %q/%q, want entity", got["visual"].Parent, got["hpbar"].Parent)
	}
}

func TestParseRejectsBadID(t *testing.T) {
	if _, err := Parse([]byte(`{"id": "bad id!", "scene": []}`), ""); err == nil {
		t.Error("expected error for invalid id")
	}
	if _, err := Parse([]byte(`not json`), ""); err == nil {
		t.Error("expected error for broken json")
	}
}

func TestResolveURL(t *testing.T) {
	def, err := Parse([]byte(`{"id": "w", "scene": []}`), "https://example.com/worlds/square.json")
	if err != nil {
		t.Fatal(err)
	}
	got, err := def.ResolveURL("../gimmicks/scarecrow.wasm")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://example.com/gimmicks/scarecrow.wasm" {
		t.Errorf("resolved = %q", got)
	}
	abs, _ := def.ResolveURL("https://cdn.example.com/x.wasm")
	if abs != "https://cdn.example.com/x.wasm" {
		t.Errorf("absolute = %q", abs)
	}
}
