import { useSyncExternalStore } from 'react'
import type { AgentSettingsPatch, AgentSettingsView, AgentStreamEvent } from '../../shared/ipc'

/**
 * P6 AI 助教共享聊天 store（单例）：
 *  - 全页 AgentChatPage 与学习页右侧 AgentSidePanel 共用同一 DSH 会话与消息流——
 *    会话/事件订阅只有一份，两个视图都是它的纯渲染壳。
 *  - React 绑定用 useSyncExternalStore（跨视图同步，无 props 钻孔）。
 *  - requestPrompt：学习页「生成课件/问助教」的固定提示词直通——空闲即发，忙则挂起，
 *    本轮 finish 后自动补发（取代旧 pendingPrompt 管道）。
 */

export type ChatItem =
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

interface ChatState {
  items: ChatItem[]
  running: boolean
  error: string | null
  settings: AgentSettingsView | null
  /** 忙时挂起的外部提示词（finish 后自动补发） */
  pendingPrompt: string | null
}

class AgentChatStore {
  private state: ChatState = { items: [], running: false, error: null, settings: null, pendingPrompt: null }
  private listeners = new Set<() => void>()
  private runId: string | null = null
  private sessionId: string | null = null
  private started = false

  private emit(): void {
    for (const l of this.listeners) l()
  }
  private set(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
  getSnapshot = (): ChatState => this.state

  /** 应用启动调一次：拉设置 + 恢复跨重启 DSH 会话 + 订阅流事件（幂等）。 */
  init(): void {
    if (this.started) return
    this.started = true
    void window.api.agentSettingsGet().then((res) => {
      if (res.ok) this.set({ settings: res.data })
    })
    const stored = localStorage.getItem(SESSION_KEY)
    if (stored != null) {
      void window.api.agentResume(stored).then((res) => {
        if (res.ok && res.data === true) this.sessionId = stored
        else localStorage.removeItem(SESSION_KEY)
      })
    }
    window.api.onAgentEvent(({ runId, event }) => {
      if (runId !== this.runId) return
      this.applyEvent(event)
    })
  }

  private applyEvent(event: AgentStreamEvent): void {
    const items = [...this.state.items]
    switch (event.type) {
      case 'text-delta': {
        const last = items[items.length - 1]
        if (last != null && last.type === 'assistant') {
          items[items.length - 1] = { ...last, text: last.text + event.text }
        } else {
          items.push({ type: 'assistant', text: event.text })
        }
        this.set({ items })
        break
      }
      case 'tool-call':
        items.push({
          type: 'tool',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input
        })
        this.set({ items })
        break
      case 'tool-result': {
        const idx = items.findIndex((it) => it.type === 'tool' && it.toolCallId === event.toolCallId)
        if (idx >= 0) {
          const it = items[idx] as Extract<ChatItem, { type: 'tool' }>
          items[idx] = { ...it, output: event.output }
        } else {
          items.push({ type: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, input: '', output: event.output })
        }
        this.set({ items })
        break
      }
      case 'tool-error': {
        const idx = items.findIndex((it) => it.type === 'tool' && it.toolCallId === event.toolCallId)
        if (idx >= 0) {
          const it = items[idx] as Extract<ChatItem, { type: 'tool' }>
          items[idx] = { ...it, error: event.error }
          this.set({ items })
        }
        break
      }
      case 'finish':
      case 'aborted': {
        const pending = this.state.pendingPrompt
        this.set({ running: false, pendingPrompt: null })
        // 忙时挂起的外部提示词：本轮结束立即补发
        if (pending != null) void this.sendText(pending)
        break
      }
      case 'error':
        this.set({ error: event.message, running: false, pendingPrompt: null })
        break
    }
  }

  async sendText(raw: string): Promise<void> {
    const text = raw.trim()
    if (text.length === 0 || this.state.running) return
    this.set({ error: null, running: true, items: [...this.state.items, { type: 'user', text }] })
    // 对话上下文由 DSH 会话持有，这里只发本轮文本
    const res = await window.api.agentChat({ sessionId: this.sessionId, text })
    if (!res.ok) {
      this.set({ error: res.error, running: false })
      return
    }
    this.sessionId = res.data.sessionId
    localStorage.setItem(SESSION_KEY, res.data.sessionId)
    this.runId = res.data.runId
  }

  /** 外部（学习页/首页）直通的固定提示词。 */
  requestPrompt(prompt: string): void {
    if (this.state.running) this.set({ pendingPrompt: prompt })
    else void this.sendText(prompt)
  }

  stop(): void {
    if (this.runId != null) void window.api.agentAbort(this.runId)
  }

  newConversation(): void {
    if (this.runId != null) void window.api.agentAbort(this.runId)
    this.sessionId = null
    localStorage.removeItem(SESSION_KEY)
    this.runId = null
    this.set({ items: [], error: null, running: false, pendingPrompt: null })
  }

  async saveSettings(patch: AgentSettingsPatch): Promise<AgentSettingsView | null> {
    const res = await window.api.agentSettingsSet(patch)
    if (res.ok) {
      this.set({ settings: res.data })
      return res.data
    }
    this.set({ error: res.error })
    return null
  }

  dismissError(): void {
    this.set({ error: null })
  }
}

export const agentChatStore = new AgentChatStore()

/** 视图绑定：items/running/error/settings + 动作集。 */
export function useAgentChat(): ChatState & {
  send: (text: string) => void
  stop: () => void
  newConversation: () => void
  dismissError: () => void
} {
  const state = useSyncExternalStore(agentChatStore.subscribe, agentChatStore.getSnapshot)
  return {
    ...state,
    send: (text: string): void => void agentChatStore.sendText(text),
    stop: (): void => agentChatStore.stop(),
    newConversation: (): void => agentChatStore.newConversation(),
    dismissError: (): void => agentChatStore.dismissError()
  }
}
