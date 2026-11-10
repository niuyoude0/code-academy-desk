import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import path from 'path'
import os from 'os'
import {
  ensureBuiltinSkills,
  builtinSkillsDir,
  listSkills,
  readSkillBody,
  readSkillFile,
  installSkillFromFolder,
  SkillError
} from '../src/main/services/skills'
import {
  importMaterialFolder,
  listMaterials,
  readMaterialFile,
  removeMaterial,
  MaterialError
} from '../src/main/services/courseMaterials'

let tmpRoot: string

function skillDir(parent: string, name: string, description: string): string {
  const dir = path.join(parent, name)
  mkdirSync(path.join(dir, 'references'), { recursive: true })
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n正文。\n`)
  writeFileSync(path.join(dir, 'references', 'guide.md'), '# 指南\n')
  return dir
}

function fakeBookProduct(parent: string, name: string): string {
  const dir = path.join(parent, name)
  mkdirSync(path.join(dir, 'ocr', 'ch03'), { recursive: true })
  mkdirSync(path.join(dir, 'pages'), { recursive: true })
  writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ title: '数字设计与计算机体系结构', authors: 'David Harris', edition: '第2版', pageOffset: 14, chapters: [{ chapter: 3, title: '时序逻辑设计' }] })
  )
  writeFileSync(path.join(dir, 'factsheet-ch03.md'), '# factsheet · 第 3 章《时序逻辑设计》\n\n## 0. 章节地图\n\n| 小节 | 书内页码 | 一句话主题 |\n|---|---|---|\n| 3.5.1 动态准则 | 80 | 输入必须稳定 |\n')
  writeFileSync(path.join(dir, 'ocr', 'ch03', 'p0094.md'), '## PDF p.94 | 书内页码 80 | 章节 3\n\n正文。\n')
  writeFileSync(path.join(dir, 'pages', 'p0094.png'), Buffer.from([0x89, 0x50]))
  writeFileSync(path.join(dir, 'qa-log.md'), '# 抽查记录\n')
  return dir
}

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-skills-'))
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('技能系统', () => {
  it('ensureBuiltinSkills 把内置技能复制到空的用户目录', () => {
    const builtin = path.join(tmpRoot, 'builtin')
    skillDir(builtin, 'course-material-processor', '处理 book-prep-ocr 产出的教材资料并构建课程')
    const root = path.join(tmpRoot, 'skills-root-empty')
    const installed = ensureBuiltinSkills(builtin, root)
    expect(installed).toEqual(['course-material-processor'])
    expect(existsSync(path.join(root, 'course-material-processor', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(root, 'course-material-processor', 'references', 'guide.md'))).toBe(true)
    // 二次执行不覆盖
    expect(ensureBuiltinSkills(builtin, root)).toEqual([])
  })

  it('builtinSkillsDir 指向 <appPath>/resources/skills', () => {
    expect(builtinSkillsDir('C:/app')).toBe(path.join('C:/app', 'resources', 'skills'))
  })

  it('listSkills 扫描并通过校验', async () => {
    const root = path.join(tmpRoot, 'skills-root-empty')
    const skills = await listSkills(root)
    expect(skills.map((s) => s.name)).toContain('course-material-processor')
    expect(skills[0].description).toContain('book-prep-ocr')
  })

  it('readSkillBody 读全文，readSkillFile 读附属文件', async () => {
    const root = path.join(tmpRoot, 'skills-root-empty')
    const body = await readSkillBody(root, 'course-material-processor')
    expect(body).toContain('# course-material-processor')
    const guide = await readSkillFile(root, 'course-material-processor', 'references/guide.md')
    expect(guide).toContain('# 指南')
  })

  it('拒绝技能名与目录名不一致、非法附属文件路径', async () => {
    const root = path.join(tmpRoot, 'skills-bad')
    const dir = path.join(root, 'my-skill')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: other-name\ndescription: 描述\n---\n正文')
    await expect(listSkills(root)).rejects.toThrow(/与目录名/)
    await expect(
      readSkillFile(path.join(tmpRoot, 'skills-root-empty'), 'course-material-processor', '../secret.txt')
    ).rejects.toThrow(SkillError)
  })

  it('installSkillFromFolder 校验并复制', async () => {
    const src = skillDir(path.join(tmpRoot, 'install-src'), 'another-skill', '另一个技能')
    const root = path.join(tmpRoot, 'skills-root-empty')
    const info = await installSkillFromFolder(src, root)
    expect(info.name).toBe('another-skill')
    await expect(installSkillFromFolder(src, root)).rejects.toThrow(/已存在/)
    const badDir = path.join(tmpRoot, 'Bad_Dir')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(path.join(badDir, 'SKILL.md'), '---\nname: Bad_Dir\ndescription: x\n---\n')
    await expect(installSkillFromFolder(badDir, root)).rejects.toThrow(/小写字母/)
  })
})

describe('教材资料导入', () => {
  it('导入 book-prep-ocr 产物：宽松解析 meta、跳过 pages/、计数正确', async () => {
    const src = fakeBookProduct(path.join(tmpRoot, 'products'), 'DDCA-ch03')
    const root = path.join(tmpRoot, 'materials-1')
    const info = await importMaterialFolder(src, root)
    expect(info.id).toBe('DDCA-ch03')
    expect(info.title).toBe('数字设计与计算机体系结构')
    expect(info.authors).toBe('David Harris')
    expect(info.pageOffsets).toEqual([{ offset: 14 }])
    expect(info.factsheets).toEqual(['factsheet-ch03.md'])
    expect(info.ocrPageCount).toBe(1)
    expect(info.qaLogExists).toBe(true)
    // pages/ 未复制
    expect(existsSync(path.join(root, 'DDCA-ch03', 'pages'))).toBe(false)
    // meta/factsheet/ocr 已复制
    expect(existsSync(path.join(root, 'DDCA-ch03', 'meta.json'))).toBe(true)
    expect(existsSync(path.join(root, 'DDCA-ch03', 'ocr', 'ch03', 'p0094.md'))).toBe(true)
  })

  it('重复导入被拒绝', async () => {
    const src = fakeBookProduct(path.join(tmpRoot, 'products'), 'dup-book')
    const root = path.join(tmpRoot, 'materials-dup')
    await importMaterialFolder(src, root)
    await expect(importMaterialFolder(src, root)).rejects.toThrow(/已导入过/)
  })

  it('非产物目录被拒绝', async () => {
    const empty = path.join(tmpRoot, 'not-product')
    mkdirSync(empty, { recursive: true })
    writeFileSync(path.join(empty, 'random.txt'), 'x')
    await expect(importMaterialFolder(empty, path.join(tmpRoot, 'materials-bad'))).rejects.toThrow(
      /meta.json 或 factsheet/
    )
  })

  it('listMaterials / readMaterialFile / removeMaterial', async () => {
    const src = fakeBookProduct(path.join(tmpRoot, 'products'), 'list-book')
    const root = path.join(tmpRoot, 'materials-list')
    await importMaterialFolder(src, root)
    const list = await listMaterials(root)
    expect(list.map((m) => m.id)).toEqual(['list-book'])
    const fsheet = await readMaterialFile(root, 'list-book', 'factsheet-ch03.md')
    expect(fsheet).toContain('章节地图')
    const ocr = await readMaterialFile(root, 'list-book', 'ocr/ch03/p0094.md')
    expect(ocr).toContain('PDF p.94')
    await expect(
      readMaterialFile(root, 'list-book', '../outside/secret.md')
    ).rejects.toThrow(MaterialError)
    await removeMaterial(root, 'list-book')
    expect(await listMaterials(root)).toHaveLength(0)
    await expect(readMaterialFile(root, 'list-book', 'meta.json')).rejects.toThrow(/不存在/)
  })

  it('meta.json 字段名不统一时宽松兜底（title 缺失 → 自动命名）', async () => {
    const dir = path.join(tmpRoot, 'products', 'weird-meta')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ book_name: '离散数学', page_offsets: [{ section: '正文', offset: 6 }] }))
    writeFileSync(path.join(dir, 'factsheet-ch01.md'), '# factsheet')
    const info = await importMaterialFolder(dir, path.join(tmpRoot, 'materials-weird'))
    expect(info.title).toBe('离散数学')
    expect(info.pageOffsets).toEqual([{ section: '正文', offset: 6 }])
  })
})
