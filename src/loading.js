const message = document.querySelector('#message')
const detail = document.querySelector('#detail')
const progressTrack = document.querySelector('#progress-track')
const progressBar = document.querySelector('#progress-bar')
const progressLabel = document.querySelector('#progress-label')
const progressValue = document.querySelector('#progress-value')
const retry = document.querySelector('#retry')
const stages = [...document.querySelectorAll('.stage')]

// Let the shell paint before compiling the decorative WebGL scenes. Starting
// those scenes during HTML evaluation used to make the entry animations miss
// their first frames on slower GPUs.
window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    document.body.classList.add('is-shell-ready')
    window.dispatchEvent(new CustomEvent('startup-shell-ready'))
  })
})

function resolveStage(status) {
  const text = `${status.message || ''} ${status.detail || ''}`
  if (/已启动|界面|等待 Harness|本地端口|Web UI/i.test(text)) return 3
  if (/准备 DeepSeek Harness|安装或读取缓存|插件|依赖/i.test(text)) return 2
  if (/Harness 更新|npm 官方|版本|联网检查/i.test(text)) return 1
  return 0
}

function updateStages(currentStage, status) {
  stages.forEach((stage, index) => {
    const isCurrent = index === currentStage
    const isComplete = index < currentStage || (/已启动/.test(status.message || '') && index <= currentStage)
    const state = stage.querySelector('.stage-state')

    stage.classList.toggle('is-current', isCurrent && !isComplete)
    stage.classList.toggle('is-complete', isComplete)
    stage.classList.toggle('has-stage-error', Boolean(status.error) && isCurrent)

    if (state) {
      state.textContent = isComplete ? '完成' : isCurrent ? (status.error ? '异常' : '进行中') : '等待'
    }
  })
}

function renderStatus(status) {
  const currentStage = resolveStage(status)
  const safeProgress =
    typeof status.progress === 'number' ? Math.max(0, Math.min(100, status.progress)) : null

  message.textContent = status.message || '正在启动 DeepSeek Harness'
  detail.textContent = status.detail || ''
  progressLabel.textContent = status.error ? '启动中断' : safeProgress === 100 ? '即将就绪' : '初始化中'
  progressValue.textContent = safeProgress === null ? '···' : `${Math.round(safeProgress)}%`
  document.body.classList.toggle('has-error', Boolean(status.error))
  document.body.dataset.stage = String(currentStage)
  retry.hidden = !status.error
  updateStages(currentStage, status)

  if (safeProgress !== null) {
    progressTrack.classList.add('is-determinate')
    progressTrack.setAttribute('aria-valuenow', String(safeProgress))
    progressBar.style.width = `${safeProgress}%`
  } else {
    progressTrack.classList.remove('is-determinate')
    progressTrack.removeAttribute('aria-valuenow')
    progressBar.style.width = ''
  }
}

if (window.desktopRuntime) {
  window.desktopRuntime.onStatus(renderStatus)

  retry.addEventListener('click', async () => {
    retry.disabled = true
    await window.desktopRuntime.retry()
    retry.disabled = false
  })
} else {
  const demoState = new URLSearchParams(window.location.search).get('demo')
  const demos = {
    environment: {
      message: '正在检查运行环境',
      detail: '查找兼容的 Node.js 与 npx，并识别当前系统架构。',
    },
    update: {
      message: '正在检查 Harness 更新',
      detail: '正在连接 npm 官方软件源并同步最新可用版本。',
    },
    install: {
      message: '正在准备 DeepSeek Harness',
      detail: '安装或读取本地缓存：@deepseek-ai/dsh@latest',
      progress: 68,
    },
    ready: {
      message: '正在等待 Harness 界面',
      detail: '本地服务已启动，正在连接 Web UI。',
      progress: 92,
    },
    error: {
      message: '启动失败',
      detail: 'Harness 在规定时间内未能启动，请检查网络连接后重试。',
      error: true,
    },
  }

  renderStatus(demos[demoState] || demos.install)
  retry.addEventListener('click', () => renderStatus(demos.environment))
}
