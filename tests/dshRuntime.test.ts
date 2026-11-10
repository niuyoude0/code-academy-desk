import { describe, it, expect } from 'vitest'
import {
  extractJsonFrames,
  mapSessionEvent
} from '../src/main/services/dshRuntime'
import {
  decodeConsoleOutput,
  runShellCommand
} from '../src/main/services/shell'

describe('JSON-RPC 帧解析', () => {
  it('切出完整帧并保留不完整尾部', () => {
    const { frames, rest } = extractJsonFrames('{"a":1}\n{"b":2}\n{"c"')
    expect(frames).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest).toBe('{"c"')
  })

  it('跳过空行', () => {
    const { frames, rest } = extractJsonFrames('\n\n{"x":1}\n\n')
    expect(frames).toEqual(['{"x":1}'])
    expect(rest).toBe('')
  })
})

describe('DSH 会话事件映射（结构取自实测会话日志）', () => {
  it('assistant/message 的 text 块 → text-delta；reasoning/tool-call 块不进聊天流', () => {
    const events = mapSessionEvent({
      type: 'assistant/message',
      data: {
        turn: 2,
        step: 2,
        message: {
          content: [
            { type: 'reasoning', text: '思考过程' },
            { type: 'text', text: 'echo 的输出是 dsh-ok。' }
          ]
        }
      }
    })
    expect(events).toEqual([{ type: 'text-delta', text: 'echo 的输出是 dsh-ok。' }])
  })

  it('空 text 块不产生事件', () => {
    const events = mapSessionEvent({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '' }] } }
    })
    expect(events).toEqual([])
  })

  it('tool/call → tool-call（arguments 原样透传）', () => {
    const events = mapSessionEvent({
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'call_00_ET', name: 'pwsh', arguments: '{"command": "echo dsh-ok"}' }
    })
    expect(events).toEqual([
      { type: 'tool-call', toolCallId: 'call_00_ET', toolName: 'pwsh', input: '{"command": "echo dsh-ok"}' }
    ])
  })

  it('tool/result 正常 → tool-result；isError → tool-error', () => {
    const ok = mapSessionEvent({
      type: 'tool/result',
      data: {
        message: {
          toolCallId: 'call_00_ET',
          isError: false,
          content: [{ type: 'text', text: 'dsh-ok' }]
        }
      }
    })
    expect(ok).toEqual([{ type: 'tool-result', toolCallId: 'call_00_ET', toolName: '', output: 'dsh-ok' }])

    const bad = mapSessionEvent({
      type: 'tool/result',
      data: {
        message: { toolCallId: 'call_X', isError: true, content: [{ type: 'text', text: 'boom' }] },
        error: { name: 'ShellError', code: 'E_X', reason: '命令不存在' }
      }
    })
    expect(bad).toEqual([{ type: 'tool-error', toolCallId: 'call_X', toolName: '', error: 'boom' }])
  })

  it('turn/end 三种收场：completed → finish、error → error、aborted → aborted', () => {
    expect(mapSessionEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })).toEqual([
      { type: 'finish', finishReason: 'completed' }
    ])
    expect(
      mapSessionEvent({
        type: 'turn/end',
        data: { turn: 1, reason: { kind: 'error', error: { message: 'DeepSeek Messages request failed (404)', code: 'HTTP_404' } } }
      })
    ).toEqual([{ type: 'error', message: 'DeepSeek Messages request failed (404)' }])
    expect(mapSessionEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } })).toEqual([
      { type: 'aborted' }
    ])
  })

  it('未知事件类型不产生事件', () => {
    expect(mapSessionEvent({ type: 'session/title', data: {} })).toEqual([])
    expect(mapSessionEvent({})).toEqual([])
  })
})

describe('shell 执行（真实本机，无 AI 消耗）', () => {
  it('UTF-8 中文直接解码', () => {
    expect(decodeConsoleOutput(Buffer.from('中文输出测试', 'utf-8'))).toBe('中文输出测试')
  })

  it('GBK 字节流（cmd OEM 936）兜底解码', () => {
    const buf = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
    const decoded = decodeConsoleOutput(buf)
    expect(decoded === '中文' || decoded.includes('\uFFFD')).toBe(true)
  })

  it('cmd：echo 与退出码', async () => {
    const r = await runShellCommand({ command: 'echo hello-cad', shell: 'cmd' })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('hello-cad')
    expect(r.timedOut).toBe(false)
  }, 30000)

  it('PowerShell：表达式求值 + 中文输出', async () => {
    const r = await runShellCommand({ command: "Write-Output ('sum=' + (1+1)); Write-Output '中文输出测试'", shell: 'powershell' })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('sum=2')
    expect(r.stdout).toContain('中文输出测试')
  }, 60000)

  it('超时：强杀进程树并标记 timedOut', async () => {
    const started = Date.now()
    const r = await runShellCommand({
      command: 'Start-Sleep -Seconds 60',
      shell: 'powershell',
      timeoutMs: 2000
    })
    expect(r.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(15000)
  }, 30000)
})
