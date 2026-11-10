/**
 * agent 桥：向 AI 助教发起会话（转学习页"问助教"管道， fire-and-forget，无回复通道）。
 * 组件不要用它做核心教学逻辑——回复出现在助教页而非组件内。
 */
export async function askTutor(text: string): Promise<void> {
  await window.cadBridge.call('agent.askTutor', { text: String(text) })
}
