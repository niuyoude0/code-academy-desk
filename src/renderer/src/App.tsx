import { useEffect, useState } from 'react'
import { CourseHomePage } from './components/CourseHomePage'
import { AgentChatPage } from './components/AgentChatPage'
import { LearningPathPage } from './components/LearningPathPage'
import { agentChatStore } from './agentChatStore'

/**
 * 顶层视图：课程首页 / 学习路径 / AI 助教（P6 三栏工作台起，学习页内嵌助教侧栏，
 * 与全页助教共用 agentChatStore 单例会话；2026-11-11 校对页移除，改「一键重新生成课件」）。
 * 页面常驻挂载（display 切换），来回切换保留聊天记录与学习页状态。
 */
export default function App(): React.JSX.Element {
  const [view, setView] = useState<'home' | 'agent' | 'course'>('home')
  const [activeCourse, setActiveCourse] = useState<{ id: string; title: string } | null>(null)

  // 共享聊天 store：拉设置 + 恢复 DSH 会话 + 订阅流事件（应用级一次）
  useEffect(() => {
    agentChatStore.init()
  }, [])

  const openCourse = (id: string, courseTitle: string): void => {
    setActiveCourse({ id, title: courseTitle })
    setView('course')
  }

  return (
    <div className="h-full">
      <div className={view === 'home' ? 'h-full' : 'hidden'}>
        <CourseHomePage active={view === 'home'} onOpenAgent={() => setView('agent')} onOpenCourse={openCourse} />
      </div>
      {activeCourse != null && (
        <div className={view === 'course' ? 'h-full' : 'hidden'}>
          <LearningPathPage
            key={activeCourse.id}
            courseId={activeCourse.id}
            title={activeCourse.title}
            onBack={() => setView('home')}
            onOpenAgent={() => setView('agent')}
          />
        </div>
      )}
      <div className={view === 'agent' ? 'h-full' : 'hidden'}>
        <AgentChatPage onBack={() => setView(activeCourse != null ? 'course' : 'home')} />
      </div>
    </div>
  )
}
