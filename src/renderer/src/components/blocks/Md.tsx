import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { CodeView } from './CodeView'

/**
 * 课件 markdown 统一渲染（A 层管线）：GFM 表格/任务列表 + remark-math/$..$、$$..$$
 * KaTeX 行内/块级公式 + fenced 代码 shiki 高亮。
 * 外部链接交给主进程 setWindowOpenHandler（deny + 系统浏览器）。
 */
export const Md = memo(function Md({
  text,
  className = ''
}: {
  text: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={`md-view text-[13px] leading-relaxed text-tx ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // fenced 代码交给 CodeView（去掉默认 pre 包裹，CodeView 自带容器）
          pre: ({ children }) => <>{children}</>,
          code: ({ className: cls, children }) => {
            const m = /language-([\w+-]+)/.exec(cls ?? '')
            const text2 = String(children ?? '').replace(/\n$/, '')
            if (m != null && m[1] != null && m[1] !== '') {
              return <CodeView code={text2} language={m[1]} />
            }
            return (
              <code className="rounded bg-bg px-1 py-0.5 font-mono text-[12px] text-tx">{children}</code>
            )
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-acc underline decoration-acc/40 hover:decoration-acc"
              onClick={(e) => {
                // Electron 主进程拦截 window.open → shell.openExternal；此处防应用内导航兜底
                e.preventDefault()
                if (href != null && href !== '') window.open(href, '_blank', 'noopener')
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

/** 行内小段 markdown（quiz 选项/表格单元格等，段落间距压缩）。 */
export const MdInline = memo(function MdInline({ text }: { text: string }): React.JSX.Element {
  return <Md text={text} className="inline-md" />
})
