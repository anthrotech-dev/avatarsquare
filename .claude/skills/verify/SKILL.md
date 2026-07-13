---
name: verify
description: avatarsquareの変更をヘッドレスブラウザ2クライアントで実機検証する手順
---

# avatarsquare 実機検証レシピ

## 起動

ユーザーが開発中はトークンサーバー(port 8787、airビルドでプロセス名"main")と
viteを常駐させていることが多い。**既存プロセスを殺さない**。

```sh
ss -ltnp | grep -E '8787|517[0-9]'   # 既存確認。8787が生きていればそのまま使う
go run ./server &                     # 必要な場合のみ(リポジトリルートで実行。cwd注意)
cd client && pnpm dev &               # ポートは自動採番(5173が塞がっていると5174等)。ログでURL確認
```

## ブラウザ駆動

Playwrightブラウザは ~/.cache/ms-playwright/chromium_headless_shell-* にキャッシュ済み。
scratchpadに `npm i playwright-core` して executablePath 指定で起動する。
WebGLに `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` が必要。

```js
const page = await browser.newPage()
await page.goto(`http://localhost:5174/?room=verify-${rand}&endpoint=${encodeURIComponent('http://localhost:8787/token')}`)
await page.waitForFunction(() => document.body.innerText.includes('接続中:')) // 接続完了
```

- **使い捨てルーム名必須**(`?room=verify-xxx`)。LiveKitは切断後も参加者を猶予保持する上、
  共用ルームsquareに実ユーザーがいることがある
- 2クライアント検証は同一browserの別contextでOK

## 操作の落とし穴

- チャット入力: `page.locator('.hud-chat-input')` に `fill()` + `press('Enter')` が確実。
  `keyboard.press('Enter')`でのフォーカストグルは「フォーカス済み+空でEnter→blur」の挙動で
  タイプが迷子になる
- チャットログ検証: `.hud-chat-entry` / `.hud-chat-from` を読む
- 吹き出し・エフェクト等の3D表示はスクリーンショットで目視確認(表示時間3〜10秒内に撮る)
