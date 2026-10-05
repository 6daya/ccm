# 启动诊断：V2 本机通过，司内冷安装待验证

日期：2026-10-04；OpenCode 固定版 1.18.34，macOS ARM64，Node 24.19.0。本轮给出有边界的定位证据，不宣称全新机器安装通过。

## 0.3.0 / V2 当前结论

OpenCode 2.0.23 在独立 XDG 新配置/数据/缓存下，本机原生无插件、空 V2 插件均在 45 秒边界内完成；两项完整 CCM 任务也未预置原生配置依赖缓存。见 [验证 JSON](validation-0.3.0.json)。CCM 依赖和 Chrome 已安装，本结果不等于全新机器/公司网络安装全部通过。V1 等待原因仍未进一步定位；换 V2 避开本机旧路径，不能证明旧故障已被修复。

V2 `opencode models` 的首个快照可能为空。`node bin/onboard.mjs models` 改为临时私有 loopback 服务，最多等 30 秒目录就绪，结束即关闭，不调用模型、不打印认证信息。非预期退出/超时明确报错。服务 stdio 必须保持 stdin 打开；PWD 固定工作目录，避免 CLI 进入错误根。

当前 `eval/diagnose-startup.mjs` 仅支持 V2，显式固定本地 diagnostic/free，使用 --standalone 与正确 PWD；空插件为 V2 id/setup 定义。下面原 V1 数值仅作历史证据。

## 历史 V1 观察与判断

| 证据 | 命令/条件 | 结果 |
| --- | --- | --- |
| 原完整任务第一次 | eval/run.mjs，无 native-config-cache | 179965ms，exit=null，模型请求 0 |
| 原完整任务第二次 | 同上，Node 加入 PATH | 180024ms，exit=null，模型请求 0 |
| 原完整任务复用缓存 | 预置已装好的 1.18.34 原生配置依赖 | 两项完整任务通过；缓存只用于隔离工程流程 |
| 本轮原生无外部插件 | run --print-logs --log-level DEBUG --format json，独立 XDG config/data/cache/state，本机模拟网关 | 最终数值见 validation-cold-start.json；正常完成，有模型请求 |
| 本轮原生空本地插件 | 相同条件，仅加 export default async () => ({}) 本地插件；不加载 CCM/Slim | 45 秒边界内超时，SIGTERM，模型请求 0；尚无原生依赖 node_modules |

原始日志停在配置加载，空插件本身没有依赖安装代码。固定版本 [插件源码](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/plugin/index.ts) 在外部插件存在时等待配置依赖；[配置源码](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/config.ts) 为配置目录准备 @opencode-ai/plugin；[npm 源码](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/core/src/npm.ts) 使用锁和 Arborist reify。这些源码与复现共同支持“等待原生配置依赖流程”的推断，排除了必须运行 CCM onboarding 安装才会卡住的解释；没有证明下层是网络、锁还是 npm 模块初始化。

[NpmConfig 源码](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/core/src/npm-config.ts) 使用每个配置目录作为 npm cwd。本机 pnpm 参考 registry 为 https://registry.npmjs.org/，本轮没有修改 registry；它不是公司环境，也不是 OpenCode 的原生有效 registry 回执。原生有效 registry、scoped 配置、具体下载/锁等待和网络错误仍未知。单独存在的锁目录不证明锁冲突；原生安装没有给出完整阶段回执，因此不能据耗时断言原因。

首版诊断网关返回非流式 JSON，触发原生循环请求后在 45 秒结束；这属于诊断夹具错误，已修正为 SSE，保留工作日志但排除出冷启动复现结论。该轮未调用真实模型或计费服务。最初 sandbox 拒绝本机端口监听也与产品冷启动原因无关；后续在允许本机监听的环境执行。

## 可复用的限定诊断

交付脚本 eval/diagnose-startup.mjs 不安装 harness，启动仅本机 127.0.0.1 模拟网关；分别运行无插件/空本地插件，单项最多 45 秒，超时结束该诊断进程组。新目录已存在就拒绝覆盖。此诊断的进程组终止仅支持 Unix，Windows 会明确拒绝运行，后续另作实机验证。不复制 provider 配置/凭据，清除自定义 OPENCODE_CONFIG 引用，使用独立 XDG 目录，沿用已有 npm 配置，不切 registry。OpenCode 自己仍按固定版本规则寻找用户 home 的 .opencode（见原始日志）；因此这是运行目录与 XDG 的隔离，不是完整操作系统沙箱。

```sh
node eval/diagnose-startup.mjs --opencode /path/to/opencode --out /path/to/fresh-diagnostic
```

保存 summary.json、native-only/native-local-plugin 的 stdout JSONL 和 stderr 日志。summary 包含版本、argv、退出码/信号、耗时、请求数、原生依赖目录是否存在、pnpm 参考 registry（去除 URL 用户信息）。脚本仅诊断固定测试配置；不将它用作业务启动器、正式安装或质量试跑。真实公司日志仍须由负责人检查脱敏后共享，不能输出完整环境、认证配置或 .npmrc。端口监听被环境禁止时在公司允许的诊断环境运行，不把 EPERM 当模型故障。

## 诊断/恢复步骤

1. 长时间未出现模型请求时停止等待，保存启动日志最后阶段、版本、实际执行命令、时限与退出码。先区分原生依赖、harness 依赖、provider、MCP/浏览器；node bin/onboard.mjs probe 只能检查 harness 前置条件，不证明原生依赖安装成功。
2. 让环境维护者核对 OpenCode 实际配置目录的正常公司 npm/registry、代理/证书、包权限和 native plugin 固定版本可用性。项目根 .npmrc 与配置目录的 npm cwd 可能不同；通过公司既定用户/受管环境配置解决，不静默换公共源，不要求聊天提供 token。pnpm registry 仅作参考，原生阶段必须另取脱敏有效配置/错误回执。
3. 使用上述限定诊断复核；若空插件也停住，先处理原生依赖，勿重跑整项 CCM 业务任务。未定位时记录错误类别/阶段为未知，提交给环境维护者；当前没有安全的一键根治方案。
4. 原生依赖经正常安装完成后，在同一公司配置下重试一次启动，再进入 Jarvis 初始化。不要复制其他机器 node_modules、provider 或测试缓存作为正式方案。冷安装验收必须记录真实依赖安装完成和后续入口成功，已有缓存条件不能替代。
5. 保留业务仓库改动、当前 .ccm 状态和旧 .team-harness 状态；启动问题不应 reset 仓库。活动任务用原 session 恢复，核对已完成专家及未知账单。doctor --repair-lock 只处理 CCM 已确认死进程的锁，不处理 OpenCode 原生锁；勿直接删除可能活动的原生锁或全部缓存。

司内网络、包权限、代理证书与整机冷安装继续单独验证；不把本机快速启动推断为所有环境均正常。
