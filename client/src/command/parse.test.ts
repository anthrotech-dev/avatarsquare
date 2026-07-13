import { describe, expect, it } from 'vitest'
import { parseCommandLine } from './parse'

describe('parseCommandLine', () => {
  it('名前と引数に分解する', () => {
    expect(parseCommandLine('/move 3 -2')).toEqual({
      name: 'move',
      args: ['3', '-2'],
      rest: '3 -2',
    })
  })

  it('名前は小文字化される', () => {
    expect(parseCommandLine('/JUMP')).toEqual({ name: 'jump', args: [], rest: '' })
  })

  it('引用符で空白を含む引数を渡せる', () => {
    expect(parseCommandLine('/echo "hello world" b')).toEqual({
      name: 'echo',
      args: ['hello world', 'b'],
      rest: '"hello world" b',
    })
    expect(parseCommandLine("/echo 'a b'")).toEqual({
      name: 'echo',
      args: ['a b'],
      rest: "'a b'",
    })
  })

  it('連続する空白・全角スペースを区切りとして扱う', () => {
    expect(parseCommandLine('/move  3　-2 ')).toEqual({
      name: 'move',
      args: ['3', '-2'],
      rest: '3　-2',
    })
  })

  it('スラッシュ始まりでなければnull', () => {
    expect(parseCommandLine('hello')).toBeNull()
    expect(parseCommandLine('')).toBeNull()
    expect(parseCommandLine('  ')).toBeNull()
  })

  it('スラッシュのみはnull', () => {
    expect(parseCommandLine('/')).toBeNull()
    expect(parseCommandLine('/  ')).toBeNull()
  })

  it('空の引用符は空文字列の引数になる', () => {
    expect(parseCommandLine('/echo ""')).toEqual({ name: 'echo', args: [''], rest: '""' })
  })

  it('restは連続スペースをそのまま保持する', () => {
    expect(parseCommandLine('/say a  b')?.rest).toBe('a  b')
  })

  it('restは引用符を解釈せず生のまま残す', () => {
    expect(parseCommandLine('/say "こんにちは" と言った')?.rest).toBe('"こんにちは" と言った')
  })

  it('restは名前直後の区切り空白のみ除去する', () => {
    expect(parseCommandLine('/say   hello')?.rest).toBe('hello')
  })

  it('本文に絵文字があってもrestが壊れない', () => {
    expect(parseCommandLine('/say 🎉 party  time')?.rest).toBe('🎉 party  time')
  })

  it('引数がなければrestは空文字', () => {
    expect(parseCommandLine('/say')?.rest).toBe('')
  })
})
