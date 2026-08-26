'use strict'

/**
 * electron-builder afterPack 钩子：把组装好的 runtime/ 拷进包内 resources。
 *
 * 不用 extraResources 的原因：其内置过滤规则会把名为 node_modules 的目录整棵剪掉，
 * 且 FileSet.filter 的再包含模式压不过它。
 * 不用 fs.cp 的原因：runtime/node_modules 里 .pnpm 的深层路径会超 Windows 260
 * 字符限制导致 cp 中途报错；robocopy 原生处理长路径。
 */

const path = require('node:path')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')

/** @param context - electron-builder 的打包上下文。 */
exports.default = async function afterPack(context) {
  const source = path.join(__dirname, '..', 'runtime')
  const destination = path.join(context.appOutDir, 'resources', 'runtime')
  const marker = path.join(destination, 'lib', 'bin.js')

  if (!fs.existsSync(path.join(source, 'lib', 'bin.js'))) {
    throw new Error(`pack-runtime: missing assembled runtime at ${source}; run "pnpm assemble" first`)
  }
  console.log(`pack-runtime: copying ${source} -> ${destination}`)

  if (process.platform === 'win32') {
    // robocopy 退出码 0-7 都算成功（1=有文件复制）。
    const result = spawnSync('robocopy.exe', [source, destination, '/E', '/NFL', '/NDL', '/NJH', '/NJS'], {
      stdio: 'ignore',
    })
    const code = result.status ?? -1
    if (code > 7) throw new Error(`pack-runtime: robocopy failed with exit code ${code}`)
  } else {
    fs.rmSync(destination, { recursive: true, force: true })
    fs.cpSync(source, destination, { recursive: true, dereference: true })
  }

  if (!fs.existsSync(marker)) throw new Error(`pack-runtime: copy incomplete, ${marker} missing`)
  console.log('pack-runtime: done')
}
