/// <reference lib="dom" />
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { katexHtml, Katex } from '../src/renderer/src/components/blocks/Katex'
import { Md } from '../src/renderer/src/components/blocks/Md'
import { CodeView } from '../src/renderer/src/components/blocks/CodeView'
import { AnimView } from '../src/renderer/src/components/blocks/AnimView'
import { judgeQuiz } from '../src/renderer/src/components/blocks/QuizCard'
import { normalizeLang } from '../src/renderer/src/components/blocks/highlighter'
import type { AnimBlock } from '../src/shared/lesson-schema'

/**
 * P5.5 块渲染器冒烟：jsdom 真渲染（react-markdown/KaTeX/shiki/motion 通路）。
 * mermaid/echarts 涉及真实测量布局，留 Electron 实机验收（同 mafs 冒烟的处理方式）。
 */

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

async function render(el: ReactElement): Promise<{ host: HTMLDivElement; html: () => string }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
    await new Promise((r) => setTimeout(r, 50))
  })
  return { host, html: () => host.innerHTML }
}

/** 轮询等待异步渲染产物出现（shiki 高亮为懒加载 chunk）。 */
async function waitFor(probe: () => boolean, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (probe()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return probe()
}

describe('KaTeX（math 块管线）', () => {
  it('display 模式产出 katex-display，解析失败降级原文不抛错', () => {
    const ok = katexHtml('x^2', true)
    expect(ok).toContain('katex-display')
    const bad = katexHtml('\\frac{1}{', true) // throwOnError:false → 保留原文的红色提示
    expect(typeof bad).toBe('string')
    expect(bad.length).toBeGreaterThan(0)
  })

  it('Katex 组件渲染为 HTML', async () => {
    const { html } = await render(createElement(Katex, { latex: '\\int_0^1 f(x)\\,dx', block: true }))
    expect(html()).toContain('katex-display')
  })

})

describe('Md（react-markdown 管线）', () => {
  it('行内公式 $...$ 走 KaTeX', async () => {
    const { html } = await render(createElement(Md, { text: '当 $x^2 > 0$ 时恒成立' }))
    expect(html()).toContain('katex')
    expect(html()).toContain('x')
  })

  it('GFM 表格渲染为 table', async () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |'
    const { html } = await render(createElement(Md, { text: md }))
    expect(html()).toContain('<table')
    expect(html()).toContain('<td>2</td>')
  })

  it('fenced 代码经 shiki 高亮（真实 chunk 懒加载）', async () => {
    const { host } = await render(createElement(Md, { text: '```python\ndef f(x):\n    return x + 1\n```' }))
    const got = await waitFor(() => host.innerHTML.includes('shiki'))
    expect(got).toBe(true)
    expect(host.querySelector('pre.shiki')).not.toBeNull()
  })

  it('白名单外语言回退纯文本 pre', async () => {
    const { host } = await render(createElement(CodeView, { code: 'PUSH A', language: 'pseudocode' }))
    // 2026-11-11 视觉重做后 cad-code 类在外层容器，pre 是其子元素
    expect(host.querySelector('.cad-code pre')).not.toBeNull()
  })
})

describe('highlighter 语言归一', () => {
  it('别名归一与纯文本判定', () => {
    expect(normalizeLang('py')).toBe('python')
    expect(normalizeLang('C++')).toBe('cpp')
    expect(normalizeLang('SystemVerilog')).toBe('system-verilog')
    expect(normalizeLang('plaintext')).toBe('')
  })
})

describe('judgeQuiz（D6 判定口径，从 P5.4 迁入）', () => {
  it('choice 按集合比对（多选乱序对等）', () => {
    expect(judgeQuiz('choice', 'A,C', ['C', 'A'], '')).toBe(true)
    expect(judgeQuiz('choice', 'A', ['A', 'B'], '')).toBe(false)
    expect(judgeQuiz('choice', 'B', [], 'B')).toBe(false)
  })
  it('blank 归一空白后比对', () => {
    expect(judgeQuiz('blank', '栈顶', [], '栈 顶')).toBe(true)
    expect(judgeQuiz('blank', 'FIFO', [], 'LIFO')).toBe(false)
  })
})

describe('AnimView（motion 帧模板）', () => {
  const block: AnimBlock = {
    id: 'a1',
    type: 'anim',
    origin: 'ai-supplement',
    template: 'array',
    frames: [
      { data: { items: [3, 1, 2] }, note: '初始数组' },
      { data: { items: [1, 2, 3] }, pointers: { i: 0 }, highlight: [0, 1], note: '交换后' }
    ]
  }

  it('首帧渲染 + 下一帧切换（含指针与高亮）', async () => {
    const { host, html } = await render(createElement(AnimView, { block }))
    expect(html()).toContain('初始数组')
    expect(html()).not.toContain('▲') // 首帧未定义 pointers
    const next = host.querySelector('[aria-label="下一帧"]') as HTMLButtonElement | null
    expect(next).not.toBeNull()
    await act(async () => {
      next?.click()
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(html()).toContain('交换后')
    expect(html()).toContain('▲ i') // 第二帧 pointers.i = 0
  })

  it('坏帧数据降级为提示而不是白屏', async () => {
    const bad: AnimBlock = {
      id: 'a2',
      type: 'anim',
      origin: 'ai-supplement',
      template: 'array',
      frames: [
        { data: { wrong: true }, note: 'x' },
        { data: { items: [1] }, note: 'y' }
      ]
    }
    const { html } = await render(createElement(AnimView, { block: bad }))
    expect(html()).toContain('不匹配')
  })
})
