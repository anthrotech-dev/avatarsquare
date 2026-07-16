#!/bin/sh
# ワールドスクリプト(wasm)のビルドと配置。
# 成果物はclient/public/gimmicks/にコミットする(Rustツールチェーン無しでも
# サーバー・クライアントを動かせるようにするため)。変更時はこれで再生成する。
set -eu
cd "$(dirname "$0")"

rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown

out=../client/public/gimmicks
mkdir -p "$out"
for name in scarecrow counter slime; do
  cp "target/wasm32-unknown-unknown/release/$name.wasm" "$out/$name.wasm"
done
ls -la "$out"
