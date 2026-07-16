import { cancelCooldown, tryStartCooldown } from './cooldowns'
import { parseCommandLine } from './parse'
import type { CommandContext, CommandDef } from './types'

/**
 * コマンドの登録・解決・実行を担う。
 * 解決順: 登録済みコマンド(alias込み) → fallback(マクロなどの動的解決)。
 * 実行中のthrowはcatchしてctx.out.errorに流す(UIを壊さない)。
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDef>()
  private readonly aliases = new Map<string, string>()
  private fallback: ((name: string) => CommandDef | undefined) | null = null

  register(def: CommandDef): void {
    const name = def.name.toLowerCase()
    this.commands.set(name, def)
    for (const alias of def.aliases ?? []) this.aliases.set(alias.toLowerCase(), name)
  }

  resolve(name: string): CommandDef | undefined {
    const key = name.toLowerCase()
    return this.commands.get(key) ?? this.commands.get(this.aliases.get(key) ?? '')
  }

  list(): CommandDef[] {
    return [...this.commands.values()]
  }

  /** 未登録名の解決手段(マクロ用)。resolveで見つからなかった時に呼ばれる */
  setFallback(fn: (name: string) => CommandDef | undefined): void {
    this.fallback = fn
  }

  async execute(line: string, ctx: CommandContext): Promise<void> {
    const parsed = parseCommandLine(line)
    if (!parsed) return
    const def = this.resolve(parsed.name) ?? this.fallback?.(parsed.name)
    if (!def) {
      ctx.out.error(`未知のコマンド: /${parsed.name}`)
      return
    }
    // CD中は黙って無視する(フィードバックはホットバーのタイマー表示が担う)。
    // CDは実行前に開始する(連打・非同期実行中の二重発火を防ぐ)
    const cooldownNames = [def.name, ...(def.aliases ?? [])]
    if (def.cooldownMs && !tryStartCooldown(cooldownNames, def.cooldownMs)) {
      return
    }
    try {
      const result = await def.execute(ctx, parsed.args, parsed.rest)
      // false = 発動不成立(対象なし・射程外など)。CDを返金する
      if (result === false && def.cooldownMs) cancelCooldown(cooldownNames)
    } catch (err) {
      if (def.cooldownMs) cancelCooldown(cooldownNames)
      ctx.out.error(`/${parsed.name} 失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
