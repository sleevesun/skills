---
name: update-repowiki
description: 核心 HRIS Repo Wiki 的派生同步能力。由 submit-knowledge 在源知识 commit 后自动调用，也可在用户明确要求“更新 Repo Wiki”“同步 Wiki”“刷新知识卡片”时单独使用；通过公开 Git 与文件协议增量维护 .qoder/repowiki 和 .agent-wiki，不调用 Qoder 私有 API，不负责业务知识提炼，也永不自行 push。
---

# update-repowiki · 核心 Wiki 派生同步

把中央 HRIS 仓库中的权威知识源同步为：

- `.qoder/repowiki/zh/content/`：面向人的 Repo Wiki；
- `.qoder/repowiki/knowledge/zh/`：面向 Agent 的 Knowledge Card；
- `.agent-wiki/manifest.json` 和 `source-index.json`：公共增量控制面。

本 Skill 是底层能力。被上游调用时直接完成并返回状态，不要求用户再次输入 Skill 名称。

## 仓库与边界

若当前目录不是核心仓，按以下顺序定位：

1. `HRIS_KNOWLEDGE_REPO`；
2. 当前工作区及其他已配置根目录；
3. 通过 Git 远端 URL 搜索可访问的候选仓库。

仍无法定位时必须询问用户，不猜测本机路径。

必须验证 `HR系统知识库/`、`.qoder/repowiki/`、`scripts/update_repowiki.py` 和远端 URL `cnb.cool/Chordsun/HRIS`。

| 路径 | 权限 |
|---|---|
| `.qoder/repowiki/zh/content/` | 可增量编辑，优先更新现有页面 |
| `.qoder/repowiki/knowledge/zh/` | 可增量编辑，保持 frontmatter 与索引 |
| `.qoder/repowiki/zh/meta/repowiki-metadata.json` | 只读，不生成或改写 `WikiEncrypted:` |
| `.agent-wiki/manifest.json` | 脚本维护并提交 |
| `.agent-wiki/source-index.json` | 脚本维护并提交 |
| `.agent-wiki/update-plan.json` | 临时计划，不提交 |

不修改权威业务知识，不 pull、rebase 或 push。

## 调用前置条件

- 权威知识变化已经形成独立 source commit；
- source commit 不包含 Repo Wiki 和 `.agent-wiki`；
- 当前 Repo Wiki 没有来源不明的预先改动；
- 记录 source commit hash 和调用时 HEAD；
- 多 Agent 共用 `.agent-wiki/update.lock`，不得覆盖他人的活动计划。

首次接入且没有 manifest 时运行 `bootstrap`。`bootstrap --force` 仅用于明确重建基线，不得绕过待处理变化。

## 执行清单

```text
- [ ] 1. status 确认同步差异
- [ ] 2. plan / prompt 生成增量任务
- [ ] 3. 阅读来源并更新受影响页面与卡片
- [ ] 4. 处理 reviewed 和 ignored
- [ ] 5. validate
- [ ] 6. finalize 创建独立 Wiki commit
- [ ] 7. 返回可发布状态，不 push
```

## Step 1：状态

```bash
python3 scripts/update_repowiki.py status
```

如果状态确认 source commit 已被当前 manifest 处理且没有工作区变化，返回 `READY_NO_WIKI_CHANGE`。否则继续。

## Step 2：计划

```bash
python3 scripts/update_repowiki.py plan
python3 scripts/update_repowiki.py prompt
```

计划依据包括 `file://` 引用、Knowledge Card 的 `source_files/scope`、模块 YAML、公开 `dependent_files`、manifest 到 HEAD 的 Git 差异以及工作区变化。

已有活动计划时不得覆盖。只有确认旧计划废弃后才能使用 `plan --replace`。计划前存在合法且属于本轮的 Wiki 改动时，才可显式使用 `--allow-dirty-artifacts`。

## Step 3：编辑页面与 Knowledge Card

只处理 `affected_pages` 和 `changed_sources`：

- 逐项阅读来源后再改结论；
- 保留目录层级、人工修订和有效引用；
- 结论变化时同步正文和来源引用，不只更新时间；
- 来源使用仓库相对 `file://` 路径；
- Knowledge Card 保持 `kind`、`name`、`category`、`scope`、`source_files`；
- 优先更新现有页面；
- 新页面可能要等 Qoder 刷新私有目录元数据后才显示，禁止自行合成该元数据；
- `full_rebuild_recommended` 只提示人工评估，不授权全量重写。

## Step 4：复核门禁

来源变化但页面结论仍成立：

```bash
python3 scripts/update_repowiki.py resolve \
  --page '<affected page path>' \
  --status reviewed \
  --note '<现有结论仍成立的证据>'
```

未映射来源确实不属于 Wiki：

```bash
python3 scripts/update_repowiki.py resolve \
  --source '<unmapped source path>' \
  --status ignored \
  --note '<不进入核心 Wiki 的原因>'
```

不得静默跳过。

## Step 5：校验

```bash
python3 scripts/update_repowiki.py validate
```

校验页面存在性、空文件、来源文件和行号、Knowledge Card 索引/模块字段及公开 Qoder 元数据 JSON。历史问题只作为 manifest 基线；本轮新增问题阻断完成。不得用 `--allow-missing` 掩盖新问题。

## Step 6：完成与独立 commit

需要 Wiki 变更时：

```bash
python3 scripts/update_repowiki.py finalize --commit \
  --message 'docs(repowiki): sync <项目或知识主题>'
```

`finalize --commit` 仅提交 `.qoder/repowiki`、`.agent-wiki/manifest.json` 和 `.agent-wiki/source-index.json`，并保留其他暂存内容。

如果没有页面内容变化但所有来源均已明确复核，仍按脚本结果更新公共索引；没有形成 commit 时返回无变更状态。

## 返回契约

只返回以下三种结果之一：

- `READY_NO_WIKI_CHANGE`：已完成检查，不需要 Wiki commit；
- `READY_WITH_WIKI_COMMIT <hash>`：`validate` 通过且独立 Wiki commit 已创建；
- `BLOCKED <原因>`：存在未处理页面、未映射来源、漂移、锁冲突、敏感风险或校验失败。

本 Skill 永不 push。上游 `submit-knowledge` 必须在 push 前再次扫描 Wiki diff；单独调用时也应把结果交回中央入库流程决定是否发布。

## 失败恢复

- HEAD 或来源漂移：重新检查后运行 `plan --replace`；
- 页面未处理：编辑或记录 `reviewed`；
- 来源未映射：补映射、新页面或记录 `ignored`；
- 计划前已有 Wiki 改动：确认归属后再处理；
- 任何失败都保留页面改动，从 `validate` 或 `finalize` 继续，不 reset。
