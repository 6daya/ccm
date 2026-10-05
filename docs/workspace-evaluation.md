# CCM 0.2.0 工作台交付评估

> 0.3.0 已改为 OpenCode V2；本文中的 0.1/0.2.x 版本与测试为历史记录。当前使用与限制见 [V2 交付](release-0.3.0.md)。
日期：2026-10-04。交付形态：CCM 根目录启动 OpenCode，workspace/ 放置独立业务仓库；Jarvis 统一引导与交付。设计判断与旧版差距见 [工作台设计](workspace-design.md)。

## 结论

39 项程序测试通过。两项任务通过真实 OpenCode 1.18.34、Slim 3.0.2 和官方 Node Playwright MCP 0.0.83，均从 CCM 根目录运行，业务位于 workspace 下三个独立 Git 仓库。该结果证明本地接入、项目约束、任务恢复和真实浏览器验收机制可运行。

模型使用本地脚本网关，未调用 GLM/Opus；专家输出、任务步骤及 token 用量均为夹具。因此尚未证明免费模型的对话引导、设计质量、调度准确性或相对 Opus 的费用优势。测试环境为 macOS ARM64，Windows 未实机测试。

## 本次产物

- 实现：workspace/ 布局、项目组登记、主会话项目选择、每次运行冻结的仓库与检查、按路径规则上下文、业务 Git 视图、新项目/新命令检查的授权登记。
- 引导：下载后 CCM 根目录打开 opencode，直接说初始化；浅层发现业务仓库并确认规则，首次应用后重启一次。不需要手动记住 init/install/slash command。
- 文档：README 使用指南、workspace/README 放置说明、工作台设计、旧版差距、当前报告。
- 证据：[机器摘要](validation-workspace.json)、[程序测试输出](validation-tests.txt)、下方 Playwright 截图。完整本机执行日志保留于交付工作目录的 work/evaluation-workspace-delivery/，不打包为可复用运行状态。

## 两项任务

| 任务 | 验证内容 | 结果 |
| --- | --- | --- |
| A：跨仓订单链路 | 明确选择 orders-system；从 web、orders、payments 三个独立仓库读取来源；子任务输入携带该项目；独立审查后完成 | accepted；约 3.3 秒 |
| B：可观测落地与恢复 | 故意尝试向公共 telemetry 写业务逻辑并被拒绝；一次限定专家判断；中断原主会话，恢复后不重复专家；免费槽在业务模块实现；检查在 web cwd 执行；独立 verifier 经 Playwright MCP 点击、核对真实接收端事件并截图 | accepted；第一阶段约 2.7 秒，恢复阶段约 5.8 秒（5774ms） |

耗时来自脚本网关和已缓存环境，不代表真实模型延迟。两个任务共 72 次模拟模型请求：免费槽 71 次、专家槽 1 次。其中主代理 51 次，说明合同/验收工具交互存在开销；不能用此结果宣称流程已经达到最佳效率。低风险任务的简化流程仍待实现和实测。

任务 B 的实际浏览器验收检查：一次点击只收到一个 order_submit，字段仅有 orderId、traceId；traceId 来自页面；公共 transport 未被改动。通过依据是 MCP 原始回执及接收端数据，而非模型一句“通过”。

![Playwright MCP 验收后页面：Buy / Done](evidence/orders-observability.png)

## 程序约束测试

新增测试覆盖：多项目歧义、不同主会话的项目选择、跨项目读/搜/写/检查拒绝、显式跨仓分组、CCM 源码不能成为业务范围、活动任务禁止切换或登记、规则变化拒绝旧输入派发及写入、业务 cwd、重启恢复、登记不改模型/预算/已有检查、仓库别名继承原必做检查、相对路径搬迁后的新任务、Git 根验证、watcher/snapshot 配置、空工作台和符号链接拒绝。

保留原有测试覆盖：公共模块保护、精确文件范围、外部用户改动保护、独立验收、旧 attempt 审查拒绝、付费证据/预算预留/未知账单保护、取消、缓存与推理用量估算、Playwright 固定步骤/参数/结果回执。

## 初始化与启动验证

真实 OpenCode 加载检查通过：harness node_modules 不存在时默认 Jarvis；发现 workspace/customer 的相对路径；应用保留公司式 provider 环境变量引用；重启后使用配置的免费槽，安装 shell 和配置编辑权限关闭，新增项目登记工具为 ask。

两次没有预置原生配置依赖的完整任务启动均在约 180 秒后超时，模型请求数为 0。加入 Node 到 PATH 未解决；复用此前 OpenCode 已安装的原生依赖缓存后任务通过。官方 [配置源码](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/config.ts) 和 [依赖安装源码](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/core/src/npm.ts) 表明启动阶段会准备配置目录依赖；本次观察指向该启动阶段，但尚未定位超时的下层网络/锁原因。本轮空本地插件隔离复现与诊断/恢复说明见 [冷启动报告](cold-start.md)，不能将无插件启动成功当作 CCM 冷安装通过。

所以本轮未证明全新机器上依赖冷安装一定顺畅。公司已有 OpenCode 环境通常具有相应缓存，仍应在公司环境验收；测试缓存参数仅用于区分安装与 harness 行为，不属于用户必须配置的接入步骤。没有自动切换公共 registry。

## 验收入口与限制

1. 把自己的完整仓库放入 CCM/workspace/，回到 CCM 根目录打开 opencode。
2. 说“初始化，将这些仓库登记为某项目，先用免费模型，专家关闭”。向导应明确确认边界和真实验收命令。
3. 重启一次，先用一个具体链路的只读分析检查来源和模块责任，再尝试一项小范围修改与 Playwright MCP 验证。
4. 已初始化后接入新仓库，直接说“接入 workspace/new-repo”；登记须获准，目录发现不能自动扩大权限。

原生 OpenCode Git/LSP 仍在 CCM 根目录，业务状态通过按仓库工具获取，检查指定业务 cwd。未实现独立仓库原生会话、自动 worktree、通用模型/预算修改、项目删除或旧配置自动迁移。已初始化的 0.1.0 应保留旧目录结束任务，再初始化新工作台。估算预算只覆盖当前工作台，不是公司全账户账单限额。

后续应使用公司真实模型对比单免费模型、CCM 免费优先、混合模型及单高级模型，记录可验收交付率、关键遗漏、返工时间、总延迟和网关账单。这才是判断“质量更好、费用更低”的依据。

## 交付收尾验证与司内材料

本轮最终源码重新运行 39 项程序测试全部通过，并通过真实 OpenCode 的入口加载检查：bootstrap 和 coordinator 对授权登记说明一致；已初始化 /onboard、/workspace 允许同一登记流程；登记仍 ask；业务 shell/config 编辑仍关闭。摘要见 [收尾验证](validation-release.json)。上面的两项完整任务证据来自此前的 0.2.0 候选工作树；本轮没有把它们重新描述成最终提交后的全量模型实验。

[公司四组试跑](company-pilot.md)、[空白记录模板](templates/company-pilot.json)、[内部知识 MCP 验证](internal-mcp-validation.md) 与 [剩余问题](remaining-work.md) 已交付；真实公司试跑尚未执行，知识摘录还未与原生检索回执程序绑定。
