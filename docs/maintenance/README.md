# CCM 工程维护总览

更新：2026-10-06。运行实现基线：CCM 0.3.0，提交 `db3c787ceb5b7d5270ad0f3f32f1d32bd7f06db4`。本组资料用于继续开发 CCM；文档整理不表示新增运行能力。进入新会话先核对实际 Git 和源码，不把这里的基线当成永远不变的 HEAD。

## 从哪里开始

先读本页，再读 [TODO](TODO.md) 中本轮相关的一项。需要换会话时用 [HANDOFF](HANDOFF.md)。不用每次加载全部历史报告或外部研究。

| 资料 | 用途与权威范围 |
| --- | --- |
| 本页 | 用户目标、设计取舍、实现入口、维护方式 |
| [当前架构](../architecture.md) | 当前机制及 OpenCode V2 适配边界 |
| [TODO](TODO.md) | 唯一维护任务清单，含依据、启动条件和完成标准 |
| [0.3.0 说明](../release-0.3.0.md)、[验证 JSON](../validation-0.3.0.json) | 固定版本的交付事实与验证证据，不能代表以后所有 HEAD |
| [新手指引](../getting-started.md) | 用户如何接入、工作、恢复和保存经验 |
| [公司试跑](../company-pilot.md)、[记录模板](../templates/company-pilot.json)、[字段约定](../templates/README.md) | 真实质量/费用实验，当前未执行 |
| [内部 MCP 验证](../internal-mcp-validation.md) | 公司只读连接、出处与权限验收，当前未实测 |
| [冷启动记录](../cold-start.md) | V1 历史等待与 V2 本机诊断，环境限制须一起读 |
| [布局研究](../workspace-design.md)、[协作研究](../ccm-collaboration.md) | 设计背景和候选取舍；其中旧版本、概念方案不视为当前能力 |
| 其他 validation-* / workspace-evaluation / release-0.2.1 | 历史证据，按文件注明的版本和条件解释 |

发现文档与代码不同，先判断实际行为并保留差异；修正文档或修复代码需要当前任务依据，不能自动放宽检查来匹配文字。真实质量和费用结论必须引用公司回执，不能仅凭源码推断。

## 用户要解决什么

用户希望日常只与 Jarvis 沟通，由公司确认免费的 GLM/DeepSeek 等承担常规工作，必要时让强模型处理一个关键判断，减少手动评估和切模型。高级模型额度不足、免费模型容易漏问题和反复返工是核心痛点。约 $1000/月是账户目标背景，不是获准开展付费实验的金额，也不是本机能保证的全局硬额度。

成功标准是可验收的业务交付、合理的总费用和更少人工返工；不是 agent 数量多、流程完整或一次专家请求少。免费模型也消耗时间和上下文。优先真实试用，依据主要失败做一项小改动，不先扩展成通用调度平台。

当前选择只服务于官方 OpenCode V2。保留未来换宿主的职责边界；尚未实现其他 coding agent 适配。用户没有要求现在重写整个架构。

## 核心设计及为什么这样做

```mermaid
flowchart LR
 U[用户目标] --> J[Jarvis 与 V2 原生子代理]
 J --> C[CCM 合同、检查、预算和状态]
 C --> W[workspace 独立业务仓库]
```

| 决策 | 当前实现与理由 | 不应误解为 |
| --- | --- | --- |
| 单一 Jarvis 入口 | 首次 Markdown 向导，初始化后同名程序 agent；用户不用管理工作角色 | 再套一个独立管理器或第二调度器 |
| 中央工作台 + 独立仓库 | workspace 浅层发现、明确项目组、分仓 Git 视图和 check cwd | 一个业务 monorepo、自动继承子仓库 provider/依赖 |
| 程序约束、模型决策 | 程序校验合同、范围、证据、检查与预算；模型选任务和相关材料 | 提示词可授权扩大权限、模型自报通过即可验收 |
| free + read-only expert 两槽 | 常规角色同一个已确认免费模型；专家仅收有限证据给判断 | 任意多级路由、付费 builder、保证免费模型实现质量 |
| 独立 verifier + 实际检查 | 验收绑定目标 attempt、文件 digest 和真实回执 | 独立上下文一定带来语义正确性 |
| 持久账本与保守恢复 | 不重放已完成专家；账单/terminal idle 不明时保留预留和未知项 | 任意中断都能自动继续、供应商一定停止在途计费 |
| 归档与长期知识分开 | 成功任务程序导出私有 report/manifest；长期代码、文档和经验属于业务仓库 | 自动晋升知识、全量读历史、自动修改 AGENTS |
| 薄 V2 适配 | 使用官方 plugin domain、原生 subagent、MCP 与会话 | 已跨宿主通用；Engine.prepare/dispatch 仍含 V2 调用合同 |

## 目录与成果归属

```text
ccm/
  .opencode/     原生入口，stock Jarvis/命令；初始化生成 plugins/ccm.js
  .ccm/          本机配置、账本、回执、备份、archive 与生成产物，Git 忽略
  workspace/     独立业务 Git 仓库集合，业务内容不提交到 CCM
  src/ bin/      CCM 实现与管理入口
  tests/ eval/   程序回归、模拟网关、真实 V2/MCP 工程验证
  docs/          工程设计、使用、脱敏证据和维护资料
```

`.git/` 等工具目录保持自身含义，不是 CCM 的业务状态。一次项目接入要核对独立 Git 根、dirty 文件、项目组、保护范围和明确检查；发现目录不等于授权。业务任务不得写 CCM 工程。CCM 自身开发使用独立开发 checkout 和具有工程权限的助手，不能让已初始化的业务 Jarvis 修改自己的 harness。

CCM 工程已确认的设计、修复经验和 TODO 保存在本仓库 docs；业务领域经验维护在业务仓库现有 docs。聊天不是唯一项目记录：有价值的决策按需写回相关资料，记录依据、适用范围和例外；不强制每次问答产出复盘文件。

## 实现入口与必要回归

路径均相对仓库根，表中的函数名用于定位，不要求稳定行号。

| 修改内容 | 主要源码 | 对应验证 |
| --- | --- | --- |
| 合同/预算/写入/验收/恢复状态 | [engine.mjs](../../src/engine.mjs)：plan / prepare / dispatch / admitPaidRequest / write / check / accept / retry / complete | [engine.test.mjs](../../tests/engine.test.mjs) |
| 项目接入/选择/冻结/规则/Git | [projects.mjs](../../src/projects.mjs) 与 Engine.registerProject / context / repository | [projects.test.mjs](../../tests/projects.test.mjs) |
| 私有归档、接受与导出分离 | [archive.mjs](../../src/archive.mjs) 与 Engine.complete / archive | [archive.test.mjs](../../tests/archive.test.mjs)，包含导出崩溃与恢复 |
| 凭据文件名过滤 | [sensitive-paths.mjs](../../src/sensitive-paths.mjs)、Engine 路径检查与 Git 过滤 | projects / engine 的读搜写上下文及 diff 回归 |
| V2 角色/模型/工具/原生确认/用量 | [plugin.mjs](../../src/plugin.mjs) | [plugin-v2.test.mjs](../../tests/plugin-v2.test.mjs) + 涉及真实 API 的原生验证 |
| Jarvis 与子角色行为 | [prompts.mjs](../../src/prompts.mjs)、[stock Jarvis](../../.opencode/agents/jarvis.md) | onboarding / V2 回归；真实模型改善另外做司内自然语言试跑 |
| 初始化、备份、profile 冲突 | [init.mjs](../../src/init.mjs)、[onboard.mjs](../../bin/onboard.mjs) | [init.test.mjs](../../tests/init.test.mjs)、[onboard.test.mjs](../../tests/onboard.test.mjs) |
| 缺失运行时/可信来源/目录探测 | [environment.mjs](../../src/environment.mjs)、[opencode-models.mjs](../../src/opencode-models.mjs)、plugin 维护入口 | V2 确认/命令边界回归，真实机器安装单独验证 |
| 默认规则和版本要求 | [defaults.mjs](../../src/defaults.mjs)、[runtime.mjs](../../src/runtime.mjs)、[package.json](../../package.json) | 配置校验、版本与安装验证；依赖升级需更新锁文件并复测 V2 |
| 离线状态/报告/核账/doctor | [cli.mjs](../../bin/cli.mjs)、[workspace.mjs](../../src/workspace.mjs) | CLI/归档/项目测试；原生会话恢复仍由 plugin 实现 |
| 完整工具链 | [run.mjs](../../eval/run.mjs)、[gateway.mjs](../../eval/gateway.mjs)、[case-server.mjs](../../eval/case-server.mjs) | 本地脚本模型 + 真实 V2 subagent / Node Playwright MCP，不能作为真实 LLM 试跑 |

任务状态为 queued → prepared → running → verifying → accepted，另有 failed / unknown / cancelled。子代理返回结果不等于验收成功；verifier 的 verdict 和固定检查、目标 attempt、文件 hash 必须一致。业务 accepted 与 archive complete 是两个独立事实。

## 不应破坏的边界

- 活动任务冻结项目、规则与检查；独立 Git、dirty 改动、精确写文件和公共模块保护须保留。接入不能改模型/预算、覆盖检查或削弱已有必做检查。
- 专家需新鲜且有来源的有限证据、已配置价格、预算预留和明确升级理由；无检索/写入/派发工具，输出上限 4000 token。禁止付费辅助调用、自动重试和重复 HTTP transport；付费 WebSocket 明确不支持。
- 终止标记或账单缺失保留未知状态，不用 guessed cost 解锁重试；费用估算不等于网关账单，工作台限额不等于账户硬封顶。
- 浏览器验收只走官方 Node Playwright MCP 的固定步骤与真实回执。内部知识许可为整个已登记 MCP ID，只接入已保证只读的端点；摘录仍是 agent-supplied。
- 系统运行时维护须先展示来源/校验/位置/PATH/回退和具体步骤，原生确认后才能执行；无活动业务 run、一次性命令、失败/重启撤销。公司 registry 和凭据不因故障被静默替换。
- 旧 `.team-harness/` 状态拒绝静默迁移，不 reset 业务仓库、不覆盖档案、不重放 V1 会话。Node/其他运行时安装需要具体授权，不能因缺失就永久拒绝帮助。

## V2 适配中已遇到的坑

1. 插件内部 session API 返回直接对象，与 REST 的 data 包装不同；不要把 V1 client/config-hook 搬回来。
2. Tool 需要 JSON Schema 和 content；没有输出 schema 时不要自行返回 output。原生 subagent 使用 agent / background:false，合同不允许 model 或 sessionID 续跑覆盖。
3. Markdown agent 权限可能晚于插件应用；init 只退休已知 stock Jarvis 并备份。编辑 stock Jarvis 后必须同步 init 中的 SHA256 保护值，并验证自定义 agent 仍拒绝覆盖。
4. V2 CLI 可能优先继承 PWD；spawn 必须同时固定 cwd 和 PWD。正式工程回归用 --standalone 和固定本地模型，防止接入全局默认模型。
5. MCP Code Mode 需关闭，才能按角色/工具/参数捕获固定步骤；V2 配置使用 mcp.servers 和 disabled。原生表单必须取得真实用户答案，不能信任模型传入的“已确认”。
6. 首个模型/agent 快照可能早于注册完成；目录探测有 30 秒上限。临时 serve --stdio 要保持 stdin 打开并清理进程，不输出认证值。
7. 子会话缺少 terminal idle 时可能仍在跑，也可能被中断；保留原尝试，不猜测完成。原生后台提升也不能作为立即重派发的理由。

## 已验证和仍未知

0.3.0 基线为 OpenCode/plugin 2.0.23、Playwright MCP 0.0.83，macOS ARM64，57 项程序回归；两项完整跨仓任务用 72 次模拟模型请求通过。真实首次引导/原生表单的总结、归档 hash、源文件 hash 和启动耗时见 validation-0.3.0.json。该文件是固定版本证据，不因为后来改文档就改写原始摘要。

原生无插件/空 V2 插件在本机新原生缓存下通过；CCM 依赖及 Chrome 已备好，279 包安装复用了缓存。没有整机冷下载、真实 GLM/Opus 质量/费用、真实内部知识 MCP 或 Windows 实机证据。首次移植中一个继承 PWD、误入默认模型的运行被排除，账单未知；不能将它混入正式结果。

仓库提供单元回归、完整任务和冷启动复现入口。首次引导/原生表单的独立临时 smoke 脚本未作为可移植入口收录；仓库有摘要及程序回归，换机器复测时按实际 TUI 检查，不能将 stub 测试冒充原生实测。`eval/mcp-fixture.mjs` 为旧协议夹具；V2 run 明确拒绝 --mcp-fixture，不能拿它代替浏览器验证。

## 后续如何迭代

1. 在独立开发 checkout 核对分支、HEAD、dirty 和现有验证；不要加载活动业务工作台状态或借业务权限开发 harness。源码从交付分支取得，main 尚不是这次交付。
2. 从 TODO 选择一项，记清触发问题、非敏感证据、期望行为和完成标准；先复现，再最小修复。没有真实质量数据时不承诺节省比例。
3. 按上表验证影响范围。纯文档核对链接、源码符号和事实即可；状态/权限/初始化变动跑相关测试，V2 工具/模型/MCP/恢复变动还要完整工程回归。测试通过后没有新问题就继续交付。
4. 更新当前设计、TODO 和必要使用说明。关键取舍可在本页或对应设计文档记“问题—决定—依据—代价”；不要求新增一套审批表或把所有问答永久灌进提示词。
5. 按当前授权提交推送，核对远端 HEAD；仅发布脱敏源码/证据。需要新版包时从该提交 git archive 导出，核对清单与 SHA256。旧 ZIP 和旧证据保持固定版本，不覆盖成另一个提交。
6. 涉及模型效果的优化做小范围真实自然语言试用，记录人工干预、首次验收、返工、时间和所有尝试成本；依据结果决定下一项。

开发环境已准备好时的常用验证命令（在 CCM 源码根执行）：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
node eval/run.mjs --opencode /absolute/path/to/opencode-v2 --out /absolute/path/to/fresh-results
node eval/diagnose-startup.mjs --opencode /absolute/path/to/opencode-v2 --out /absolute/path/to/fresh-diagnostic
git diff --check
```

上面的路径是需要替换的示意路径，结果目录必须新建。完整验证使用已安装浏览器；需要指定 Chrome 时用 HARNESS_EVAL_BROWSER 指向真实可执行文件。冷启动诊断是 Unix 每项 45 秒有界测试，不是正式安装器。缺失 Node/pnpm/rg 时先定位已有运行时，确需安装再形成获批方案；不要把开发者机器缓存路径写成用户依赖。

运行版本只有在实际行为/兼容性变化时调整；纯维护文档补充可以保留 0.3.0，用 Git commit 区分内容。维护资料中的快照应标注日期和基线；新一轮完成后更新 TODO 状态和链接，后续开发无需依赖原聊天全文。
