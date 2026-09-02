'use strict'

/**
 * dsh-electron-shell — 把 DeepSeek Harness 的 Web GUI 包成桌面窗口。
 *
 * 职责边界（外挂壳路线，零侵入 harness 源码）：
 *   1. 以独立 Node 子进程方式启动已构建的 `dsh web` 服务（--no-open，端口可控）
 *   2. 轮询服务就绪后，用 BrowserWindow 加载 GUI
 *   3. 窗口/应用退出时回收服务子进程
 *
 * 开发模式前置：仓库根目录已完成 `pnpm install` 和 `pnpm run build`
 * （本壳直接运行构建产物 apps/cli/lib/bin.js）。
 */

const { app, BrowserWindow, dialog, Menu } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { guardBrokenPipe } = require('./broken-pipe-guard.js')
const { formatWindowTitle } = require('./window-title.js')

// 输出管道对端关闭时 console 写入会抛 EPIPE 并被当成主进程未捕获异常弹窗；吞掉它。
guardBrokenPipe(process.stdout)
guardBrokenPipe(process.stderr)

/**
 * 开发模式：直接引用 fork 仓库的构建产物（上一级目录）。
 * 打包模式：服务运行时整体在 resources/runtime（assemble-runtime.mjs 产物），
 * 并自带 node.exe，不要求目标机器装 Node。
 */
const isPackaged = app.isPackaged
/** fork 仓库根目录（仅开发模式使用）。 */
const REPO_ROOT = path.resolve(__dirname, '..')
/** 运行时根：开发模式是仓库布局；打包模式是 extraResources/runtime。 */
const RUNTIME_ROOT = isPackaged ? path.join(process.resourcesPath, 'runtime') : REPO_ROOT
/** 已构建的 dsh CLI 入口。 */
const CLI_BIN = isPackaged
  ? path.join(RUNTIME_ROOT, 'lib', 'bin.js')
  : path.join(RUNTIME_ROOT, 'apps', 'cli', 'lib', 'bin.js')

/**
 * 解析用于跑服务的 Node 可执行文件。
 * 打包模式必须用运行时自带的 Node，不依赖目标机器 PATH；
 * Electron 内置 Node 版本不保证满足 DSH engines（^22.19 || >=24），不用。
 */
function resolveNodeExe() {
  if (!isPackaged) return process.platform === 'win32' ? 'node.exe' : 'node'
  const bundled = process.platform === 'win32'
    ? path.join(RUNTIME_ROOT, 'node.exe')
    : path.join(RUNTIME_ROOT, 'node')
  if (!fs.existsSync(bundled)) {
    dialog.showErrorBox('缺少内置 Node', `打包产物缺 ${bundled}；请重新执行 pnpm assemble 再打包。`)
    app.quit()
    return null
  }
  return bundled
}

/** 服务绑定地址。 */
const HOST = '127.0.0.1'
/** 监听端口；默认避开原版 DSH 的 3080，可用环境变量 DSH_SHELL_PORT 覆盖。 */
const PORT = Number.parseInt(process.env.DSH_SHELL_PORT ?? '3081', 10)
const BASE_URL = `http://${HOST}:${PORT}`

/** 就绪轮询间隔与总超时：harness 冷启动可能较慢，给足余量。 */
const POLL_INTERVAL_MS = 300
const READY_TIMEOUT_MS = 120_000

let serverProc = null
let mainWindow = null
let quitting = false

/** 启动 DSH web 服务子进程。 */
function startServer() {
  if (!fs.existsSync(CLI_BIN)) {
    dialog.showErrorBox(
      'DSH 尚未构建',
      isPackaged
        ? `打包产物不完整：\n${CLI_BIN}\n\n请重新执行 pnpm assemble 后再打包。`
        : `找不到构建产物：\n${CLI_BIN}\n\n请先在仓库根目录执行：\n  pnpm install\n  pnpm run build`,
    )
    app.quit()
    return null
  }

  const nodeExe = resolveNodeExe()
  if (nodeExe === null) return null

  const child = spawn(
    nodeExe,
    [CLI_BIN, 'web', '--no-open', '--port', String(PORT)],
    {
      cwd: RUNTIME_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )

  const forward = (stream, pipe) => {
    stream.setEncoding('utf8')
    let rest = ''
    stream.on('data', (chunk) => {
      rest += chunk
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) pipe(line)
    })
  }
  forward(child.stdout, (line) => console.log(`[dsh] ${line}`))
  forward(child.stderr, (line) => console.error(`[dsh] ${line}`))

  child.on('exit', (code) => {
    console.log(`[dsh] server exited with code ${code}`)
    if (!quitting && code !== 0 && code !== null) {
      dialog.showErrorBox('DSH 服务异常退出', `dsh web 进程退出码 ${code}。\n详情见启动它的终端日志。`)
      app.quit()
    }
  })

  return child
}

/** 强制结束服务进程树（Windows 上子进程可能有孙进程）。 */
function stopServer() {
  if (serverProc === null || serverProc.exitCode !== null) return
  const pid = serverProc.pid
  serverProc.kill()
  // 兜底：5 秒后仍在则按进程树强杀（Windows）。
  const timer = setTimeout(() => {
    if (process.platform === 'win32') {
      spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else if (serverProc !== null && serverProc.exitCode === null) {
      serverProc.kill('SIGKILL')
    }
  }, 5000)
  timer.unref()
}

/** 轮询直到 web 服务可访问或超时。 */
function waitForServer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume()
        // 任何 HTTP 响应都视为就绪（静态资源已可服务）。
        resolve(res.statusCode ?? 0)
      })
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`等待 ${url} 就绪超时（${Math.round(timeoutMs / 1000)}s）`))
        } else {
          setTimeout(attempt, POLL_INTERVAL_MS).unref()
        }
      })
    }
    attempt()
  })
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 600,
    title: formatWindowTitle(HOST, PORT),
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    backgroundColor: '#111111',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 自用调试口：F12 切换开发者工具，开发和打包版都启用。
  // before-input-event 只在窗口聚焦时触发，不会抢占系统全局 F12。
  // 菜单栏已通过 Menu.setApplicationMenu(null) 移除，原默认菜单附带的
  // 快捷键在这里手动保留：Ctrl+R / Ctrl+Shift+R 刷新、Ctrl+Shift+I
  // 开发者工具、F11 全屏、Ctrl+0/=/- 缩放、Ctrl+W 关闭、Ctrl+Q 退出。
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const ctrl = input.control || input.meta
    if (input.key === 'F12' || (ctrl && input.shift && key === 'i')) {
      win.webContents.toggleDevTools()
    } else if (ctrl && input.shift && key === 'r') {
      win.webContents.reloadIgnoringCache()
    } else if (ctrl && !input.shift && key === 'r') {
      win.webContents.reload()
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
    } else if (ctrl && !input.shift && key === '0') {
      win.webContents.setZoomLevel(0)
    } else if (ctrl && !input.shift && (key === '=' || key === '+')) {
      win.webContents.setZoomLevel(Math.min(3, win.webContents.getZoomLevel() + 0.5))
    } else if (ctrl && !input.shift && key === '-') {
      win.webContents.setZoomLevel(Math.max(-3, win.webContents.getZoomLevel() - 0.5))
    } else if (ctrl && !input.shift && key === 'w') {
      win.close()
    } else if (ctrl && !input.shift && key === 'q') {
      app.quit()
    }
  })

  // 窗口标题固定携带监听地址，避免被页面 document.title 覆盖。
  win.on('page-title-updated', (event) => {
    event.preventDefault()
    win.setTitle(formatWindowTitle(HOST, PORT))
  })

  win.once('ready-to-show', () => win.show())

  try {
    await waitForServer(`${BASE_URL}/`, READY_TIMEOUT_MS)
    await win.loadURL(BASE_URL)
  } catch (error) {
    dialog.showErrorBox('无法连接 DSH 服务', error instanceof Error ? error.message : String(error))
    app.quit()
  }

  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 移除 Electron 默认应用菜单栏（File/Edit/View/Window/Help）。
  // 该菜单栏对 web 界面无实际用途，且在 Windows 上按 Alt 会误触弹出。
  // 原默认菜单附带的快捷键（刷新 / 全屏 / 缩放 / 关闭等）在下方
  // before-input-event 中手动保留，功能不变。
  Menu.setApplicationMenu(null)

  app.whenReady().then(async () => {
    serverProc = startServer()
    if (serverProc === null) return
    mainWindow = await createWindow()
  })

  app.on('window-all-closed', () => {
    quitting = true
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    stopServer()
  })
}
