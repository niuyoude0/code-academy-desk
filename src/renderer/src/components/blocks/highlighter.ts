import type { HighlighterCore } from 'shiki/core'

/**
 * shiki 4 细粒度单例（2026-11-10 选型，design/renderer-libs-survey.md §9）：
 *  - createHighlighterCore + @shikijs/engine-javascript 纯 JS 引擎（免 wasm，桌面冷启动快）
 *  - 语言/主题按需动态 import（vite 自动分包，首次渲染代码块才拉对应 chunk）
 *  - 白名单外语言（如伪代码）回退纯文本展示
 */

type LangModule = { default: unknown }

const LANG_LOADERS: Record<string, () => Promise<LangModule>> = {
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  python: () => import('@shikijs/langs/python'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  java: () => import('@shikijs/langs/java'),
  json: () => import('@shikijs/langs/json'),
  bash: () => import('@shikijs/langs/bash'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  sql: () => import('@shikijs/langs/sql'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  verilog: () => import('@shikijs/langs/verilog'),
  'system-verilog': () => import('@shikijs/langs/system-verilog'),
  markdown: () => import('@shikijs/langs/markdown'),
  yaml: () => import('@shikijs/langs/yaml')
}

const ALIAS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  'c++': 'cpp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  systemverilog: 'system-verilog',
  text: '',
  txt: '',
  plaintext: '',
  pseudo: '',
  pseudocode: ''
}

/** 语言名归一；返回 '' 表示按纯文本处理。 */
export function normalizeLang(lang: string): string {
  const l = lang.trim().toLowerCase()
  return ALIAS[l] ?? l
}

export const CODE_THEME = 'one-dark-pro'

let singleton: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()

async function createHighlighter(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('@shikijs/themes/one-dark-pro')
  ])
  return createHighlighterCore({
    themes: [theme.default],
    langs: [],
    engine: createJavaScriptRegexEngine()
  })
}

/** 确保语言就绪；白名单外语言返回 null（调用方回退纯文本）。 */
export async function ensureLang(lang: string): Promise<string | null> {
  const norm = normalizeLang(lang)
  if (norm === '') return null
  if (loadedLangs.has(norm)) return norm
  const loader = LANG_LOADERS[norm]
  if (loader == null) return null
  const hl = await getHighlighter()
  const mod = (await loader()) as { default: Parameters<HighlighterCore['loadLanguage']>[0] }
  await hl.loadLanguage(mod.default)
  loadedLangs.add(norm)
  return norm
}

function getHighlighter(): Promise<HighlighterCore> {
  singleton ??= createHighlighter()
  return singleton
}

/** 高亮为 HTML；不支持的语言/失败返回 null（调用方回退纯文本）。 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  try {
    const norm = await ensureLang(lang)
    if (norm == null) return null
    const hl = await getHighlighter()
    return hl.codeToHtml(code, { lang: norm, theme: CODE_THEME })
  } catch {
    return null
  }
}
