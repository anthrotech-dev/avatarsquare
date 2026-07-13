/**
 * アバター映像キャプチャの共通仕様。
 * 送信側(AvatarStreamer)のオルソ枠と受信側(RemoteAvatars)のビルボード寸法を
 * 一致させることで、受信映像が送信側の見た目と同スケールで再投影される。
 */

/** キャプチャカメラだけに見せるレイヤー。アバター本体をこのレイヤーにも登録する */
export const AVATAR_LAYER = 2

/** キャプチャ枠のワールド寸法(横 x 縦) */
export const CAPTURE_WORLD_W = 2.0
export const CAPTURE_WORLD_H = 2.4

/** キャプチャ枠の中心(アバター足元からの高さ) */
export const CAPTURE_CENTER_Y = 1.1

/** 片側(カラー/マスク)の解像度。キャンバス全体は横2倍 */
export const CAPTURE_PX_W = 320
export const CAPTURE_PX_H = 384

export const CAPTURE_FPS = 20
