import { describe, expect, it } from 'vitest'
import { chatBubbleDuration, wrapChatLines } from './speechBubble'

describe('chatBubbleDuration', () => {
  it('短文は下限の3秒', () => {
    expect(chatBubbleDuration('やあ')).toBe(3)
  })

  it('長文ほど長くなる', () => {
    expect(chatBubbleDuration('あ'.repeat(50))).toBeGreaterThan(chatBubbleDuration('あ'.repeat(20)))
  })

  it('上限は10秒', () => {
    expect(chatBubbleDuration('あ'.repeat(200))).toBe(10)
  })

  it('文字数はコードポイント単位で数える(絵文字を2文字扱いしない)', () => {
    expect(chatBubbleDuration('🎉'.repeat(10))).toBe(chatBubbleDuration('あ'.repeat(10)))
  })
})

describe('wrapChatLines', () => {
  // 1文字=幅10のモック(jsdomにcanvas 2Dコンテキストがないため注入する)
  const measure = (s: string) => [...s].length * 10

  it('幅に収まる文は1行のまま', () => {
    expect(wrapChatLines('こんにちは', 100, measure)).toEqual(['こんにちは'])
  })

  it('コードポイント単位で折り返す(空白がない日本語文)', () => {
    expect(wrapChatLines('あいうえおかきくけこ', 50, measure)).toEqual(['あいうえお', 'かきくけこ'])
  })

  it('最大行数を超えたら最終行を省略記号にする', () => {
    const lines = wrapChatLines('あ'.repeat(30), 50, measure, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('あああああ')
    expect(lines[1]).toBe('ああああ…')
    expect(measure(lines[1])).toBeLessThanOrEqual(50)
  })

  it('空文字は空配列', () => {
    expect(wrapChatLines('', 50, measure)).toEqual([])
  })

  it('サロゲートペアを分断しない', () => {
    const lines = wrapChatLines('🎉'.repeat(8), 50, measure)
    expect(lines).toEqual(['🎉🎉🎉🎉🎉', '🎉🎉🎉'])
    expect(lines.join('').includes('�')).toBe(false)
  })
})
