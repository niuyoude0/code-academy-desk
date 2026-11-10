import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import { createCourseV2, addChapterV2 } from '../src/main/services/coursePackageV2'
import {
  readCourseFileText,
  readCourseAssetDataUrl,
  getCourseProgress,
  getCourseManifest,
  InteractiveBridgeError
} from '../src/main/services/interactiveBridge'

/**
 * P5.6 interactive 桥服务（fs 桥路径限定/只读强制，零 AI 消耗）。
 */

let tmpRoot: string
const COURSE = 'qqbridge'

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-interactive-bridge-'))
  await createCourseV2(tmpRoot, { id: COURSE, title: '桥测试课程' })
  await addChapterV2(tmpRoot, COURSE, { id: 'ch01', title: '第一章' })
  // 桥可读的课程内文本
  const chDir = path.join(tmpRoot, COURSE, 'chapters', 'ch01')
  mkdirSync(chDir, { recursive: true })
  writeFileSync(path.join(chDir, 'ch01-k01.json'), JSON.stringify({ ok: true }), 'utf-8')
  // assets 图片（1x1 png）
  mkdirSync(path.join(tmpRoot, COURSE, 'assets'), { recursive: true })
  writeFileSync(
    path.join(tmpRoot, COURSE, 'assets', 'a.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  )
  // 白名单外的敏感位置（模拟包内不该读的文件）
  writeFileSync(path.join(tmpRoot, COURSE, 'secret.txt'), 'TOPSECRET', 'utf-8')
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('fs 桥：readCourseFile 路径限定', () => {
  it('读 chapters/ 内文本成功', async () => {
    const content = await readCourseFileText(tmpRoot, COURSE, 'chapters/ch01/ch01-k01.json')
    expect(content).toContain('"ok":true')
  })

  it('读 manifest.json / progress.json 成功', async () => {
    expect(await readCourseFileText(tmpRoot, COURSE, 'manifest.json')).toContain(COURSE)
    await getCourseProgress(tmpRoot, COURSE) // 惰性初始化 progress.json
    expect(await readCourseFileText(tmpRoot, COURSE, 'progress.json')).toContain('kps')
  })

  it('穿越 ../ 与绝对路径拒绝', async () => {
    await expect(readCourseFileText(tmpRoot, COURSE, '../other/secret.txt')).rejects.toThrow(InteractiveBridgeError)
    await expect(readCourseFileText(tmpRoot, COURSE, 'C:/windows/win.ini')).rejects.toThrow(InteractiveBridgeError)
    await expect(readCourseFileText(tmpRoot, COURSE, '..\\escape.txt')).rejects.toThrow(InteractiveBridgeError)
  })

  it('白名单外顶层名拒绝（secret.txt / assets 走文本通道）', async () => {
    await expect(readCourseFileText(tmpRoot, COURSE, 'secret.txt')).rejects.toThrow(InteractiveBridgeError)
    await expect(readCourseFileText(tmpRoot, COURSE, 'assets/a.png')).rejects.toThrow(/readCourseAsset/)
  })

  it('目录列取与空段拒绝', async () => {
    await expect(readCourseFileText(tmpRoot, COURSE, 'chapters')).rejects.toThrow(InteractiveBridgeError)
    await expect(readCourseFileText(tmpRoot, COURSE, '')).rejects.toThrow(InteractiveBridgeError)
  })
})

describe('fs 桥：资产与数据', () => {
  it('readCourseAsset 返回 data URL；包外引用拒绝', async () => {
    const url = await readCourseAssetDataUrl(tmpRoot, COURSE, 'assets/a.png')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    await expect(readCourseAssetDataUrl(tmpRoot, COURSE, 'chapters/ch01/ch01-k01.json')).rejects.toThrow(
      InteractiveBridgeError
    )
  })

  it('getProgress 返回空进度结构；getManifest 返回章节树', async () => {
    const progress = (await getCourseProgress(tmpRoot, COURSE)) as { kps: unknown[]; courseId: string }
    expect(progress.courseId).toBe(COURSE)
    expect(Array.isArray(progress.kps)).toBe(true)
    const manifest = (await getCourseManifest(tmpRoot, COURSE)) as { id: string; chapters: unknown[] }
    expect(manifest.id).toBe(COURSE)
    expect(manifest.chapters).toHaveLength(1)
  })
})
