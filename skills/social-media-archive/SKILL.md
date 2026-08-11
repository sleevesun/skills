---
name: social-media-archive
description: "解析、总结并归档抖音、小红书、Bilibili 等平台内容，生成可配置知识库中的高密度 Markdown 文档。用于解析视频或笔记链接、提取文案、总结内容、保存知识笔记，或把社交媒体内容归档到本地知识库。"
---

# Social Media Analysis & Archiving

Turn a social media link or note/video into a factual, high-density Markdown knowledge note, then archive it under the user's local knowledge base.

## Configuration

Resolve configuration before reading or writing knowledge-base files. On first use or when configuration is missing, read `references/configuration.example.yaml` and use this precedence:

1. Values explicitly provided in the current request.
2. `.social-media-archive.yaml` in the current project root.
3. `SOCIAL_MEDIA_ARCHIVE_ROOT` for the knowledge-base root.
4. `${XDG_CONFIG_HOME:-~/.config}/social-media-archive/config.yaml`.
5. Ask the user for the knowledge-base root; never guess a personal path.

Resolve `index` and `inbox` relative to the configured root unless they are absolute. Default them to `00_知识库目录索引.md` and `00_Inbox`. Treat the user's configuration as private and never copy its absolute paths into generated public templates.

Discover retrieval tools from the current environment. Prefer platform-specific tools for Xiaohongshu/RedNote and Douyin, then general video extraction or transcription. Do not assume a specific MCP server name exists.

## Trigger Recognition

Use this workflow for:

- Douyin: `v.douyin.com`, `douyin.com/video/`, `douyin.com/jingxuan`, `aweme.snssdk.com`
- Xiaohongshu/RedNote: `xhslink.com`, `xiaohongshu.com/explore/`, `xiaohongshu.com/discovery/`
- Bilibili: `b23.tv`, `bilibili.com/video/`
- Natural-language requests such as "帮我解析这个视频", "提取视频文案", "总结这篇笔记", "归档这个链接".

## Non-Negotiable Rules

- Never infer the content from the title, URL, memory, or model knowledge alone.
- Always call at least one factual retrieval tool before writing a note.
- If extraction fails, say exactly what failed and archive only verified metadata, or ask the user for the source text/transcript.
- Do not place generated `.md` files directly in the knowledge base root.
- Read `00_知识库目录索引.md` before choosing a target folder.
- If classification is uncertain, write to `00_Inbox`.
- Do not expose API keys, cookies, or login state in the output note.
- For video content, do not produce a thin summary when transcript content is available. Follow the duration-aware density rules below.

## Extraction Workflow

1. Classify the URL/platform.
2. Retrieve factual content:
   - Xiaohongshu/RedNote: use an available platform-specific tool to fetch note content, author, metadata, and comments.
   - Douyin: prefer platform-specific metadata and text extraction; if needed, retrieve permitted media and use audio transcription.
   - Bilibili or other video links: use an available video extraction or transcription tool when possible.
   - If platform tools fail, use web search only to recover verified metadata or official links; cite URLs in the note's resources section.
3. Preserve provenance in working notes: source URL, extraction tool used, author if available, and any retrieval limitations.
4. If the content includes tools, projects, papers, or official resources, search for official links before finalizing the resources section.

## Video Summary Density Rules

For video content, the note must be duration-aware and at least as detailed as a platform-generated intelligent summary.

- Short videos, 0-3 minutes: include a concise overall summary, key points, solution/method, practical value, and 3-5 highlights.
- Medium videos, 3-10 minutes: include background/pain point, problem decomposition, solution or framework mechanism, step-by-step process, example/result, pitfalls, applicability limits, and 3-6 highlights.
- Long videos, over 10 minutes: include a chaptered or timeline-style note, detailed concept explanations, reusable workflow, key evidence/numbers, pitfalls, limits, and knowledge-network links.
- If the transcript has timestamps, highlights must include timestamps in `MM:SS` format. If timestamps are unavailable, write `转写结果未提供时间戳` and still list the strongest highlights as bullets.
- For videos over 3 minutes, never summarize only as a short TL;DR plus generic bullets. The body must preserve the main argument chain and enough detail to let the user reconstruct the method without reopening the video.
- Extract and retain concrete numbers, tool names, framework names, commands, file names, success criteria, case outcomes, and quoted concepts when present in the transcript.
- Distinguish between resources explicitly mentioned in the video and resources added by the agent as external research.

## Markdown Output Format

Generate one Markdown file with YAML frontmatter:

```yaml
---
title: "提炼后的核心标题"
date: "YYYY-MM-DD"
type: "工具推荐 / 美食教程 / 知识科普 / 教育启蒙 / Vlog / 其他"
tags: [标签1, 标签2, 标签3]
source_url: "原链接"
author: "创作者或 unknown"
platform: "Douyin / Xiaohongshu / Bilibili / Web"
status: "待实操"
transcript_status: "完整转写 / 部分转写 / 未取得转写"
extraction_tool: "douyin.extract_douyin_text / video-extraction / rednote / user-provided / metadata-only"
---
```

Then use exactly these sections:

```markdown
## 1. 核心速览与唤醒场景

- **一句话速览**：20 个字以内。
- **唤醒场景**：什么时候应该重新看这条内容。

## 2. 内容详述

### 视频核心结论

用一段话说明视频真正解决的问题、核心观点和最终结论。

### 问题与难点

列出原内容明确提到的背景痛点、难点、限制条件和失败原因。

### 解决方案/框架机制

说明视频提出的方法、框架、工具链或核心机制。包含关键概念、运行逻辑、输入输出和必要条件。

### 实操流程

按原内容顺序整理步骤。保留命令、配置项、文件名、验收标准、操作顺序和注意事项。

### 案例、结果与关键数字

提取案例、演示结果、关键数字、性能指标、时间、成本、版本、模型名或其他可验证细节。

### 踩坑经验与适用边界

整理避坑提示、失败场景、适用/不适用范围，以及用户复用时的前置条件。

### 高光片段

- `MM:SS` 高光内容；如果没有时间戳，写明 `转写结果未提供时间戳`。

信息不足时明确标注“原内容未提及”。

## 3. 行动清单与相关资源

- [ ] 可执行动作

### 相关资源

- 原内容明确提到的资源。
- 延伸参考：由 Agent 补充检索的官方链接或权威资料，必须标注“非视频原始提及”。

## 4. 深度分析与知识网络

包含 `[[重要概念]]` 双向链接、客观审查、局限性和落地建议。
```

## Routing & Storage

1. Read the configured knowledge-base index before selecting a destination.
2. Choose the best first-level folder declared by the index or configuration routes. If classification is uncertain or no suitable route exists, use the configured inbox.
3. Filename format: `YYYYMMDD_<平台>_<核心主题词>.md`.
4. Use a safe filename: Chinese or ASCII is fine; remove `/`, `:`, whitespace runs, and URL fragments.
5. Write the file only after routing is decided.
6. After writing, report the final path, the retrieval or extraction capabilities used, and any content limitations.

## Graphify Follow-Up

Do not run a knowledge-graph tool automatically. If the user asks to connect or refresh the knowledge graph, use the tool and output folder configured for their knowledge base.
