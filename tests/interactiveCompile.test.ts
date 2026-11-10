import { describe, it, expect } from 'vitest'
import {
  compileInteractiveComponent,
  InteractiveCompileError,
  clearCompileCache
} from '../src/main/services/interactiveCompile'

/**
 * P5.6 interactive 编译服务（真实 esbuild，零 AI 消耗）：
 * 白名单重写为 cad-i:// chunk URL、别名、白名单外拒绝、缓存。
 */

const ok = (imports: string, body: string): string => `
import { useState } from 'react'
${imports}
export default function Demo() {
  ${body}
  return null
}
`

describe('interactiveCompile：白名单重写', () => {
  it('react + motion import 重写为 cad-i:// chunk 绝对 URL', async () => {
    clearCompileCache()
    const r = await compileInteractiveComponent(
      ok("import { motion } from 'motion'", 'const [n] = useState(0); void n; void motion;')
    )
    expect(r.code).toContain("cad-i://bridge/chunks/react.js")
    expect(r.code).toContain("cad-i://bridge/chunks/motion.js")
    expect(r.cached).toBe(false)
  })

  it('别名：matter → matter chunk；three/drei 与 three → 同一 three chunk', async () => {
    const r = await compileInteractiveComponent(`
import Matter from 'matter'
import { OrbitControls } from 'three/drei'
export default function D() { void Matter; void OrbitControls; return null }
`)
    expect(r.code).toContain('cad-i://bridge/chunks/matter.js')
    expect(r.code).toContain('cad-i://bridge/chunks/three.js')
  })

  it('jsx automatic：产出 react/jsx-runtime 重写而非 createElement', async () => {
    const r = await compileInteractiveComponent(`
export default function D() { return <div className="x">hi</div> }
`)
    expect(r.code).toContain('cad-i://bridge/chunks/react.js')
    expect(r.code).not.toContain('React.createElement')
  })

  it('编译缓存命中', async () => {
    clearCompileCache()
    const src = ok("import { Slider } from 'controls'", 'const [v] = useState(1); void v; void Slider;')
    const a = await compileInteractiveComponent(src)
    const b = await compileInteractiveComponent(src)
    expect(a.cached).toBe(false)
    expect(b.cached).toBe(true)
    expect(b.code).toBe(a.code)
  })
})

describe('interactiveCompile：白名单外拒绝', () => {
  const expectReject = async (source: string, needle: string): Promise<void> => {
    try {
      await compileInteractiveComponent(source)
      expect.fail(`应当拒绝: ${needle}`)
    } catch (e) {
      expect(e).toBeInstanceOf(InteractiveCompileError)
      expect((e as InteractiveCompileError).issues.map((i) => i.text).join('\n')).toContain(needle)
    }
  }

  it('node:fs 内置模块拒绝', async () => {
    await expectReject("import { readFileSync } from 'node:fs'\nexport default function D(){return null}", 'node:fs')
  })

  it('fs 桥具名导出校验：readFileSync 不存在即编译期拒绝', async () => {
    await expectReject(
      "import { readFileSync } from 'fs'\nexport default function D(){return null}",
      "没有导出 'readFileSync'"
    )
    // 正确的 fs 桥用法通过
    const r = await compileInteractiveComponent(
      "import { getProgress } from 'fs'\nexport default function D(){ void getProgress; return null }"
    )
    expect(r.code).toContain('cad-i://bridge/chunks/fs.js')
  })

  it('白名单外三方包拒绝', async () => {
    await expectReject("import _ from 'lodash'\nexport default function D(){return null}", 'lodash')
  })

  it('相对导入拒绝（单文件自包含）', async () => {
    await expectReject("import { x } from './helper'\nexport default function D(){return null}", '自包含')
  })

  it('超过 500KB 拒绝', async () => {
    const big = `export default function D(){ const s = '${'x'.repeat(600 * 1024)}'; void s; return null }`
    await expectReject(big, '500KB')
  })
})
