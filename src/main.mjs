import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net as electronNet,
  shell,
  Tray,
} from 'electron'
import { resolveNodeEnvironment } from './node-runtime.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STARTUP_TIMEOUT_MS = 10 * 60_000
const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
const DSH_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2fdsh/latest'

let mainWindow = null
let tray = null
let dshProcess = null
let startupPromise = null
let harnessOrigin = null
let isQuitting = false

function emitStatus(message, detail = '', progress = null, error = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('runtime-status', { message, detail, progress, error })
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function reportNodeProgress(event) {
  switch (event.phase) {
    case 'download-start':
      emitStatus('正在安装私有 Node.js', `准备下载 ${event.file}`, 0)
      break
    case 'download': {
      const progress = event.total ? Math.round((event.received / event.total) * 100) : null
      const total = event.total ? ` / ${formatBytes(event.total)}` : ''
      emitStatus(
        '正在下载私有 Node.js',
        `${formatBytes(event.received)}${total}`,
        progress,
      )
      break
    }
    case 'verify':
      emitStatus('正在校验 Node.js', '验证官方安装包的 SHA-256', 100)
      break
    case 'extract':
      emitStatus('正在安装私有 Node.js', '正在解压应用私有运行时', null)
      break
    default:
      break
  }
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (port) resolve(port)
        else reject(new Error('无法分配本地端口。'))
      })
    })
  })
}

function appendProcessOutput(stream, channel) {
  if (!stream) return
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) console[channel](`[dsh] ${line}`)
    }
  })
}

async function waitForHarness(url, child, timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let exited = false
  let exitCode = null
  child.once('exit', (code) => {
    exited = true
    exitCode = code
  })

  while (Date.now() < deadline) {
    if (exited) throw new Error(`Harness 启动进程已退出（代码 ${exitCode ?? '未知'}）。`)
    try {
      const response = await electronNet.fetch(url, {
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) return
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`Harness 在 ${Math.round(timeoutMs / 1000)} 秒内未能启动。`)
}

async function resolveLatestDshPackage() {
  emitStatus('正在检查 Harness 更新', '查询 npm 官方软件源', null)
  try {
    const response = await electronNet.fetch(DSH_REGISTRY_URL, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest = await response.json()
    if (!manifest || typeof manifest.version !== 'string') {
      throw new Error('npm 返回的版本信息无效')
    }
    return `${DSH_PACKAGE_NAME}@${manifest.version}`
  } catch (error) {
    console.warn('[dsh] update check failed, falling back to npm cache', error)
    emitStatus('无法联网检查 Harness 更新', '尝试使用 npm 缓存中的可用版本', null)
    return `${DSH_PACKAGE_NAME}@latest`
  }
}

function stopHarness() {
  const child = dshProcess
  dshProcess = null
  if (!child || child.killed) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 5_000)
  timer.unref()
}

function buildHarnessEnvironment(nodeEnvironment) {
  const nodeDir = path.dirname(nodeEnvironment.nodePath)
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const inheritedPath = process.env[pathKey] ?? ''
  return {
    ...process.env,
    [pathKey]: [nodeDir, inheritedPath].filter(Boolean).join(path.delimiter),
    DSH_HOME: path.join(app.getPath('userData'), 'dsh-home'),
    npm_config_cache: path.join(app.getPath('userData'), 'npm-cache'),
    npm_config_progress: 'false',
  }
}

async function launchHarness() {
  emitStatus('正在检查运行环境', '查找兼容的 Node.js 与 npx', null)
  const runtimeRoot = path.join(app.getPath('userData'), 'runtime')
  const nodeEnvironment = await resolveNodeEnvironment({
    runtimeRoot,
    platform: process.platform,
    arch: process.arch,
    fetchImpl: electronNet.fetch,
    onProgress: reportNodeProgress,
  })

  const runtimeLabel = nodeEnvironment.source === 'system' ? '用户 Node.js' : '应用私有 Node.js'
  emitStatus(
    '运行环境已就绪',
    `使用${runtimeLabel} ${nodeEnvironment.version}（${process.platform}/${process.arch}）`,
    null,
  )

  const port = await getAvailablePort()
  const url = `http://127.0.0.1:${port}`
  const workspacePath = app.isPackaged ? app.getPath('documents') : process.cwd()
  const dshPackage = await resolveLatestDshPackage()
  emitStatus('正在准备 DeepSeek Harness', `安装或读取缓存：${dshPackage}`, null)

  const child = spawn(
    nodeEnvironment.nodePath,
    [
      nodeEnvironment.npxCliPath,
      '--yes',
      dshPackage,
      'web',
      '--port',
      String(port),
    ],
    {
      cwd: workspacePath,
      env: buildHarnessEnvironment(nodeEnvironment),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  dshProcess = child
  let harnessReady = false
  appendProcessOutput(child.stdout, 'log')
  appendProcessOutput(child.stderr, 'error')
  child.once('error', (error) => {
    console.error('[dsh] process error', error)
  })
  child.once('exit', (code, signal) => {
    if (!harnessReady || dshProcess !== child || isQuitting) return
    dshProcess = null
    harnessOrigin = null
    void mainWindow.loadFile(path.join(__dirname, 'loading.html')).then(() => {
      emitStatus(
        'Harness 已停止',
        `后台进程意外退出（${signal ?? `代码 ${code ?? '未知'}`}）。`,
        null,
        true,
      )
    })
  })

  emitStatus('正在等待 Harness 界面', `首次安装依赖较多，请保持网络连接 · ${url}`, null)
  await waitForHarness(url, child)
  harnessReady = true
  harnessOrigin = new URL(url).origin
  emitStatus('Harness 已启动', url, 100)
  await mainWindow.loadURL(url)
}

async function startApplication() {
  if (startupPromise) return startupPromise
  startupPromise = (async () => {
    stopHarness()
    harnessOrigin = null
    await mainWindow.loadFile(path.join(__dirname, 'loading.html'))
    try {
      await launchHarness()
    } catch (error) {
      stopHarness()
      console.error(error)
      emitStatus(
        '启动失败',
        error instanceof Error ? error.message : String(error),
        null,
        true,
      )
    } finally {
      startupPromise = null
    }
  })()
  return startupPromise
}

function isAllowedLocalUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol === 'file:') return true
    return Boolean(harnessOrigin && parsed.origin === harnessOrigin)
  } catch {
    return false
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function quitApplication() {
  isQuitting = true
  stopHarness()
  app.quit()
}

function createTrayImage() {
  const assetName =
    process.platform === 'darwin'
      ? 'tray-icon.png'
      : nativeTheme.shouldUseDarkColors
        ? 'tray-icon-dark.png'
        : 'tray-icon-light.png'
  const iconPath = path.join(__dirname, 'assets', 'brand', assetName)
  const iconSize = process.platform === 'darwin' ? 18 : 20
  const trayImage = nativeImage.createFromPath(iconPath).resize({
    width: iconSize,
    height: iconSize,
  })
  if (process.platform === 'darwin') trayImage.setTemplateImage(true)
  return trayImage
}

function updateTrayTheme() {
  if (tray) tray.setImage(createTrayImage())
}

function createTrayContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: '在默认浏览器中打开',
      enabled: Boolean(harnessOrigin),
      click: () => {
        if (harnessOrigin) void shell.openExternal(`${harnessOrigin}/`)
      },
    },
    { type: 'separator' },
    { label: '退出', click: quitApplication },
  ])
}

function createTray() {
  if (tray) return

  tray = new Tray(createTrayImage())
  tray.setToolTip('DeepSeek Harness Desktop')

  tray.on('click', showMainWindow)
  tray.on('right-click', () => tray?.popUpContextMenu(createTrayContextMenu()))
  nativeTheme.on('updated', updateTrayTheme)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#101114',
    title: 'DeepSeek Harness Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalUrl(url)) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    }
  })
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  void startApplication()
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    createTray()
    createWindow()
  })
  app.on('activate', () => {
    showMainWindow()
  })
}

ipcMain.handle('retry-startup', async () => {
  await startApplication()
})

app.on('before-quit', () => {
  isQuitting = true
  nativeTheme.removeListener('updated', updateTrayTheme)
  stopHarness()
})
