import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { python } from '@codemirror/lang-python'
import { cpp } from '@codemirror/lang-cpp'
import { javascript } from '@codemirror/lang-javascript'
import type { Extension } from '@codemirror/state'

/**
 * P5.8 编程题代码编辑器（CodeMirror 6，选型报告既定；经 React.lazy 懒加载分包）。
 * 语言 → 扩展：python/cpp/javascript，白名单外纯文本。
 */

function langExtension(language: string): Extension[] {
  const l = language.toLowerCase()
  if (l === 'python' || l === 'py' || l === 'python3') return [python()]
  if (l === 'c' || l === 'cpp' || l === 'c++') return [cpp()]
  if (l === 'javascript' || l === 'js' || l === 'node' || l === 'typescript' || l === 'ts') {
    return [javascript({ ...(l.startsWith('ts') ? { typescript: true } : {}) })]
  }
  return []
}

export default function CodeEditor({
  value,
  language,
  readOnly = false,
  onChange
}: {
  value: string
  language: string
  readOnly?: boolean
  onChange?: (next: string) => void
}): React.JSX.Element {
  return (
    <CodeMirror
      value={value}
      theme={oneDark}
      extensions={langExtension(language)}
      readOnly={readOnly}
      onChange={(v): void => onChange?.(v)}
      height="auto"
      minHeight="120px"
      maxHeight="420px"
      basicSetup={{ foldGutter: false, autocompletion: false, highlightActiveLine: !readOnly }}
    />
  )
}
