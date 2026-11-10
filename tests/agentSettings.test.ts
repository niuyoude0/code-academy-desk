import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import {
  readAgentSettings,
  saveAgentSettings,
  toSettingsView,
  agentSettingsFile,
  AgentSettingsError
} from '../src/main/services/agentSettings'

let tmpRoot: string

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-agent-settings-'))
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('Agent 设置', () => {
  it('缺省设置：deepseek + deepseek-chat，未配置 key', async () => {
    const root = path.join(tmpRoot, 'settings-a')
    const s = await readAgentSettings(root)
    expect(s.model).toBe('deepseek-chat')
    expect(s.apiKey).toBeUndefined()
    const view = toSettingsView(s)
    expect(view.configured).toBe(false)
    expect(view.apiKeyMasked).toBe('')
  })

  it('保存后合并 + 掩码只露末 4 位', async () => {
    const root = path.join(tmpRoot, 'settings-b')
    await saveAgentSettings(root, { apiKey: 'sk-test1234567890abcd', model: 'deepseek-reasoner' })
    const raw = JSON.parse(readFileSync(agentSettingsFile(root), 'utf-8')) as Record<string, unknown>
    expect(raw['apiKey']).toBe('sk-test1234567890abcd') // 文件里是原 key（本机存储）
    const view = toSettingsView(await readAgentSettings(root))
    expect(view.configured).toBe(true)
    expect(view.apiKeyMasked).toBe('****abcd')
    expect(view.model).toBe('deepseek-reasoner')
  })

  it('校验：空 key / 空 model / 非法 baseUrl 被拒', async () => {
    const root = path.join(tmpRoot, 'settings-c')
    mkdirSync(root, { recursive: true })
    await expect(saveAgentSettings(root, { apiKey: '  ' })).rejects.toThrow(AgentSettingsError)
    await expect(saveAgentSettings(root, { model: '' })).rejects.toThrow(AgentSettingsError)
    await expect(saveAgentSettings(root, { baseUrl: 'ftp://x' })).rejects.toThrow(/http/)
    await saveAgentSettings(root, { apiKey: 'sk-x', baseUrl: 'http://localhost:11434/anthropic' })
    const s = await readAgentSettings(root)
    expect(s.baseUrl).toBe('http://localhost:11434/anthropic')
    await saveAgentSettings(root, { baseUrl: null })
    expect((await readAgentSettings(root)).baseUrl).toBeUndefined()
  })

  it('权限档位：默认 workspace-write，合法值可写，非法值被拒', async () => {
    const root = path.join(tmpRoot, 'settings-e')
    expect((await readAgentSettings(root)).permissionMode).toBe('workspace-write')
    await saveAgentSettings(root, { permissionMode: 'read-only' })
    expect((await readAgentSettings(root)).permissionMode).toBe('read-only')
    await expect(
      saveAgentSettings(root, { permissionMode: 'yolo-mode' as unknown as 'read-only' })
    ).rejects.toThrow(AgentSettingsError)
    // 损坏文件里的未知档位回落到默认
    const root2 = path.join(tmpRoot, 'settings-f')
    mkdirSync(root2, { recursive: true })
    writeFileSync(path.join(root2, 'agent-settings.json'), JSON.stringify({ permissionMode: 'chaos' }))
    expect((await readAgentSettings(root2)).permissionMode).toBe('workspace-write')
  })

  it('损坏的设置文件给出可读错误', async () => {
    const root = path.join(tmpRoot, 'settings-d')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'agent-settings.json'), '{broken')
    await expect(readAgentSettings(root)).rejects.toThrow(/解析失败/)
  })
})
