/// <reference lib="dom" />
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Mafs, Coordinates, Plot, Point, Circle, Text, Vector, Theme, LaTeX, useMovablePoint } from 'mafs'

/**
 * mafs 0.21.0 × React 19.3 冒烟（2026-11-10 选型确认的前置门槛）。
 * mafs 停滞 2 年、peer 只声明 >=18，需实测验证 React 19 下可渲染。
 *
 * Mafs 以"容器测量宽度 > 0"为门槛挂载 SVG 子树，jsdom 无布局引擎，
 * 故用官方 ssr 属性（宽度取 500）绕过测量；这里验证的是组件树在
 * React 19 渲染器 + effect 真实执行下不崩、产出合法 SVG 子树。
 * （真实浏览器中的指针拖拽等验收留到 P5.6 渲染管线端到端做。）
 */

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

function Scene(): ReactElement {
  const tip = useMovablePoint([1, 1])
  return createElement(
    Mafs,
    { ssr: true, viewBox: { x: [-3, 3], y: [-2, 2] }, preserveAspectRatio: false, height: 400 },
    createElement(Coordinates.Cartesian),
    createElement(Plot.OfX, { y: (x: number) => (x * x) / 2, color: Theme.blue }),
    createElement(Point, { x: 1, y: 1 }),
    createElement(Circle, { center: [0, 0], radius: 1, fillOpacity: 0.3 }),
    createElement(Vector, { tail: [-2, -1], tip: tip.point }),
    createElement(Text, { x: 0, y: 1.5, attach: 'e' }, 'hello'),
    createElement(LaTeX, { at: [-1, -1], tex: '\\int f(x)\\,dx' })
  )
}

async function renderScene(): Promise<string> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(Scene))
    await new Promise((r) => setTimeout(r, 50)) // 等 useMeasure 回调/首帧 effect
  })
  return host.innerHTML
}

describe('mafs × React 19 冒烟', () => {
  it('静态+交互组件在 effect 真实执行下渲染出合法 SVG', async () => {
    const html = await renderScene()
    expect(html).toContain('<svg')
    expect(html).toContain('</svg>')
    expect(html).toContain('<circle') // Circle 块
    expect(html).toContain('<path') // Plot.OfX 曲线
    expect(html).toContain('<text') // Text 标签
    expect(html).toContain('<line') // Vector 向量线
  })

  it('useMovablePoint（可拖拽点）在 React 19 渲染器下工作', async () => {
    const html = await renderScene()
    // MovablePoint 渲染为 g 包裹的拖拽手柄
    expect(html).toContain('<g')
  })

  it('LaTeX 组件产出 KaTeX 标记', async () => {
    const html = await renderScene()
    expect(html.toLowerCase()).toContain('katex')
  })
})
