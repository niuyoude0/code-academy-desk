import { useCallback, useState } from 'react'
import { Send, Square, Sparkles, X } from 'lucide-react'
import { agentChatStore, useAgentChat } from '../agentChatStore'
import { ChatTranscript } from './ChatTranscript'

/**
 * P6 学习页右侧 AI 助教侧栏（紧凑视图）：
 * 与全页 AgentChatPage 共用 agentChatStore 单例（同一 DSH 会话/消息流）。
 * 设置/MCP 管理在全页——未配置 Key 时提示去全页。
 */
export function AgentSidePanel({ onOpenFull }: { onOpenFull: () => void }): React.JSX.Element {
  const { items, running, error, settings } = useAgentChat()
  const [input, setInput] = useState('')

  const send = useCallback((): void => {
    agentChatStore.sendText(input)
    setInput('')
  }, [input])

  const configured = settings?.configured ?? false

  return (
    <div className="flex h-full flex-col bg-bg">
      <ChatTranscript
        compact
        items={items}
        running={running}
        empty={
          <div className="flex flex-col items-center gap-3 pt-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel">
              <Sparkles size={18} className="text-acc" />
            </div>
            <p className="px-4 text-[12.5px] leading-relaxed text-tx2">
              边学边问：右侧课件遇到的问题直接在这里问助教，答案与全页助教共用一份会话。
            </p>
          </div>
        }
      />

      {!configured && (
        <button
          type="button"
          onClick={onOpenFull}
          className="mx-3 mb-2 shrink-0 rounded-md bg-warn/10 px-3 py-1.5 text-left text-[11.5px] text-warn hover:bg-warn/20"
        >
          尚未配置 API Key —— 点击前往 AI 助教页设置
        </button>
      )}

      {error != null && (
        <div className="mx-3 mb-2 flex items-start justify-between gap-2 rounded-md border border-bad/50 bg-bad/10 px-2.5 py-1.5 text-[11.5px] text-bad">
          <span className="min-w-0 break-all">{error}</span>
          <button type="button" aria-label="关闭" onClick={agentChatStore.dismissError}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="shrink-0 px-3 pb-3">
        <div className="flex items-end gap-1.5 rounded-lg border border-line bg-panel p-1.5 focus-within:border-acc">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder={configured ? '问助教…（Enter 发送）' : '请先配置 API Key'}
            className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1 text-[12.5px] text-tx outline-none placeholder:text-tx2/60"
          />
          {running ? (
            <button
              type="button"
              onClick={agentChatStore.stop}
              title="停止"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel-hover text-tx hover:bg-track"
            >
              <Square size={11} />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={input.trim().length === 0}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-acc text-white hover:bg-acc-hover disabled:opacity-40"
            >
              <Send size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
