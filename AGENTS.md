# 团队工作区入口

这里是 OpenCode 团队工作区脚手架。无需用户手动安装依赖或运行 init：
- 尚无 `.team-harness/config.json` 时，建议使用 `/onboard`，由原生 `workspace-mate` 对话引导；在选定免费模型后才安装和配置。
- 已初始化时，日常任务由默认 `orchestrator` 执行；`/workspace` 调用只读规则向导。
- 公司 API key 始终交给已有 OpenCode provider 管理，不请求用户将其粘贴进聊天。
- 不运行外部 websearch，不切换到公共 registry；依赖安装遵循已有公司配置。
- 不允许业务任务通过编辑预算、边界或检查规避验收。
- `projects/` 是可选仓库摆放位置；实际关联范围以 `.team-harness/config.json` 的 roots 为准。不要递归扫描所有仓库、依赖或运行记录。
