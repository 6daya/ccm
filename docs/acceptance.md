# 体验与验收

> 0.3.0 已改为 OpenCode V2；本文中的 0.1/0.2.x 版本与测试为历史记录。当前使用与限制见 [V2 交付](release-0.3.0.md)。
## 任务 A：跨仓链路与责任归属

素材：CCM/workspace 下三个独立 Git 仓库 web、orders、payments。将它们明确登记为 orders-system 项目组，再从 CCM 根目录启动任务。eval 会创建这些素材，也可替换成你的真实仓库。

自然语言请求：分析 Browser → gateway → orders → payments 的调用关系、团队责任、失败传播；指出 liveness 与 payment-confirmed 的区别。所有结论提供文件/行来源，不明事项明确标记，不默认上专家。

你验收：拓扑是否正确，是否虚构跨仓关系，是否混淆健康检查与业务成功，是否能用来源追溯，是否有不必要付费调用。

## 任务 B：可观测落地与恢复

素材：一个订单按钮、公共 telemetry transport、业务模块归属规范。

自然语言请求：补充 order_submit，上报 orderId、traceId，禁止 PII；公共 transport 保持中立；通过 Playwright MCP 验证页面点击、真实接收端事件和截图。中途退出并在原主会话说“继续”。

以下故障注入仅用于机械回归，不用于真实模型调度比较：第一次免费 builder 尝试将业务事件放入 common；固定保护与精确文件范围应拦截。验收失败不能冒充通过。允许一次限定专家决策，然后免费 builder 在原业务文件实现，独立 verifier 使用 MCP 回执验收。

你验收：公共文件无越界改动，trace 关联正确，一次点击一次上报，无多余字段，旧审查不用于新 attempt，中断后不重复专家请求。

## 公司模型实测

比较四组：单免费模型、CCM 仅免费、CCM 免费优先+限定专家、单高级模型。先由负责人确认质量门槛与每组支出上限，再做各组 A/B 各一次的小样本。使用相同仓库快照、自然语言目标和验收，保留全部失败/返工及网关账单，不使用 EVAL 提示或脚本预置任务图。

具体隔离、评审和费用口径见 [公司试跑方案](company-pilot.md)，空白记录见 [JSON 模板](templates/company-pilot.json) 和 [字段说明](templates/README.md)。内部知识检索须按 [MCP 接入验证](internal-mcp-validation.md) 保留真实回执。

本轮仅证明路由、状态、限制与浏览器验收机制可运行，没有证明真实 GLM 的协调质量或成本目标已达成。

工作台布局、旧版差距见 [设计分析](workspace-design.md)；本次执行数据、启动超时与缓存条件见 [评估报告](workspace-evaluation.md)。
