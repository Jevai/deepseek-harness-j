'use strict'

/**
 * dsh-electron-shell — 把 DeepSeek Harness 的 Web GUI 包成桌面窗口。
 *
 * 职责边界（外挂壳路线，零侵入 harness 源码）：
 *   1. 以系统 Node 子进程方式启动已构建的 `dsh web` 服务（--no-open，端口可控）
 *   2. 轮询服务就绪后，用 BrowserWindow 加载 GUI
 *   3. 窗口/应用退出时回收服务子进程
 *
 * 前置条件：仓库根目录已完成 `corepack pnpm install` 和
 * `corepack pnpm run build`（本壳直接运行构建产物 apps/cli/lib/bin.js）。
 */

const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

/** fork 仓库根目录（electron-shell 的上一级）。 */
const REPO_ROOT = path.resolve(__dirname, '..')
/** 已构建的 dsh CLI 入口。 */
const CLI_BIN = path.join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')

/** 服务绑定地址；与 web profile 默认一致。 */
const HOST = '127.0.0.1'
/** 监听端口；可用环境变量 DSH_SHELL_PORT 覆盖。 */
const PORT = Number.parseInt(process.env.DSH_SHELL_PORT ?? '3080', 10)
const BASE_URL = `http://${HOST}:${PORT}`

/** 就绪轮询间隔与总超时：harness 冷启动可能较慢，给足余量。 */
const POLL_INTERVAL_MS = 300
const READY_TIMEOUT_MS = 120_000

let serverProc = null
let mainWindow = null
let quitting = false

/**
 * 启动 DSH web 服务子进程。
 * 必须用系统 Node 而不是 Electron 自带的 Node：
 * DSH engines 要求 ^22.19 || >=24，Electron 内置 Node 版本不保证满足。
 */
function startServer() {
  if (!fs.existsSync(CLI_BIN)) {
    dialog.showErrorBox(
      'DSH 尚未构建',
      `找不到构建产物：\n${CLI_BIN}\n\n请先在仓库根目录执行：\n  corepack pnpm install\n  corepack pnpm run build`,
    )
    app.quit()
    return null
  }

  const child = spawn(
    process.platform === 'win32' ? 'node.exe' : 'node',
    [CLI_BIN, 'web', '--no-open', '--port', String(PORT)],
    {
      cwd: REPO_ROOT,
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
    title: 'DeepSeek Harness',
    show: false,
    backgroundColor: '#111111',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())
  // 防止页面标题覆盖窗口标题后缀丢失应用名（保留默认行为亦可，这里不强改）。

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
