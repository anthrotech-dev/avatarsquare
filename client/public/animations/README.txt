ここに walk.vrma / walk.fbx / idle.vrma / idle.fbx を置くと、
組み込みの歩行・待機モーションの代わりに自動で読み込まれます。
それ以外のファイルはアプリにドラッグ&ドロップで登録できます(ファイル名がクリップ名)。
FBXはMixamoリグ(mixamorig*)のものに対応。

エモート用のVRMA_01.vrma 〜 VRMA_07.vrma はここには置かず、
R2(src/ui/hud/emotes.ts の EMOTE_BASE_URL)から実行時に取得します。
