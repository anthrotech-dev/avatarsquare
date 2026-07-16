# avatarsquare

avatarsquareは、アバターを使い、リアルタイムに他の人と交流できるwebアプリケーションです。
league of legendsのような見下ろし型の視点で、アバターを操作しながら、他のユーザーとチャットやゲームを楽しむことができます。

通信にはwebRTCを使用します。ユーザーは自分のアバターの描画結果と、現在位置などをストリームとして送信し、他のユーザーはそのストリームを受信して表示します。これにより、リアルタイムでの交流が可能になります。これによりアバターの3Dモデルを送信することなく他人に表示できるため、安全にアバターを共有することができます。

## だいじなこと
- アバターの3Dモデルを送信することなく、描画結果をストリームとして送信することで、他人に安全にアバターを共有できるようにします。
- 拡張性が大事です。例えばすべての操作をコマンドというインターフェースに統一することで、新しく機能を追加した際も、それにアクセスしやすくなります。
    - 厳密さよりも拡張性のほうが大事です。avatarsquareは厳密なゲームというよりはコミュニケーションツールであるため、ユーザーのチートを防止することよりも、ユーザーが自由に楽しめることを優先します。
- 本当はユーザーが自由にプラグインやマップサーバーを開発して、アバターのアクションやゲームのルール・マップなどを追加できるようにしたいです。ユーザーが自由にプラグインを開発できるようにすることで、avatarsquareはより多様な楽しみ方ができるようになります。

### 開発環境の起動

LiveKitは開発サーバーでsystemdサービスとして稼働しており、`wss://livekit.anthrotech.dev`
(nginxでSSL終端、メディアはUDP 7882 / TCP 7881直通)で利用できる。
手元ではトークンサーバーとクライアントだけを動かす:

```sh
go run ./server           # トークン発行API (server/ にて、ポート8787。airでも可)
cd client && pnpm dev     # クライアント (Vite)
```

- トークンサーバーが返すLiveKitのURLは既定で`wss://livekit.anthrotech.dev`。
  署名キーは`server/.env`(git管理外、`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`)で開発サーバーと揃える
- トークンサーバーはk8s上に`https://avatarsquare-api.anthrotech.dev`としてデプロイ済み(後述の「デプロイ」参照)。
  手元で動かしたものをHTTPトンネルで公開して使うこともできる
- LiveKitもローカルで完結させたい場合は`docker compose up -d`し、`LIVEKIT_URL=ws://localhost:7880 go run ./server`
  (この場合`.env`のキーはコメントアウトしてdevkey/secretに戻す)

ブラウザで開くとサーバーの`/worlds`からワールド一覧を取得し、先頭のワールドに入室します
(`?world=xxx`でワールド選択、`?room=xxx`で入室ルームだけ変更、サーバー未対応・オフライン時は
public同梱の`square`にフォールバック)。

### ワールド

マップは「ワールド」としてJSONで定義され、サーバーが配信します。ワールドJSONは
HTMLとJavaScriptの関係で構成されます: `scene`が汎用ノードの列
(`ground`=地面テクスチャURL / `sprite`=ビルボード画像 / `collider`=通行不可領域 /
`text`・`bar`・`box`・`cylinder`)、`scripts`がノードをidで参照して動かす
wasmスクリプト(Rust製、`gimmicks/`)のURLです。

- サーバーは環境変数`WORLD_URLS`(カンマ区切り)で信頼できるワールドJSONのURLを指定して起動する。
  各ワールドのLiveKitルームにボット(`__world`)として常駐し、wasmスクリプトを実行して
  ギミック状態(かかしのHP・ボタンのカウンター等)をサーバー権威で同期する
- `/world`でワールド一覧、`/world <id>`で移動(ロード画面を挟んで再接続)。
  ワールド内のポータル(`portal: "<行き先id>"`属性を持つノード)を左クリックしても移動できる
- ボタン等のインタラクト可能なオブジェクトは左クリック(または`/interact <id>`)
- ワールドの生成器は`client/scripts/generate-square/`・`generate-island/`、
  wasmスクリプトのビルドは`gimmicks/build.sh`(成果物はコミット済みなのでRust無しでも動く)
- ローカル開発: `WORLD_URLS='http://localhost:5174/worlds/square.json' go run .`(server/にて。
  viteのポートは環境に合わせる)

トークンサーバーのエンドポイントは既定で`https://avatarsquare-api.anthrotech.dev/token`です。
画面上の入力欄(localStorageに保存)、`?endpoint=`クエリ、環境変数`VITE_TOKEN_URL`のいずれでも変更できます
(優先順: クエリ > 入力欄 > 環境変数 > 既定値)。ローカル開発時は`http://localhost:8787/token`を指定してください。
※`.dev`TLDはHSTSプリロード対象のため、これらのドメインを平文http/wsで使うことはできません(TLS必須)。
`.vrm`をドラッグ&ドロップでアバター読み込み、`.vrma`/Mixamo系`.fbx`でモーション登録ができます。
ファイル名(拡張子除く)がクリップ名になり、`walk`/`idle`/`jump`/`slash`/`shoot`は対応する組み込みモーションを差し替えます。

### デプロイ

トークンサーバーのDockerイメージは、`main`への`server/**`のpushを契機にGitHub Actions
(`.github/workflows/build-server-image.yml`)がビルドし、`ghcr.io/anthrotech-dev/avatarsquare/server`
(`latest`と`sha-<commit>`タグ)へpushする。

k8sへのデプロイは`deploy/k8s/`のマニフェストを使う:

```sh
# LiveKitの署名キー(server/.envと同じ値)をSecretとして作成
kubectl create secret generic avatarsquare-server \
  --from-literal=LIVEKIT_API_KEY=<key> \
  --from-literal=LIVEKIT_API_SECRET=<secret>
kubectl apply -f deploy/k8s/deployment.yaml -f deploy/k8s/service.yaml
```

- Serviceは ClusterIP(ポート8787)まで。外部公開(TLS終端含む)はクラスタ側のIngress等で行う
- LiveKit自体はk8s管理外(既存の`wss://livekit.anthrotech.dev`を利用)
- リポジトリがprivateの場合、GHCRのpackageをpublicにするか`imagePullSecrets`の設定が必要

### 操作方法

- 右クリック: 移動 / 左クリック: オブジェクトにインタラクト / ホイール: ズーム / Space: ジャンプ
- Esc: メニュー(コマンドパレット・HUDレイアウト編集・設定への入口)
- 1〜9, 0: ホットバー実行。メニューから開くコマンドパレットの項目をドラッグ&ドロップで割当、
  スロット間ドラッグで入替、スロット外へドラッグで削除(割当はlocalStorageに保存)
- HUD編集モード(⚙→HUDレイアウト編集、または`/hud edit`): ホットバー・チャット・ステータス・設定ボタンをドラッグで好きな位置へ移動でき、
  👁ボタンで各要素を非表示にもできる(設定ボタンを消してもEsc→メニュー→設定から開ける)。`/hud reset`で配置・表示とも初期状態に戻る。
  編集モード中にホットバーの⚙から各スロットのキーボードショートカット(任意キー+Shift/Ctrl/Alt)を変更できる
- Y: カメラ追従/固定の切替(固定中は画面端で視点スクロール)
- ボイスチャット: `/vc on`で参加(マイク発行+他の人の声が聞こえる。初回はマイク許可を求められます)、
  `/vc off`で離脱、`/mic on|off|toggle`でミュート切替。`/voice`(またはメニュー)でウィンドウを開くと
  参加者ごとの音量・全体音量を調整できます。マイクデバイスと入力感度(ノイズゲート)は設定パネルで選択・調整。
  入力感度はマイク音量のライブメーターに黄色いつまみを合わせて設定し、つまみより右に振れた音だけが送信されます
  (閾値未満のキーボード音・環境音は相手に届きません)。
  声はアバターの位置に応じて空間定位され(近いほど大きく、左右にパン)、話すとアバターの口が動き、
  ネームプレートが発話色になります。VC参加中はネームプレートに🎤(ミュート中は🔇)がつき、
  右上のVCパネルで現在の状態を確認・切替できます。
  発音モードは3種類: 通常(距離減衰あり)のほか、`/broadcast`で距離に関係なく全員に届くブロードキャスト(📢)、
  `/whisper [半径m]`で周囲の円の中の人にだけ聞こえるウィスパー(🤫、既定5m・1〜15m)に切り替えられます
  (再実行で通常に戻る。正式形は`/vc mode <normal|broadcast|whisper> [半径]`、ウィンドウのボタンでも切替可)。
  ウィスパー中はアバターの足元に可聴範囲の円が全員に見えます
- Enter: チャット欄にフォーカス。そのまま送信するとチャットとして全員に届き、
  アバターの頭上に吹き出しで数秒間表示される。`/`始まりでコマンド実行(`/help`で一覧)。
  `/say <text>`でもチャットでき、`/`で始まる文を送りたいときは`/say /hello`のようにする
- ⚙(右上): プレイヤー名・接続設定・VRM読込・カメラ操作・マクロ編集

読み込んだVRMはIndexedDBにキャッシュされ、次回リロード時に自動で復元されます(設定パネルから削除可)。
プレイヤー名(設定パネルまたは`/name <名前>`)はアバターの頭上のネームプレートに表示され、他のユーザーにも見えます。未設定時はVRMのモデル名が表示されます。

すべての操作はコマンド(`/move` `/jump` `/attack` `/shoot` `/emote` `/camera`など)に統一されており、
設定画面で作ったマクロ(1行1コマンド、`/wait`で間を取れる)はマクロ名がそのままコマンドになります
(例: マクロ`combo`は`/combo`で実行)。ホットバーのスロットにはコマンド・エモート・マクロ・任意のコマンド文字列を割り当てられます。

