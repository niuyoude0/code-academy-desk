// 桥 chunk 源码的全局声明（构建脚本 esbuild 不查类型，仅编辑器友好）
declare interface Window {
  cadBridge: {
    call: (kind: string, params: Record<string, unknown>) => Promise<unknown>
  }
}
