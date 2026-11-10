import katex from 'katex'

/** KaTeX → HTML 字符串（解析失败不抛错，降级显示原文）。 */
export function katexHtml(latex: string, displayMode = false): string {
  return katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    strict: false,
    output: 'html'
  })
}

/** 独立公式渲染（math 块 / formula-list 项）。 */
export function Katex({
  latex,
  block = false,
  className = ''
}: {
  latex: string
  block?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={`${block ? 'katex-block overflow-x-auto py-1' : 'inline-block'} ${className}`}
      dangerouslySetInnerHTML={{ __html: katexHtml(latex, block) }}
    />
  )
}
