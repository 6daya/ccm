# 业务仓库集合

在这里 clone 或复制完整的业务仓库，每个仓库保留自己的 Git、依赖、AGENTS.md 和测试配置。

```text
ccm/
  workspace/
    frontend/
    backend/
    business-monorepo/
```

回到 CCM 根目录运行 `opencode`，与 Jarvis 说“初始化，并关联 workspace/ 中的项目”。初始化后添加仓库可说“接入 workspace/new-repo”，Jarvis 会展示项目范围、保护路径和验收检查，获准后登记。复制目录不会自动扩大代理权限。

此目录中的业务仓库不提交到 CCM。源码修改和验收发生在各自仓库；CCM 原生 Git 面板不代表业务仓库状态，应让 Jarvis 按仓库检查。不要将业务仓库的 node_modules、运行状态或密钥复制进 harness 配置。工作台搬迁后启动新任务；带有旧绝对路径的未完成任务应留在原位置恢复。
