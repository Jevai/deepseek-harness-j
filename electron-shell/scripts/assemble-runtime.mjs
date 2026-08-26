'use strict'

/**
 * 组装自包含 DSH 运行时到 electron-shell/runtime/（供 electron-builder 打包）。
 *
 * 步骤（每一步都已在 Windows 上实测通过）：
 *   1. `pnpm --filter @deepseek-ai/dsh deploy --prod --legacy` 物化 cli 及其依赖闭包
 *   2. 补齐 deploy 不覆盖的「组装事实」包：
 *      - @deepseek-ai/dsh-web-frontend（前端 dist；web-app 用 require.resolve 定位它）
 *      - vendor 直链的 peer：cordis-plugin-group / logger-console / cosmokit / schemastery
 *      - 未被 cli 直接声明、由中间层 peer 引用的：dsh-scope / dsh-timeout / dsh-sandbox
 *   3. 复制当前 Node.exe 进运行时（打包后的应用不依赖系统 PATH 里有 node）
 *
 * 用法：在仓库完成 `pnpm install && pnpm run build` 后执行 `pnpm assemble`。
 */

import { copyFileSync, cpSync, existsSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(shellDir, '..')
const out = join(shellDir, 'runtime')

/** 排除源码与测试目录，只带运行需要的产物。 */
function copyPackage(sourceRelative, packageName) {
  const source = join(repoRoot, ...sourceRelative.split('/'))
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error(`assemble: source package not found: ${source}`)
  }
  const destination = join(out, 'node_modules', '@deepseek-ai', packageName)
  cpSync(source, destination, {
    recursive: true,
    filter: (entry) => !/(^|[\\/])(node_modules|src|tests)([\\/]|$)/.test(entry),
  })
  console.log(`assemble: + ${packageName}`)
}

console.log('assemble: pnpm deploy …')
rmSync(out, { recursive: true, force: true })
execSync(`pnpm --filter @deepseek-ai/dsh deploy --prod --legacy "${out}"`, {
  cwd: repoRoot,
  stdio: 'inherit',
})

console.log('assemble: copy assembly-fact packages …')
copyPackage('apps/web', 'dsh-web-frontend')
for (const [sourceRelative, packageName] of [
  ['vendor/group', 'cordis-plugin-group'],
  ['vendor/logger-console', 'cordis-plugin-logger-console'],
  ['vendor/cosmokit', 'cosmokit'],
  ['vendor/schemastery', 'schemastery'],
  ['packages/core/scope', 'dsh-scope'],
  ['packages/util/timeout', 'dsh-timeout'],
  ['packages/sandbox/sandbox', 'dsh-sandbox'],
]) {
  copyPackage(sourceRelative, packageName)
}

console.log('assemble: bundle node.exe …')
if (process.platform === 'win32') {
  copyFileSync(process.execPath, join(out, 'node.exe'))
} else {
  // 类 Unix 上直接复制执行中的 node 二进制同样可行（同平台分发前提）。
  copyFileSync(process.execPath, join(out, 'node'))
}

console.log(`assemble: done -> ${out}`)
