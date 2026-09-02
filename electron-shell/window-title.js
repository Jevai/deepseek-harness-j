'use strict'

/**
 * 生成窗口标题：携带监听地址（host:port），便于区分并行实例。
 * 纯函数，独立于 electron，便于行为测试。
 *
 * @param {string} host 服务绑定地址
 * @param {number|string} port 监听端口
 * @returns {string} 窗口标题
 */
function formatWindowTitle(host, port) {
  return `DeepSeek Harness — ${host}:${port}`
}

module.exports = { formatWindowTitle }
