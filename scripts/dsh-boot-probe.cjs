/* DSH boot 探针：手动 spawn + initialize，打印全部 stdout/stderr（复现「运行时未就绪」） */
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')

const vendorRoot = path.join(__dirname, '..', 'resources', 'dsh-runtime')
const nodeExe = path.join(vendorRoot, 'node24', 'node.exe')
const dshEntry = path.join(vendorRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const userData = path.join(os.homedir(), 'AppData', 'Roaming', 'code-academy-desk')
const dshHome = path.join(userData, 'dsh', 'home')

console.log('node:', nodeExe, require('fs').existsSync(nodeExe))
console.log('entry:', dshEntry, require('fs').existsSync(dshEntry))

const child = spawn(nodeExe, [dshEntry, '--profile', 'cad'], {
  cwd: path.join(userData, 'workspace'),
  env: {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_PERMISSION_MODE: 'workspace-write',
    DEEPSEEK_API_KEY: 'sk-dummy-for-boot-probe',
    CAD_COURSES_ROOT: path.join(userData, 'courses'),
    CAD_MATERIALS_ROOT: path.join(userData, 'materials')
  },
  stdio: ['pipe', 'pipe', 'pipe']
})

let buf = ''
child.stdout.setEncoding('utf-8')
child.stdout.on('data', (d) => {
  buf += d
  // 打印每个完整行（JSON-RPC 帧）
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const l of lines) console.log('[OUT]', l.slice(0, 300))
})
child.stderr.setEncoding('utf-8')
child.stderr.on('data', (d) => console.log('[ERR]', String(d).slice(0, 500)))
child.on('exit', (code) => console.log('[EXIT]', code))

setTimeout(() => {
  console.log('--- sending initialize ---')
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { cwd: path.join(userData, 'workspace'), approvalRequests: true, provider: 'deepseek-official', model: 'deepseek-chat' }
  }) + '\n')
}, 3000)

setTimeout(() => {
  console.log('--- timeout, killing ---')
  try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']) } catch {}
  process.exit(0)
}, 30000)
