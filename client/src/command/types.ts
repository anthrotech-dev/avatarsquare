/**
 * コマンドシステムの型定義。
 * commandモジュールはGameを直接参照せず、GameCommandAPIインターフェースにのみ
 * 依存する(Gameが実装を注入する)。これにより循環importを避けつつ、
 * 将来のプラグインが同じAPIで操作を追加できる。
 */

export interface GameCommandAPI {
  /** A*経路探索して移動する。到達不能ならfalse */
  moveTo(x: number, z: number): boolean
  stop(): void
  /** ジャンプする。空中ならfalse */
  jump(): boolean
  /** targetは向き合わせ・方向スキルの狙い先。tidは対象指定スキルの対象ノードid */
  performAction(name: string, target?: { x: number; z: number }, tid?: string): void
  playEmote(id: string): Promise<void>
  setCameraFollow(mode: 'on' | 'off' | 'toggle'): void
  snapCamera(): void
  setZoom(zoom: number): void
  getPosition(): { x: number; z: number; yaw: number }
  /** マウスカーソル直下の地面座標。カーソルが画面外などで取れなければnull */
  getCursorTarget(): { x: number; z: number } | null
  /** 表示名(ネームプレート)を設定する */
  setName(name: string): void
  /** チャットを送信する(頭上の吹き出し表示+全員へ配信) */
  sendChat(text: string): void
  /** HUD編集モードの切替 */
  setHudEditMode(on: boolean): void
  /** HUD要素の配置をデフォルトに戻す */
  resetHudLayout(): void
  /** 設定ウィンドウを開く */
  openSettings(): void
  /** コマンドパレットを開く */
  openPalette(): void
  /** プレイヤー一覧ウィンドウを開く */
  openPlayers(): void
  /** ボイスチャットウィンドウを開く */
  openVoice(): void
  /**
   * VCへの参加/離脱(マイク公開+他人の声の受聴)。
   * onで初回はマイク許可を求める。失敗はthrow(コマンド側で表示)
   */
  setVoiceEnabled(mode: 'on' | 'off' | 'toggle'): Promise<void>
  /** VC参加中のマイクミュート切替。onで発話可。VC未参加はthrow */
  setMicEnabled(mode: 'on' | 'off' | 'toggle'): Promise<void>
  /**
   * 発音モード。broadcast=距離減衰なしで全員へ、whisper=周囲radius(m)のみ。
   * VC OFF中でも設定でき、次の参加時から効く
   */
  setVoiceMode(mode: 'normal' | 'broadcast' | 'whisper', radius?: number): void
  /** 現在の発音モード(/broadcast・/whisperのトグル判定用) */
  getVoiceMode(): 'normal' | 'broadcast' | 'whisper'
  /** サーバーが提供するワールド一覧(未取得・サーバー未対応なら空) */
  getWorlds(): Array<{ id: string; name: string }>
  /** 現在いるワールド(未ロードならnull) */
  getCurrentWorld(): { id: string; name: string } | null
  /** 別ワールドへ移動する。取得失敗はthrow(コマンド側で表示) */
  switchWorld(id: string): Promise<void>
  /**
   * シーンノードへのインタラクト(結果はサーバー権威のgpatchで返る)。
   * 対象がない・インタラクト不可・離れすぎはthrow(コマンド側で表示)
   */
  interact(id: string): void
  /** 対象を選択する(null=解除)。targetableでないノードはthrow(コマンド側で表示) */
  selectTarget(id: string | null): void
  /**
   * 対象指定スキル用の対象取得。選択済みかつ有効(存在+targetable+可視)なら
   * それを、未選択ならカーソル直下のtargetableエンティティを自動選択して返す。
   * どちらも無ければnull。座標はワールド座標、radiusは射程判定用の的の半径
   */
  acquireTarget(): { id: string; name: string; x: number; z: number; radius: number } | null
  /** チャット入力欄にフォーカスする */
  focusChat(): void
  /** VRMファイル選択ダイアログを開く */
  openVrmPicker(): void
  /** キャッシュ済みVRMを削除する */
  clearVrmCache(): void
  /** レンダラー統計(描画コール・プログラム数など)。性能問題の切り分け用 */
  getRenderStats(): string[]
}

export interface CommandOutput {
  print(text: string): void
  error(text: string): void
}

export interface CommandContext {
  api: GameCommandAPI
  out: CommandOutput
  /** マクロの入れ子の深さ。再帰爆発の防止に使う */
  depth: number
}

export interface CommandDef {
  /** 先頭スラッシュなしの名前 */
  name: string
  aliases?: string[]
  description: string
  /** 例: '/move <x> <z>' */
  usage?: string
  /** 実行後この時間(ms)は再実行を無視する。CD中の実行は黙って捨てられる */
  cooldownMs?: number
  /**
   * restはコマンド名より後の生の残り文字列(チャット本文など改変したくない引数用)。
   * falseを返すと「発動不成立」(対象なし・射程外など)としてクールダウンが返金される。
   * void(undefined)を返す既存コマンドはCD消費のまま変わらない
   */
  execute(
    ctx: CommandContext,
    args: string[],
    rest?: string,
  ): undefined | boolean | Promise<undefined | boolean> | void | Promise<void>
}
