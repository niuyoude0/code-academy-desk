import { useEffect, useState } from 'react'
import { highlightCode } from './highlighter'

/**
 * 代码块渲染（shiki one-dark-pro）。
 * 高亮异步就绪前先出纯文本，就绪后整体替换——不阻塞课件首屏。
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
      <pre className="cad-code m-0 overflow-x-auto rounded-md bg-bg p-3 font-mono text-[12px] leading-relaxed text-tx">
        <code>{code}</code>
      </pre>
    )
  }
  return <div className="cad-code text-[12px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
}
