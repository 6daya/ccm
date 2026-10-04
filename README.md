# CCM — Content Creation Management

在官方 OpenCode CLI 中正常对话，由免费主代理拆任务，免费子代理检索、设计、实现和验收；必要时把一个有限决策交给付费专家。用户仍只与主代理沟通。浏览器验证使用官方 **Node Playwright MCP**，不使用 Python MCP，也不要求用户手动操作 Chrome。

已验证组合：OpenCode **1.18.34**、Slim **3.0.2**、Playwright MCP **0.0.83**，macOS ARM64。Windows 做了路径、命令和落盘兼容处理，但尚未实机验证。真实 GLM/Opus 质量与费用尚未实测。

> 当前是 harness 基线与 onboarding 原型。推荐的统一 Jarvis 协作架构见 [设计决策](docs/ccm-collaboration.md)，其中标为待实现的能力尚未上线。

## 开始使用

把解压后的工程本身作为团队工作区。无需单独建立“工程目录”和“工作目录”，也不用记安装/init 命令：

```sh
cd /path/to/ccm
opencode
```

打开后默认助手是 **Jarvis（贾维斯）**，直接说“初始化这个工作区”。首次使用的当前模型由公司既有 OpenCode 配置决定；可先通过 `/models` 选择已配置的免费模型。Jarvis 会分步询问模型、仓库、内部 MCP 和验收规则，替你安装依赖、生成配置并调用校验脚本。`/onboard` 是可选快捷入口；Markdown agent 和启动配置在没有 `node_modules` 时也能被 OpenCode 识别。

需要已有公司 OpenCode provider、Node 24.15+（或 Node 22.22.2+）、pnpm 和 ripgrep。依赖安装使用现有公司 registry，不切换公共源、不安装系统软件。向导不会询问 API key。免费模型未知之前，启动向导的当前模型由 OpenCode 的选择决定，不能提前保证免费。

首次配置完成后退出并重新打开一次 `opencode`，编排插件在启动时加载。之后仍由默认 Jarvis 接待，直接描述业务任务或询问项目规则，不需要 `--agent` 或切换 agent。**`/workspace`** 可作为检查模型、规则和验收缺失项的快捷入口，仍使用 Jarvis；配置解释是只读的，业务执行通过 harness 的受控子任务完成。

首次向导会展示要持久化的保护边界、预算及具体验收命令，请你确认后才应用。仓库已有的 AGENTS.md/package.json 用来提出规则和检查候选；不会自动执行未知脚本，也不会将脚本名称当作验证通过。现阶段已初始化后的 `/workspace` 能解释规则并提出修改建议，**尚不能对话式应用配置更新或自动管理 Git worktree**。

模型 ID 来自 `opencode models`，不根据 GLM/Opus 显示名猜测。所有工作角色初始使用同一个确认免费的模型；可选专家需填写公司网关价格，默认关闭。

已有公司网关、API key 引用及内部 MCP 定义保留在 OpenCode 配置中；凭据继续交给 OpenCode 管理，CLI 不要求另填 key，任务状态不保存 key。初始化完整备份原项目配置（若原文件直接写了 key，备份也会包含它），并保留 JSONC 注释。已有另一个编排插件或冲突配置时，会要求使用一个干净的项目 profile，避免两套调度器。

随后在工作目录运行：

```sh
opencode
```

正常输入，例如：

> 分析 web、orders、payments 仓库，解释订单链路、责任边界和告警归属，列出来源和不确定项。默认使用免费模型，仅对有证据的关键歧义升级专家。

> 给订单页面补可观测，先确认公共模块与业务模块边界，完成代码修改和 Playwright MCP 验证。缺少验收目标时先澄清。

主代理会通过 `question` 澄清关键业务缺口。CLI 的 TUI 支持该交互；非交互 `opencode run` 不适合作为需要用户回答的入口。

保留原有命令行初始化作为脚本/高级入口：

```sh
pnpm install --frozen-lockfile --ignore-scripts
node bin/cli.mjs init --workspace /absolute/path/to/workspace
node bin/cli.mjs doctor --workspace /absolute/path/to/workspace
```

若将工程本身初始化为工作区，plugin shim 使用相对导入。仓库 roots、浏览器命令和 Node 路径仍可能是机器绝对路径；迁移机器时要重新核对，不能把运行配置当作完全可搬移的模板。

## 一次性登记项目边界和验收

配置位于工作目录 `.team-harness/config.json`。模型可以选任务与证据，不能修改该文件或验收脚本。需要先由你登记项目规则，避免免费主代理自行放宽边界。

- `roots`：允许读取的绝对仓库根目录，可跨仓。
- `mcpIds`：允许 scout 使用的内部知识 MCP 配置 ID。
- `protectedWriteRoots`：公共模块等默认禁止修改的绝对路径；连主代理也不能授予例外。
- `checks`：受信任的命令或 MCP 验收步骤。
- `requiredBuilderChecks`：所有代码任务必须包含的检查 ID。
- `browserOrigins`：浏览器导航允许的 origin。

命令检查使用参数数组，不执行任意 shell。例如：

```json
{
  "id": "unit",
  "cwd": "/work/web",
  "argv": ["node", "scripts/acceptance.mjs"],
  "timeoutMs": 60000
}
```

Windows 推荐 `node` + JS 入口，避免把 `npm.cmd` / `npx.cmd` 当普通可执行文件跨平台调用。路径通过 Node 的 `path`/`fileURLToPath` 处理；JSON 中的 Windows 路径需要转义反斜线，也可以使用正斜线。本版本尚不支持 Windows UNC 仓库作为已验证组合。

没有检查配置时可以做分析；builder 会被阻止开始代码修改。根目录建议使用一个覆盖日常仓库的统一工作目录，预算和状态便于共享。

## Playwright MCP

安装的 MCP 是 npm 包 `@playwright/mcp@0.0.83`。用 Node 启动，不使用 Python：

```sh
node node_modules/@playwright/mcp/cli.js --headless --isolated --no-webmcp
```

已有公司的同类 MCP 可以直接复用。配置的 MCP ID 使用字母、数字或下划线。登记 `type: "mcp"` 的检查后，harness 只向独立 verifier 开放步骤所需的工具；它先调用 `harness_check` 获取固定步骤，然后逐步调用原生 MCP。程序检查工具名、参数、顺序、实际回执和文件 digest。模型的“通过”文字不能替代回执。

新项目 `init` 发现 Playwright 检查且没有 `mcp.playwright` 时，会生成 Node 本地启动配置；已有定义保持不变。MCP 管理浏览器进程。浏览器二进制需由你的开发环境/内网镜像预装；可以在已有 MCP 配置中指定 executable-path 或远端浏览器端点。

通用例子在 `eval/case-server.mjs` 的 `browserCheck()`：导航 → 按选择器点击 → 页面/接收端断言 → 截图。使用 `browser_click` 和 `browser_evaluate`，没有开放服务器进程中的任意代码执行。不同页面按项目约定登记对应套件；本版本不让模型随意改写验收步骤。公司的 agent.md 可以作为业务测试规范的来源输入，再由你登记需要执行的检查。

浏览器 origin 配置是操作范围控制，并不替代公司网络隔离；注册的命令和 MCP 步骤属于你信任的测试代码。

## 中断、状态、输入输出

```sh
node bin/cli.mjs status --workspace /work/team
node bin/cli.mjs resume --workspace /work/team
node bin/cli.mjs report --workspace /work/team --out /work/team/report.md
```

`resume` 显示原主会话 ID。用 `opencode --session <ID>` 打开它，直接说“继续”。主代理读取持久化状态，并与 OpenCode 的实时子会话状态、消息结果核对。已完成工作不盲目重跑。

`.team-harness/state.json` 保存逻辑任务、每次 attempt、依赖、范围、证据、用量、预算预留和状态变化。`receipts/` 保留每次子代理的原始输出。主代理的状态工具返回简要结果；需要详情再读取切片，避免把所有子会话完整历史交给专家。

付费请求中断且账单不明时，保留预留额并阻止重试。按网关账单人工核对：

```sh
node bin/cli.mjs reconcile --workspace /work/team --run RUN_ID --task TASK_ID --usd TOTAL --note "gateway receipt ..."
```

TOTAL 是该 attempt 的总费用，不是追加费用。确认后才允许重试。取消可直接告诉主代理；CLI `cancel` 是离线停止标记，在线主代理还会 abort 子会话。无法保证供应商立即停止在途计费。

程序使用文件锁、fsync 和原子替换保存状态；Windows 跳过不受支持的目录 fsync。死进程留下锁时 `doctor --repair-lock` 仅删除确认不存在的进程锁。代码文件写入与账本并非跨文件事务；崩溃后可能需要重新核对已落盘文件，程序会保留外部改动而不是强行覆盖。

## 调度与预算

固定：模型价格、内部来源、公共模块保护、必做检查、每任务精确文件范围、最大尝试次数、并发、预算、不可递归派发。

动态：任务拆分、证据选择、免费角色、是否澄清、是否提出专家升级。模型提出，程序检查。专家必须带新鲜证据和明确原因，不能搜索、写代码或继续派发；最多一次输出 4000 token。普通工作与默认验收都走免费模型。

本版本只有 free / expert 两个槽，专家只读。尚未实现三级模型链、专家编码、持久后台 DAG 调度或知识库自动发布。这是可执行的受控基线，并非之前概念设计中所有扩展项。

预算记录覆盖本工作目录中的任务和已观测用量，使用配置价格估算，不能看见同一 API key 在其他工具或工作目录的消费。预算预留与输出上限不能保证硬美元封顶；硬配额仍应在公司网关设置。内部免费模型需由你确认确实免费。

## 复现验证

```sh
pnpm test
node eval/run.mjs --opencode /path/to/opencode --real-playwright-mcp --out /path/to/results
```

默认提供可复现模型测试网关，**不是实际 LLM**；浏览器是真正的官方 Node Playwright MCP。模型决策和 token 用量在这项回归中是脚本注入，不代表 GLM/Opus 能力或真实费用。它验证的是工程链路。

无需浏览器的协议回归：

```sh
node eval/run.mjs --opencode /path/to/opencode --mcp-fixture --out /path/to/results
```

`mcp-fixture` 明确使用协议夹具和 jsdom，不能当浏览器实测。真实远端 MCP 可传 `--playwright-mcp-url URL`，端点需能访问本地 fixture 页面；远端机器应改为其可达的测试地址。

两个任务的定义、评估结果与模型对比验收方法见 `docs/acceptance.md` 和交付的评估报告。

依赖依据：[OpenCode](https://github.com/anomalyco/opencode)、[Slim](https://github.com/alvinunreal/oh-my-opencode-slim)、[官方 Playwright MCP](https://github.com/microsoft/playwright-mcp)。依赖已锁定，不运行自动升级或公共检索 MCP。
