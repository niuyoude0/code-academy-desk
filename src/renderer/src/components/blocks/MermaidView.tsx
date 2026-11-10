import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

type MermaidApi = (typeof import('mermaid'))['default']

let mermaidLoad: Promise<MermaidApi> | null = null

/** mermaid 12 懒加载单例（vite 分包，首次 diagram 块才拉取 ~670KB chunk）。 */
function loadMermaid(): Promise<MermaidApi> {
  mermaidLoad ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif'
    })
    return m.default
  })
  return mermaidLoad
}

/** diagram 块（mermaid）渲染；语法错误回显原文供返工定位。 */
export function MermaidView({ code, blockId }: { code: string; blockId: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSvg(null)
    setErr(null)
    void loadMermaid()
      .then(async (mermaid) => {
        // render 需要每次唯一的 id（v10+ 内部创建临时元素）
        const uid = `mmd-${blockId.replace(/[^\w-]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
        const { svg: out } = await mermaid.render(uid, code)
        if (alive) setSvg(out)
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [code, blockId])

  if (err != null) {
    return (
      <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-bad">
          <AlertTriangle size={13} /> mermaid 渲染失败：{err}
        </div>
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-tx2">{code}</pre>
      </div>
    )
  }
  if (svg == null) {
    return <div className="py-5 text-center text-[12px] text-tx2">渲染图示中…</div>
  }
  return <div className="mermaid-view flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
}
