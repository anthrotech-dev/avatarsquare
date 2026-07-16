import { clampWhisperRadius, isVoiceMode } from '../net/protocol'
import type { CommandRegistry } from './CommandRegistry'
import type { MacroStore } from './macros'
import { macroAsCommand } from './macros'
import type { CommandContext, CommandDef } from './types'

/** 射撃の射程。方向指定スキルなので飛距離は狙い先によらず一定 */
const SHOOT_RANGE = 6

/** 斬撃の射程(対象指定)。サーバーの検証(hit.goのslashRange)のミラー */
const SLASH_RANGE = 2.2

/** 攻撃スキル(斬撃・射撃)のクールダウン */
const SKILL_COOLDOWN_MS = 3000

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function forwardTarget(ctx: CommandContext, distance: number): { x: number; z: number } {
  const { x, z, yaw } = ctx.api.getPosition()
  // モデルは+Z向きが正面。yaw = atan2(dx, dz)
  return { x: x + Math.sin(yaw) * distance, z: z + Math.cos(yaw) * distance }
}

/**
 * 方向指定スキルの着弾点を求める。引数の座標は「狙う方向」の指定で、
 * 省略時はカーソル直下の地面座標を狙う(ホットバー・キーボード発動で自動的に入る)。
 * 飛距離は狙い先によらずrangeで一定。方向が定まらない場合は向いている方へ
 */
function resolveDirectionTarget(
  ctx: CommandContext,
  args: string[],
  range: number,
): { x: number; z: number } | null {
  let aim: { x: number; z: number } | null
  if (args.length === 0) {
    aim = ctx.api.getCursorTarget()
  } else {
    const x = parseNumber(args[0])
    const z = parseNumber(args[1])
    if (x === null || z === null) return null
    aim = { x, z }
  }
  if (!aim) return forwardTarget(ctx, range)
  const { x, z } = ctx.api.getPosition()
  const dx = aim.x - x
  const dz = aim.z - z
  const length = Math.hypot(dx, dz)
  // 狙い先が自分と同一地点で方向が定まらないときも前方へ
  if (length < 1e-6) return forwardTarget(ctx, range)
  return { x: x + (dx / length) * range, z: z + (dz / length) * range }
}

const VOICE_MODE_LABELS = {
  normal: '通常発話に戻しました',
  broadcast: '📢 ブロードキャスト: 距離に関係なく全員に届きます',
  whisper: '🤫 ウィスパー: 円の中の人にだけ聞こえます',
} as const

/**
 * 発音モードの設定と結果表示。whisperは半径(m)を指定でき、範囲外はクランプする。
 * 半径が数値でないときはnullを返す(呼び出し側でusage表示)。
 */
function applyVoiceMode(
  ctx: CommandContext,
  mode: 'normal' | 'broadcast' | 'whisper',
  radiusArg?: string,
): boolean {
  let radius: number | undefined
  if (radiusArg !== undefined) {
    const n = parseNumber(radiusArg)
    if (n === null) return false
    radius = clampWhisperRadius(n)
  }
  ctx.api.setVoiceMode(mode, radius)
  let label: string = VOICE_MODE_LABELS[mode]
  if (mode === 'whisper' && radius !== undefined) label += `(半径${radius}m)`
  ctx.out.print(label)
  return true
}

export function registerBuiltins(registry: CommandRegistry, macros: MacroStore): void {
  const defs: CommandDef[] = [
    {
      name: 'move',
      description: '指定座標へ移動する',
      usage: '/move <x> <z>',
      execute(ctx, args) {
        const x = parseNumber(args[0])
        const z = parseNumber(args[1])
        if (x === null || z === null) {
          ctx.out.error('使い方: /move <x> <z>')
          return
        }
        if (!ctx.api.moveTo(x, z)) ctx.out.error('そこへは移動できません')
      },
    },
    {
      name: 'stop',
      description: '移動を中止する',
      execute(ctx) {
        ctx.api.stop()
      },
    },
    {
      name: 'jump',
      description: 'ジャンプする',
      execute(ctx) {
        ctx.api.jump()
      },
    },
    {
      name: 'attack',
      aliases: ['slash'],
      description: '選択中の対象を斬りつける(未選択ならカーソル直下を自動選択)',
      cooldownMs: SKILL_COOLDOWN_MS,
      execute(ctx) {
        // 対象指定スキル: 対象がいない・射程外なら発動しない(falseでCD返金)
        const target = ctx.api.acquireTarget()
        if (!target) {
          ctx.out.error('対象を選択してください')
          return false
        }
        const { x, z } = ctx.api.getPosition()
        if (Math.hypot(target.x - x, target.z - z) - target.radius > SLASH_RANGE) {
          ctx.out.error(`「${target.name}」は射程外です。近づいてください`)
          return false
        }
        ctx.api.performAction('slash', { x: target.x, z: target.z }, target.id)
      },
    },
    {
      name: 'target',
      description: '対象を選択/解除する(対象可能ノードのクリックでも選択できる)',
      usage: '/target <ノードid|clear>',
      execute(ctx, args) {
        if (!args[0]) {
          ctx.out.error('使い方: /target <ノードid|clear>')
          return
        }
        ctx.api.selectTarget(args[0] === 'clear' ? null : args[0])
      },
    },
    {
      name: 'shoot',
      description: '弾を撃つ(方向指定・射程一定)。座標省略時はカーソルの方向へ',
      usage: '/shoot [x z]',
      cooldownMs: SKILL_COOLDOWN_MS,
      execute(ctx, args) {
        const target = resolveDirectionTarget(ctx, args, SHOOT_RANGE)
        if (!target) {
          ctx.out.error('使い方: /shoot [x z]')
          return
        }
        ctx.api.performAction('shoot', target)
      },
    },
    {
      name: 'emote',
      aliases: ['e'],
      description: 'エモートを再生する',
      usage: '/emote <id>',
      async execute(ctx, args) {
        if (!args[0]) {
          ctx.out.error('使い方: /emote <id>')
          return
        }
        await ctx.api.playEmote(args[0])
      },
    },
    {
      name: 'camera',
      description: 'カメラを操作する',
      usage: '/camera <follow|fixed|toggle|snap>',
      execute(ctx, args) {
        switch (args[0]) {
          case 'follow':
            ctx.api.setCameraFollow('on')
            break
          case 'fixed':
            ctx.api.setCameraFollow('off')
            break
          case 'toggle':
            ctx.api.setCameraFollow('toggle')
            break
          case 'snap':
            ctx.api.snapCamera()
            break
          default:
            ctx.out.error('使い方: /camera <follow|fixed|toggle|snap>')
        }
      },
    },
    {
      name: 'zoom',
      description: 'ズームを設定する(小さいほど寄る)',
      usage: '/zoom <n>',
      execute(ctx, args) {
        const zoom = parseNumber(args[0])
        if (zoom === null) {
          ctx.out.error('使い方: /zoom <n>')
          return
        }
        ctx.api.setZoom(zoom)
      },
    },
    {
      name: 'wait',
      description: '指定秒数待つ(マクロ用)',
      usage: '/wait <秒>',
      async execute(ctx, args) {
        const seconds = parseNumber(args[0])
        if (seconds === null || seconds < 0 || seconds > 60) {
          ctx.out.error('使い方: /wait <秒> (0〜60)')
          return
        }
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
      },
    },
    {
      name: 'echo',
      description: 'テキストをログに表示する',
      usage: '/echo <text>',
      execute(ctx, args) {
        ctx.out.print(args.join(' '))
      },
    },
    {
      name: 'say',
      description: 'チャットを送信する(頭上に吹き出し表示)',
      usage: '/say <text>',
      execute(ctx, args, rest) {
        // restで連続スペースや引用符をそのまま送る(発言を改変しない)
        const text = rest ?? args.join(' ')
        if (!text) {
          ctx.out.error('使い方: /say <text>')
          return
        }
        ctx.api.sendChat(text)
      },
    },
    {
      name: 'name',
      description: '表示名を設定する(ネームプレートに表示)',
      usage: '/name <名前>',
      execute(ctx, args) {
        if (args.length === 0) {
          ctx.out.print('使い方: /name <名前>')
          return
        }
        // スペース入りの名前に対応
        ctx.api.setName(args.join(' '))
      },
    },
    {
      name: 'where',
      description: '現在座標を表示する',
      execute(ctx) {
        const { x, z } = ctx.api.getPosition()
        ctx.out.print(`現在位置: (${x.toFixed(1)}, ${z.toFixed(1)})`)
      },
    },
    {
      name: 'world',
      description: 'ワールド一覧の表示・別ワールドへの移動',
      usage: '/world [id]',
      async execute(ctx, args) {
        if (!args[0]) {
          const worlds = ctx.api.getWorlds()
          if (worlds.length === 0) {
            ctx.out.print('ワールド一覧を取得できません(サーバー未対応またはオフライン)')
            return
          }
          const current = ctx.api.getCurrentWorld()
          for (const w of worlds) {
            ctx.out.print(`${w.id === current?.id ? '▶ ' : ''}${w.id}: ${w.name}`)
          }
          ctx.out.print('/world <id> で移動できます')
          return
        }
        if (args[0] === ctx.api.getCurrentWorld()?.id) {
          ctx.out.print('すでにそのワールドにいます')
          return
        }
        try {
          await ctx.api.switchWorld(args[0])
        } catch (err) {
          ctx.out.error(
            `ワールドへ移動できません: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
    {
      name: 'interact',
      description: '近くのオブジェクト(ボタン等)にインタラクトする',
      usage: '/interact <id>',
      execute(ctx, args) {
        if (!args[0]) {
          ctx.out.error('使い方: /interact <id>')
          return
        }
        try {
          ctx.api.interact(args[0])
        } catch (err) {
          ctx.out.error(err instanceof Error ? err.message : String(err))
        }
      },
    },
    {
      name: 'macro',
      aliases: ['m'],
      description: 'マクロを実行する',
      usage: '/macro <name>',
      async execute(ctx, args) {
        if (!args[0]) {
          const names = macros.list().map((m) => m.name)
          ctx.out.print(names.length ? `マクロ: ${names.join(', ')}` : 'マクロはありません')
          return
        }
        const macro = macros.get(args[0])
        if (!macro) {
          ctx.out.error(`マクロ「${args[0]}」がありません`)
          return
        }
        await macroAsCommand(macro, registry).execute(ctx, [])
      },
    },
    {
      name: 'hud',
      description: 'HUDレイアウトを編集する',
      usage: '/hud <edit|done|reset>',
      execute(ctx, args) {
        switch (args[0]) {
          case 'edit':
            ctx.api.setHudEditMode(true)
            break
          case 'done':
            ctx.api.setHudEditMode(false)
            break
          case 'reset':
            ctx.api.resetHudLayout()
            ctx.out.print('HUDの配置をリセットしました')
            break
          default:
            ctx.out.error('使い方: /hud <edit|done|reset>')
        }
      },
    },
    {
      name: 'settings',
      description: '設定ウィンドウを開く',
      execute(ctx) {
        ctx.api.openSettings()
      },
    },
    {
      name: 'palette',
      description: 'コマンドパレットを開く',
      execute(ctx) {
        ctx.api.openPalette()
      },
    },
    {
      name: 'players',
      aliases: ['who'],
      description: 'プレイヤー一覧を開く',
      execute(ctx) {
        ctx.api.openPlayers()
      },
    },
    {
      name: 'chat',
      description: 'チャット入力にフォーカスする',
      execute(ctx) {
        ctx.api.focusChat()
      },
    },
    {
      name: 'vc',
      description: 'ボイスチャットに参加/離脱・発音モードを切り替える',
      usage: '/vc <on|off|toggle|mode <normal|broadcast|whisper> [半径m]>',
      async execute(ctx, args) {
        const usage = () =>
          ctx.out.error('使い方: /vc <on|off|toggle|mode <normal|broadcast|whisper> [半径m]>')
        const mode = args[0]
        if (mode === 'mode') {
          if (!isVoiceMode(args[1]) || !applyVoiceMode(ctx, args[1], args[2])) usage()
          return
        }
        if (mode !== 'on' && mode !== 'off' && mode !== 'toggle') {
          usage()
          return
        }
        await ctx.api.setVoiceEnabled(mode)
      },
    },
    {
      name: 'broadcast',
      aliases: ['bc'],
      description: 'ブロードキャスト発話を切り替える(距離に関係なく全員に届く)',
      execute(ctx) {
        const next = ctx.api.getVoiceMode() === 'broadcast' ? 'normal' : 'broadcast'
        applyVoiceMode(ctx, next)
      },
    },
    {
      name: 'whisper',
      aliases: ['wh'],
      description: 'ウィスパー発話を切り替える(周囲の円の中の人にだけ聞こえる)',
      usage: '/whisper [半径m]',
      execute(ctx, args) {
        // 半径指定時はトグルせずウィスパーに設定(ウィスパー中の半径変更にも使う)
        const next =
          args[0] === undefined && ctx.api.getVoiceMode() === 'whisper' ? 'normal' : 'whisper'
        if (!applyVoiceMode(ctx, next, args[0])) ctx.out.error('使い方: /whisper [半径m]')
      },
    },
    {
      name: 'mic',
      description: 'VC参加中のマイクをミュート/解除する',
      usage: '/mic <on|off|toggle>',
      async execute(ctx, args) {
        const mode = args[0]
        if (mode !== 'on' && mode !== 'off' && mode !== 'toggle') {
          ctx.out.error('使い方: /mic <on|off|toggle>')
          return
        }
        await ctx.api.setMicEnabled(mode)
      },
    },
    {
      name: 'voice',
      description: 'ボイスチャットウィンドウを開く',
      execute(ctx) {
        ctx.api.openVoice()
      },
    },
    {
      name: 'vrm',
      description: 'VRMファイルを開く/キャッシュを削除する',
      usage: '/vrm <open|clear>',
      execute(ctx, args) {
        switch (args[0]) {
          case 'open':
            ctx.api.openVrmPicker()
            break
          case 'clear':
            ctx.api.clearVrmCache()
            break
          default:
            ctx.out.error('使い方: /vrm <open|clear>')
        }
      },
    },
    {
      name: 'stats',
      description: 'レンダラー統計を表示する(性能問題の切り分け用)',
      execute(ctx) {
        for (const line of ctx.api.getRenderStats()) ctx.out.print(line)
      },
    },
    {
      name: 'help',
      description: 'コマンド一覧・使い方を表示する',
      usage: '/help [name]',
      execute(ctx, args) {
        if (args[0]) {
          const def = registry.resolve(args[0])
          if (!def) {
            ctx.out.error(`未知のコマンド: /${args[0]}`)
            return
          }
          ctx.out.print(`${def.usage ?? `/${def.name}`} — ${def.description}`)
          return
        }
        for (const def of registry.list()) {
          ctx.out.print(`/${def.name} — ${def.description}`)
        }
      },
    },
  ]
  for (const def of defs) registry.register(def)
}
