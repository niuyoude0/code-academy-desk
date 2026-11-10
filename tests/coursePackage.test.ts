import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import JSZip from 'jszip'
import {
  importCourseZipBuffer,
  exportCourseToZip,
  exportCourseToZipBuffer,
  listCourses,
  getCourse,
  removeCourse,
  sanitizeZipEntry,
  CoursePackageError,
  MAX_MANIFEST_BYTES
} from '../src/main/services/coursePackage'
import { CoursePackage } from '../src/shared/course-schema'
import type { CoursePackageInput } from '../src/shared/course-schema'

/** P4 验收测试：schema 校验 + zip 导入导出 round-trip + zip-slip 防护 + 大小上限。 */

const validPackage = {
  schemaVersion: '1.0',
  course: {
    id: 'c-prog-basics',
    title: 'C 程序设计基础',
    bookTitle: 'C 程序设计（第5版）',
    bookAuthors: '谭浩强',
    language: 'c',
    description: 'P4 测试课程',
    ocrSource: {
      factsheets: ['factsheet-ch04.md'],
      metaJson: { pageOffset: 14, chapters: ['ch04'] }
    }
  },
  chapters: [
    {
      id: 'ch04',
      title: '第 4 章 函数',
      order: 0,
      source: {
        origin: 'book',
        bookPageRefs: [{ pdfPage: 100, bookPage: 86, ocrFile: 'ocr/ch04/p100.md' }]
      },
      knowledgePoints: [
        {
          id: 'kp-func-def',
          title: '函数的定义',
          content: '# 函数的定义\n\n函数是组织程序逻辑的基本结构……\n\n![图 4-1](assets/fig4-1.png)',
          source: { origin: 'book', bookPageRefs: [{ pdfPage: 101, bookPage: 87 }] },
          order: 0
        },
        {
          id: 'kp-recursion',
          title: '递归调用（AI 补充讲解）',
          content: '## 递归\n\n以下为 AI 补充讲解……',
          source: { origin: 'ai-supplement' },
          order: 1
        }
      ],
      exercises: [
        {
          id: 'ex-4-1',
          number: '4.1',
          title: '实现两个数求和函数',
          statement: '输入两个整数，输出它们的和。',
          source: { origin: 'book', bookPageRefs: [{ pdfPage: 110, bookPage: 96 }] },
          knowledgePointIds: ['kp-func-def'],
          starterFiles: [{ path: 'main.c', content: '#include <stdio.h>\nint main(void){return 0;}\n', language: 'c' }],
          tests: [{ id: 't1', name: '样例：3 5', input: '3 5', expectedOutput: '8', source: 'book' }],
          referenceSolution: [{ path: 'ref-main.c', content: 'int main(void){return 0;}\n', readOnly: true }]
        },
        {
          id: 'ex-4-2',
          number: '4.2',
          title: '扩展：增加溢出判断',
          statement: '在上一题基础上增加溢出判断。',
          source: { origin: 'book' },
          workspaceGroupId: 'wg-4x'
        },
        {
          id: 'ex-4-3',
          number: '4.3',
          title: '继续扩展：多组输入（AI 补充练习）',
          statement: '支持多组输入直到 EOF。',
          source: { origin: 'ai-exercise', note: 'AI 根据知识点生成的补充练习' },
          workspaceGroupId: 'wg-4x'
        }
      ]
    }
  ],
  workspaceGroups: [
    {
      id: 'wg-4x',
      title: '习题 4.x 递进系列',
      reason: '后续习题要求扩展前序实现，归入同一工作区组',
      exerciseIds: ['ex-4-1', 'ex-4-2', 'ex-4-3']
    }
  ]
} satisfies CoursePackageInput

/** 用 JSZip 在内存中构造课程包 zip。 */
async function buildZip(
  manifest: unknown,
  extraEntries: Record<string, string | Buffer> = {}
): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('course-package.json', JSON.stringify(manifest, null, 2))
  for (const [name, content] of Object.entries(extraEntries)) {
    zip.file(name, content)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

let tmpRoot: string

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-p4-'))
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('课程包 schema 校验', () => {
  it('合法课程包通过解析并填充默认值', () => {
    const parsed = CoursePackage.parse(validPackage)
    expect(parsed.course.id).toBe('c-prog-basics')
    expect(parsed.chapters[0].exercises[0].tests[0].source).toBe('book')
    expect(parsed.chapters[0].knowledgePoints[1].source.bookPageRefs).toEqual([])
    expect(parsed.workspaceGroups).toHaveLength(1)
  })

  it('拒绝缺少 schemaVersion 的包', () => {
    const bad = { ...validPackage, schemaVersion: undefined }
    expect(CoursePackage.safeParse(bad).success).toBe(false)
  })

  it('拒绝非法课程 id（大写/下划线/空格）', () => {
    for (const id of ['Bad_Id', 'UPPER', 'has space', '-leading']) {
      const bad = { ...validPackage, course: { ...validPackage.course, id } }
      expect(CoursePackage.safeParse(bad).success).toBe(false)
    }
  })

  it('拒绝重复的习题 id', () => {
    const bad = structuredClone(validPackage) as typeof validPackage
    bad.chapters[0].exercises[1].id = 'ex-4-1'
    bad.chapters[0].exercises[1].workspaceGroupId = undefined
    expect(CoursePackage.safeParse(bad).success).toBe(false)
  })

  it('拒绝悬空的知识点/工作区组引用', () => {
    const badKp = structuredClone(validPackage) as typeof validPackage
    badKp.chapters[0].exercises[0].knowledgePointIds = ['kp-not-exist']
    expect(CoursePackage.safeParse(badKp).success).toBe(false)

    const badGroup = structuredClone(validPackage) as typeof validPackage
    badGroup.chapters[0].exercises[0].workspaceGroupId = 'wg-ghost'
    expect(CoursePackage.safeParse(badGroup).success).toBe(false)

    const badGroupMember = structuredClone(validPackage) as typeof validPackage
    badGroupMember.workspaceGroups[0].exerciseIds = ['ex-4-1', 'ex-ghost']
    expect(CoursePackage.safeParse(badGroupMember).success).toBe(false)
  })

  it('工作区组少于 2 道题被拒绝（无依赖关系不应分组）', () => {
    const bad = structuredClone(validPackage) as typeof validPackage
    bad.workspaceGroups[0].exerciseIds = ['ex-4-1']
    expect(CoursePackage.safeParse(bad).success).toBe(false)
  })
})

describe('zip-slip 防护', () => {
  it('拒绝路径穿越条目', () => {
    expect(() => sanitizeZipEntry('../evil.txt')).toThrow(CoursePackageError)
    expect(() => sanitizeZipEntry('assets/../../evil.txt')).toThrow(CoursePackageError)
    expect(() => sanitizeZipEntry('..\\evil.txt')).toThrow(CoursePackageError)
    expect(() => sanitizeZipEntry('/etc/passwd')).toThrow(CoursePackageError)
    expect(() => sanitizeZipEntry('C:/evil.txt')).toThrow(CoursePackageError)
    expect(() => sanitizeZipEntry('assets/ok/fig.png')).not.toThrow()
  })

  it('导入包含路径穿越条目的 zip 时抛错且课程目录已回滚', async () => {
    const evil = await buildZip(validPackage, { '../evil.txt': 'pwned' })
    const root = path.join(tmpRoot, 'zipslip-1')
    await expect(importCourseZipBuffer(root, evil)).rejects.toThrow(CoursePackageError)
    // coursesRoot 可能被 mkdir(recursive) 创建，但课程目录必须已回滚删除
    await expect(fs.access(path.join(root, 'c-prog-basics'))).rejects.toThrow()
    await expect(fs.readdir(path.join(root, 'c-prog-basics'))).rejects.toThrow()
  })

  it('导入包含绝对路径与反斜杠条目的 zip 时抛错', async () => {
    const evilAbs = await buildZip(validPackage, { '/etc/evil.txt': 'x' })
    const evilBackslash = await buildZip(validPackage, { 'assets\\evil.txt': 'x' })
    const root = path.join(tmpRoot, 'zipslip-2')
    await expect(importCourseZipBuffer(root, evilAbs)).rejects.toThrow(CoursePackageError)
    await expect(importCourseZipBuffer(root, evilBackslash)).rejects.toThrow(CoursePackageError)
    // 恶意条目不得落到磁盘
    await expect(fs.access(path.join(root, 'c-prog-basics', 'etc'))).rejects.toThrow()
    await expect(fs.access(path.join(root, 'c-prog-basics', 'assets'))).rejects.toThrow()
  })

  it('导入 assets/ 之外的业务文件被拒绝', async () => {
    const evil = await buildZip(validPackage, { 'scripts/run.sh': 'rm -rf /' })
    await expect(importCourseZipBuffer(path.join(tmpRoot, 'zipslip-3'), evil)).rejects.toThrow(
      /只允许/
    )
  })
})

describe('导入 / 导出 round-trip', () => {
  it('完整闭环：导入 → 列表 → 导出 → 二次导入 → 数据一致', async () => {
    const root1 = path.join(tmpRoot, 'rt-1')
    const root2 = path.join(tmpRoot, 'rt-2')

    // 1) 导入
    const zip = await buildZip(validPackage, { 'assets/fig4-1.png': PNG_BYTES })
    const result = await importCourseZipBuffer(root1, zip)
    expect(result).toMatchObject({
      courseId: 'c-prog-basics',
      title: 'C 程序设计基础',
      chapterCount: 1,
      exerciseCount: 3,
      workspaceGroupCount: 1
    })

    // 2) 索引列表
    const list = await listCourses(root1)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'c-prog-basics',
      language: 'c',
      chapterCount: 1,
      exerciseCount: 3
    })

    // 3) 资源文件落盘
    const assetPath = path.join(root1, 'c-prog-basics', 'assets', 'fig4-1.png')
    expect(await fs.readFile(assetPath)).toEqual(PNG_BYTES)

    // 4) 导出 → 二次导入
    const outZip = path.join(tmpRoot, 'exported.zip')
    await exportCourseToZip(root1, 'c-prog-basics', outZip)
    const exportedBuffer = await fs.readFile(outZip)
    const result2 = await importCourseZipBuffer(root2, exportedBuffer)
    expect(result2.courseId).toBe('c-prog-basics')

    // 5) 两个根里的课程数据一致
    const pkg1 = await getCourse(root1, 'c-prog-basics')
    const pkg2 = await getCourse(root2, 'c-prog-basics')
    expect(JSON.stringify(pkg2)).toBe(JSON.stringify(pkg1))
    expect(pkg1.chapters[0].exercises).toHaveLength(3)
    expect(pkg1.workspaceGroups[0].exerciseIds).toEqual(['ex-4-1', 'ex-4-2', 'ex-4-3'])

    // 6) 内存导出版可用
    const memBuffer = await exportCourseToZipBuffer(root2, 'c-prog-basics')
    expect(memBuffer.byteLength).toBeGreaterThan(0)
  })

  it('重复导入同一课程被拒绝（防误覆盖）', async () => {
    const zip = await buildZip(validPackage)
    const root = path.join(tmpRoot, 'rt-dup')
    await importCourseZipBuffer(root, zip)
    await expect(importCourseZipBuffer(root, zip)).rejects.toThrow(/课程已存在/)
  })

  it('导入后 removeCourse 清理目录与索引', async () => {
    const zip = await buildZip(validPackage)
    const root = path.join(tmpRoot, 'rt-rm')
    await importCourseZipBuffer(root, zip)
    await removeCourse(root, 'c-prog-basics')
    expect(await listCourses(root)).toHaveLength(0)
    await expect(fs.access(path.join(root, 'c-prog-basics'))).rejects.toThrow()
    await expect(removeCourse(root, 'c-prog-basics')).rejects.toThrow(/课程不存在/)
  })
})

describe('大小与坏数据防护', () => {
  it('缺少 manifest 的 zip 被拒绝', async () => {
    const zip = new JSZip()
    zip.file('assets/only.png', PNG_BYTES)
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(importCourseZipBuffer(path.join(tmpRoot, 'no-manifest'), buffer)).rejects.toThrow(
      /缺少/
    )
  })

  it('manifest 不是合法 JSON 时被拒绝', async () => {
    const zip = new JSZip()
    zip.file('course-package.json', '{ not json !!!')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(importCourseZipBuffer(path.join(tmpRoot, 'bad-json'), buffer)).rejects.toThrow(
      /合法 JSON/
    )
  })

  it('超过 manifest 大小上限的课程包被拒绝', async () => {
    const huge = {
      ...validPackage,
      chapters: [
        {
          ...validPackage.chapters[0],
          knowledgePoints: [
            {
              ...validPackage.chapters[0].knowledgePoints[0],
              content: 'x'.repeat(MAX_MANIFEST_BYTES + 1024)
            }
          ]
        }
      ]
    }
    const zip = await buildZip(huge)
    await expect(importCourseZipBuffer(path.join(tmpRoot, 'too-big'), zip)).rejects.toThrow(
      /大小上限/
    )
  })

  it('非课程包 zip（坏 schema）被拒绝且不落盘', async () => {
    const bad = { schemaVersion: '9.9', course: { id: 'x' } }
    const zip = await buildZip(bad)
    const root = path.join(tmpRoot, 'bad-schema')
    await expect(importCourseZipBuffer(root, zip)).rejects.toThrow(/schema 校验失败/)
    await expect(fs.access(root)).rejects.toThrow()
  })
})
