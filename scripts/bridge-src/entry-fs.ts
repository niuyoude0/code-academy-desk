/**
 * fs 桥（课程数据只读桥）：宿主在主进程侧强制路径限定与只读，沙箱内只是声明。
 *  - readCourseFile：读课程包内文本文件（manifest/path/progress/review/chapters/exercises）
 *  - readCourseAsset：读课程包 assets/ 内图片 → data URL
 *  - getProgress：当前课程学习进度
 *  - getManifest：当前课程清单（章节树/标题）
 */
export async function readCourseFile(relPath: string): Promise<string> {
  return window.cadBridge.call('fs.readCourseFile', { relPath: String(relPath) })
}

export async function readCourseAsset(relPath: string): Promise<string> {
  return window.cadBridge.call('fs.readCourseAsset', { relPath: String(relPath) })
}

export async function getProgress(): Promise<unknown> {
  return window.cadBridge.call('fs.getProgress', {})
}

export async function getManifest(): Promise<unknown> {
  return window.cadBridge.call('fs.getManifest', {})
}
