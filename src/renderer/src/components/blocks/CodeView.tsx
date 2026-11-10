import { useEffect, useState } from 'react'
import { highlightCode } from './highlighter'

/**
 * 代码块渲染（shiki github-light，2026-11-11 随宿主切浅色）。
 * 高亮异步就绪前先出纯文本，就绪后整体替换——不阻塞课件首屏。
 * 容器统一浅灰面板 + 极细边框（.cad-code pre 的底色在 globals.css 强制 bg2）。
 */
export function CodeView({ code, language }: { code: string; language: string }): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setHtml(null)
    void highlightCode(code, language).then((h) => {
      if (alive) setHtml(h)
    })
    return () => {
      alive = false
    }
  }, [code, language])

  if (html == null) {
    return (
      <div className="cad-code overflow-hidden rounded-md border border-line/70 bg-bg2">
        <pre className="m-0 overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-tx">
          <code>{code}</code>
        </pre>
      </div>
    )
  }
  return <div className="cad-code overflow-hidden rounded-md border border-line/70 text-[12px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
}
