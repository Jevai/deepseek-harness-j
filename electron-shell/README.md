# dsh-electron-shell

把 DeepSeek Harness 的 Web GUI 包成桌面窗口的 Electron 外挂壳。

零侵入：不改 harness 任何源码，只负责「起服务 + 开窗口 + 收进程」。

## 前置条件

1. Node ≥ 22.19（或 ≥ 24），pnpm
2. 仓库根目录完成安装与构建：

```powershell
corepack pnpm install        # 或 pnpm install --pm-on-fail=ignore
corepack pnpm run build
```

## 启动

```powershell
cd electron-shell
pnpm install     # 首次；独立于主仓库 workspace，自装 Electron
pnpm start
```

窗口打开即代表 `dsh web` 服务就绪并已加载 GUI。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_SHELL_PORT` | `3080` | 服务监听端口 |

## 工作方式

1. 以系统 Node 子进程运行构建产物 `apps/cli/lib/bin.js web --no-open`
   （不用 Electron 内置 Node：版本不满足 DSH engines 要求）
2. 轮询 `http://127.0.0.1:<port>/` 直到可访问（上限 120s）
3. `BrowserWindow` 加载 GUI；应用退出时回收服务进程树

改了 harness 源码后：重新 `corepack pnpm run build`，再重启壳即可。
