import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../state/store'

/**
 * 左下のチャットウィンドウ。チャット送受信・システムログ・コマンド入力を担う。
 * 非/入力は/sayコマンドに流す(すべての操作をコマンドに統一する方針)。
 */
export function ChatWindow() {
  const chatLog = useAppStore((s) => s.chatLog)
  const dispatch = useAppStore((s) => s.dispatch)
  const appendChat = useAppStore((s) => s.appendChat)
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 新しいログで最下部へ自動スクロール
  // biome-ignore lint/correctness/useExhaustiveDependencies: chatLogの追加をスクロールのトリガにする
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [chatLog])

  // Enterで入力欄にフォーカス(入力中・HUD編集モード中でなければ)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      if (useAppStore.getState().hudEditMode) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const submit = () => {
    const line = input.trim()
    setInput('')
    if (!line) {
      inputRef.current?.blur()
      return
    }
    if (line.startsWith('/')) {
      appendChat({ kind: 'echo', text: line })
      void dispatch?.(line)
    } else {
      // sendChatがchatエントリを積むため、ここではechoしない(二重表示防止)
      void dispatch?.(`/say ${line}`)
    }
  }

  return (
    <div className="hud-chat">
      <div className="hud-chat-log" ref={logRef}>
        {chatLog.map((entry) => (
          <div key={entry.id} className={`hud-chat-entry ${entry.kind}`}>
            {entry.from ? <span className="hud-chat-from">{entry.from}: </span> : null}
            {entry.text}
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        className="hud-chat-input"
        placeholder="Enterで送信 / でコマンド"
        value={input}
        spellCheck={false}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            inputRef.current?.blur()
          }
          e.stopPropagation()
        }}
      />
    </div>
  )
}
