import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import {
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  saveMcpServers,
  buildMcpPatchRows,
  composeProfilePatch,
  McpError
} from '../src/main/services/mcpServers'

let tmpRoot: string

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-mcp-'))
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('MCP 服务器 CRUD 与校验', () => {
  it('空目录返回空列表', async () => {
    expect(await listMcpServers(path.join(tmpRoot, 'a'))).toEqual([])
  })

  it('添加 stdio 服务器并回读', async () => {
    const root = path.join(tmpRoot, 'a')
    const added = await addMcpServer(root, {
      serverName: 'mysql',
      transport: 'stdio',
      enabled: true,
      command: 'cmd',
      args: ['/c', 'npx', '-y', 'mcp-server-mysql'],
      env: { MYSQL_URL: 'mysql://localhost/x' }
    })
    expect(added.id).toBeTruthy()
    const list = await listMcpServers(root)
    expect(list).toHaveLength(1)
    expect(list[0].serverName).toBe('mysql')
    expect(list[0].args).toEqual(['/c', 'npx', '-y', 'mcp-server-mysql'])
  })

  it('校验：非法 serverName / 缺 command / 缺 url / 非法 transport / 重复 serverName', async () => {
    const root = path.join(tmpRoot, 'b')
    await expect(
      addMcpServer(root, { serverName: '空格 不行', transport: 'stdio', enabled: true, command: 'x' })
    ).rejects.toThrow(McpError)
    await expect(
      addMcpServer(root, { serverName: 'ok1', transport: 'stdio', enabled: true })
    ).rejects.toThrow(/command/)
    await expect(
      addMcpServer(root, { serverName: 'ok2', transport: 'streamable-http', enabled: true })
    ).rejects.toThrow(/url/)
    await expect(
      addMcpServer(root, { serverName: 'ok3', transport: 'grpc' as 'stdio', enabled: true, command: 'x' })
    ).rejects.toThrow(/transport/)
    await addMcpServer(root, { serverName: 'dup', transport: 'stdio', enabled: true, command: 'x' })
    await expect(
      addMcpServer(root, { serverName: 'DUP', transport: 'stdio', enabled: true, command: 'y' })
    ).rejects.toThrow(/重复/)
  })

  it('update 启停 + remove', async () => {
    const root = path.join(tmpRoot, 'c')
    const s = await addMcpServer(root, { serverName: 'web', transport: 'streamable-http', enabled: true, url: 'http://localhost:3000/mcp' })
    const afterUpdate = await updateMcpServer(root, { id: s.id, enabled: false })
    expect(afterUpdate[0].enabled).toBe(false)
    await removeMcpServer(root, s.id)
    expect(await listMcpServers(root)).toHaveLength(0)
    await expect(updateMcpServer(root, { id: 'missing', enabled: true })).rejects.toThrow(/不存在/)
  })

  it('损坏的配置文件给出可读错误', async () => {
    const root = path.join(tmpRoot, 'd')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'mcp-servers.json'), '{broken')
    await expect(listMcpServers(root)).rejects.toThrow(/解析失败/)
  })
})

describe('profile patch 行生成与组装（js-yaml 真实解析验证）', () => {
  it('启用服务器 → 行文本；组合后与 DSH patch 结构同构', () => {
    const rows = buildMcpPatchRows([
      {
        id: 'abc-def',
        serverName: 'mysql',
        transport: 'stdio',
        enabled: true,
        command: 'cmd',
        args: ['/c', 'npx', '-y', 'mcp-server-mysql'],
        env: { MYSQL_URL: 'mysql://localhost/x' }
      },
      {
        id: 'web-1',
        serverName: 'web',
        transport: 'streamable-http',
        enabled: true,
        url: 'http://localhost:3000/mcp',
        headers: { Authorization: 'Bearer tok en' }
      },
      { id: 'off', serverName: 'off', transport: 'stdio', enabled: false, command: 'x' }
    ])
    const doc = composeProfilePatch(rows)
    // profile patch 与 DSH bundle 同构：顶层是数组 [ { insert: [rows...] } ]
    const parsed = yaml.load(doc) as Array<{
      insert: Array<{ id: string; name: string; config: Record<string, unknown> }>
    }>
    expect(Array.isArray(parsed)).toBe(true)
    const inserted = parsed[0].insert
    expect(inserted).toHaveLength(3) // course-tools + 2 个启用服务器（停用的不出现）
    expect(inserted[0].id).toBe('course-tools')
    expect(inserted[0].name).toBe('@cad/course-tools')
    const mysql = inserted[1]
    expect(mysql.id).toBe('mcp-user-abcdef')
    expect(mysql.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(mysql.config.serverName).toBe('mysql')
    expect(mysql.config.transport).toBe('stdio')
    expect(mysql.config.command).toBe('cmd')
    expect(mysql.config.args).toEqual(['/c', 'npx', '-y', 'mcp-server-mysql'])
    expect(mysql.config.env).toEqual({ MYSQL_URL: 'mysql://localhost/x' })
    expect(mysql.config.failOnStartupError).toBe(false)
    expect(inserted[2].config.url).toBe('http://localhost:3000/mcp')
    expect(inserted[2].config.headers).toEqual({ Authorization: 'Bearer tok en' })
  })

  it('全部停用/空列表 → 只有 course-tools 行', () => {
    expect(buildMcpPatchRows([])).toEqual([])
    const doc = composeProfilePatch(
      buildMcpPatchRows([
        { id: 'x', serverName: 'x', transport: 'stdio', enabled: false, command: 'x' }
      ])
    )
    const parsed = yaml.load(doc) as Array<{ insert: Array<{ id: string }> }>
    expect(parsed[0].insert).toEqual([{ id: 'course-tools', name: '@cad/course-tools' }])
  })

  it('特殊字符值（冒号/引号/中文）经 YAML 往返不失真', () => {
    const rows = buildMcpPatchRows([
      {
        id: 's1',
        serverName: 'tricky',
        transport: 'stdio',
        enabled: true,
        command: 'powershell',
        args: ['-Command', 'Write-Host "a: b #c"'],
        env: { NOTE: '中文：值#2' }
      }
    ])
    const doc = composeProfilePatch(rows)
    const parsed = yaml.load(doc) as Array<{ insert: Array<{ config: Record<string, unknown> }> }>
    const cfg = parsed[0].insert[1].config
    expect(cfg.args).toEqual(['-Command', 'Write-Host "a: b #c"'])
    expect(cfg.env).toEqual({ NOTE: '中文：值#2' })
  })
})

describe('patch 落盘链路（存取配合生成）', () => {
  it('保存后可从文件读回并生成 profile patch', async () => {
    const root = path.join(tmpRoot, 'e')
    await saveMcpServers(root, [
      { id: 'z1', serverName: 'mysql', transport: 'stdio', enabled: true, command: 'cmd' }
    ])
    const servers = await listMcpServers(root)
    const doc = composeProfilePatch(buildMcpPatchRows(servers))
    expect(doc).toContain('serverName: "mysql"')
    expect(existsSync(path.join(root, 'mcp-servers.json'))).toBe(true)
    expect(readFileSync(path.join(root, 'mcp-servers.json'), 'utf-8')).toContain('"mysql"')
  })
})
