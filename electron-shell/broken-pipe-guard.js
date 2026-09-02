'use strict'

/**
 * 让流忽略 EPIPE（broken pipe）错误，其余错误照常抛出。
 *
 * 主进程把 `dsh web` 子进程的 stdout/stderr 转发到自己的 stdout/stderr。当本进程
 * 输出管道的对端已经关闭（例如从终端直接 `electron .` 启动、终端句柄随后失效），
 * 写入会抛 `Error: EPIPE: broken pipe, write`，被 Electron 当作主进程未捕获异常
 * 并弹出 "A JavaScript error occurred in the main process" 对话框。管道断开只表示
 * 没人再看这些转发日志，窗口本身仍正常工作，所以这里静默吞掉 EPIPE；其他错误
 * 必须继续抛出，避免掩盖真实故障。
 *
 * @param {NodeJS.EventEmitter} stream 需要容错的流，例如 process.stdout / process.stderr。
 * @returns {void}
 */
function guardBrokenPipe(stream) {
  stream.on('error', (error) => {
    if (error?.code !== 'EPIPE') throw error
  })
}

module.exports = { guardBrokenPipe }
