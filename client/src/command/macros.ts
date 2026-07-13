import type { CommandRegistry } from './CommandRegistry'
import type { CommandDef } from './types'

export interface Macro {
  name: string
  lines: string[]
}

export const MAX_MACRO_DEPTH = 8

const STORAGE_KEY = 'avatarsquare:macros'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * マクロ(コマンド列)の永続化。storageを注入できるためテストではメモリ実装を使う。
 */
export class MacroStore {
  /** 保存・削除時に呼ばれる(UIの再描画トリガ用) */
  onChange: (() => void) | null = null

  constructor(private readonly storage: StorageLike = localStorage) {}

  list(): Macro[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as Macro[]
      if (!Array.isArray(parsed)) return []
      return parsed.filter((m) => typeof m?.name === 'string' && Array.isArray(m?.lines))
    } catch {
      return []
    }
  }

  get(name: string): Macro | undefined {
    const key = name.toLowerCase()
    return this.list().find((m) => m.name.toLowerCase() === key)
  }

  save(macro: Macro): void {
    const macros = this.list().filter((m) => m.name.toLowerCase() !== macro.name.toLowerCase())
    macros.push(macro)
    this.storage.setItem(STORAGE_KEY, JSON.stringify(macros))
    this.onChange?.()
  }

  remove(name: string): void {
    const key = name.toLowerCase()
    const macros = this.list().filter((m) => m.name.toLowerCase() !== key)
    this.storage.setItem(STORAGE_KEY, JSON.stringify(macros))
    this.onChange?.()
  }
}

/**
 * マクロをコマンドとして実行できるようにする。
 * registry.setFallbackに配線することで、マクロ名がそのままコマンド名になる。
 */
export function macroAsCommand(macro: Macro, registry: CommandRegistry): CommandDef {
  return {
    name: macro.name,
    description: `マクロ (${macro.lines.length}行)`,
    async execute(ctx, _args) {
      if (ctx.depth >= MAX_MACRO_DEPTH) {
        ctx.out.error(`マクロの入れ子が深すぎます (最大${MAX_MACRO_DEPTH})`)
        return
      }
      for (const line of macro.lines) {
        if (!line.trim()) continue
        await registry.execute(line, { ...ctx, depth: ctx.depth + 1 })
      }
    },
  }
}

/** registryにマクロ解決のfallbackを配線する */
export function wireMacros(registry: CommandRegistry, store: MacroStore): void {
  registry.setFallback((name) => {
    const macro = store.get(name)
    return macro && macroAsCommand(macro, registry)
  })
}
