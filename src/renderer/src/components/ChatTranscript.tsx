import { useEffect, useRef } from 'react'
import { BookOpen, FileText, Library, Terminal, Wrench } from 'lucide-react'
import type { ChatItem } from '../agentChatStore'

/**
 * P6 共享消息流渲染（全页 AgentChatPage 与侧栏 AgentSidePanel 共用）：
 * 用户气泡 / 助教气泡 / 工具调用卡（输入输出可展开）+ 运行中指示。
 */

function toolIcon(name: string): React.JSX.Element {
  if (name === 'run_command') return <Terminal size={13} className="shrink-0 text-warn" />
  if (name.includes('skill')) return <BookOpen size={13} className="shrink-0 text-tx2" />
  if (name.includes('material')) return <Library size={13} className="shrink-0 text-tx2" />
  if (name.includes('workspace')) return <FileText size={13} className="shrink-0 text-tx2" />
  return <Wrench size={13} className="shrink-0 text-tx2" />
}

function compactInput(input: string): string {
  try {
    const obj = JSON.parse(input) as Record<string, unknown>
    if (typeof obj['command'] === 'string') return obj['command']
    if (typeof obj['relPath'] === 'string') return String(obj['relPath'])
    if (typeof obj['name'] === 'string') return String(obj['name'])
    if (typeof obj['id'] === 'string') return String(obj['id'])
  } catch {
    // 保持原文
  }
  return input
}

export function ChatTranscript({
  items,
  running,
  empty,
  compact = false
}: {
  items: ChatItem[]
  running: boolean
  /** 空会话时的占位内容（建议列表等） */
  empty: React.ReactNode
  /** 侧栏紧凑模式：气泡与内边距收窄 */
  compact?: boolean
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el != null) el.scrollTop = el.scrollHeight
  }, [items])

  const maxW = compact ? 'max-w-full' : 'max-w-[760px]'

  return (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>
      {items.length === 0 ? (
        empty
      ) : (
        <div className={`mx-auto flex ${maxW} flex-col gap-3`}>
          {items.map((it, i) =>
            it.type === 'user' ? (
              <div key={i} className="flex justify-end">
                <div
                  className={`whitespace-pre-wrap rounded-lg rounded-br-sm bg-acc ${
                    compact ? 'max-w-[92%] px-2.5 py-1.5 text-[12.5px]' : 'max-w-[85%] px-3 py-2 text-[13px]'
                  } leading-relaxed text-white`}
                >
                  {it.text}
                </div>
              </div>
            ) : it.type === 'assistant' ? (
              <div
                className={`whitespace-pre-wrap rounded-lg rounded-bl-sm border border-line bg-panel ${
                  compact ? 'px-2.5 py-1.5 text-[12.5px]' : 'px-3 py-2 text-[13px]'
                } leading-relaxed text-tx`}
              >
                {it.text}
              </div>
            ) : (
              <details
                key={it.toolCallId}
                className={`rounded-lg border border-line bg-bg2 px-2.5 py-2 text-[12px] ${compact ? '' : 'px-3 py-2 text-[12.5px]'}`}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 text-tx2">
                  {toolIcon(it.toolName)}
                  <span className="font-mono text-tx">{it.toolName}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-tx2">
                    {compactInput(it.input)}
                  </span>
                  {it.error != null && <span className="text-bad">出错</span>}
                  {it.output == null && it.error == null && <span className="text-warn">运行中…</span>}
                </summary>
                <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
                  <div>
                    <div className="mb-1 text-[11px] font-semibold text-tx2">输入</div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11px] text-tx2">
                      {it.input}
                    </pre>
                  </div>
                  {it.output != null && (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold text-tx2">输出</div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11px] text-tx">
                        {it.output}
                      </pre>
                    </div>
                  )}
                  {it.error != null && (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold text-tx2 text-bad">错误</div>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11px] text-bad">
                        {it.error}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )
          )}
          {running && (
            <div className="flex items-center gap-2 text-[12px] text-tx2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-track border-t-acc" />
              助教工作中…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
