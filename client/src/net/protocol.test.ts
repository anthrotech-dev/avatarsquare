import { describe, expect, it } from 'vitest'
import {
  type ActMessage,
  type ChatMessage,
  clampWhisperRadius,
  decodeMessage,
  encodeMessage,
  isVoiceMode,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  type PosMessage,
  type ProfileMessage,
  type SpeakMessage,
  sanitizeChatText,
  sanitizeName,
  type VoiceModeMessage,
  WHISPER_RADIUS_DEFAULT,
  WHISPER_RADIUS_MAX,
  WHISPER_RADIUS_MIN,
} from './protocol'

describe('encodeMessage / decodeMessage', () => {
  it('posメッセージがラウンドトリップする', () => {
    const message: PosMessage = { t: 'pos', x: 1.5, y: 0.8, z: -2.25, yaw: 0.3, moving: true }
    expect(decodeMessage(encodeMessage(message))).toEqual(message)
  })

  it('actメッセージがラウンドトリップする(対象地点あり)', () => {
    const message: ActMessage = { t: 'act', name: 'shoot', x: 0, z: 5, yaw: 1.2, tx: 3, tz: 8 }
    expect(decodeMessage(encodeMessage(message))).toEqual(message)
  })

  it('y無しの旧posメッセージも受理される', () => {
    const legacy = new TextEncoder().encode(
      JSON.stringify({ t: 'pos', x: 1, z: 2, yaw: 0, moving: false }),
    )
    const decoded = decodeMessage(legacy)
    expect(decoded?.t).toBe('pos')
    if (decoded?.t === 'pos') expect(decoded.y ?? 0).toBe(0)
  })

  it('未知のtは拒否する', () => {
    const unknown = new TextEncoder().encode(JSON.stringify({ t: 'nope', x: 0 }))
    expect(decodeMessage(unknown)).toBeNull()
  })

  it('profileメッセージがラウンドトリップする', () => {
    const message: ProfileMessage = { t: 'profile', name: 'ととがんま' }
    expect(decodeMessage(encodeMessage(message))).toEqual(message)
  })

  it('chatメッセージがラウンドトリップする', () => {
    const message: ChatMessage = { t: 'chat', name: 'ととがんま', text: 'こんにちは！' }
    expect(decodeMessage(encodeMessage(message))).toEqual(message)
  })

  it('spkメッセージ(発話中通知)がラウンドトリップする', () => {
    const message: SpeakMessage = { t: 'spk', on: true }
    expect(decodeMessage(encodeMessage(message))).toEqual(message)
  })

  it('vmodeメッセージ(発音モード通知)がラウンドトリップする', () => {
    const message: VoiceModeMessage = { t: 'vmode', mode: 'whisper', radius: 8 }
    expect(decodeMessage(encodeMessage(message))).toEqual(message)
  })

  it('壊れたデータはnullを返す', () => {
    expect(decodeMessage(new Uint8Array([0xff, 0x00, 0x12]))).toBeNull()
  })
})

describe('発音モード', () => {
  it('isVoiceModeは3モードだけを通す', () => {
    expect(isVoiceMode('normal')).toBe(true)
    expect(isVoiceMode('broadcast')).toBe(true)
    expect(isVoiceMode('whisper')).toBe(true)
    expect(isVoiceMode('shout')).toBe(false)
    expect(isVoiceMode(undefined)).toBe(false)
  })

  it('clampWhisperRadiusは範囲内に収める', () => {
    expect(clampWhisperRadius(8)).toBe(8)
    expect(clampWhisperRadius(0)).toBe(WHISPER_RADIUS_MIN)
    expect(clampWhisperRadius(100)).toBe(WHISPER_RADIUS_MAX)
  })

  it('clampWhisperRadiusは不正値を既定値に落とす(相手のクライアント改造対策)', () => {
    expect(clampWhisperRadius(undefined)).toBe(WHISPER_RADIUS_DEFAULT)
    expect(clampWhisperRadius(Number.NaN)).toBe(WHISPER_RADIUS_DEFAULT)
    expect(clampWhisperRadius('5')).toBe(WHISPER_RADIUS_DEFAULT)
  })
})

describe('sanitizeName', () => {
  it('制御文字・ゼロ幅文字を除去する', () => {
    expect(sanitizeName('とと\u0007がん\u200bま\n')).toBe('ととがんま')
  })

  it('前後の空白をtrimする', () => {
    expect(sanitizeName('  totegamma  ')).toBe('totegamma')
  })

  it('コードポイント単位でクランプする', () => {
    expect([...sanitizeName('あ'.repeat(40))]).toHaveLength(MAX_NAME_LENGTH)
  })

  it('サロゲートペア(絵文字)を壊さない', () => {
    const name = '🎮'.repeat(30)
    const result = sanitizeName(name)
    expect([...result]).toHaveLength(MAX_NAME_LENGTH)
    expect(result.includes('�')).toBe(false)
    expect([...result].every((c) => c === '🎮')).toBe(true)
  })

  it('通常の名前はそのまま通る', () => {
    expect(sanitizeName('ととがんま')).toBe('ととがんま')
  })
})

describe('sanitizeChatText', () => {
  it('制御文字・ゼロ幅文字を除去する', () => {
    expect(sanitizeChatText('こんにち​は\n')).toBe('こんにちは')
  })

  it('空白のみの入力は空文字になる', () => {
    expect(sanitizeChatText('   \t ')).toBe('')
  })

  it('コードポイント単位でクランプする', () => {
    expect([...sanitizeChatText('あ'.repeat(300))]).toHaveLength(MAX_CHAT_LENGTH)
  })

  it('サロゲートペア(絵文字)を壊さない', () => {
    const result = sanitizeChatText('🎉'.repeat(250))
    expect([...result]).toHaveLength(MAX_CHAT_LENGTH)
    expect(result.includes('�')).toBe(false)
  })

  it('通常の本文はそのまま通る(名前の24文字制限は受けない)', () => {
    const text = 'a'.repeat(100)
    expect(sanitizeChatText(text)).toBe(text)
  })
})
