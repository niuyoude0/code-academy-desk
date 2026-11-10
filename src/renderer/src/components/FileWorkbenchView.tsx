import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree, type NodeApi } from 'react-arborist'
import { Plus, Save, Loader2, FileText, FolderClosed, FolderOpen, GitCommitHorizontal, Play } from 'lucide-react'
import type { ScriptRunResult, WorkspaceNode } from '../../../shared/ipc'

/**
 * P7 文件工作区视图（学习页右侧「文件」页签）：
 *  - 课程沙盒目录 <userData>/workspace/files/<courseId>/ 的文件树（react-arborist）
 *  - CodeMirror 编辑（懒加载复用 blocks/CodeEditor）+ 保存（写入自动 isomorphic-git 快照）
 *  - 新建文件走内联命名行（Electron 禁 window.prompt）
 */

const CodeEditor = lazy(async (): Promise<typeof import('./blocks/CodeEditor')> => await import('./blocks/CodeEditor'))

interface ArboristNode {
  id: string
  name: string
  node: WorkspaceNode
  children?: ArboristNode[]
}

/** 扁平列表 → react-arborist 层级。 */
function buildTree(nodes: WorkspaceNode[]): ArboristNode[] {
  const byPath = new Map<string, ArboristNode>()
  const roots: ArboristNode[] = []
  for (const n of nodes) byPath.set(n.path, { id: n.path, name: n.name, node: n })
  for (const n of nodes) {
    const item = byPath.get(n.path)
    if (item == null) continue
    const slash = n.path.lastIndexOf('/')
    const parent = slash < 0 ? null : byPath.get(n.path.slice(0, slash))
    if (parent != null) {
      parent.children ??= []
      parent.children.push(item)
    } else {
      roots.push(item)
    }
  }
  return roots
}

function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'py') return 'python'
  if (ext === 'js' || ext === 'mjs') return 'javascript'
  if (ext === 'ts' || ext === 'tsx') return 'typescript'
  if (ext === 'c' || ext === 'h') return 'c'
  if (ext === 'cpp' || ext === 'hpp') return 'cpp'
  if (ext === 'java') return 'java'
  return 'text'
}

/** 容器尺寸测量（react-arborist 虚拟化需要像素高度）。 */
function useMeasure(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (el == null) return
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

export function FileWorkbenchView({ courseId }: { courseId: string }): React.JSX.Element {
  const [nodes, setNodes] = useState<WorkspaceNode[] | null>(null)
  const [treeErr, setTreeErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [saved, setSaved] = useState<string>('') // 上次保存成功时的内容（判 dirty）
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [runResult, setRunResult] = useState<ScriptRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [treeRef, treeSize] = useMeasure()

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.api.workspaceTree(courseId)
    if (res.ok) {
      setNodes(res.data)
      setTreeErr(null)
    } else {
      setTreeErr(res.error)
    }
  }, [courseId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const data = useMemo(() => buildTree(nodes ?? []), [nodes])

  const openFile = useCallback(
    async (relPath: string): Promise<void> => {
      setLoadingFile(true)
      setStatus(null)
      const res = await window.api.workspaceRead(courseId, relPath)
      setLoadingFile(false)
      if (res.ok) {
        setSelected(relPath)
        setDraft(res.data.content)
        setSaved(res.data.content)
      } else {
        setStatus({ kind: 'bad', text: res.error })
      }
    },
    [courseId]
  )

  // react-arborist onSelect 传选中的节点数组（单选时取最后一个）
  const onSelect = useCallback(
    (selected: NodeApi<ArboristNode>[]): void => {
      const n = selected[selected.length - 1]
      if (n != null && n.data.node.type === 'file') void openFile(n.data.node.path)
    },
    [openFile]
  )

  const doSave = useCallback(async (): Promise<void> => {
    if (selected == null || saving) return
    setSaving(true)
    setStatus(null)
    const res = await window.api.workspaceWrite(courseId, selected, draft)
    setSaving(false)
    if (res.ok) {
      setSaved(draft)
      setStatus({
        kind: 'ok',
        text: res.data.commit != null ? `已保存 · git 快照 ${res.data.commit.slice(0, 8)}` : '已保存（快照未生成）'
      })
      void refresh()
    } else {
      setStatus({ kind: 'bad', text: res.error })
    }
  }, [selected, saving, courseId, draft, refresh])

  const createFile = useCallback(async (): Promise<void> => {
    const name = newName.trim()
    if (name.length === 0) return
    setCreating(false)
    setNewName('')
    const res = await window.api.workspaceWrite(courseId, name, '')
    if (res.ok) {
      await refresh()
      void openFile(name)
    } else {
      setStatus({ kind: 'bad', text: res.error })
    }
  }, [newName, courseId, refresh, openFile])

  const dirty = selected != null && draft !== saved

  /** P8 通用执行：直接跑编辑器当前草稿（不要求先保存；扩展名定语言白名单 py/js/c）。 */
  const doRun = useCallback(async (): Promise<void> => {
    if (selected == null || running) return
    setRunning(true)
    setStatus(null)
    setRunResult(null)
    const res = await window.api.workspaceRun(courseId, selected.split('/').pop() ?? selected, draft)
    setRunning(false)
    if (res.ok) setRunResult(res.data)
    else setStatus({ kind: 'bad', text: res.error })
  }, [selected, running, courseId, draft])

  return (
    <div className="flex h-full min-h-0 bg-bg">
      {/* 文件树 */}
      <div className="flex w-[172px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-8 shrink-0 items-center justify-between px-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-tx2">工作区</span>
          <button
            type="button"
            title="新建文件（如 notes.md / main.py）"
            onClick={() => setCreating((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded text-tx2 hover:bg-panel-hover hover:text-tx"
          >
            <Plus size={13} />
          </button>
        </div>
        {creating && (
          <div className="px-1.5 pb-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFile()
                if (e.key === 'Escape') setCreating(false)
              }}
              placeholder="文件名"
              className="h-6 w-full rounded border border-line bg-bg px-1.5 font-mono text-[11px] text-tx outline-none focus:border-acc"
            />
          </div>
        )}
        <div ref={treeRef} className="min-h-0 flex-1 overflow-hidden px-1 pb-1">
          {nodes == null ? (
            <div className="flex items-center justify-center py-6 text-[11.5px] text-tx2">
              <Loader2 size={13} className="mr-1.5 animate-spin" /> 加载…
            </div>
          ) : treeErr != null ? (
            <div className="px-1.5 py-2 text-[11px] text-bad">{treeErr}</div>
          ) : data.length === 0 ? (
            <div className="px-1.5 py-2 text-[11px] leading-relaxed text-tx2/80">
              空工作区——点 + 新建第一个文件。
            </div>
          ) : (
            treeSize.height > 40 && (
              <Tree
                data={data}
                onSelect={onSelect}
                openByDefault={false}
                indent={10}
                padding={2}
                rowHeight={24}
                width={treeSize.width}
                height={treeSize.height}
              >
                {(props) => (
                  <div
                    style={props.style}
                    className={`flex h-full cursor-pointer items-center gap-1.5 rounded px-1 ${
                      props.node.data.node.type === 'file' && selected === props.node.data.node.path
                        ? 'bg-acc/10 text-acc'
                        : 'text-tx hover:bg-panel-hover'
                    }`}
                  >
                    {props.node.data.node.type === 'dir' ? (
                      props.node.isOpen ? (
                        <FolderOpen size={12} className="shrink-0 text-warn/80" />
                      ) : (
                        <FolderClosed size={12} className="shrink-0 text-warn/80" />
                      )
                    ) : (
                      <FileText size={12} className="shrink-0 text-tx2/70" />
                    )}
                    <span className="truncate text-[11.5px]">{props.node.data.name}</span>
                  </div>
                )}
              </Tree>
            )
          )}
        </div>
      </div>

      {/* 编辑器 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2.5">
          <span className="min-w-0 truncate font-mono text-[11px] text-tx2">{selected ?? '未打开文件'}</span>
          {dirty && <span className="rounded bg-warn/15 px-1 py-0.5 text-[10px] text-warn">未保存</span>}
          {selected != null && (
            <button
              type="button"
              disabled={running}
              title="运行当前文件（python/.js/.c；直接跑编辑器草稿）"
              onClick={() => void doRun()}
              className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded bg-ok/90 px-2 text-[11px] font-medium text-white hover:bg-ok disabled:opacity-40"
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              运行
            </button>
          )}
          {selected != null && (
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void doSave()}
              className="flex h-6 shrink-0 items-center gap-1 rounded bg-acc px-2 text-[11px] font-medium text-white hover:bg-acc-hover disabled:opacity-40"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              保存
            </button>
          )}
        </div>
        {status != null && (
          <div
            className={`flex shrink-0 items-center gap-1.5 border-b px-2.5 py-1 text-[11px] ${
              status.kind === 'ok' ? 'border-line bg-ok/10 text-ok' : 'border-line bg-bad/10 text-bad'
            }`}
          >
            {status.kind === 'ok' && <GitCommitHorizontal size={12} />}
            {status.text}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {loadingFile ? (
            <div className="flex items-center justify-center py-10 text-[12px] text-tx2">
              <Loader2 size={14} className="mr-2 animate-spin" /> 读取中…
            </div>
          ) : selected == null ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-[12px] text-tx2">
              <FileText size={20} className="text-tx2/50" strokeWidth={1.5} />
              从左侧选择一个文件，或点 + 新建。
              <span className="text-[11px] text-tx2/60">每次保存自动生成 git 快照（isomorphic-git）。</span>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-10 text-[12px] text-tx2">
                  <Loader2 size={14} className="mr-2 animate-spin" /> 编辑器加载中…
                </div>
              }
            >
              <CodeEditor value={draft} language={langOf(selected)} onChange={setDraft} />
            </Suspense>
          )}
        </div>
        {runResult != null && (
          <div className="shrink-0 border-t border-line bg-bg2">
            <div className="flex items-center gap-2 px-2.5 py-1 text-[10.5px] text-tx2">
              <span className="font-mono">退出码 {runResult.exitCode ?? '—'}</span>
              <span>· {runResult.language}</span>
              <span>· {(runResult.durationMs / 1000).toFixed(1)}s</span>
              {runResult.timedOut && <span className="text-warn">· 超时已杀树</span>}
              <button type="button" onClick={() => setRunResult(null)} className="ml-auto text-tx2/60 hover:text-tx">
                收起
              </button>
            </div>
            {runResult.stdout.trim().length > 0 && (
              <pre className="max-h-40 overflow-auto border-t border-line px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-tx">
                {runResult.stdout}
              </pre>
            )}
            {runResult.stderr.trim().length > 0 && (
              <pre className="max-h-40 overflow-auto border-t border-line bg-bad/5 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-bad">
                {runResult.stderr}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
