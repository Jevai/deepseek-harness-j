# dsh-electron-shell

把 DeepSeek Harness 的 Web GUI 包成桌面窗口的 Electron 外挂壳。

零侵入：不改 harness 任何源码，只负责「起服务 + 开窗口 + 收进程」。

## 前置条件（开发模式）

1. Node ≥ 22.19（或 ≥ 24），pnpm
2. 仓库根目录完成安装与构建：

```powershell
corepack pnpm install        # 或 pnpm install --pm-on-fail=ignore
corepack pnpm run build
```

## 启动（开发模式）

```powershell
cd electron-shell
pnpm install     # 首次；独立于主仓库 workspace，自装 Electron
pnpm start
```

窗口打开即代表 `dsh web` 服务就绪并已加载 GUI。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_SHELL_PORT` | `3081` | 服务监听端口（默认避开原版 DSH 的 3080） |

## 打安装包

```powershell
pnpm run dist    # 组装自包含运行时 + electron-builder 出 NSIS 安装包
```

产物在 `release/`：`DeepSeek Harness Setup <版本>.exe` 与免安装版 `win-unpacked/`。
打包版自带 Node 与全部运行时，目标机器无需任何环境。

## 工作方式

1. 以独立 Node 子进程运行构建产物 `apps/cli/lib/bin.js web --no-open`
   （开发模式用系统 Node；打包模式用运行时自带的 node.exe——
   Electron 内置 Node 版本不满足 DSH engines 要求，不用）
2. 轮询 `http://127.0.0.1:<port>/` 直到可访问（上限 120s）
3. `BrowserWindow` 加载 GUI；应用退出时回收服务进程树

改了 harness 源码后：重新 `corepack pnpm run build`，再重启壳即可；
要更新安装包则再跑一次 `pnpm run dist`。

## 应用图标

`build/icon.ico`（16–256 多尺寸）与 `build/icon.png`（256×256）取自
DeepSeek 官网 favicon 的鲸鱼帧（225×225 原图 lanczos 放大至 256），
版权归 DeepSeek 所有，仅用于本自用壳。开发模式窗口图标由 `main.js`
引用 `build/icon.png`；打包图标由 `electron-builder.yml` 的 `win.icon`
引用 `build/icon.ico`（NSIS 安装器与 exe 同源）。
