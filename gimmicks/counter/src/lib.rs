//! カウンターボタン: クリック(インタラクト)されるたびにカウンターが増える。
//!
//! 対象ノードはシーン側で宣言する。ノードに `counter` 属性があれば管理対象:
//! ```jsonc
//! { "id": "counter-button", "kind": "cylinder", ..., "interactable": true,
//!   "counter": { "label": "counter-label" } }
//! ```
//! `label` はカウント表示に使うtextノードのid(省略可)。

use asq_sdk::{json, listen, log, patch, Event, Script, Value};
use std::collections::HashMap;

struct Target {
    label: Option<String>,
    count: u64,
}

#[derive(Default)]
struct Counter {
    targets: HashMap<String, Target>,
}

impl Script for Counter {
    fn main(&mut self, world: &Value) {
        let Some(scene) = world["scene"].as_array() else {
            return;
        };
        for node in scene {
            let config = &node["counter"];
            if config.is_null() {
                continue;
            }
            let Some(id) = node["id"].as_str() else {
                continue;
            };
            self.targets.insert(
                id.to_string(),
                Target {
                    label: config["label"].as_str().map(String::from),
                    count: 0,
                },
            );
            listen(id, "interact");
            log(&format!("counter ready: {id}"));
        }
    }

    fn on_event(&mut self, event: &Event) {
        if event.event_type != "interact" {
            return;
        }
        let Some(target) = self.targets.get_mut(&event.node) else {
            return;
        };
        target.count += 1;
        if let Some(label) = &target.label {
            patch(label, json!({ "text": target.count.to_string() }));
        }
    }
}

asq_sdk::register_script!(Counter);
