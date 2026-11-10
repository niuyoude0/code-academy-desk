import { useEffect, useState } from 'react'
import { ImageIcon } from 'lucide-react'

/** image 块：assets/ 内相对路径 → course:asset:read IPC → data URL。 */
export function ImageView({ courseId, path, alt }: { courseId: string; path: string; alt: string }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setUrl(null)
    setErr(null)
    void window.api.courseAssetRead(courseId, path).then((res) => {
      if (!alive) return
      if (res.ok) setUrl(res.data.dataUrl)
      else setErr(res.error)
    })
    return () => {
      alive = false
    }
  }, [courseId, path])

  if (err != null) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
        <ImageIcon size={14} /> 插图加载失败（{path}）：{err}
      </div>
    )
  }
  if (url == null) {
    return <div className="py-5 text-center text-[12px] text-tx2">加载插图…（{alt || path}）</div>
  }
  return <img src={url} alt={alt} className="mx-auto max-w-full rounded-md border border-line" />
}
