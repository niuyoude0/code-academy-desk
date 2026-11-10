import { BookOpen, Sparkles, FolderUp, Plus } from 'lucide-react'

interface Props {
  onImportTextbook: () => void
  onImportPackage: () => void
  onCreate: () => void
}

/** 首次使用空状态（对应 design/home.pen 的空状态屏）。 */
export function EmptyState({ onImportTextbook, onImportPackage, onCreate }: Props): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5">
      <div className="flex h-[88px] w-[88px] items-center justify-center rounded-[20px] border border-line bg-panel">
        <BookOpen size={40} className="text-tx2" strokeWidth={1.5} />
      </div>
      <span className="text-[18px] font-semibold text-tx">还没有课程</span>
      <span className="max-w-[420px] text-center text-[13px] leading-relaxed text-tx2">
        导入已构建好的课程包，或让 AI 把一本教材变成可学习、可练习、可复习的结构化课程。
      </span>
      <div className="mt-1 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onImportTextbook}
          className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3.5 text-[13px] font-medium text-white hover:bg-acc-hover"
        >
          <Sparkles size={14} />
          导入教材 · AI 构建课程
        </button>
        <button
          type="button"
          onClick={onImportPackage}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3.5 text-[13px] text-tx hover:bg-panel-hover"
        >
          <FolderUp size={14} className="text-tx2" />
          导入课程包
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] text-tx2 hover:bg-panel-hover"
        >
          <Plus size={14} />
          手动创建
        </button>
      </div>
      <div className="mt-6 flex flex-col items-center gap-1.5">
        <span className="font-mono text-[11px] text-tx2">
          支持格式：课程包 .zip · EPUB · PDF · Markdown
        </span>
        <span className="text-[11px] text-tx2">
          所有数据保存在本地 · AI 分析教材时才需要联网
        </span>
      </div>
    </div>
  )
}
