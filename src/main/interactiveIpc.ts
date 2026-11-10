import { app, ipcMain, protocol } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { IpcChannel } from '../shared/ipc'
import {
  compileInteractiveComponent,
  InteractiveCompileError
} from './services/interactiveCompile'
import {
  readCourseFileText,
  readCourseAssetDataUrl,
  getCourseProgress,
  getCourseManifest,
  InteractiveBridgeError
} from './services/interactiveBridge'

/**
 * P5.6 interactive 域：
 *  - interactive:compile   TSX → ESM（主进程 esbuild，白名单重写，带缓存）
 *  - interactive:bridge    沙箱组件的宿主能力桥（fs/system；agent.askTutor 是渲染层本地动作不到主进程）
 *  - cad-i:// 协议         沙箱 iframe 文档与 chunk 资源（resources/interactive-bridge/）
 *
 * 安全模型（D2 裁决）：iframe 沙箱 allow-scripts（opaque origin）摸不到宿主；
 * 桥的每一步都在主进程做路径限定与只读强制。渲染层转发的 kind 必须在白名单内。
 */

const BRIDGE_KINDS = [
  'fs.readCourseFile',
  'fs.readCourseAsset',
  'fs.getProgress',
  'fs.getManifest',
  'system.getInfo'
] as const
type BridgeKind = (typeof BRIDGE_KINDS)[number]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

/** app ready 前调用：注册 cad-i 为标准安全协议。 */
export function registerInteractiveProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'cad-i', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

function bridgeAssetsRoot(): string {
  // dev = 项目根/resources；打包后 app.getAppPath() 指向 app.asar（Electron 的 fs 可透明读 asar）
  return join(app.getAppPath(), 'resources', 'interactive-bridge')
}

/** app ready 后调用：cad-i:// 协议处理器 + IPC 通道。 */
export function registerInteractiveIpc(coursesRoot: string): void {
  protocol.handle('cad-i', async (request) => {
    try {
      const url = new URL(request.url)
      // 只服务 cad-i://bridge/<path>；path 归一化防穿越
      if (url.host !== 'bridge') {
        console.error('[cad-i] 404 bad host:', request.url)
        return new Response('not found', { status: 404 })
      }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (rel.includes('..') || rel === '') {
        console.error('[cad-i] 404 bad path:', request.url)
        return new Response('not found', { status: 404 })
      }
      const file = join(bridgeAssetsRoot(), rel)
      const st = await fs.stat(file).catch(() => null)
      if (st == null || !st.isFile()) {
        console.error('[cad-i] 404 missing:', rel, '→', file)
        return new Response('not found', { status: 404 })
      }
      const mime = MIME[join(rel).slice(rel.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream'
      const buf = await fs.readFile(file)
      console.log('[cad-i] 200', rel, `(${buf.length}b)`)
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': mime, 'cache-control': 'no-cache' }
      })
    } catch (err) {
      console.error('[cad-i] 500:', err)
      return new Response('error', { status: 500 })
    }
  })

  const wrap = async <T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      if (err instanceof InteractiveCompileError || err instanceof InteractiveBridgeError) {
        return { ok: false, error: err.message }
      }
      console.error('[interactive] 未预期错误:', err)
      return { ok: false, error: err instanceof Error ? err.message : '内部错误' }
    }
  }

  ipcMain.handle(IpcChannel.InteractiveCompile, (_e, payload: { source: string }) =>
    wrap(async () => {
      const r = await compileInteractiveComponent(String(payload.source ?? ''))
      return { code: r.code, cached: r.cached }
    })
  )

  ipcMain.handle(
    IpcChannel.InteractiveBridge,
    (_e, payload: { courseId: string; kind: string; params: Record<string, unknown> }) =>
      wrap(async () => {
        const kind = String(payload.kind ?? '')
        if (!(BRIDGE_KINDS as readonly string[]).includes(kind)) {
          // agent.askTutor / host.* 属渲染层本地动作，绝不该到主进程
          throw new InteractiveBridgeError(`未知桥调用: ${kind}`)
        }
        const courseId = String(payload.courseId ?? '')
        const params = (payload.params ?? {}) as Record<string, unknown>
        switch (kind as BridgeKind) {
          case 'fs.readCourseFile':
            return { content: await readCourseFileText(coursesRoot, courseId, String(params.relPath ?? '')) }
          case 'fs.readCourseAsset':
            return { dataUrl: await readCourseAssetDataUrl(coursesRoot, courseId, String(params.relPath ?? '')) }
          case 'fs.getProgress':
            return await getCourseProgress(coursesRoot, courseId)
          case 'fs.getManifest':
            return await getCourseManifest(coursesRoot, courseId)
          case 'system.getInfo':
            return { platform: process.platform, locale: app.getLocale(), appVersion: app.getVersion() }
        }
      })
  )
}
