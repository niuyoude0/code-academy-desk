import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

/**
 * P9.8 MCP 服务器管理（DSH dsh-mcp-client）：
 *  - 配置存 userData/mcp-servers.json（应用拥有管理 UI）
 *  - 启动时生成 DSH 调用 patch（- insert 每个启用的服务器一行 dsh-mcp-client）
 *  - 工具名规则：mcp__<serverName>__<tool>；serverName [A-Za-z0-9_-]{1,32} 唯一
 *  - Windows 提示：npx 需 cmd /c 包装（Node 对 .bat 裸 spawn 抛 EINVAL）
 */

export type McpTransport = 'stdio' | 'streamable-http'

export interface McpServerConfig {
  id: string
  serverName: string
  transport: McpTransport
  enabled: boolean
  /** stdio */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  /** streamable-http */
  url?: string
  headers?: Record<string, string>
}

export class McpError extends Error {}

const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
const FILE_NAME = 'mcp-servers.json'

export function mcpServersFile(settingsRoot: string): string {
  return path.join(settingsRoot, FILE_NAME)
}

export async function listMcpServers(settingsRoot: string): Promise<McpServerConfig[]> {
  if (!existsSync(mcpServersFile(settingsRoot))) return []
  try {
    const raw = JSON.parse(await fs.readFile(mcpServersFile(settingsRoot), 'utf-8')) as unknown
    if (!Array.isArray(raw)) throw new McpError('mcp-servers.json 不是数组')
    return raw.map((r) => validateServer(r))
  } catch (err) {
    if (err instanceof McpError) throw err
    throw new McpError(`mcp-servers.json 解析失败: ${String(err)}`)
  }
}

export async function saveMcpServers(settingsRoot: string, servers: McpServerConfig[]): Promise<void> {
  const seen = new Set<string>()
  for (const s of servers) {
    validateServer(s)
    const key = s.serverName.toLowerCase()
    if (seen.has(key)) throw new McpError(`serverName 重复: ${s.serverName}`)
    seen.add(key)
  }
  await fs.mkdir(settingsRoot, { recursive: true })
  await fs.writeFile(mcpServersFile(settingsRoot), JSON.stringify(servers, null, 2), 'utf-8')
}

export async function addMcpServer(
  settingsRoot: string,
  input: Omit<McpServerConfig, 'id'>
): Promise<McpServerConfig> {
  const servers = await listMcpServers(settingsRoot)
  const server: McpServerConfig = { ...input, id: randomUUID() }
  await saveMcpServers(settingsRoot, [...servers, server])
  return server
}

export async function updateMcpServer(
  settingsRoot: string,
  patch: Partial<Omit<McpServerConfig, 'id'>> & { id: string }
): Promise<McpServerConfig[]> {
  const servers = await listMcpServers(settingsRoot)
  const idx = servers.findIndex((s) => s.id === patch.id)
  if (idx < 0) throw new McpError(`MCP 服务器不存在: ${patch.id}`)
  const next = [...servers]
  next[idx] = validateServer({ ...next[idx], ...patch, id: patch.id })
  await saveMcpServers(settingsRoot, next)
  return next
}

export async function removeMcpServer(settingsRoot: string, id: string): Promise<void> {
  const servers = await listMcpServers(settingsRoot)
  await saveMcpServers(
    settingsRoot,
    servers.filter((s) => s.id !== id)
  )
}

function validateServer(raw: unknown): McpServerConfig {
  if (raw == null || typeof raw !== 'object') throw new McpError('MCP 服务器配置必须是对象')
  const r = raw as Record<string, unknown>
  const serverName = typeof r['serverName'] === 'string' ? r['serverName'] : ''
  if (!SERVER_NAME_RE.test(serverName)) {
    throw new McpError(`serverName 只允许字母/数字/_/-（1-32 位）: "${serverName}"`)
  }
  const transport = r['transport']
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    throw new McpError(`transport 必须是 stdio 或 streamable-http: ${String(transport)}`)
  }
  const server: McpServerConfig = {
    id: typeof r['id'] === 'string' && r['id'].length > 0 ? r['id'] : randomUUID(),
    serverName,
    transport,
    enabled: r['enabled'] !== false
  }
  const strRecord = (v: unknown, label: string): Record<string, string> | undefined => {
    if (v == null) return undefined
    if (typeof v !== 'object' || Array.isArray(v)) throw new McpError(`${label} 必须是对象`)
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val !== 'string') throw new McpError(`${label}.${k} 必须是字符串`)
      out[k] = val
    }
    return out
  }
  if (transport === 'stdio') {
    const command = r['command']
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new McpError('stdio 传输必须提供 command')
    }
    server.command = command.trim()
    if (r['args'] != null) {
      if (!Array.isArray(r['args']) || r['args'].some((a) => typeof a !== 'string')) {
        throw new McpError('args 必须是字符串数组')
      }
      server.args = r['args'] as string[]
    }
    server.env = strRecord(r['env'], 'env')
    if (typeof r['cwd'] === 'string' && r['cwd'].trim().length > 0) server.cwd = r['cwd']
  } else {
    const url = r['url']
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new McpError('streamable-http 传输必须提供 http(s) url')
    }
    server.url = url
    server.headers = strRecord(r['headers'], 'headers')
  }
  return server
}

/* ===== DSH profile patch 生成（纯函数） ===== */

/** YAML 标量：一律 JSON 双引号（合法 YAML flow 标量，避免任何转义歧义）。 */
function q(v: string): string {
  return JSON.stringify(v)
}

function emitRecordLines(lines: string[], indent: string, label: string, rec: Record<string, string>): void {
  lines.push(`${indent}${label}:`)
  for (const [k, v] of Object.entries(rec)) {
    lines.push(`${indent}  ${q(k)}: ${q(v)}`)
  }
}

/**
 * 生成单个启用服务器的 patch 行文本（不 含 `- insert:` 头）。
 */
export function buildMcpPatchRow(s: McpServerConfig): string[] {
  const lines: string[] = []
  lines.push(`    - id: mcp-user-${s.id.replaceAll('-', '')}`)
  lines.push(`      name: '@deepseek-ai/dsh-mcp-client'`)
  lines.push(`      config:`)
  lines.push(`        serverName: ${q(s.serverName)}`)
  lines.push(`        transport: ${s.transport}`)
  if (s.transport === 'stdio') {
    lines.push(`        command: ${q(s.command ?? '')}`)
    if (s.args != null && s.args.length > 0) {
      lines.push(`        args: [${s.args.map(q).join(', ')}]`)
    }
    if (s.env != null && Object.keys(s.env).length > 0) emitRecordLines(lines, '        ', 'env', s.env)
    if (s.cwd != null) lines.push(`        cwd: ${q(s.cwd)}`)
  } else {
    lines.push(`        url: ${q(s.url ?? '')}`)
    if (s.headers != null && Object.keys(s.headers).length > 0) {
      emitRecordLines(lines, '        ', 'headers', s.headers)
    }
  }
  lines.push(`        failOnStartupError: false`)
  return lines
}

/** 收集所有启用服务器的 patch 行（无启用服务器 → 空数组）。 */
export function buildMcpPatchRows(servers: McpServerConfig[]): string[] {
  const out: string[] = []
  for (const s of servers) {
    if (!s.enabled) continue
    out.push(...buildMcpPatchRow(s))
  }
  return out
}

/**
 * 组装应用托管的 profile cordis.patch.yml 整文档：
 * 业务工具插件（course-tools）+ MCP 服务器行。行文本由调用方拼好传入。
 */
export function composeProfilePatch(extraRows: string[]): string {
  const lines: string[] = [
    '# Code Academy Desk profile patch layer（应用托管，请勿手工编辑）',
    '# 组成：业务工具插件 @cad/course-tools + MCP 服务器（userData/mcp-servers.json）',
    '- insert:',
    "    - id: course-tools",
    "      name: '@cad/course-tools'"
  ]
  if (extraRows.length > 0) {
    lines.push(...extraRows)
  }
  return lines.join('\n') + '\n'
}
