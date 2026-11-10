import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react'
import type { InteractiveBlock } from '../../../../shared/lesson-schema'

/**
 * P5.6 interactive 块宿主（D2 裁决：独立受限 Renderer + 白名单桥）。
 *  - 编译在主进程 esbuild（白名单 import 重写为 cad-i:// chunk URL，白名单外编译失败回喂）
 *  - 执行在 <iframe sandbox="allow-scripts">：opaque origin 摸不到宿主 DOM/preload/Node；
 *    与宿主唯一通道 postMessage（桥中继 → window.api.interactiveBridge → 主进程强制只读/路径限定）
 *  - agent.askTutor / host.* 为渲染层本地动作（不进主进程）
 *  - 心跳：组件每 2s 上报；漂移大 = 长任务卡顿提示；>8s 无心跳 = 挂死 → 重载按钮
 */

const IFRAME_SRC = 'cad-i://bridge/index.html'

type Status = 'compiling' | 'loading' | 'ready'

interface BridgeRequest {
  type: 'bridge'
  id: string
  kind: string
  params: Record<string, unknown>
}
interface IframeMessage {
  type: 'ready' | 'init-ack' | 'heartbeat' | 'size' | 'error' | BridgeRequest['type']
  id?: string
  kind?: string
  params?: Record<string, unknown>
  drift?: number
  height?: number
  title?: string
  message?: string
}

export function InteractiveBlockView({
  block,
  courseId,
  onAskAgent
}: {
  block: InteractiveBlock
  courseId: string
  onAskAgent?: (prompt: string) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<Status>('compiling')
  const [compileErrs, setCompileErrs] = useState<string[] | null>(null)
  const [runtimeErr, setRuntimeErr] = useState<string | null>(null)
  const [stale, setStale] = useState(false) // 心跳超时 → 挂死提示
  const [height, setHeight] = useState(220)
  const [reloadKey, setReloadKey] = useState(0)
  const [slowHint, setSlowHint] = useState(false)

  // 声明的桥徽标（bridgeImports 在 schema 是白名单枚举）
  const declaredBridges: string[] = block.bridgeImports ?? []

  const codeRef = useRef<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastBeatRef = useRef<number>(Date.now())
  const initedRef = useRef(false)
  const iframeReadyRef = useRef(false)

  // 编译（源码变化或重载时）
  useEffect(() => {
    let alive = true
    setStatus('compiling')
    setCompileErrs(null)
    setRuntimeErr(null)
    setStale(false)
    setSlowHint(false)
    initedRef.current = false
    iframeReadyRef.current = false
    codeRef.current = null
    void window.api.interactiveCompile(block.source).then((res) => {
      if (!alive) return
      if (res.ok) {
        codeRef.current = res.data.code
        setStatus('loading')
        // iframe onLoad / bootstrap ready 往往早于编译完成——补发 init（sendInit 幂等）
        sendInit()
      } else {
        setCompileErrs(res.error.split('\n').filter((l) => l.trim().length > 0).slice(0, 12))
      }
    })
    return () => {
      alive = false
    }
  }, [block.source, reloadKey])

  // init 双向门控：编译产物就绪 + iframe 文档就绪，两者都到位才发（任一后到都由本函数补发）
  const sendInit = useCallback((): void => {
    const win = iframeRef.current?.contentWindow
    if (win == null || codeRef.current == null || !iframeReadyRef.current || initedRef.current) return
    initedRef.current = true
    win.postMessage({ type: 'init', code: codeRef.current }, '*')
  }, [])

  const handleBridge = useCallback(
    async (req: BridgeRequest): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> => {
      // 渲染层本地动作
      if (req.kind === 'agent.askTutor') {
        const text = String(req.params.text ?? '')
        onAskAgent?.(text)
        return { ok: true, data: null }
      }
      if (req.kind.startsWith('host.')) {
        return { ok: true, data: null } // host.notify 等留空实现（v1 无 toast 依赖）
      }
      // 其余走主进程（路径限定/只读强制在主进程）
      return window.api.interactiveBridge({ courseId, kind: req.kind, params: req.params })
    },
    [courseId, onAskAgent]
  )

  // iframe 消息通道
  useEffect(() => {
    const handler = (e: MessageEvent<IframeMessage>): void => {
      const win = iframeRef.current?.contentWindow
      if (win == null || e.source !== win) return // 只信当前 iframe
      const msg = e.data
      if (msg == null) return
      switch (msg.type) {
        case 'ready':
          iframeReadyRef.current = true
          sendInit()
          break
        case 'size':
          if (typeof msg.height === 'number' && msg.height > 40 && msg.height < 8000) setHeight(msg.height)
          setStatus('ready') // 首帧尺寸回报 = 组件已挂载
          break
        case 'heartbeat':
          lastBeatRef.current = Date.now()
          setStatus('ready')
          if ((msg.drift ?? 0) > 3000) setSlowHint(true)
          break
        case 'error':
          setRuntimeErr(`${msg.title ?? '错误'}: ${msg.message ?? ''}`)
          break
        case 'bridge': {
          if (msg.id == null) break
          const req: BridgeRequest = { type: 'bridge', id: msg.id, kind: String(msg.kind), params: msg.params ?? {} }
          void handleBridge(req).then((r) => {
            win.postMessage(
              { type: 'bridge-result', id: req.id, ok: r.ok, ...(r.ok ? { data: r.data } : { error: r.error }) },
              '*'
            )
          })
          break
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [sendInit, handleBridge])

  // 看门狗：>8s 无心跳 → 挂死提示（组件同步死循环时宿主也可能被冻住——此时提示出现在重载后）
  useEffect(() => {
    if (status !== 'ready') return
    const t = setInterval(() => {
      if (Date.now() - lastBeatRef.current > 8000) setStale(true)
      else setStale(false)
    }, 3000)
    return () => clearInterval(t)
  }, [status])

  if (compileErrs != null) {
    return (
      <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-bad">
          <AlertTriangle size={13} /> 交互组件编译失败
        </div>
        <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px] text-tx2">
          {compileErrs.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="relative">
      {status !== 'ready' && (
        <div className="flex h-[180px] items-center justify-center gap-2 rounded-md border border-dashed border-line text-[12px] text-tx2">
          <Loader2 size={14} className="animate-spin" />
          {status === 'compiling' ? '编译交互组件…' : '加载组件…'}
        </div>
      )}
      <iframe
        key={reloadKey}
        ref={iframeRef}
        src={IFRAME_SRC}
        sandbox="allow-scripts"
        title={block.title}
        onLoad={() => {
          iframeReadyRef.current = true
          sendInit()
        }}
        className={`w-full border-0 bg-transparent ${status === 'ready' ? '' : 'absolute inset-0 h-0 opacity-0'}`}
        style={{ height: status === 'ready' ? height + 8 : undefined }}
      />
      {runtimeErr != null && (
        <div className="mt-1.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-[11px] text-warn">
          {runtimeErr}
        </div>
      )}
      {slowHint && !stale && (
        <div className="mt-1.5 text-[11px] text-warn">组件出现长任务卡顿（桥调用应放在低频路径）</div>
      )}
      {stale && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-bg/80 text-[12.5px] text-tx">
          交互组件无响应
          <button
            type="button"
            onClick={() => {
              setSlowHint(false)
              setReloadKey((k) => k + 1)
            }}
            className="flex h-7 items-center gap-1.5 rounded border border-line px-3 text-tx2 hover:bg-panel-hover"
          >
            <RefreshCw size={12} /> 重新加载
          </button>
        </div>
      )}
      {declaredBridges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {declaredBridges.map((b) => (
            <span key={b} className="rounded bg-track px-1.5 py-0.5 font-mono text-[10px] text-tx2">
              {b}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
