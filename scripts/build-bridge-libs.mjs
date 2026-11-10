/**
 * P5.6 interactive 桥 chunk 预打包：
 *  scripts/bridge-src/entry-*.mjs → resources/interactive-bridge/{bootstrap.html,bridge.css,chunks/*.js}
 *
 * 设计要点：
 *  - 用户代码经主进程 esbuild 编译时，白名单 import 全部重写为绝对 URL 'cad-i://bridge/chunks/<name>.js'
 *    （见 src/main/services/interactiveCompile.ts），所以 chunk 之间互相引用也用同源相对路径 './react.js'。
 *  - three/fiber/drei 打进同一个 chunk，保证 three 实例唯一（分 chunk 会 import map 冲突）。
 *  - CSS（mafs/xyflow）由 esbuild 从 entry 的 css import 产出同名 .css，bootstrap <link> 固定引用。
 *  - devDeps 的库只在本脚本使用，不进 asar；产物 chunk 随 resources/** 打包。
 */
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, statSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(root, 'scripts', 'bridge-src')
const outDir = join(root, 'resources', 'interactive-bridge')
const chunksDir = join(outDir, 'chunks')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(chunksDir, { recursive: true })

/** react 家族 → 同目录 './react.js'（jsx-runtime 同 chunk，react entry 已合并导出）。 */
const reactExternal = {
  name: 'react-external',
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, () => ({ path: './react.js', external: true }))
  }
}

const EXTS = { echarts: '.tsx', controls: '.tsx' }

const COMMON = {
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['chrome130'],
  logLevel: 'silent',
  jsx: 'automatic',
  jsxImportSource: 'react',
  // mafs 的 core.css 引入 computer-modern 字体文件 → 作为资产输出到 chunks/（css 内 url 相对引用）
  loader: { '.ttf': 'file', '.woff2': 'file', '.woff': 'file' },
  plugins: [reactExternal]
}

const ENTRIES = [ // name → 源文件扩展名（含 JSX 的用 .tsx）
  'react',
  'motion',
  'echarts',
  'konva',
  'xyflow',
  'matter',
  'three',
  'controls',
  'mafs',
  'fs',
  'system',
  'agent'
]

const t0 = Date.now()
const sizes = []
for (const name of ENTRIES) {
  const outfile = join(chunksDir, `${name}.js`)
  // react chunk 本体就是 react——不能套 reactExternal 插件（否则把自己也 external 成 './react.js'）
  const opts =
    name === 'react'
      ? { ...COMMON, plugins: [] }
      : COMMON
  const result = await build({
    ...opts,
    entryPoints: [join(srcDir, `entry-${name}${EXTS[name] ?? '.ts'}`)],
    outfile,
    metafile: true,
    write: true
  })
  const bytes = statSync(outfile).size
  sizes.push([name, bytes, result.metafile ? countModules(result.metafile) : 0])
}

function countModules(metafile) {
  return Object.keys(metafile.inputs).length
}

// bootstrap（iframe 请求 index.html）与工具样式
cpSync(join(srcDir, 'bootstrap.html'), join(outDir, 'index.html'))
cpSync(join(srcDir, 'bridge.css'), join(outDir, 'bridge.css'))

let total = 0
console.log('bridge chunks:')
for (const [name, bytes, mods] of sizes) {
  total += bytes
  console.log(`  ${name.padEnd(10)} ${(bytes / 1024).toFixed(0).padStart(6)} KB  (${mods} modules)`)
}
const fileCount = readdirSync(chunksDir).length
console.log(`total ${(total / 1024).toFixed(0)} KB, ${fileCount} files → resources/interactive-bridge/ (${Date.now() - t0}ms)`)
