/**
 * @deepseek-ai/dsh-tools 的最小类型面（仅插件开发所需；运行时由 vendor 树提供真包，
 * 构建时 external 不打包）。契约依据 vendor 0.2.2-rc.1 实测（P5.0/P5.2.5）。
 */
declare module '@deepseek-ai/dsh-tools' {
  export interface ToolParameterNode {
    /** string | number | integer | boolean | null | array | object | json */
    type?: string
    description?: string
    /** 属性级标记：true = 必填（只能是 true） */
    required?: boolean
    items?: ToolParameterNode
    properties?: Record<string, ToolParameterNode>
    enum?: (string | number | boolean | null)[]
  }

  export interface ToolDefinition {
    name: string
    description: string
    /** 属性映射：{ 参数名: 节点 }；编译为 JSON Schema 并做实参校验 */
    parameters: Record<string, ToolParameterNode>
    output: {
      schema: { type: string }
      render: (args: unknown, value: unknown) => Array<{ type: string; text?: string }>
    }
    execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
    /** 同参数并发调用是否安全（纯读工具建议 true） */
    isConcurrencySafe?: boolean
    timeoutMs?: number
  }

  export function defineTool(options: ToolDefinition): unknown
}
