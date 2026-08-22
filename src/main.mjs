import { spawn } from 'node:child_process'
import { chmod, copyFile, readdir, rename, rm } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net as electronNet,
  shell,
  Tray,
} from 'electron'
import {
  downloadReleaseAsset,
  fetchAvailableUpdate,
} from './app-update.mjs'
import {
  buildHarnessEnvironment,
  DSH_PACKAGE_NAME,
  findUserDshInstallation,
  getGlobalNpmBinDirectory,
  isDshUpdateRequired,
  updateGlobalDsh,
} from './dsh-runtime.mjs'
import { resolveNodeEnvironment } from './node-runtime.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STARTUP_TIMEOUT_MS = 10 * 60_000
const DSH_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2fdsh/latest'
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60_000

let mainWindow = null
let tray = null
let dshProcess = null
let startupPromise = null
let harnessOrigin = null
let isQuitting = false
let desktopUpdateCheck = null
let desktopUpdateTimeout = null
let desktopUpdateInterval = null
let desktopUpdateState = { status: 'idle', progress: null, update: null, file: null }
let desktopUpdatePrompt = null

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

async function resolveLatestDshVersion() {
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
    return manifest.version
  } catch (error) {
    console.warn('[dsh] update check failed', error)
    emitStatus('无法联网检查 Harness 更新', '如已安装，将继续使用当前版本', null)
    return null
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

async function prepareDshInstallation(nodeEnvironment, latestVersion, env) {
  const isSystemRuntime = nodeEnvironment.source === 'system'
  const scopeLabel = isSystemRuntime ? '用户全局环境' : '应用私有环境'
  const installed = await findUserDshInstallation({
    nodeEnvironment,
    platform: process.platform,
    env,
    includePath: isSystemRuntime,
  })

  if (installed && !isDshUpdateRequired(installed.version, latestVersion)) {
    const versionState = latestVersion ? '已是最新版本' : '使用已安装版本'
    emitStatus('DeepSeek Harness 已就绪', `${versionState} ${installed.version} · ${scopeLabel}`, null)
    return installed
  }

  const targetVersion = latestVersion ?? 'latest'
  const isUpdate = Boolean(installed)
  emitStatus(
    isUpdate ? '正在更新 DeepSeek Harness' : '正在安装 DeepSeek Harness',
    `${scopeLabel} · ${DSH_PACKAGE_NAME}@${targetVersion}`,
    null,
  )

  try {
    const installation = await updateGlobalDsh({
      nodeEnvironment,
      version: targetVersion,
      platform: process.platform,
      env,
    })
    if (!installation) throw new Error('npm 完成后未找到 dsh 全局安装')
    return installation
  } catch (error) {
    if (installed) {
      console.warn('[dsh] update failed, using installed version', error)
      emitStatus(
        'Harness 更新失败',
        `继续使用已安装版本 ${installed.version} · ${scopeLabel}`,
        null,
      )
      return installed
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`无法在${scopeLabel}安装 DeepSeek Harness：${reason}`)
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

  const baseEnvironment = buildHarnessEnvironment(nodeEnvironment)
  const globalBinDir = await getGlobalNpmBinDirectory({
    nodeEnvironment,
    platform: process.platform,
    env: baseEnvironment,
  })
  const installEnvironment = buildHarnessEnvironment(nodeEnvironment, [globalBinDir])
  const latestVersion = await resolveLatestDshVersion()
  const dshInstallation = await prepareDshInstallation(
    nodeEnvironment,
    latestVersion,
    installEnvironment,
  )

  const port = await getAvailablePort()
  const url = `http://127.0.0.1:${port}`
  const workspacePath = app.isPackaged ? app.getPath('documents') : process.cwd()
  const harnessEnvironment = buildHarnessEnvironment(nodeEnvironment, [
    dshInstallation.binDir,
    globalBinDir,
  ])

  const child = spawn(
    nodeEnvironment.nodePath,
    [
      dshInstallation.binPath,
      'web',
      '--no-open',
      '--port',
      String(port),
    ],
    {
      cwd: workspacePath,
      env: harnessEnvironment,
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

  emitStatus(
    '正在等待 Harness 界面',
    `启动版本 ${dshInstallation.version} · ${url}`,
    null,
  )
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

function restartApplication() {
  if (isQuitting) return
  app.relaunch()
  quitApplication()
}

function setDesktopUpdateState(status, values = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(values, key)
  desktopUpdateState = {
    status,
    progress: values.progress ?? null,
    update: has('update') ? values.update : desktopUpdateState.update,
    file: has('file') ? values.file : desktopUpdateState.file,
    error: values.error ?? null,
  }
}

function showMessageBox(options) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    return dialog.showMessageBox(mainWindow, options)
  }
  return dialog.showMessageBox(options)
}

function desktopUpdateMenuLabel() {
  const version = desktopUpdateState.update?.manifest.version
  switch (desktopUpdateState.status) {
    case 'checking':
      return '正在检查桌面端更新…'
    case 'downloading':
      return `正在下载桌面端 v${version}（${desktopUpdateState.progress ?? 0}%）`
    case 'ready':
      return `安装桌面端更新 v${version}`
    case 'installing':
      return `正在打开桌面端 v${version} 安装包…`
    default:
      return `检查桌面端更新（当前 v${app.getVersion()}）`
  }
}

async function replaceCurrentAppImage(downloadedFile) {
  const currentAppImage = process.env.APPIMAGE
  if (!currentAppImage || !path.isAbsolute(currentAppImage)) {
    throw new Error('无法定位当前 AppImage。')
  }

  const stagedFile = `${currentAppImage}.update`
  await rm(stagedFile, { force: true })
  try {
    await copyFile(downloadedFile, stagedFile)
    await chmod(stagedFile, 0o755)
    await rename(stagedFile, currentAppImage)
  } catch (error) {
    await rm(stagedFile, { force: true })
    throw error
  }

  app.relaunch({ execPath: currentAppImage })
  quitApplication()
}

async function removeOldDesktopUpdates(updatesRoot, keepDirectory) {
  let entries
  try {
    entries = await readdir(updatesRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== keepDirectory)
      .map((entry) => rm(path.join(updatesRoot, entry.name), { recursive: true, force: true })),
  )
}

async function installDesktopUpdate() {
  const { update, file } = desktopUpdateState
  if (!update || !file || desktopUpdateState.status !== 'ready') return
  setDesktopUpdateState('installing', { update, file })

  try {
    if (process.platform === 'linux' && file.endsWith('.AppImage')) {
      await replaceCurrentAppImage(file)
      return
    }

    if (process.platform === 'win32') {
      const openError = await shell.openPath(file)
      if (openError) throw new Error(openError)
      quitApplication()
      return
    }

    const openError = await shell.openPath(file)
    if (openError) throw new Error(openError)
    setDesktopUpdateState('ready', { update, file })
  } catch (error) {
    console.error('[desktop-update] install failed', error)
    setDesktopUpdateState('ready', { update, file, error })
    await showMessageBox({
      type: 'error',
      title: '无法安装更新',
      message: '无法打开桌面端更新',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

async function promptDesktopUpdate() {
  if (desktopUpdatePrompt) return desktopUpdatePrompt
  const { update, file } = desktopUpdateState
  if (!update || !file || desktopUpdateState.status !== 'ready') return

  const version = update.manifest.version
  const installLabel =
    process.platform === 'linux' && file.endsWith('.AppImage')
      ? '重启并更新'
      : process.platform === 'win32'
        ? '退出并安装'
        : '打开安装包'

  desktopUpdatePrompt = showMessageBox({
    type: 'info',
    title: '桌面端更新已就绪',
    message: `DeepSeek Harness Desktop v${version} 已下载并通过完整性校验。`,
    detail:
      process.platform === 'darwin'
        ? '打开 DMG 后，请将新版本拖入“应用程序”文件夹完成更新。'
        : '现在安装，或稍后从系统托盘菜单继续。',
    buttons: [installLabel, '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
    .then(({ response }) => {
      if (response === 0) return installDesktopUpdate()
    })
    .finally(() => {
      desktopUpdatePrompt = null
    })
  return desktopUpdatePrompt
}

async function checkForDesktopUpdate({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) {
      await showMessageBox({
        type: 'info',
        title: '桌面端更新',
        message: '开发模式不会检查桌面端更新。',
      })
    }
    return
  }
  if (desktopUpdateState.status === 'ready') {
    if (manual) await promptDesktopUpdate()
    return
  }
  if (desktopUpdateCheck) return desktopUpdateCheck

  desktopUpdateCheck = (async () => {
    setDesktopUpdateState('checking', { update: null, file: null })
    try {
      const update = await fetchAvailableUpdate({
        fetchImpl: electronNet.fetch,
        currentVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        isAppImage: Boolean(process.env.APPIMAGE),
      })
      if (!update) {
        setDesktopUpdateState('current', { update: null, file: null })
        if (manual) {
          await showMessageBox({
            type: 'info',
            title: '桌面端更新',
            message: `当前已是最新版本 v${app.getVersion()}。`,
          })
        }
        return
      }

      setDesktopUpdateState('downloading', { update, file: null, progress: 0 })
      const updatesRoot = path.join(app.getPath('userData'), 'updates')
      const versionDirectory = `v${update.manifest.version}`
      const destination = path.join(
        updatesRoot,
        versionDirectory,
        update.asset.name,
      )
      const file = await downloadReleaseAsset({
        fetchImpl: electronNet.fetch,
        asset: update.asset,
        destination,
        onProgress: ({ received, total }) => {
          const progress = total ? Math.min(100, Math.round((received / total) * 100)) : null
          setDesktopUpdateState('downloading', { update, progress })
        },
      })
      try {
        await removeOldDesktopUpdates(updatesRoot, versionDirectory)
      } catch (error) {
        console.warn('[desktop-update] unable to remove old downloads', error)
      }
      setDesktopUpdateState('ready', { update, file, progress: 100 })
      await promptDesktopUpdate()
    } catch (error) {
      console.warn('[desktop-update] check failed', error)
      setDesktopUpdateState('error', { update: null, file: null, error })
      if (manual) {
        await showMessageBox({
          type: 'error',
          title: '检查更新失败',
          message: '暂时无法检查桌面端更新。',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      desktopUpdateCheck = null
    }
  })()
  return desktopUpdateCheck
}

function scheduleDesktopUpdates() {
  desktopUpdateTimeout = setTimeout(() => {
    void checkForDesktopUpdate()
  }, 5_000)
  desktopUpdateInterval = setInterval(() => {
    void checkForDesktopUpdate()
  }, UPDATE_CHECK_INTERVAL_MS)
  desktopUpdateTimeout.unref()
  desktopUpdateInterval.unref()
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
  const updateBusy = ['checking', 'downloading', 'installing'].includes(desktopUpdateState.status)
  return Menu.buildFromTemplate([
    {
      label: '在默认浏览器中打开',
      enabled: Boolean(harnessOrigin),
      click: () => {
        if (harnessOrigin) void shell.openExternal(`${harnessOrigin}/`)
      },
    },
    { type: 'separator' },
    {
      label: desktopUpdateMenuLabel(),
      enabled: !updateBusy,
      click: () => {
        if (desktopUpdateState.status === 'ready') void promptDesktopUpdate()
        else void checkForDesktopUpdate({ manual: true })
      },
    },
    { type: 'separator' },
    { label: '重启', click: restartApplication },
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
    autoHideMenuBar: process.platform === 'win32',
    backgroundColor: '#0a0a0a',
    title: 'DeepSeek Harness Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.platform === 'win32') mainWindow.removeMenu()

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
    const applicationMenu =
      process.platform === 'darwin' ? Menu.buildFromTemplate([]) : null
    Menu.setApplicationMenu(applicationMenu)
    createTray()
    createWindow()
    scheduleDesktopUpdates()
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
  if (desktopUpdateTimeout) clearTimeout(desktopUpdateTimeout)
  if (desktopUpdateInterval) clearInterval(desktopUpdateInterval)
  nativeTheme.removeListener('updated', updateTrayTheme)
  stopHarness()
})
