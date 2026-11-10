import { Check, X } from 'lucide-react'
import type { QuizBlock } from '../../../../shared/lesson-schema'
import { BlockShell } from './BlockShell'
import { MdInline } from './Md'

/** quiz 的学习态（渲染层本视图；判定/解锁规则本体在主进程服务）。 */
export interface QuizAnswerState {
  picked: string[]
  input: string
  judged: boolean
  correct: boolean
}

/** 判定 quiz 答案（choice 按集合比对；blank 归一空白后比对）。 */
export function judgeQuiz(kind: 'choice' | 'blank', answer: string, picked: string[], input: string): boolean {
  if (kind === 'choice') {
    const want = answer.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    const got = [...picked].sort()
    return want.length === got.length && [...want].sort().every((k, i) => k === got[i])
  }
  const norm = (s: string): string => s.replaceAll(/\s+/g, '').trim()
  return norm(answer) === norm(input) || norm(answer).includes(norm(input))
}

/** quiz 块交互卡（P5.4 从学习页迁入；题面/选项/解析升级为 markdown+KaTeX 渲染）。 */
export function QuizCard({
  block,
  state,
  onChange,
  onJudge,
  chrome = 'read'
}: {
  block: QuizBlock
  state?: QuizAnswerState
  onChange: (next: QuizAnswerState) => void
  onJudge: (correct: boolean) => void
  chrome?: 'read' | 'review'
}): React.JSX.Element {
  const options = block.options ?? []
  const multi = block.kind === 'choice' && block.answer.includes(',')

  const change = (patch: Partial<QuizAnswerState>): void => {
    if (state?.judged === true) return
    onChange({ picked: state?.picked ?? [], input: state?.input ?? '', judged: false, correct: false, ...patch })
  }

  const toggle = (key: string): void => {
    if (state?.judged === true || options.length === 0) return
    const picked = state?.picked ?? []
    const next = multi
      ? picked.includes(key)
        ? picked.filter((k) => k !== key)
        : [...picked, key]
      : [key]
    change({ picked: next })
  }

  return (
    <BlockShell label={`quiz · ${block.kind}`} origin={block.origin} source={block.source ?? null} chrome={chrome}>
      <div className="mb-3 text-[14.5px] font-semibold leading-relaxed">
        <MdInline text={block.question} />
      </div>
      {block.kind === 'choice' ? (
        <div className="flex flex-col gap-1.5">
          {options.map((o) => {
            const picked = state?.picked?.includes(o.key) === true
            const revealed = state?.judged === true
            const isAnswer = revealed && block.answer.split(',').map((s) => s.trim()).includes(o.key)
            const isWrongPick = revealed && picked && !isAnswer
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => toggle(o.key)}
                className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13.5px] ${
                  isAnswer
                    ? 'border-ok/50 bg-ok/10 text-tx'
                    : isWrongPick
                      ? 'border-bad/50 bg-bad/10 text-tx'
                      : picked
                        ? 'border-acc bg-acc/8 text-tx'
                        : 'border-line/80 text-tx hover:bg-panel-hover'
                }`}
              >
                <span className="font-mono text-[11px] text-tx2">{o.key}</span>
                <span className="min-w-0 [&_.md-view_p]:m-0">
                  <MdInline text={o.text} />
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <input
          value={state?.input ?? ''}
          onChange={(e) => change({ picked: [], input: e.target.value })}
          disabled={state?.judged === true}
          placeholder="输入答案"
          className="w-full rounded-md border border-line/80 bg-bg px-3 py-2 text-[13.5px] text-tx outline-none focus:border-acc"
        />
      )}
      <div className="mt-2.5 flex items-center gap-2.5">
        {state?.judged !== true && (
          <button
            type="button"
            disabled={block.kind === 'choice' ? (state?.picked?.length ?? 0) === 0 : (state?.input ?? '').trim().length === 0}
            onClick={() => {
              const correct = judgeQuiz(block.kind, block.answer, state?.picked ?? [], state?.input ?? '')
              change({ judged: true, correct })
              onJudge(correct)
            }}
            className="flex h-7 items-center gap-1.5 rounded bg-acc px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            判定
          </button>
        )}
        {state?.judged === true && (
          <span className={`inline-flex items-center gap-1 text-[12.5px] font-medium ${state.correct ? 'text-ok' : 'text-bad'}`}>
            {state.correct ? <Check size={14} /> : <X size={14} />}
            {state.correct ? '答对' : '答错'}
          </span>
        )}
      </div>
      {state?.judged === true && block.explanation != null && (
        <div className="mt-2 rounded-md bg-bg2 px-3 py-2 text-[13px] leading-relaxed text-tx2">
          <span className="font-medium text-tx">解析：</span>
          <MdInline text={block.explanation} />
        </div>
      )}
    </BlockShell>
  )
}
