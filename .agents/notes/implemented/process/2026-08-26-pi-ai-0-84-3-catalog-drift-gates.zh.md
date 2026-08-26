# Agent Note: 将 pi-ai 升级到 0.84.3 并保持 catalog drift gate 同步

Status: implemented

[English](2026-08-26-pi-ai-0-84-3-catalog-drift-gates.md) | 中文

## Problem

`dsh-llm-pi-ai` 将 `@earendil-works/pi-ai` 锁定在 `^0.82.1`，其 `opencode-go` catalog 早于 `ox-alpha-free`（免费、Unlimited，2026-08-21 发布）且携带过期的模型元数据。该模型是 OpenCode Zen Go 的真实模型，但部署无法选中它：pi-ai 直到 0.84.3 才把 `ox-alpha-free` 收录进 `opencode-go` catalog，而会替换 catalog 的每条路由 `models` 列表里也没有它。harness 自己的 `catalog.ts` 是编译 pi-ai 类型的，所以升级并非单纯的版本号提升。

## Decision

将 `packages/llm/llm-pi-ai/package.json` 中的 `@earendil-works/pi-ai` 从 `^0.82.1` 提升到 `^0.84.3`，并把 `packages/llm/llm-pi-ai/src/catalog.ts` 里的编译期 drift gate 与 0.84.3 提供的类型对齐：

- `THINKING_FORMAT_GATE` / `SUPPORTED_THINKING_FORMATS`：加入 `baseten`。
- `CHAT_TEMPLATE_VAR_GATE` / `CHAT_TEMPLATE_VARS`：加入 `thinking.budget`。
- `COMPLETIONS_COMPAT_GATE`：加入 `supportsFinishReason`、`chatTemplateArgs`、`thinkingTokenBudgetField`、`supportsThinkingTokenBudget`，全部 `withhold`。
- `RESPONSES_COMPAT_GATE`：加入 `supportsAdditionalTools`，`withhold`。
- `ANTHROPIC_COMPAT_GATE`：加入 `allowedFallbackModels`，`withhold`。

每个新增 compatibility 字段都归类为 `withhold` 而非 `offer`，因为提供一个新的 offered 字段还需增加 `PiAiCompatProfile` 成员、config schema 条目以及一个文档化的值——而这些由 vendor/catalog 拥有的开关并不需要在网关上手写配置。`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 更新为 `@earendil-works/pi-ai@0.84.3`，这正是该排除项存在以放行的、携带 catalog 更新的发行版。

升级暴露出两处 pi-ai 行为变化，harness 予以对齐：

- **调用方 abort 以 `error` 事件呈现，而非 `aborted` stop reason。** 预先 abort 的信号会让 0.84.3 发出 `stopReason: 'error'`，并把 abort-reason 字符串作为 `errorMessage`，而不是抛出或发出 `'aborted'`。`PiAiAdapter.streamWithSnapshot` 现在在请求自身信号被 abort 时，将终态 `error` finish 重映射为 `aborted`，使调用方发起的取消永远不会被报告为模型侧错误。
- **新增 `StopReason` 成员。** pi-ai 0.84.3 将 `StopReason` 扩展出 `deferred`（终态工具延迟加载）与 `pending`（非终态）。`mapStopReason` 将 `deferred` 映射为 `tool-calls`——延迟加载的工具仍以工具使用运行——而 `pending` 映射为 `EMPTY_RESPONSE` 错误，因为终态事件绝不应携带非终态状态。

该 bump 带来的 catalog 内容漂移在包的测试中更新：`deepseek` catalog 现在为 `deepseek-v4-flash` 提供 `low`（受支持级别从 `off/high/max` 变为 `off/low/high/max`），该模型的 wire 输出上限字段现为 `max_tokens`，且 `xai` 仅提供 `openai-responses`（不再是 completions+responses 混合 catalog），因此混合路由 switch fixture 移至 `opencode`。

## Alternatives considered

**将 pi-ai 保持在 0.82.1，并通过手写的单协议专用路由描述 `ox-alpha-free`。** 这样无需依赖升级也能加入该模型，并且可行；但它会重复路由（选择器多显示一个 provider），并让该 vendor 后续每次 catalog 新增都一直无法映射，直到某次后续 bump 追赶。现在做这次 bump，让整个已安装 catalog（含 `ox-alpha-free` 及任何新增兄弟模型）自动服务，在 catalog 层而非设置文档层得到解析。

## Consequences

运行中的部署必须重启 dsh 才能加载升级后的 catalog 与重建的 `lib`；一旦加载，`ox-alpha-free`（以及 0.84.3 新增的任何 catalog 模型）会在 `opencode-go` 下出现，并带其 catalog 端点、容量与推理级别，那次变通所用的独立单协议路由则从设置文档中移除。

代价是 harness 现在针对更新的 pi-ai 面编译：未来 drift gate 点名的每个 pi-ai 类型新增（一种 modality、一种 thinking format、一个 compat 字段）都会在分类前导致编译失败，这正是这些 gate 早已接受的取舍——只是名称集合变了。abort/stop-reason 对齐让调用方发起的取消继续报告为 `aborted`、延迟工具加载继续作为工具使用运行，符合 harness 词汇，而非把 pi-ai 的 `error`/`pending`/`deferred` 拼写泄漏进 seam。
