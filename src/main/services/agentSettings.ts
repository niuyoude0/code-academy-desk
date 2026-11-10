import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import type { AgentSettingsPatch, AgentSettingsView } from '../../shared/ipc'

/**
 * Agent 设置存取（userData/agent-settings.json）：
 *  - apiKey 只落本地文件，读方向永远脱敏（渲染层只见掩码）
 *  - provider 固定 deepseek / openai-compatible 两种；baseUrl 仅 openai-compatible 生效
 */

export const DEFAULT_AGENT_SETTINGS = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  permissionMode: 'workspace-write'
} as const

export interface AgentSettings {
  provider: 'deepseek' | 'openai-compatible'
  model: string
  baseUrl?: string
  apiKey?: string
  /** 权限档位（DSH DSH_PERMISSION_MODE 预设）：只读/标准写工作区+确认/完全放开 */
  permissionMode: 'read-only' | 'workspace-write' | 'danger-full-access'
}

export const PERMISSION_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export class AgentSettingsError extends Error {}

const FILE_NAME = 'agent-settings.json'

export function agentSettingsFile(settingsRoot: string): string {
  return path.join(settingsRoot, FILE_NAME)
}

export async function readAgentSettings(settingsRoot: string): Promise<AgentSettings> {
  if (!existsSync(agentSettingsFile(settingsRoot))) {
    return { ...DEFAULT_AGENT_SETTINGS }
  }
  try {
    const raw = JSON.parse(await fs.readFile(agentSettingsFile(settingsRoot), 'utf-8')) as Record<
      string,
      unknown
    >
    const mode = raw['permissionMode']
    return {
      provider: raw['provider'] === 'openai-compatible' ? 'openai-compatible' : 'deepseek',
      model: typeof raw['model'] === 'string' && raw['model'].length > 0 ? raw['model'] : DEFAULT_AGENT_SETTINGS.model,
      baseUrl: typeof raw['baseUrl'] === 'string' && raw['baseUrl'].length > 0 ? raw['baseUrl'] : undefined,
      apiKey: typeof raw['apiKey'] === 'string' && raw['apiKey'].length > 0 ? raw['apiKey'] : undefined,
      permissionMode:
        mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access'
          ? mode
          : 'workspace-write'
    }
  } catch (err) {
    throw new AgentSettingsError(`agent-settings.json 解析失败: ${String(err)}`)
  }
}

export async function saveAgentSettings(
  settingsRoot: string,
  patch: AgentSettingsPatch
): Promise<AgentSettings> {
  const current = await readAgentSettings(settingsRoot)
  const next: AgentSettings = { ...current }
  if (patch.apiKey != null) {
    const key = patch.apiKey.trim()
    if (key.length === 0) throw new AgentSettingsError('API Key 不能为空')
    next.apiKey = key
  }
  if (patch.model != null) {
    const model = patch.model.trim()
    if (model.length === 0) throw new AgentSettingsError('模型名不能为空')
    next.model = model
  }
  if (patch.baseUrl !== undefined) {
    if (patch.baseUrl === null || patch.baseUrl.trim().length === 0) {
      delete next.baseUrl
    } else if (/^https?:\/\//.test(patch.baseUrl.trim())) {
      next.baseUrl = patch.baseUrl.trim()
    } else {
      throw new AgentSettingsError('baseUrl 必须是 http(s) 地址')
    }
  }
  if (patch.permissionMode !== undefined) {
    if ((PERMISSION_MODES as readonly string[]).includes(patch.permissionMode)) {
      next.permissionMode = patch.permissionMode
    } else {
      throw new AgentSettingsError(`未知权限档位: ${String(patch.permissionMode)}`)
    }
  }
  await fs.mkdir(settingsRoot, { recursive: true })
  await fs.writeFile(agentSettingsFile(settingsRoot), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

/** 读方向视图：apiKey 以掩码呈现（保留末 4 位），未配置返回空串。 */
export function toSettingsView(s: AgentSettings): AgentSettingsView {
  const key = s.apiKey ?? ''
  const masked =
    key.length <= 4
      ? key.length > 0 ? '****' : ''
      : `****${key.slice(-4)}`
  return {
    configured: key.length > 0,
    provider: s.provider,
    model: s.model,
    baseUrl: s.baseUrl,
    apiKeyMasked: masked,
    permissionMode: s.permissionMode
  }
}
