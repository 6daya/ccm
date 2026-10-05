# CCM — Content Creation Management

CCM 0.3.0 是面向 **OpenCode V2** 的本地工作台。你在 CCM 根目录启动 `opencode`，与 Jarvis（贾维斯）沟通目标；常规分析、开发和独立验收使用已确认免费的模型，必要时才向受限只读专家提出一个有证据的判断请求。程序维护项目范围、验收合同、预算记录、恢复和私有归档。

已集成验证：OpenCode **2.0.23**、`@opencode/plugin` **2.0.23**、官方 Node Playwright MCP **0.0.83**，macOS ARM64。本版删除 Slim/V1 组合，仅支持 V2；其他 V2 版本须重新验证。真实公司模型质量、总费用和内部知识 MCP 尚未实测，Windows 尚未实机验证。

[完整新手指引](docs/getting-started.md) · [0.3.0 变更与证据](docs/release-0.3.0.md) · [架构与适配边界](docs/architecture.md) · [司内质量/费用试跑](docs/company-pilot.md) · [内部 MCP 验证](docs/internal-mcp-validation.md) · [后续计划](docs/remaining-work.md)

## 开始使用

下载 `ccm-0.3.0.zip`，或 clone 交付分支（main 仍不是交付版本）：

```sh
git clone --branch feat/harness-baseline --single-branch git@github.com:6daya/ccm.git
cd ccm
opencode
```

```text
ccm/
  .opencode/                OpenCode 的原生 Jarvis 引导入口；初始化后加载 ccm.js
  .ccm/                     本机配置、状态、回执、备份、归档与生成产物（Git 忽略）
  workspace/                独立业务仓库集合（Git 忽略，保留各自 .git）
    frontend/
    backend/
  src/ bin/ tests/ eval/    CCM 工程源码与验证，业务任务不能修改
  docs/                     使用与交付材料
```

`.ccm/` 是 CCM 私有运行目录；`.opencode/` 是宿主入口。仓库中的 `.git/` 等工具目录保留各自含义。业务代码、测试、长期文档和已核实经验放在业务仓库；正式成功任务的报告放在 `.ccm/archive/<projectId>/<runId>/`，程序自动导出，不增加模型调用。

把完整业务 checkout 放进 `workspace/`，保留独立 Git 和未提交改动。公司 provider/MCP 必须在 CCM 根目录启动时可用，子仓库的宿主配置不会自动合并。密钥沿用已有 OpenCode 安全配置，不发到聊天。

先在 `/models` 选择公司已确认免费的模型，再对默认 Jarvis 说：

> 初始化 CCM。接入 workspace/frontend 和 workspace/backend，登记为 orders-system。常规使用当前免费模型，专家先关闭。展示仓库现状、保护目录和明确验收命令，确认后应用。缺失运行时先查已有路径，再提供官方安装方案，获我确认后安装。

Jarvis 的 Markdown 定义负责首次引导；初始化后程序备份该定义并注册同名默认助手，不需要 `--agent`、@引用或切换角色。安装锁定依赖使用现有公司 registry，保留 provider 引用与 JSONC 注释；确认持久规则后应用。**退出并重新打开一次 OpenCode**，随后直接提出分析/开发目标。`/onboard` 和 `/workspace` 是可选快捷入口。

需要 Node `^22.22.2 || >=24.15.0`、pnpm、rg 和 Git。在 PATH 缺失时 Jarvis 先查已有兼容运行时；确需安装则按系统/架构查官方来源，展示版本、校验、安装/PATH 位置、精确命令与回退方案，获得原生确认再执行。初始化后使用 `harness_environment` → `harness_runtime_prepare`：无活动业务任务，一次性按序匹配命令，失败/重启撤销。初始化前没有 CCM 插件，采用原生 shell 授权和引导规则。不会静默换 registry，也不会从业务子代理安装。公司托管设备遵循公司流程。

## 日常协作

直接告诉 Jarvis 目标、项目和完成标准；它选择项目、按需澄清和派发免费角色。多个仓库的任务必须属于明确登记的项目组，活动任务冻结范围、检查和文件合同。

> 分析 orders-system 的订单链路，列出来源、责任边界和未知信息，暂不改代码。

> 为订单提交补 traceId，保留公共模块和我已有改动，按已登记命令与 Playwright MCP 验收，交付分仓改动与报告。

builder 只能写合同列出的文件；独立 verifier 运行登记检查。没有可执行检查时可先分析，编码受阻。新增仓库可以通过 `harness_register_project` 的**原生具体确认表单**登记项目/命令检查，不能修改模型、预算、已有检查或削弱保护。活动任务期间禁止登记。

V2 没有 LSP，使用业务仓库的已登记 typecheck/lint/编译命令。原生 Git 仍以 CCM 为目录；`harness_repository` 按业务仓库读取 status/diff。业务工具尚无 commit/push、PR、部署、业务依赖安装或原生 worktree 管理入口。

常见敏感文件名由业务读/搜/写/上下文/Git diff 策略拒绝；检查与 MCP 是可信执行入口，仍需公司权限管理。内部知识只向免费 scout 开放已登记的只读 MCP ID，V2 Code Mode 关闭以使用直接工具；摘录仍为 `agent-supplied`，不能自动证明真实出处。

## 中断与费用

回到原会话说“继续，先核对持久状态”。V2 子会话有 terminal idle 才能确认完成；缺失标记保留未知状态和预留额，不盲目重跑。受限专家仅走一个持久记录的 HTTP 请求，自动重试与付费辅助调用被拒绝；付费 WebSocket 尚不支持。未知账单需按公司网关核对。

```sh
node bin/cli.mjs resume
opencode --session <原主会话ID>
node bin/cli.mjs status --run <任务ID>
node bin/cli.mjs report --run <任务ID> --archive
node bin/cli.mjs reconcile --run <任务ID> --task <子任务ID> --usd <该尝试总费用> --note "网关回执摘要"
```

业务 accepted 与归档成功分别返回。已验收任务归档失败只重试导出；不重派发、不重复专家。报告是导出时费用/用量快照，实际账单与晚到用量仍可能未知。工作台估算预算不覆盖其他客户端或账户全局消费；公司网关负责硬配额。

## 验证、升级与边界

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
node eval/run.mjs --opencode /path/to/opencode-v2 --out /path/to/fresh-results
node eval/diagnose-startup.mjs --opencode /path/to/opencode-v2 --out /path/to/fresh-diagnostic
```

工程回归使用确定性模拟模型与真实 V2/Node Playwright MCP，不证明 GLM/Opus 的质量或费用。冷启动诊断每项 45 秒，使用隔离配置/本地网关，Unix 支持。V2 本机新原生缓存下已通过；全新机器的依赖安装和公司网络仍待验证，见 [启动说明](docs/cold-start.md)。模型目录向导最多等待 30 秒，避免 V2 首个空快照误判，无模型调用。

0.1/0.2.x 的 `.team-harness/` 状态保留在旧工作台。先结束/取消任务、核对账单，再在**新目录**使用 0.3.0 重新初始化。检测到旧状态会拒绝静默迁移；不重放 V1 会话，不覆盖 dirty 文件。

核心职责与宿主入口已分层，但目前只有 OpenCode V2 适配实现。其他 coding agent 需要工具/权限、模型/用量、子会话/恢复适配，不能只跳过配置读取就使用。CCM 自身迭代在独立开发任务中复现问题、最小修复、验证后交付；不让业务 Jarvis 修改自己的权限。

官方依据：[V2 插件](https://opencode.ai/v2/docs/build/plugins/)、[V1 插件迁移](https://opencode.ai/v2/docs/build/plugins/migrate-v1/)、[V2 CLI](https://opencode.ai/v2/docs/cli/)、[Node Playwright MCP](https://github.com/microsoft/playwright-mcp)。
