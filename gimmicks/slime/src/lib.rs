//! スライム召喚ボタン: interactでスライムが湧く。スライムはアグロ範囲に
//! 最初に入ったプレイヤー(以後は最後に攻撃してきたプレイヤー)を対象に取り、
//! ゆっくり近づいて近接攻撃(演出イベント)を繰り返す。斬撃で倒せる(復活なし)。
//!
//! ボタンはシーン側で宣言する。ノードに `slime` 属性があれば管理対象:
//! ```jsonc
//! { "id": "slime-button", "kind": "cylinder", "interactable": true, ...,
//!   "slime": { "hp": 30, "speed": 1.2, "aggroRange": 6, "attackRange": 1.0,
//!              "attackMs": 2000, "damage": 10, "image": "square/slime.png",
//!              "spawnOffset": [2, 0] } }
//! ```
//! スライム本体はかかしと同じエンティティ規約(親group: targetable/name/hp/hpMax、
//! 子: sprite+バインドbar)で動的にspawnする。同時数の上限は設けない
//! (サーバーのノード上限のみ)。連打の暴発防止にボタンごと250msのCDを持つ。

use asq_sdk::{
    despawn, event, get_all_players, json, listen, log, patch, spawn, Event, Script, Value,
};
use std::collections::HashMap;

const DAMAGE_PER_HIT: i64 = 10;
/// ボタン連打の暴発防止(同時数上限ではない)
const SPAWN_COOLDOWN_MS: i64 = 250;

struct Button {
    x: f64,
    z: f64,
    hp: i64,
    speed: f64,
    aggro_range: f64,
    attack_range: f64,
    attack_ms: i64,
    damage: i64,
    image: String,
    spawn_offset: (f64, f64),
    /// スポーンの連番(id採番用。セッション寿命で単調増加)
    seq: u64,
    spawn_cd: i64,
}

struct Slime {
    x: f64,
    z: f64,
    hp: i64,
    /// 対象プレイヤーのidentity。範囲侵入で獲得、被弾で攻撃者に切替
    target: Option<String>,
    attack_cd: i64,
    speed: f64,
    aggro_range: f64,
    attack_range: f64,
    attack_ms: i64,
    damage: i64,
}

#[derive(Default)]
struct SlimeGimmick {
    buttons: HashMap<String, Button>,
    slimes: HashMap<String, Slime>,
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

impl SlimeGimmick {
    fn spawn_slime(&mut self, button_id: &str) {
        let Some(button) = self.buttons.get_mut(button_id) else {
            return;
        };
        if button.spawn_cd > 0 {
            return;
        }
        button.spawn_cd = SPAWN_COOLDOWN_MS;
        button.seq += 1;
        let id = format!("{button_id}-s{}", button.seq);
        let x = button.x + button.spawn_offset.0;
        let z = button.z + button.spawn_offset.1;
        spawn(
            None,
            json!({
                "id": id, "kind": "group", "x": x, "z": z,
                "targetable": true, "name": "スライム",
                "hp": button.hp, "hpMax": button.hp,
                "children": [
                    { "id": format!("{id}-visual"), "kind": "sprite",
                      "image": button.image, "w": 0.9, "h": 0.7 },
                    { "id": format!("{id}-hp"), "kind": "bar", "y": 1.0, "w": 0.9, "h": 0.14,
                      "source": "parent", "valueFrom": "hp", "maxFrom": "hpMax" }
                ]
            }),
        );
        listen(&id, "hit");
        self.slimes.insert(
            id,
            Slime {
                x,
                z,
                hp: button.hp,
                target: None,
                attack_cd: 0,
                speed: button.speed,
                aggro_range: button.aggro_range,
                attack_range: button.attack_range,
                attack_ms: button.attack_ms,
                damage: button.damage,
            },
        );
    }
}

impl Script for SlimeGimmick {
    fn main(&mut self, world: &Value) {
        let Some(scene) = world["scene"].as_array() else {
            return;
        };
        for node in scene {
            let config = &node["slime"];
            if config.is_null() {
                continue;
            }
            let Some(id) = node["id"].as_str() else {
                continue;
            };
            let offset = config["spawnOffset"].as_array();
            let off = |i: usize| offset.and_then(|a| a.get(i)).and_then(Value::as_f64);
            self.buttons.insert(
                id.to_string(),
                Button {
                    x: node["x"].as_f64().unwrap_or(0.0),
                    z: node["z"].as_f64().unwrap_or(0.0),
                    hp: config["hp"].as_i64().unwrap_or(30).max(1),
                    speed: config["speed"].as_f64().unwrap_or(1.2),
                    aggro_range: config["aggroRange"].as_f64().unwrap_or(6.0),
                    attack_range: config["attackRange"].as_f64().unwrap_or(1.0),
                    attack_ms: config["attackMs"].as_i64().unwrap_or(2000),
                    damage: config["damage"].as_i64().unwrap_or(10).max(0),
                    image: config["image"].as_str().unwrap_or("").to_string(),
                    spawn_offset: (off(0).unwrap_or(2.0), off(1).unwrap_or(0.0)),
                    seq: 0,
                    spawn_cd: 0,
                },
            );
            listen(id, "interact");
            log(&format!("slime button ready: {id}"));
        }
    }

    fn on_event(&mut self, event: &Event) {
        match event.event_type.as_str() {
            "interact" => self.spawn_slime(&event.node.clone()),
            "hit" => {
                let Some(slime) = self.slimes.get_mut(&event.node) else {
                    return;
                };
                slime.hp = (slime.hp - DAMAGE_PER_HIT).max(0);
                patch(&event.node, json!({ "hp": slime.hp }));
                // 最後に攻撃してきたプレイヤーに対象を切り替える
                if let Some(by) = &event.by {
                    slime.target = Some(by.clone());
                }
                if slime.hp == 0 {
                    despawn(&event.node);
                    self.slimes.remove(&event.node);
                }
            }
            _ => {}
        }
    }

    fn on_tick(&mut self, dt_ms: u32) {
        let dt = dt_ms as i64;
        for button in self.buttons.values_mut() {
            button.spawn_cd -= dt;
        }
        if self.slimes.is_empty() {
            return;
        }
        // id昇順で届く(ホスト側でソート済み)ため「最初に範囲に入ったプレイヤー」の
        // 同時侵入タイブレークも決定的になる
        let players = get_all_players();
        for (id, slime) in self.slimes.iter_mut() {
            // 対象が退室していたら解除
            if let Some(target) = &slime.target {
                if !players.iter().any(|p| &p.id == target) {
                    slime.target = None;
                }
            }
            // 未対象ならアグロ範囲に入っている最初のプレイヤーを対象に取る
            if slime.target.is_none() {
                slime.target = players
                    .iter()
                    .find(|p| (p.x - slime.x).hypot(p.z - slime.z) <= slime.aggro_range)
                    .map(|p| p.id.clone());
            }
            slime.attack_cd -= dt;
            let Some(player) = slime
                .target
                .as_ref()
                .and_then(|t| players.iter().find(|p| &p.id == t))
            else {
                continue;
            };
            let dx = player.x - slime.x;
            let dz = player.z - slime.z;
            let dist = dx.hypot(dz);
            if dist > slime.attack_range {
                // 攻撃範囲の境界で止まる(行き過ぎて震えない)
                let step = (slime.speed * dt as f64 / 1000.0).min(dist - slime.attack_range);
                if step > 1e-3 {
                    slime.x = round3(slime.x + dx / dist * step);
                    slime.z = round3(slime.z + dz / dist * step);
                    patch(id, json!({ "x": slime.x, "z": slime.z }));
                }
            }
            // 許容誤差は座標のround3(±0.0007)と移動打ち切り(1e-3)より大きく取る。
            // 小さいと境界で止まったまま永遠に攻撃できないことがある
            if dist <= slime.attack_range + 3e-3 && slime.attack_cd <= 0 {
                slime.attack_cd = slime.attack_ms;
                // 近接攻撃: 足元のhitエフェクトに加え、対象identityとダメージ量を
                // 同梱する(対象クライアントが自分のHPを減らす。クライアント権威)
                event(
                    id,
                    "hit",
                    json!({
                        "x": round3(player.x), "z": round3(player.z),
                        "target": player.id, "damage": slime.damage
                    }),
                );
            }
        }
    }
}

asq_sdk::register_script!(SlimeGimmick);
