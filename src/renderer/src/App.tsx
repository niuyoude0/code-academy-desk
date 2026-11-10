import { useState } from 'react'
import { CourseHomePage } from './components/CourseHomePage'
import { AgentChatPage } from './components/AgentChatPage'
import { LearningPathPage } from './components/LearningPathPage'
import { ReviewPage } from './components/ReviewPage'

/**
 * 顶层视图：课程首页 / 学习路径 / 课件校对 / AI 助教。
 * 页面常驻挂载（display 切换），来回切换保留聊天记录与学习页状态。
 * 学习页的「生成课件/问助教」经 pendingPrompt 把固定提示词直通助教页自动发送。
 */
export default function App(): React.JSX.Element {
  const [view, setView] = useState<'home' | 'agent' | 'course' | 'review'>('home')
  const [returnTo, setReturnTo] = useState<'home' | 'course' | 'review'>('home')
  const [activeCourse, setActiveCourse] = useState<{ id: string; title: string } | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const openCourse = (id: string, courseTitle: string): void => {
    setActiveCourse({ id, title: courseTitle })
    setView('course')
  }

  /** 学习页/校对页 → 助教：带提示词跳转，助教页自动发送一轮。 */
  const askAgent = (prompt: string): void => {
    if (view === 'course' || view === 'home' || view === 'review') setReturnTo(view)
    setPendingPrompt(prompt)
    setView('agent')
  }

  return (
    <div className="h-full">
      <div className={view === 'home' ? 'h-full' : 'hidden'}>
        <CourseHomePage onOpenAgent={() => setView('agent')} onOpenCourse={openCourse} />
      </div>
      {activeCourse != null && (
        <>
          <div className={view === 'course' ? 'h-full' : 'hidden'}>
            <LearningPathPage
              courseId={activeCourse.id}
              title={activeCourse.title}
              onBack={() => setView('home')}
              onOpenReview={() => setView('review')}
              onAskAgent={askAgent}
            />
          </div>
          <div className={view === 'review' ? 'h-full' : 'hidden'}>
            <ReviewPage
              courseId={activeCourse.id}
              title={activeCourse.title}
              onBack={() => setView('course')}
              onAskAgent={askAgent}
            />
          </div>
        </>
      )}
      <div className={view === 'agent' ? 'h-full' : 'hidden'}>
        <AgentChatPage
          onBack={() => setView(returnTo)}
          pendingPrompt={pendingPrompt}
          onPromptConsumed={() => setPendingPrompt(null)}
        />
      </div>
    </div>
  )
}
