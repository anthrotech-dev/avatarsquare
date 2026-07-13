export interface ParsedCommand {
  name: string
  args: string[]
  /**
   * コマンド名より後の生の残り文字列(先頭の区切り空白のみ除去)。
   * トークン分割・引用符解釈を通さないため、チャット本文のように
   * 連続スペースや引用符をそのまま扱いたいコマンドが使う。
   */
  rest: string
}

/**
 * '/move 3 -2' → {name: 'move', args: ['3', '-2'], rest: '3 -2'}
 * 引用符("a b" / 'a b')で空白を含む引数を渡せる。全角スペースも区切りとして扱う。
 * スラッシュ始まりでない・名前が空の行はnull(=コマンドではない)。
 */
export function parseCommandLine(line: string): ParsedCommand | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return null

  const body = trimmed.slice(1)
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let hasToken = false
  let rest = ''
  // for-ofはコードポイント単位(サロゲートペアを壊さない)なので、indexは別で追う
  let index = 0

  for (const char of body) {
    const charStart = index
    index += char.length
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
      continue
    }
    if (char === ' ' || char === '\t' || char === '　') {
      if (hasToken) {
        tokens.push(current)
        // 最初のトークン=コマンド名の直後で、生の残り文字列を確定する
        if (tokens.length === 1) rest = body.slice(charStart).trimStart()
        current = ''
        hasToken = false
      }
      continue
    }
    current += char
    hasToken = true
  }
  if (hasToken) tokens.push(current)

  const [name, ...args] = tokens
  if (!name) return null
  return { name: name.toLowerCase(), args, rest }
}
