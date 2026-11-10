/**
 * 构建 @cad/course-tools 插件（P5.2.5）：
 *  - 把 src/course-tools/index.ts 连同 shared schema 与 main 服务单源打包成 ESM 单文件
 *  - 产物落到 vendor：resources/dsh-runtime/node_modules/@cad/course-tools/lib/index.js
 *    （profile node_modules junction 到 vendor @cad scope，DSH 以 bare specifier 加载）
 *  - '@deepseek-ai/dsh-tools' 保持 external：运行时经 junction 解析到 vendor 真包
 *
 * 用法：npm run build:plugin
 */
import { build } from 'esbuild'
import { statSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outfile = path.join(root, 'resources', 'dsh-runtime', 'node_modules', '@cad', 'course-tools', 'lib', 'index.js')

const result = await build({
  entryPoints: [path.join(root, 'src', 'course-tools', 'index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['@deepseek-ai/dsh-tools'],
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  metafile: true
})

const size = statSync(outfile).size
const inputs = Object.keys(result.metafile.inputs).length
console.log(`[build:plugin] OK → ${outfile} (${(size / 1024).toFixed(0)} KB, ${inputs} modules)`)
