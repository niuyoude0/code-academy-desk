import { build, type Plugin } from 'esbuild'
import { createHash } from 'crypto'

/**
 * P5.6 interactive 编译服务（D2 裁决 2026-11-10：独立受限 Renderer + 白名单桥）。
 *  - AI 生成的 TSX 在主进程 esbuild 转译为 ESM（毫秒级），送入沙箱 iframe（opaque origin）执行
 *  - 白名单 import 编译期重写为 cad-i://bridge/chunks/ 绝对 URL（渲染层 import map 不参与，blob 模块直接可加载）
 *  - 白名单外 import（含 node:fs/relative import）→ 编译错误回喂（对模型/用户都是明确的返工信号）
 *  - 别名：AI 侧桥名 → 实际 chunk（three→fiber+drei 合并 chunk、matter→matter-js、konva→react-konva…）
 *    与 resources/skills/course-material-processor/references/interactive-bridge.md 的 import 形状一一对应
 */

export const BRIDGE_CHUNK_BASE = 'cad-i://bridge/chunks'

/** AI 侧 import 名 → chunk 文件名（值 = chunks/<名>.js）。 */
export const AI_IMPORT_MAP: Record<string, string> = {
  react: 'react',
  'react/jsx-runtime': 'react',
  motion: 'motion',
  echarts: 'echarts',
  konva: 'konva',
  xyflow: 'xyflow',
  matter: 'matter',
  three: 'three',
  'three/drei': 'three',
  controls: 'controls',
  mafs: 'mafs',
  fs: 'fs',
  system: 'system',
  agent: 'agent'
}

/**
 * 受控桥的具名导出清单（chunk 入口由本仓库维护，导出面已知）。
 * export * 的大面桥（react/motion/konva/xyflow/matter/mafs）不校验具名——运行时 undefined 可定位。
 */
export const AI_NAMED_EXPORTS: Partial<Record<string, string[]>> = {
  fs: ['readCourseFile', 'readCourseAsset', 'getProgress', 'getManifest'],
  system: ['getSystemInfo'],
  agent: ['askTutor'],
  echarts: ['EChart'],
  controls: ['Slider', 'NumberInput', 'Toggle', 'PlayButton', 'Select'],
  three: [
    'Canvas', 'useFrame', 'useThree', 'useLoader', 'extend',
    'OrbitControls', 'TransformControls', 'Html', 'Text', 'Grid', 'Sky', 'Stars',
    'Environment', 'ContactShadows', 'Float', 'Line', 'Billboard', 'Center', 'RoundedBox'
  ]
}

/** 从源码取某 specifier 的具名导入集合（含 as 别名归一、type 前缀剔除）。 */
function namedImportsOf(source: string, spec: string): string[] {
  const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out: string[] = []
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${esc}['"]`, 'g')
  for (const m of source.matchAll(re)) {
    for (const raw of m[1].split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim()
      if (name.length > 0) out.push(name)
    }
  }
  return out
}

export interface CompileResult {
  code: string
  cached: boolean
}

export interface CompileIssue {
  text: string
}

export class InteractiveCompileError extends Error {
  issues: CompileIssue[]
  constructor(message: string, issues: CompileIssue[]) {
    super(message)
    this.issues = issues
  }
}

const SOURCE_MAX_BYTES = 500 * 1024
const OUTPUT_MAX_BYTES = 8 * 1024 * 1024

const cache = new Map<string, CompileResult>()

/**
 * 源码级 import 预扫描（安全门，先于 esbuild）。
 * 为什么必须有：esbuild 在解析层就会丢弃未使用的 import（treeShaking:false 也拦不住），
 * 插件 onResolve 对被丢弃的 import 根本不触发——白名单审查必须发生在源码文本上。
 * 已知局限：字符串/注释里的 import 形文本会误报（可接受，错误信息会指引）。
 */
export function scanImportSpecifiers(source: string): { specifiers: string[]; issues: CompileIssue[] } {
  const specifiers: string[] = []
  const issues: CompileIssue[] = []
  const patterns = [
    /(?:^|[;\s}])(?:import\s[\s\S]*?|export\s[\s\S]*?)from\s*['"]([^'"\n]+)['"]/g, // import/export ... from 'x'
    /(?:^|[;\s}])import\s*['"]([^'"\n]+)['"]/g, // import 'x'
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g // 动态 import('x')
  ]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const spec = m[1]
      if (!specifiers.includes(spec)) specifiers.push(spec)
    }
  }
  // require() 一律拒绝（技能文档：ESM only）
  if (/\brequire\s*\(/.test(source)) {
    issues.push({ text: "禁止 require()——interactive 组件只用 ESM import" })
  }
  return { specifiers, issues }
}

/** 白名单 import 重写插件：命中 → external 绝对 URL；未命中 → 编译错误。 */
function bridgeRewritePlugin(): Plugin {
  return {
    name: 'cad-bridge-rewrite',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path
        if (p in AI_IMPORT_MAP) {
          return { path: `${BRIDGE_CHUNK_BASE}/${AI_IMPORT_MAP[p]}.js`, external: true }
        }
        if (p.startsWith('node:')) {
          return {
            errors: [
              { text: `白名单外 import: '${p}'（Node 内置模块不可用——宿主能力走 fs/system/agent 桥）` }
            ]
          }
        }
        if (p.startsWith('.')) {
          return {
            errors: [
              { text: `interactive 组件必须是单个自包含文件，不支持相对导入: '${p}'` }
            ]
          }
        }
        const allow = Object.keys(AI_IMPORT_MAP).filter((k) => !k.includes('/'))
        return {
          errors: [
            {
              text: `白名单外 import: '${p}'。允许列表：${allow.join(' / ')}（'three/drei' 为 three 的子桥）`
            }
          ]
        }
      })
    }
  }
}

/**
 * 编译 interactive 组件源码 → ESM JS 字符串。
 * 抛 InteractiveCompileError（issues 含每条编译错误文本）。
 */
export async function compileInteractiveComponent(source: string): Promise<CompileResult> {
  if (Buffer.byteLength(source, 'utf-8') > SOURCE_MAX_BYTES) {
    throw new InteractiveCompileError('组件源码超过 500KB 上限', [
      { text: `源码 ${Math.round(Buffer.byteLength(source, 'utf-8') / 1024)}KB > 500KB` }
    ])
  }
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 24)
  const hit = cache.get(hash)
  if (hit != null) return { ...hit, cached: true }

  // 安全门 1：源码级 import 预扫描（所有出现的 specifier 必须在白名单内，无论是否被使用）
  const scan = scanImportSpecifiers(source)
  const violations: CompileIssue[] = []
  const allow = Object.keys(AI_IMPORT_MAP).filter((k) => !k.includes('/'))
  for (const s of scan.specifiers) {
    if (!(s in AI_IMPORT_MAP)) {
      violations.push({
        text: s.startsWith('.')
          ? `interactive 组件必须是单个自包含文件，不支持相对导入: '${s}'`
          : `白名单外 import: '${s}'。允许列表：${allow.join(' / ')}（'three/drei' 为 three 的子桥；Node 内置/相对导入/三方包一律不可用）`
      })
      continue
    }
    // 具名导出校验（受控桥）：import { readFileSync } from 'fs' 这类错误在编译期就报
    const known = AI_NAMED_EXPORTS[s]
    if (known != null) {
      for (const n of namedImportsOf(source, s)) {
        if (!known.includes(n)) {
          violations.push({ text: `'${s}' 桥没有导出 '${n}'。可用：${known.join(' / ')}` })
        }
      }
    }
  }
  if (violations.length > 0 || scan.issues.length > 0) {
    throw new InteractiveCompileError(`import 白名单校验失败（${violations.length + scan.issues.length} 处）`, [
      ...violations,
      ...scan.issues
    ])
  }

  let result
  try {
    result = await build({
      stdin: { contents: source, resolveDir: '.', sourcefile: 'interactive.tsx', loader: 'tsx' },
      bundle: true,
      write: false,
      format: 'esm',
      target: ['chrome130'],
      jsx: 'automatic',
      jsxImportSource: 'react',
      logLevel: 'silent',
      minify: false, // 校对页人审与错误定位需要可读性
      treeShaking: false, // 安全边界：未使用的 import 也要过白名单审查（否则被树摇绕过）
      plugins: [bridgeRewritePlugin()]
    })
  } catch (err) {
    // esbuild 自身异常（区别于编译错误）
    throw new InteractiveCompileError('编译器异常', [
      { text: err instanceof Error ? err.message : String(err) }
    ])
  }
  if (result.errors.length > 0) {
    throw new InteractiveCompileError(
      `编译失败（${result.errors.length} 处）`,
      result.errors.map((e) => ({ text: `${e.location ? `${e.location.file}:${e.location.line} ` : ''}${e.text}` }))
    )
  }
  const code = result.outputFiles[0]?.text ?? ''
  if (code.length === 0) {
    throw new InteractiveCompileError('编译产物为空', [{ text: '(no output)' }])
  }
  // 安全门 2（兜底）：产物中不得出现 node: 导入或 require
  if (/(?:^|[\s(])from\s*['"]node:|import\s*['"]node:|\brequire\s*\(/.test(code)) {
    throw new InteractiveCompileError('产物含被禁止的模块引用', [{ text: '(node: import or require in output)' }])
  }
  if (Buffer.byteLength(code, 'utf-8') > OUTPUT_MAX_BYTES) {
    throw new InteractiveCompileError('编译产物超过 8MB 上限', [{ text: '(too large)' }])
  }
  const out: CompileResult = { code, cached: false }
  cache.set(hash, out)
  if (cache.size > 200) {
    // 粗略防膨胀：清最旧的 50 条（ interactive 块每课件 ≤1，正常用不到）
    const keys = [...cache.keys()].slice(0, 50)
    for (const k of keys) cache.delete(k)
  }
  return out
}

/** 清空编译缓存（测试用）。 */
export function clearCompileCache(): void {
  cache.clear()
}
