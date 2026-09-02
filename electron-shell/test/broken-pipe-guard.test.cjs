'use strict'

/**
 * broken-pipe-guard 的行为测试：只用 Node 内建的 node:test / node:assert，
 * 不依赖 electron（main.js 需要 electron，这里刻意不加载它）。
 */

const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')

const { guardBrokenPipe } = require('../broken-pipe-guard.js')

/** 造一个带 code 的 Error。 */
function errWithCode(message, code) {
  return Object.assign(new Error(message), { code })
}

test('EPIPE 错误被静默吞掉', () => {
  const stream = new EventEmitter()
  guardBrokenPipe(stream)

  assert.doesNotThrow(() => stream.emit('error', errWithCode('write EPIPE', 'EPIPE')))
})

test('非 EPIPE 错误照常抛出', () => {
  const stream = new EventEmitter()
  guardBrokenPipe(stream)
  const error = errWithCode('too many open files', 'EMFILE')

  assert.throws(() => stream.emit('error', error), (thrown) => thrown === error)
})

test('无 code 的普通 Error 照常抛出', () => {
  const stream = new EventEmitter()
  guardBrokenPipe(stream)
  const error = new Error('something else broke')

  assert.throws(() => stream.emit('error', error), (thrown) => thrown === error)
})
