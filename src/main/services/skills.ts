import { promises as fsp, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs'
import path from 'path'
import matter from 'gray-matter'

/**
 * Agent 技能系统 MVP（agentskills.io SKILL.md 契约的加载与安装）：
 *  - 技能根目录 userData/skills/<skill-name>/SKILL.md（+ scripts/ references/ assets/）
 *  - 内置技能随应用分发（resources/skills/），首次启动复制到用户目录（不覆盖已存在的）
 *  - frontmatter 校验：name 1–64 小写字母/数字/连字符且与目录同名；description 1–1024
 */

export interface SkillInfo {
  name: string
  description: string
  dir: string
  source: 'builtin' | 'user'
}

const NAME_RE = /^[a-z0-9][a-z0-9\-]{0,63}$/

export class SkillError extends Error {}

export function builtinSkillsDir(appPath: string): string {
  return path.join(appPath, 'resources', 'skills')
}

/** 校验单个技能目录（返回 null 表示缺少 SKILL.md），供扫描与安装共用。 */
async function validateSkillDir(dir: string): Promise<SkillInfo | null> {
  const skillFile = path.join(dir, 'SKILL.md')
  if (!existsSync(skillFile)) return null
  const raw = await fsp.readFile(skillFile, 'utf-8')
  const parsed = matter(raw)
  const name = typeof parsed.data['name'] === 'string' ? parsed.data['name'] : ''
  const description = typeof parsed.data['description'] === 'string' ? parsed.data['description'] : ''
  const dirName = path.basename(dir)
  if (!NAME_RE.test(name) || name !== dirName) {
    throw new SkillError(
      `技能 frontmatter name "${name}" 必须为小写字母/数字/连字符（1–64 字符）且与目录名 "${dirName}" 一致`
    )
  }
  if (description.length < 1 || description.length > 1024) {
    throw new SkillError(`技能 ${name} 的 description 长度必须在 1–1024 之间`)
  }
  return { name, description, dir, source: 'user' }
}

/** 首次启动：把内置技能复制到用户技能目录（已存在同名则跳过，不覆盖用户改动）。 */
export function ensureBuiltinSkills(builtinDir: string, skillsRoot: string): string[] {
  const installed: string[] = []
  if (!existsSync(builtinDir)) return installed
  for (const name of readdirSync(builtinDir)) {
    const src = path.join(builtinDir, name)
    if (!statSync(src).isDirectory()) continue
    const dest = path.join(skillsRoot, name)
    if (existsSync(dest)) continue
    copyDirSync(src, dest)
    installed.push(name)
  }
  return installed
}

function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (statSync(s).isDirectory()) copyDirSync(s, d)
    else copyFileSync(s, d)
  }
}

/** 扫描技能根目录，返回技能列表。 */
export async function listSkills(skillsRoot: string): Promise<SkillInfo[]> {
  if (!existsSync(skillsRoot)) return []
  const skills: SkillInfo[] = []
  for (const name of await fsp.readdir(skillsRoot)) {
    const dir = path.join(skillsRoot, name)
    if (!(await fsp.stat(dir)).isDirectory()) continue
    const info = await validateSkillDir(dir)
    if (info != null) skills.push(info)
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/** 读取技能 SKILL.md 全文（渐进披露第二级：激活时注入）。 */
export async function readSkillBody(skillsRoot: string, name: string): Promise<string> {
  assertSafeName(name)
  const skillFile = path.join(skillsRoot, name, 'SKILL.md')
  if (!existsSync(skillFile)) throw new SkillError(`技能不存在: ${name}`)
  return fsp.readFile(skillFile, 'utf-8')
}

/** 读取技能附属文件（references/scripts/assets，按需加载）。 */
export async function readSkillFile(
  skillsRoot: string,
  name: string,
  relPath: string
): Promise<string> {
  assertSafeName(name)
  const safe = sanitizeRelPath(relPath)
  const file = path.join(skillsRoot, name, ...safe.split('/'))
  if (!existsSync(file)) throw new SkillError(`技能附属文件不存在: ${relPath}`)
  return fsp.readFile(file, 'utf-8')
}

/** 从本地文件夹安装技能（校验 name 与目录名一致后复制）。 */
export async function installSkillFromFolder(
  srcFolder: string,
  skillsRoot: string
): Promise<SkillInfo> {
  const base = path.basename(srcFolder)
  if (!NAME_RE.test(base)) {
    throw new SkillError(`技能目录名 "${base}" 必须为小写字母/数字/连字符（1–64 字符）`)
  }
  const info = await validateSkillDir(srcFolder)
  if (info == null) throw new SkillError(`目录 ${base} 中缺少 SKILL.md`)
  const dest = path.join(skillsRoot, base)
  if (existsSync(dest)) throw new SkillError(`技能 ${base} 已存在，拒绝覆盖`)
  await fsp.mkdir(skillsRoot, { recursive: true })
  await copyDir(srcFolder, dest)
  return { ...info, dir: dest }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true })
  for (const name of await fsp.readdir(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if ((await fsp.stat(s)).isDirectory()) await copyDir(s, d)
    else await fsp.copyFile(s, d)
  }
}

function assertSafeName(name: string): void {
  if (!NAME_RE.test(name)) throw new SkillError(`非法技能名: ${name}`)
}

function sanitizeRelPath(relPath: string): string {
  const normalized = path.posix.normalize(relPath.replaceAll('\\', '/'))
  if (normalized.startsWith('..') || normalized.includes('../') || path.posix.isAbsolute(normalized)) {
    throw new SkillError(`非法技能文件路径: ${relPath}`)
  }
  return normalized
}
