import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Settings,
  Send,
  Square,
  Terminal,
  Wrench,
  FileText,
  BookOpen,
  Library,
  Sparkles,
  X,
  KeyRound
} from 'lucide-react'
import type {
  AgentSettingsPatch,
  AgentSettingsView,
  AgentStreamEvent,
  McpServerEntry
} from '../../../shared/ipc'

/**
 * P9 AI 助教聊天页（JetBrains New UI 风格）：
 * - 流式回复 + 工具调用卡片（输入/输出可展开）
 * - run_command 的执行确认由主进程弹原生对话框，这里只展示结果
 * - 设置弹窗管理 DeepSeek API Key（掩码显示）
 */

type ChatItem =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | {
      type: 'tool'
      toolCallId: string
      toolName: string
      input: string
      output?: string
      error?: string
    }

const SESSION_KEY = 'cad-agent-session-id'

const SUGGESTIONS = [
  '把已导入的教材资料构建成课程（严格按 course-material-processor 技能执行）',
  '用 PowerShell 查看我电脑上的 Python / Node 版本',
  '讲讲课程构建流程：教材资料是怎么变成课程的？'
]

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

export function AgentChatPage({
  onBack,
  pendingPrompt,
  onPromptConsumed
}: {
  onBack: () => void
  /** 其他页面（学习路径页）直通过来的固定提示词：进入本页后自动发送一轮。 */
  pendingPrompt?: string | null
  onPromptConsumed?: () => void
}): React.JSX.Element {
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AgentSettingsView | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)

  const runIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    void window.api.agentSettingsGet().then((res) => {
      if (res.ok) {
        setSettings(res.data)
        if (!res.data.configured) setSettingsOpen(true)
      }
    })
    // 恢复跨重启的 DSH 会话上下文；失败则静默开新会话
    const stored = localStorage.getItem(SESSION_KEY)
    if (stored != null) {
      void window.api.agentResume(stored).then((res) => {
        if (res.ok && res.data === true) sessionIdRef.current = stored
        else localStorage.removeItem(SESSION_KEY)
      })
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el != null) el.scrollTop = el.scrollHeight
  }, [items])

  useEffect(() => {
    const unsubscribe = window.api.onAgentEvent(({ runId, event }) => {
      if (runId !== runIdRef.current) return
      applyEvent(event)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyEvent = useCallback((event: AgentStreamEvent): void => {
    setItems((prev) => {
      const next = [...prev]
      switch (event.type) {
        case 'text-delta': {
          const last = next[next.length - 1]
          if (last != null && last.type === 'assistant') {
            next[next.length - 1] = { ...last, text: last.text + event.text }
          } else {
            next.push({ type: 'assistant', text: event.text })
          }
          break
        }
        case 'tool-call':
          next.push({
            type: 'tool',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input
          })
          break
        case 'tool-result': {
          const idx = next.findIndex(
            (it) => it.type === 'tool' && it.toolCallId === event.toolCallId
          )
          if (idx >= 0) {
            const it = next[idx] as Extract<ChatItem, { type: 'tool' }>
            next[idx] = { ...it, output: event.output }
          } else {
            next.push({
              type: 'tool',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: '',
              output: event.output
            })
          }
          break
        }
        case 'tool-error': {
          const idx = next.findIndex(
            (it) => it.type === 'tool' && it.toolCallId === event.toolCallId
          )
          if (idx >= 0) {
            const it = next[idx] as Extract<ChatItem, { type: 'tool' }>
            next[idx] = { ...it, error: event.error }
          }
          break
        }
        case 'finish':
        case 'aborted':
          setRunning(false)
          break
        case 'error':
          setError(event.message)
          setRunning(false)
          break
      }
      return next
    })
  }, [])

  const sendText = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim()
      if (text.length === 0 || running) return

      setInput('')
      setError(null)
      setRunning(true)
      setItems((prev) => [...prev, { type: 'user', text }])

      // 对话上下文由 DSH 会话持有，这里只发本轮文本
      const res = await window.api.agentChat({ sessionId: sessionIdRef.current, text })
      if (!res.ok) {
        setError(res.error)
        setRunning(false)
        return
      }
      sessionIdRef.current = res.data.sessionId
      localStorage.setItem(SESSION_KEY, res.data.sessionId)
      runIdRef.current = res.data.runId
    },
    [running]
  )

  const send = useCallback((): Promise<void> => sendText(input), [sendText, input])

  // 其他页面直通的固定提示词：空闲时自动发送一轮（ref 去重防 StrictMode 双发/重复发送）
  const lastPromptRef = useRef<string | null>(null)
  useEffect(() => {
    if (pendingPrompt == null || pendingPrompt === lastPromptRef.current) return
    if (running) return
    lastPromptRef.current = pendingPrompt
    onPromptConsumed?.()
    void sendText(pendingPrompt)
  }, [pendingPrompt, running, sendText, onPromptConsumed])

  const newConversation = useCallback((): void => {
    if (runIdRef.current != null) void window.api.agentAbort(runIdRef.current)
    sessionIdRef.current = null
    localStorage.removeItem(SESSION_KEY)
    runIdRef.current = null
    setItems([])
    setError(null)
    setRunning(false)
    textareaRef.current?.focus()
  }, [])

  const stop = useCallback((): void => {
    if (runIdRef.current != null) void window.api.agentAbort(runIdRef.current)
  }, [])

  const saveSettings = useCallback(async (patch: AgentSettingsPatch): Promise<void> => {
    const res = await window.api.agentSettingsSet(patch)
    if (res.ok) {
      setSettings(res.data)
      setSettingsOpen(false)
    } else {
      setError(res.error)
    }
  }, [])

  const configured = settings?.configured ?? false

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="返回课程"
            title="返回课程"
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
          >
            <ArrowLeft size={16} />
          </button>
          <Sparkles size={16} className="text-acc" />
          <span className="text-[14px] font-semibold text-tx">AI 助教</span>
          {settings != null && (
            <span className="rounded bg-bg2 px-1.5 py-0.5 font-mono text-[11px] text-tx2">
              {settings.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="开始新对话（当前上下文保留在 DSH 会话中）"
            onClick={newConversation}
            className="flex h-8 items-center rounded-md px-2.5 text-[12.5px] text-tx2 hover:bg-panel-hover hover:text-tx"
          >
            新对话
          </button>
          <button
            type="button"
            title="MCP 服务器"
            onClick={() => setMcpOpen(true)}
            className="flex h-8 items-center rounded-md px-2.5 text-[12.5px] text-tx2 hover:bg-panel-hover hover:text-tx"
          >
            MCP
          </button>
          <button
            type="button"
            aria-label="Agent 设置"
            title="API 设置"
            onClick={() => setSettingsOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {!configured && !settingsOpen && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-warn/10 px-4 py-2 text-[12.5px] text-warn">
          <span>尚未配置 AI API Key，Agent 无法使用。</span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded border border-line px-2 py-0.5 text-[12px] text-tx hover:bg-panel-hover"
          >
            去配置
          </button>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 ? (
          <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 pt-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-panel">
              <Sparkles size={22} className="text-acc" />
            </div>
            <p className="text-[13px] text-tx2">和助教聊聊：解答概念、跑命令、把教材资料构建成课程。</p>
            <div className="flex flex-col items-stretch gap-2 self-stretch">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="rounded-lg border border-line bg-panel px-3 py-2 text-left text-[12.5px] text-tx2 hover:border-acc hover:text-tx"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-3">
            {items.map((it, i) =>
              it.type === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-acc px-3 py-2 text-[13px] leading-relaxed text-white">
                    {it.text}
                  </div>
                </div>
              ) : it.type === 'assistant' ? (
                <div
                  key={i}
                  className="max-w-[95%] whitespace-pre-wrap rounded-lg rounded-bl-sm border border-line bg-panel px-3 py-2 text-[13px] leading-relaxed text-tx"
                >
                  {it.text}
                </div>
              ) : (
                <details
                  key={it.toolCallId}
                  className="max-w-[95%] rounded-lg border border-line bg-bg2 px-3 py-2 text-[12.5px]"
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
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11.5px] text-tx2">
                        {it.input}
                      </pre>
                    </div>
                    {it.output != null && (
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-tx2">输出</div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11.5px] text-tx">
                          {it.output}
                        </pre>
                      </div>
                    )}
                    {it.error != null && (
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-bad">错误</div>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11.5px] text-bad">
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

      {error != null && (
        <div className="mx-auto mb-2 flex w-[calc(100%-32px)] max-w-[760px] items-start justify-between gap-3 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
          <span className="min-w-0 break-all">{error}</span>
          <button type="button" aria-label="关闭" onClick={() => setError(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-lg border border-line bg-panel p-2 focus-within:border-acc">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder={configured ? '向助教提问…（Enter 发送，Shift+Enter 换行）' : '请先配置 API Key'}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-tx outline-none placeholder:text-tx2/60"
          />
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-8 items-center gap-1.5 rounded-md bg-panel-hover px-3 text-[12.5px] text-tx hover:bg-track"
            >
              <Square size={12} />
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={input.trim().length === 0}
              className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3 text-[12.5px] text-white hover:bg-acc-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={13} />
              发送
            </button>
          )}
        </div>
      </div>

      {settingsOpen && (
        <AgentSettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}

      {mcpOpen && <McpManagerModal onClose={() => setMcpOpen(false)} />}
    </div>
  )
}

function AgentSettingsModal({
  settings,
  onClose,
  onSave
}: {
  settings: AgentSettingsView | null
  onClose: () => void
  onSave: (patch: AgentSettingsPatch) => Promise<void>
}): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings?.model ?? 'deepseek-chat')
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '')
  const [mode, setMode] = useState<AgentSettingsPatch['permissionMode']>(
    settings?.permissionMode ?? 'workspace-write'
  )
  const [saving, setSaving] = useState(false)

  const MODE_OPTIONS: {
    value: NonNullable<AgentSettingsPatch['permissionMode']>
    label: string
    desc: string
  }[] = [
    {
      value: 'read-only',
      label: '只读模式',
      desc: '沙箱拒绝一切写入；工具调用仍逐次确认'
    },
    {
      value: 'workspace-write',
      label: '标准模式（推荐）',
      desc: '写入限定在工作区；危险操作逐次弹窗确认'
    },
    {
      value: 'danger-full-access',
      label: '自由模式',
      desc: '关闭沙箱与确认弹窗，直接执行（信任本机环境时使用）'
    }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[440px] rounded-xl border border-line bg-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-acc" />
            <span className="text-[14px] font-semibold text-tx">Agent 设置</span>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-tx2">
              DeepSeek API Key{settings?.configured === true && <>（当前 {settings.apiKeyMasked}）</>}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              className="h-8 rounded-md border border-line bg-bg2 px-2 font-mono text-[12.5px] text-tx outline-none focus:border-acc"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-tx2">模型</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-chat / deepseek-reasoner"
              className="h-8 rounded-md border border-line bg-bg2 px-2 font-mono text-[12.5px] text-tx outline-none focus:border-acc"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-tx2">API 地址（可选，留空用官方）</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/anthropic"
              className="h-8 rounded-md border border-line bg-bg2 px-2 font-mono text-[12.5px] text-tx outline-none focus:border-acc"
            />
            <span className="text-[11px] text-tx2/70">自定义须为 Anthropic 兼容端点（DSH 经此通道调用）</span>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-tx2">权限档位</span>
            <div className="flex flex-col gap-1">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left ${
                    mode === opt.value ? 'border-acc bg-acc/10' : 'border-line hover:bg-panel-hover'
                  }`}
                >
                  <span className={`text-[12.5px] ${mode === opt.value ? 'text-tx' : 'text-tx2'}`}>
                    {opt.label}
                  </span>
                  <span className="text-[11px] leading-snug text-tx2/70">{opt.desc}</span>
                </button>
              ))}
            </div>
            <span className="text-[11px] text-tx2/70">
              Windows 下沙箱经 ACL 限制令牌执行（个别硬链接场景为尽力而为）；切换档位后下一轮对话生效。
            </span>
          </div>
          <p className="text-[11.5px] leading-relaxed text-tx2/80">
            Key 只保存在本机（%APPDATA%/code-academy-desk/agent-settings.json），不随课程包/日志外发。
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md border border-line px-3 text-[12.5px] text-tx hover:bg-panel-hover"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving || (apiKey.trim().length === 0 && settings?.configured !== true)}
              onClick={() => {
                setSaving(true)
                void onSave({
                  ...(apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {}),
                  model: model.trim() || undefined,
                  baseUrl: baseUrl.trim().length > 0 ? baseUrl.trim() : null,
                  permissionMode: mode
                }).finally(() => setSaving(false))
              }}
              className="h-8 rounded-md bg-acc px-3 text-[12.5px] text-white hover:bg-acc-hover disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ===== MCP 服务器管理弹窗 ===== */

function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.length === 0) continue
    const idx = t.indexOf('=')
    if (idx <= 0) continue
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim()
  }
  return out
}

function McpManagerModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [servers, setServers] = useState<McpServerEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 新增表单
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('stdio')
  const [command, setCommand] = useState('npx')
  const [argsText, setArgsText] = useState('-y @modelcontextprotocol/server-xxx')
  const [envText, setEnvText] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback((): void => {
    void window.api.mcpList().then((res) => {
      if (res.ok) setServers(res.data)
      else setError(res.error)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const add = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const input: Omit<McpServerEntry, 'id'> =
      transport === 'stdio'
        ? {
            serverName: name.trim(),
            transport,
            enabled: true,
            command: command.trim(),
            args: argsText
              .split('\n')
              .flatMap((l) => l.trim().split(/\s+/))
              .filter((s) => s.length > 0),
            ...(envText.trim().length > 0 ? { env: parseKeyValueLines(envText) } : {})
          }
        : {
            serverName: name.trim(),
            transport,
            enabled: true,
            url: url.trim()
          }
    const res = await window.api.mcpAdd(input)
    setBusy(false)
    if (res.ok) {
      setShowAdd(false)
      setName('')
      setEnvText('')
      refresh()
    } else {
      setError(res.error)
    }
  }, [name, transport, command, argsText, envText, url, refresh])

  const toggle = useCallback(
    async (s: McpServerEntry): Promise<void> => {
      const res = await window.api.mcpUpdate({ id: s.id, enabled: !s.enabled })
      if (res.ok) refresh()
      else setError(res.error)
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const res = await window.api.mcpRemove(id)
      if (res.ok) refresh()
      else setError(res.error)
    },
    [refresh]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-[560px] flex-col rounded-xl border border-line bg-panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-tx">MCP 服务器</span>
            <span className="rounded bg-bg2 px-1.5 py-0.5 text-[11px] text-tx2">
              工具名 mcp__名称__工具
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="h-7 rounded-md bg-acc px-2.5 text-[12px] text-white hover:bg-acc-hover"
            >
              {showAdd ? '收起' : '添加'}
            </button>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {error != null && (
          <div className="mb-2 rounded-md border border-bad/50 bg-bad/10 px-2.5 py-1.5 text-[12px] text-bad">
            {error}
          </div>
        )}

        {showAdd && (
          <div className="mb-3 flex flex-col gap-2.5 rounded-lg border border-line bg-bg2 p-3">
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="名称（字母/数字/_/-，如 mysql）"
                className="h-8 flex-1 rounded-md border border-line bg-panel px-2 font-mono text-[12.5px] text-tx outline-none focus:border-acc"
              />
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as 'stdio' | 'streamable-http')}
                className="h-8 rounded-md border border-line bg-panel px-1.5 text-[12.5px] text-tx outline-none focus:border-acc"
              >
                <option value="stdio">stdio（本地进程）</option>
                <option value="streamable-http">HTTP（远程服务）</option>
              </select>
            </div>
            {transport === 'stdio' ? (
              <>
                <div className="flex gap-2">
                  <input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="命令"
                    className="h-8 flex-1 rounded-md border border-line bg-panel px-2 font-mono text-[12.5px] text-tx outline-none focus:border-acc"
                  />
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="（stdio 不用填 URL）"
                    disabled
                    className="h-8 hidden flex-1 rounded-md border border-line bg-panel px-2 text-[12.5px] text-tx2"
                  />
                </div>
                <textarea
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  rows={2}
                  placeholder="参数（每行一个，或空格分隔）"
                  className="resize-none rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-[12px] text-tx outline-none focus:border-acc"
                />
                <textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  rows={2}
                  placeholder="环境变量（每行 KEY=VALUE，可选）"
                  className="resize-none rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-[12px] text-tx outline-none focus:border-acc"
                />
                <p className="text-[11px] leading-snug text-tx2/70">
                  Windows 提示：npx 需要包装执行——命令填 cmd，参数每行一个：/c、npx、-y、包名。
                </p>
              </>
            ) : (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://host:port/mcp"
                className="h-8 rounded-md border border-line bg-panel px-2 font-mono text-[12.5px] text-tx outline-none focus:border-acc"
              />
            )}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy || name.trim().length === 0}
                onClick={() => void add()}
                className="h-7 rounded-md bg-acc px-3 text-[12px] text-white hover:bg-acc-hover disabled:opacity-40"
              >
                {busy ? '添加中…' : '确认添加'}
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {servers == null ? (
            <div className="py-6 text-center text-[12.5px] text-tx2">加载中…</div>
          ) : servers.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-tx2">
              尚未配置 MCP 服务器。添加后 Agent 会自动获得对应工具（下一轮对话生效）。
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {servers.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-bg2 px-2.5 py-2"
                >
                  <button
                    type="button"
                    title={s.enabled ? '点击停用' : '点击启用'}
                    onClick={() => void toggle(s)}
                    className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
                      s.enabled ? 'bg-ok' : 'bg-track'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                        s.enabled ? 'left-4' : 'left-0.5'
                      }`}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] text-tx">{s.serverName}</span>
                      <span className="rounded bg-panel px-1.5 py-0.5 text-[10.5px] text-tx2">
                        {s.transport === 'stdio' ? '本地' : 'HTTP'}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-tx2">
                      {s.transport === 'stdio' ? [s.command, ...(s.args ?? [])].join(' ') : s.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="删除"
                    onClick={() => void remove(s.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tx2 hover:bg-bad/20 hover:text-bad"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-tx2/70">
          变更后自动重启 Agent 进程，下一轮对话生效。启动失败的服务器不影响 Agent 其余功能。
        </p>
      </div>
    </div>
  )
}           
