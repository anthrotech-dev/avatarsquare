//! かかし: 攻撃を受けるとHPが減り、0になると消滅(despawn)し、
//! しばらく後に「別のかかし」が同じ場所にスポーンする。
//!
//! 対象ノードはシーン側で宣言する。ノードに `scarecrow` 属性があれば管理対象:
//! ```jsonc
//! { "id": "scarecrow", "kind": "group", "hp": 100, "hpMax": 100, ...,
//!   "scarecrow": { "hp": 100, "respawnMs": 5000 },
//!   "children": [ /* sprite や source:"parent" のbar など */ ] }
//! ```
//! HPはノード自身の `hp` 属性としてpatchで公開する。ゲージ表示は
//! ワールド側が `bar`(source/valueFrom/maxFrom)を子に置いて実現する。
//! 復活は元ノードJSONをテンプレートに、subtree内の全idへ `@世代` を付けた
//! 新エンティティをspawnする(=クライアントの選択などは自然に外れる)。

use asq_sdk::{despawn, json, listen, log, patch, spawn, Event, Script, Value};

const DAMAGE_PER_HIT: i64 = 10;
/// 斬撃(kind=slash)被弾で付くよろめきデバフの持続時間。表示専用(slimeと同じ規約)。
/// ノード属性buffsの汎用規約(remainingMs=送信時点の残り時間)でクライアントに配る
const STAGGER_MS: i64 = 5000;

struct Target {
    hp: i64,
    max_hp: i64,
    respawn_ms: i64,
    /// 消滅中の復活までの残り時間(ms)。0以下は生存中
    down_left: i64,
    /// 元のノードJSON(childrenごと)。復活時のspawn元
    template: Value,
    /// 現在生きているノードのid(世代サフィックス付き)
    live_id: String,
    /// 復活の世代。スポーンごとに+1してid衝突を避ける
    gen: u32,
    /// よろめきデバフの残りms(0以下=なし)。斬撃被弾でリフレッシュ
    stagger_ms: i64,
}

#[derive(Default)]
struct Scarecrow {
    targets: Vec<Target>,
}

/// subtree内の全idに `@世代` サフィックスを付ける(テンプレートのidが基準)
fn rewrite_ids(node: &mut Value, gen: u32) {
    if let Some(id) = node["id"].as_str() {
        let renamed = format!("{id}@{gen}");
        node["id"] = Value::String(renamed);
    }
    if let Some(children) = node["children"].as_array_mut() {
        for child in children {
            rewrite_ids(child, gen);
        }
    }
}

impl Script for Scarecrow {
    fn main(&mut self, world: &Value) {
        let Some(scene) = world["scene"].as_array() else {
            return;
        };
        for node in scene {
            let config = &node["scarecrow"];
            if config.is_null() {
                continue;
            }
            let Some(id) = node["id"].as_str() else {
                continue;
            };
            let max_hp = config["hp"].as_i64().unwrap_or(100).max(1);
            self.targets.push(Target {
                hp: max_hp,
                max_hp,
                respawn_ms: config["respawnMs"].as_i64().unwrap_or(5000),
                down_left: 0,
                template: node.clone(),
                live_id: id.to_string(),
                gen: 0,
                stagger_ms: 0,
            });
            listen(id, "hit");
            log(&format!("scarecrow ready: {id} (hp {max_hp})"));
        }
    }

    fn on_event(&mut self, event: &Event) {
        if event.event_type != "hit" {
            return;
        }
        let Some(target) = self.targets.iter_mut().find(|t| t.live_id == event.node) else {
            return;
        };
        // 消滅中(復活待ち)のイベントは無視(通常は届かない)
        if target.hp <= 0 {
            return;
        }
        target.hp = (target.hp - DAMAGE_PER_HIT).max(0);
        // 斬撃はよろめきデバフを与える(再被弾で残り時間リフレッシュ。slimeと同じ規約)
        if event.kind.as_deref() == Some("slash") && target.hp > 0 {
            target.stagger_ms = STAGGER_MS;
            patch(
                &event.node,
                json!({ "hp": target.hp, "buffs": [{
                    "id": "stagger", "name": "よろめき", "kind": "debuff",
                    "remainingMs": STAGGER_MS, "durationMs": STAGGER_MS
                }] }),
            );
        } else {
            patch(&event.node, json!({ "hp": target.hp }));
        }
        if target.hp == 0 {
            target.down_left = target.respawn_ms;
            // 復活後は新ノード(テンプレート由来)なのでデバフは持ち越さない
            target.stagger_ms = 0;
            despawn(&event.node);
        }
    }

    fn on_tick(&mut self, dt_ms: u32) {
        for target in self.targets.iter_mut() {
            if target.hp > 0 {
                // よろめきの期限切れ。剥奪のpatch(空配列)だけを期限を跨いだ1回だけ送る
                if target.stagger_ms > 0 {
                    target.stagger_ms -= dt_ms as i64;
                    if target.stagger_ms <= 0 {
                        target.stagger_ms = 0;
                        patch(&target.live_id, json!({ "buffs": [] }));
                    }
                }
                continue;
            }
            target.down_left -= dt_ms as i64;
            if target.down_left <= 0 {
                // 「別のかかし」として新しいidでスポーンし直す
                target.gen += 1;
                let mut node = target.template.clone();
                rewrite_ids(&mut node, target.gen);
                node["hp"] = json!(target.max_hp);
                let live_id = node["id"].as_str().unwrap_or_default().to_string();
                spawn(None, node);
                listen(&live_id, "hit");
                target.live_id = live_id;
                target.hp = target.max_hp;
            }
        }
    }
}

asq_sdk::register_script!(Scarecrow);
