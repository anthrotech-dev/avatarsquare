//! かかし: 攻撃を受けるとHPが減り、0になると倒れて(非表示)しばらく後に復活する。
//!
//! 対象ノードはシーン側で宣言する。ノードに `scarecrow` 属性があれば管理対象:
//! ```jsonc
//! { "id": "scarecrow", "kind": "group", "hp": 100, "hpMax": 100, ...,
//!   "scarecrow": { "hp": 100, "respawnMs": 5000 },
//!   "children": [ /* sprite や source:"parent" のbar など */ ] }
//! ```
//! HPはノード自身の `hp` 属性としてpatchで公開する。ゲージ表示は
//! ワールド側が `bar`(source/valueFrom/maxFrom)を子に置いて実現する。

use asq_sdk::{json, listen, log, patch, Event, Script, Value};
use std::collections::HashMap;

const DAMAGE_PER_HIT: i64 = 10;

struct Target {
    hp: i64,
    max_hp: i64,
    respawn_ms: i64,
    /// 倒れている間の復活までの残り時間(ms)
    down_left: i64,
}

#[derive(Default)]
struct Scarecrow {
    targets: HashMap<String, Target>,
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
            self.targets.insert(
                id.to_string(),
                Target {
                    hp: max_hp,
                    max_hp,
                    respawn_ms: config["respawnMs"].as_i64().unwrap_or(5000),
                    down_left: 0,
                },
            );
            listen(id, "hit");
            log(&format!("scarecrow ready: {id} (hp {max_hp})"));
        }
    }

    fn on_event(&mut self, event: &Event) {
        if event.event_type != "hit" {
            return;
        }
        let Some(target) = self.targets.get_mut(&event.node) else {
            return;
        };
        // 倒れている間は無敵(復活待ち)
        if target.hp <= 0 {
            return;
        }
        target.hp = (target.hp - DAMAGE_PER_HIT).max(0);
        if target.hp == 0 {
            target.down_left = target.respawn_ms;
            patch(&event.node, json!({ "hp": target.hp, "visible": false }));
        } else {
            patch(&event.node, json!({ "hp": target.hp }));
        }
    }

    fn on_tick(&mut self, dt_ms: u32) {
        for (id, target) in self.targets.iter_mut() {
            if target.hp > 0 {
                continue;
            }
            target.down_left -= dt_ms as i64;
            if target.down_left <= 0 {
                target.hp = target.max_hp;
                patch(id, json!({ "visible": true, "hp": target.max_hp }));
            }
        }
    }
}

asq_sdk::register_script!(Scarecrow);
