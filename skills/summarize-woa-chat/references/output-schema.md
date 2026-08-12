# 产物与总结规则

## 本地产物

`fetch` 在用户缓存目录下按 `account_uid/chat_id/time_window` 生成：

- `manifest.json`：会话、时间窗、记录数和覆盖校验。
- `records.jsonl`：每行一条脱敏、规范化的消息。
- `records.md`：便于人工阅读的时序文本。
- `summary-chunks/`：仅在执行 `prepare-summary.mjs` 后生成的总结分块。

`records.jsonl` 的稳定字段：

```json
{
  "chat_id": "1234567",
  "chat_name": "项目讨论群",
  "chat_type": "group",
  "message_id": "189318774",
  "seq": 123,
  "sender_id": "10001",
  "sender_name": "张三",
  "sent_at": "2026-08-12T02:00:00.718Z",
  "message_type": "text",
  "text": "消息正文",
  "attachments": [],
  "status": "ok"
}
```

首版只保存附件元数据，不主动下载附件。`sender_name` 取不到显示名时可回退为发送人 ID。

## 覆盖校验

总结前必须同时确认：

1. `manifest.status == "done"`
2. `manifest.coverage.complete == true`
3. `manifest.coverage.database_count == manifest.coverage.exported_count`

任一条不成立时，停止生成完整性结论，改为说明缺口和可执行的修复方式。

## 总结输出

根据真实记录生成中文总结，使用以下结构：

```markdown
# <会话名称> 聊天总结

- 时间范围：...
- 实际覆盖：...
- 消息数：...

## 核心结论

## 主要进展

## 已确认决定

## 待办与责任人

## 风险与阻塞

## 未决问题

## 数据限制
```

遵守以下证据规则：

- 对决定、待办、重要数字和有争议的结论，附上 `YYYY-MM-DD HH:mm / 发送人 / message_id`。
- 区分“对话明确说明”与“根据上下文推断”；推断必须标注。
- 不根据聊天中没有出现的信息补全责任人、截止时间或处理结果。
- 合并跨分块的重复事项，保留状态变化的时间线。
- 附件只有元数据时，不推测其文件内容。
- 默认不在最终答复中暴露本地缓存目录中的其他会话或个人路径。
