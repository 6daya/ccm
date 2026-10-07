# 团队工作区入口

这里是 OpenCode V2 专用团队工作区脚手架。无需用户手动安装依赖或运行 init：
- 尚无 `.ccm/config.json` 时，默认 Jarvis 接待；用户说“初始化”即可，`/onboard` 为可选快捷入口；在选定免费模型后才安装和配置。
- 已初始化时，默认 Jarvis 接待；先选择已登记项目，再绑定任务。新增项目/命令检查只通过需要用户授权的登记工具，不能修改模型、预算或覆盖已有检查。
- 公司 API key 始终交给已有 OpenCode provider 管理，不请求用户将其粘贴进聊天。
- 不运行外部 websearch，不切换到公共 registry；CCM 包安装遵循已有公司配置。缺失运行时先检查环境/已有路径，按系统查官方源，展示校验、安装/PATH 和回退步骤，获得具体原生确认后安装。初始化后只在无活动业务 run 时执行获批一次性命令；子代理不能安装。
- 不允许业务任务通过编辑预算、边界或检查规避验收。
- `workspace/` 是业务仓库集合，每个子仓库保留自己的 Git 和依赖，不提交到 CCM。登记项目组是权限范围，任务开始后冻结。不要递归扫描所有仓库、依赖或运行记录。
- CCM src/bin/.opencode/.ccm 不属于业务修改范围。修改 harness 是用户单独发起的开发任务。
- 原生 OpenCode Git 仍以 CCM 为目录；V2 不运行 LSP，须登记 typecheck/lint/编译命令；业务状态使用按仓库的 harness_repository，验收在明确的仓库 cwd 运行。
- 接入须是独立 Git 根，展示已有 dirty 文件，不 reset。常见凭据路径由业务工具拒绝；可信 checks/MCP 仍由公司环境管理。
- 正式成功 run 由程序自动私有归档，无额外模型请求。归档失败与业务 accepted 分开；只重试导出，不重跑已完成任务。代码/长期文档在业务仓库，经验按需维护，不能自动改变 AGENTS 或权限。

用户明确发起 CCM 自身开发/维护任务时，先读 `docs/maintenance/README.md`，再读 `docs/maintenance/TODO.md` 的相关项；新会话可用 `docs/maintenance/HANDOFF.md`。核对实际 Git/源码与验证版本，保留 dirty，按影响范围验证并同步资料。普通业务对话不全量加载工程 TODO/历史研究；此入口不改变业务 Jarvis 的运行权限。
