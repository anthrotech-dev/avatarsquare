//! ワールドスクリプトSDK。
//!
//! avatarsquareのワールドはHTMLとJavaScriptの関係で構成される:
//! ワールドJSONの`scene`が汎用ノードの列(HTML)、wasmスクリプトがそれらを
//! idで見つけてイベントを購読し属性を書き換えるロジック(JavaScript)にあたる。
//!
//! スクリプトは[`Script`]トレイトを実装して[`register_script!`]で登録する。
//! - `main(world)`: ロード時に1回、ワールドJSON全体を受け取る。ここで`listen`を呼ぶ
//! - `on_event(event)`: 購読したノードのイベント(hit/interact)を受け取る
//! - `on_tick(dt_ms)`: 約10Hzで呼ばれる(タイマー処理用)
//!
//! 状態の可視化は[`patch`]でノード属性を書き換える(サーバーが全クライアントへ配信)。
//!
//! # ABI (v1)
//! - export: `asq_alloc(len)->ptr`(入力バッファ確保。次の呼び出しまで有効)、
//!   `asq_main(ptr,len)` / `asq_event(ptr,len)`(JSON文字列)、`asq_tick(dt_ms)`
//! - import (module "asq"): `log(ptr,len)` / `listen(id_ptr,id_len,ev_ptr,ev_len)` /
//!   `patch(ptr,len)`(`{"id":…,"attrs":{…}}`)
//!
//! ABIのホスト側実装(正本)は server/scene/abi.go を参照。

pub use serde_json::{self, json, Value};

mod ffi {
    #[link(wasm_import_module = "asq")]
    extern "C" {
        pub fn log(ptr: *const u8, len: usize);
        pub fn listen(id_ptr: *const u8, id_len: usize, ev_ptr: *const u8, ev_len: usize);
        pub fn patch(ptr: *const u8, len: usize);
    }
}

/// サーバーログへ出力する(接頭辞にスクリプト名がつく)
pub fn log(message: &str) {
    unsafe { ffi::log(message.as_ptr(), message.len()) }
}

/// ノードのイベントを購読する。event: "hit"(攻撃が当たった) / "interact"(クリック)
pub fn listen(node_id: &str, event: &str) {
    unsafe { ffi::listen(node_id.as_ptr(), node_id.len(), event.as_ptr(), event.len()) }
}

/// ノードの属性を書き換える。サーバーが権威シーンに適用し全クライアントへ配信する
pub fn patch(node_id: &str, attrs: Value) {
    let payload = json!({ "id": node_id, "attrs": attrs }).to_string();
    unsafe { ffi::patch(payload.as_ptr(), payload.len()) }
}

/// 購読したノードに起きたイベント
#[derive(serde::Deserialize)]
pub struct Event {
    /// イベントが起きたノードid
    pub node: String,
    /// "hit" | "interact"
    #[serde(rename = "type")]
    pub event_type: String,
    /// hitの攻撃種別("slash" | "shoot"など)
    #[serde(default)]
    pub kind: Option<String>,
    /// 起こしたプレイヤーのidentity
    #[serde(default)]
    pub by: Option<String>,
}

pub trait Script: Default {
    fn main(&mut self, world: &Value);
    fn on_event(&mut self, event: &Event);
    fn on_tick(&mut self, _dt_ms: u32) {}
}

/// ABIのエントリポイント(no_mangleシム)をスクリプトクレート側に展開する。
/// SDK側に置くとリンカに落とされ得るためマクロで提供する。
#[macro_export]
macro_rules! register_script {
    ($t:ty) => {
        thread_local! {
            static __ASQ_STATE: std::cell::RefCell<$t> = Default::default();
            static __ASQ_INBUF: std::cell::RefCell<Vec<u8>> = Default::default();
        }

        #[no_mangle]
        pub extern "C" fn asq_alloc(len: usize) -> *mut u8 {
            __ASQ_INBUF.with(|b| {
                let mut b = b.borrow_mut();
                b.resize(len, 0);
                b.as_mut_ptr()
            })
        }

        fn __asq_input(len: usize) -> String {
            __ASQ_INBUF.with(|b| String::from_utf8_lossy(&b.borrow()[..len]).into_owned())
        }

        #[no_mangle]
        pub extern "C" fn asq_main(_ptr: *const u8, len: usize) {
            let input = __asq_input(len);
            let world: $crate::Value =
                $crate::serde_json::from_str(&input).unwrap_or($crate::Value::Null);
            __ASQ_STATE.with(|s| $crate::Script::main(&mut *s.borrow_mut(), &world));
        }

        #[no_mangle]
        pub extern "C" fn asq_event(_ptr: *const u8, len: usize) {
            let input = __asq_input(len);
            if let Ok(event) = $crate::serde_json::from_str::<$crate::Event>(&input) {
                __ASQ_STATE.with(|s| $crate::Script::on_event(&mut *s.borrow_mut(), &event));
            }
        }

        #[no_mangle]
        pub extern "C" fn asq_tick(dt_ms: u32) {
            __ASQ_STATE.with(|s| $crate::Script::on_tick(&mut *s.borrow_mut(), dt_ms));
        }
    };
}
