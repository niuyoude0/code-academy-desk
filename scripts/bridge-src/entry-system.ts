/** system 桥：琐碎系统信息只读（平台/语言/应用版本）。 */
export async function getSystemInfo(): Promise<{ platform: string; locale: string; appVersion: string }> {
  return window.cadBridge.call('system.getInfo', {})
}
