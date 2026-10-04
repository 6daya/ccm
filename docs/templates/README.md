# 记录字段约定

company-pilot.json 是空白模板，null 表示未知/未确认，空数组表示尚未记录；不是一次已执行实验，也不是审批。每次运行复制一份，保留 not-run，实际开始后更新 running，结束按 completed/failed/cancelled/timed-out 记录。group 使用 company-pilot.md 的四组 ID，task 使用 A/B。真实数据与模拟数据分开目录；模拟数据必须 simulated=true。

数组元素使用以下结构（未知值仍填 null）：

- models：role、providerModelId、version、freeConfirmedBy、priceEffectiveAt、pricesUsdPerMillion、priceSource。
- repositories：rootAlias、commit、initialDigestManifest、uncommittedFilesReference。
- requests：requestId、gatewayRequestId、sessionId、role、phase（decision/tool-followup/acceptance/resume/unknown）、modelVersion、startedAt、elapsedMs、tokens（input/output/cacheRead/cacheWrite/reasoning）、paidReason、estimatedUsd、actualUsd、receiptReference。
- acceptance：criterion、severity、firstPass、finalPass、reviewer、evidenceReference、finding。
- interventions：at、actor、reason、action、minutes、extraInputReference。
- internalSources：mcpId、toolName、querySummary、sourceUri、sourceVersion、updatedAt、retrievedAt、rawReceiptReference、excerptDigest、repoFileAndLines、permissionDenied、truncated、conflicts、authenticity（native-receipt-reviewed/agent-supplied/unknown）。

时间使用带时区 ISO 8601。证据引用公司允许的存储位置，不把内部文档正文、账单账户信息或真实业务代码上传 GitHub。统计前核对状态、账单覆盖范围与 token 类别；未知字段不可填 0。价格和账单引用不含凭据。
