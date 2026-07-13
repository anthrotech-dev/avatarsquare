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
  performAction(name: string, target?: { x: number; z: number }): void
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
  /** restはコマンド名より後の生の残り文字列(チャット本文など改変したくない引数用) */
  execute(ctx: CommandContext, args: string[], rest?: string): void | Promise<void>
}
