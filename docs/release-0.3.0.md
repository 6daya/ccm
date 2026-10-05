# CCM 0.3.0：OpenCode V2 专用交付

日期：2026-10-06；基于已交付 0.2.1。V1→V2 是宿主 API 破坏性变更，因此本版为 0.3.0，不继续标为 0.2 补丁。

## 已实现

- 官方 `@opencode/plugin@2.0.23` domain API，原生 subagent、工具 JSON Schema/content、session context/idle、事件用量与中断恢复；移除 Slim 和 V1 SDK 依赖。
- 免费 Jarvis 默认入口，隐藏受控角色；模型/HTTP/辅助调用限制，专家一次持久 HTTP transport，禁止付费自动重试与 WebSocket。
- 项目登记改为实际原生确认表单；发现目录不会授权，模型无法自行伪造确认输入。
- 缺失运行时按系统查已有路径与官方源，展示具体安装/校验/PATH/回退方案。初始化后经原生确认冻结一次性命令，无活动业务任务才可执行；失败、业务启动或重启撤销批准。初始化前采用原生授权与向导规则，未承诺完整程序沙箱。
- 本机运行目录 `.ccm/`，入口 `.opencode/`，业务集合 `workspace/`；plugin shim 命名 ccm.js，仅保留 ccm CLI 名。旧 `.team-harness/` 保留并阻止静默迁移。
- 模型目录最多 30 秒等待 V2 首次快照就绪；首次引导 agent 被备份并退休，避免 V2 晚应用 Markdown 权限遮蔽插件工具。
- 保留项目冻结、精确写入、敏感文件过滤、独立验收、未知账单预留和确定性私有归档。

## 已验证

57 项程序回归通过；官方 OpenCode 2.0.23/macOS ARM64 实际加载。无 CCM node_modules 的首次引导、真实 V2 provider 引用保留、模型目录、初始化备份及重启、项目原生表单确认均通过。运行时维护另通过实际原生表单与 `node --version` 无写入探测；**没有安装任何系统运行时或修改 PATH**。

两项完整跨仓任务通过真实 V2 子代理、命令检查与官方 Node Playwright MCP/Chrome：拓扑分析、公共模块拒写、一次受限专家判断、业务修复、真实页面点击/接收端事件/截图、中断恢复无专家重放、成功自动归档以及零请求归档重试。模型是确定性模拟网关；72 次请求（coordinator 51、scout 4、verifier 11、builder 5、expert 1）不是自然语言智能调度、真实 token 或费用证明。

本机新原生配置缓存下两项有界启动诊断完成；原有 V1 冷启动等待保留为历史未定位问题。CCM node_modules 与 Chrome 已备好，不等于整机/司内冷安装通过。源文件摘要、耗时、原生回执与档案摘要见 [验证 JSON](validation-0.3.0.json)；[程序输出](validation-0.3.0-tests.txt)。

初次移植评估因继承 PWD 进入错误根，调用了默认模型而未进入本地网关；该结果排除出验证与质量/费用结论。后续所有正式评估显式设置 PWD、隔离配置并固定本地模型，费用未知不补造为零。其他适配诊断发现 V2 直接返回值、Markdown 权限顺序、content 输出协议和子代理 prompt 前缀差异，均已修正并回归。

## 待司内验证

真实 GLM/DeepSeek 的澄清、项目选择、合同遵守与开发质量；专家能否减少返工；实际全尝试总费用；公司冷安装、provider HTTP 特性、内部只读 MCP 名称/权限/来源真实性。使用 [四组试跑](company-pilot.md) 与 [空白记录](templates/company-pilot.json)，先确认质量门槛/额度，再跑自然语言任务，不能用 EVAL 夹具替代。

## 后续候选

以真实失败证据决定简化只读流程、限定付费修复、知识回执绑定/细工具 ACL、业务原生 Git 会话/worktree、配置迁移、Windows 实机和第二宿主适配。V2 无 LSP，以登记类型/编译检查验证。当前其他 coding agent 不能直接运行 CCM，仅跳过 OpenCode 配置不够，见 [架构](architecture.md)。

## 使用与升级

本机已将 opencode 命令替换为官方 V2 2.0.23，V1 二进制备份保留；没有改 provider/key 配置。若此机器缺 Node/pnpm/rg，后续让 Jarvis 按新规则提供并执行获批方案。本次只更新 CCM。

新用户取得 0.3.0 → 放完整仓库到 workspace → 在 CCM 根启动 opencode → 选择确认免费的模型 → 对 Jarvis 说初始化 → 确认具体持久规则 → 重启一次 → 正常提业务目标。详细步骤见 [新手指引](getting-started.md)。

旧用户在旧版本/原位置结束或取消任务、核账并保留状态；另目录初始化 0.3.0，不覆盖旧状态、不转换 V1 会话、不同时改同份 checkout。交付分支为 feat/harness-baseline；main 未更新。ZIP 从同一 Git HEAD 导出，外部 release.json 记录提交与 SHA256。
