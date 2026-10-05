# CCM 0.3.0：核心与 OpenCode V2 入口

继续开发时先读 [工程维护总览](maintenance/README.md)，其中整理了设计依据、源码/测试入口和维护边界；任务统一记录在 [TODO](maintenance/TODO.md)。本页描述当前运行机制。

```mermaid
flowchart LR
 U[用户与 Jarvis 沟通] --> A[OpenCode V2 适配]
 A --> C[CCM 项目规则、状态、验收与预算]
 C --> W[workspace 独立业务仓库]
```

`.ccm/` 保存本机配置、账本、回执、备份、归档与生成产物；`.opencode/` 保存宿主启动入口。`workspace/` 只放独立业务仓库，保留各自 Git/依赖/规则。`src/bin/tests/eval/docs` 是 CCM 工程，业务任务不能写入。

核心由 `engine.mjs`、`projects.mjs`、`archive.mjs`、`sensitive-paths.mjs` 管理。范围、检查摘要、证据 hash、预算预留、精确文件写入、独立审查和归档无需模型自报才能生效。状态锁覆盖本工作台；同文件 writer 冲突、浏览器验收租用和敏感路径检查继续保留。

`plugin.mjs` 使用官方 `Plugin.define` 和 V2 各 domain 的注册/transform/hook；只保留 Jarvis 和隐藏的受控角色，原生 `subagent` 执行任务。原生子代理参数必须匹配程序准备的合同。没有 Slim、V1 client/config-hook 或第二个调度器；V2 注册工具用 JSON Schema，返回 content，MCP 关闭 Code Mode 以逐步捕获固定浏览器回执。

模型 context/request/HTTP、用量事件、原生确认、取消和恢复由 V2 适配负责。专家只读无工具、最多 4000 输出 token、禁止付费 title/compaction/generate/自动重试；持久 `requestIssued` 拒绝同一尝试的第二次 HTTP transport。付费 WebSocket 未验证，明确拒绝。网关硬配额仍是美元封顶的依据。

queued → prepared → running → verifying → accepted；另有 failed/unknown/cancelled。verifying 只代表结果就绪，不能代替独立验收。恢复读取原生 context 的 terminal idle；缺失标记保留不确定性和预留额，不盲目续跑。完成的专家和已验收任务不重放。

配置/状态查询直接回答，不建完整团队任务。普通业务仍受合同和检查约束。运行时维护是单独、临时、需具体原生确认的模式：检测缺项 → 官方来源与校验/路径/回退方案 → 冻结命令 → 一次性按序执行 → 复核环境。没有活动业务 run 才能维护；启动业务撤销批准，执行失败撤销剩余步骤；重启不保留批准。宿主/OS 的外部路径授权仍有效。源码没有提供一键系统安装器，模型须形成适合机器的可审阅方案。

`init.mjs` 备份并保留公司 JSONC/provider 引用，退休并备份 stock Markdown 引导 agent，生成 `.opencode/plugins/ccm.js`。这样原生 Markdown 权限不会在插件注册之后再次遮蔽初始化后的工具。自定义 Jarvis、已有编排插件、旧状态冲突拒绝自动覆盖。首次免费模型选择仍由用户确认。

V2 原生 Git 根仍是 CCM，`harness_repository` 与命令检查 cwd 显式绑定业务仓库。V2 不运行 LSP，注册 typecheck/lint/编译。没有业务 commit/push/worktree 或跨仓原子事务。

这种职责划分便于未来换宿主，但**尚不是可跨 agent 运行的产品**：Engine.prepare/dispatch 仍含原生调用合同，恢复还依赖 V2 数据形状。目前只实现 V2 adapter；其他宿主至少需要工具/权限/确认、模型/用量、子会话/取消/恢复三组适配并通过同等回归。仅不读取 OpenCode 配置不够。出现第二个实际宿主需求时再提取薄接口，不先建立多平台框架。

成功结果程序私有归档，不增加模型调用；费用是当时已观测快照，晚到用量和真实账单可能未知。长期业务知识维护到业务 docs，按明确任务和原评审流程生效；不自动修改 AGENTS 或权限。真实模型语义质量需司内验证。
