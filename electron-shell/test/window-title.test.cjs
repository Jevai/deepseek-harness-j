'use strict'

/**
 * window-title 的行为测试：窗口标题携带监听地址（host:port），
 * 便于区分并行实例。纯 Node 内建测试，不依赖 electron。
 */

const test = require('node:test')
const assert = require('node:assert')

const { formatWindowTitle } = require('../window-title.js')

test('标题包含默认监听地址', () => {
  assert.strictEqual(formatWindowTitle('127.0.0.1', 3081), 'DeepSeek Harness — 127.0.0.1:3081')
})

test('标题包含自定义端口（DSH_SHELL_PORT 覆盖场景）', () => {
  assert.strictEqual(formatWindowTitle('127.0.0.1', 4000), 'DeepSeek Harness — 127.0.0.1:4000')
})

test('端口为字符串输入时同样正确格式化', () => {
  assert.strictEqual(formatWindowTitle('127.0.0.1', '3081'), 'DeepSeek Harness — 127.0.0.1:3081')
})

test('不同 host 按传入值呈现', () => {
  assert.strictEqual(formatWindowTitle('0.0.0.0', 3081), 'DeepSeek Harness — 0.0.0.0:3081')
})
