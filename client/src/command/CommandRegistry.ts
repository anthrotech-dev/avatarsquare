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
    try {
      await def.execute(ctx, parsed.args, parsed.rest)
    } catch (err) {
      ctx.out.error(`/${parsed.name} 失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
