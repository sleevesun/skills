---
name: submit-knowledge
description: 中央 HRIS 知识库的唯一入库与发布守门员。用于“提交到知识库”“入库”“同步知识”“发布知识修订”，也由 archive-project 在项目知识闭环中自动调用；负责中央仓定位、命名归位、敏感扫描、关联校验、源知识 commit、强制调用 update-repowiki 生成独立 Wiki commit，并按授权统一推送 main。用户无需手工调用下游 Skill。
---

# submit-knowledge · 中央知识入库事务

把一次知识写入作为不可拆散的事务处理：

```text
权威知识校验
  → source commit
  → Repo Wiki / Knowledge Card 同步
  → Wiki 敏感复核与 validate
  → Wiki commit
  → 一次 push
```

不得先 push 源知识、再把 Wiki 更新留给下一次会话。

## 调用模式

- **知识闭环模式**：由 `archive-project` 调用，继承项目名、来源、允许路径和 push 授权。
- **直接入库模式**：用户直接提交 PRD、纪要、方案、知识修订等材料。
- 两种模式执行相同的安全门禁。只有产物分类和 commit message 不同。
- 面向用户统一描述为“入库与 Wiki 同步”，不要要求用户手工调用 `update-repowiki`。

## 中央仓定位

按顺序检查：

1. `HRIS_KNOWLEDGE_REPO`；
2. 当前工作区及其他已配置根目录；
3. 通过 Git 远端 URL 搜索可访问的候选仓库。

仍无法定位时必须询问用户，不猜测本机路径。

候选必须同时满足：

- 存在 `HR系统知识库/`、`.qoder/repowiki/`、`scripts/update_repowiki.py`；
- 某个 Git 远端 URL 包含 `cnb.cool/Chordsun/HRIS`。

从 `git remote -v` 获取匹配 URL 的远端名，记为 `<HRIS_REMOTE>`。不得假设远端叫 `origin`。

## 事务清单

```text
- [ ] 1. 验证中央仓、远端、分支和工作区基线
- [ ] 2. 分类归位、命名和限定本轮提交路径
- [ ] 3. 敏感扫描与大文件检查
- [ ] 4. 生成摘要并完成知识关联与链接校验
- [ ] 5. 展示 source commit 文件清单
- [ ] 6. 创建 source commit，禁止提前 push
- [ ] 7. 强制执行 update-repowiki
- [ ] 8. 复核 Wiki 敏感信息并创建 Wiki commit
- [ ] 9. 按授权一次推送全部本轮 commit
```

## Step 1：环境与基线

```bash
git status --porcelain
git branch --show-current
git remote -v
git pull --rebase <HRIS_REMOTE> main
```

要求：

- 分支必须是 `main`，除非用户明确指定其他受控流程；
- 有非本轮改动时先确认归属，使用路径白名单隔离，禁止混入；
- 不 reset、不覆盖、不自动处理无法判断的冲突；
- 记录本轮开始 HEAD，供最终核对 commit 范围。

## Step 2：分类、命名与路径白名单

| 材料类型 | 目标目录 |
|---|---|
| 在途项目原始材料 | `进行中项目文档/<项目名>/` |
| 历史归档材料 | `各系统历史文档/<年月-项目>/` |
| 权威知识新增或修订 | `HR系统知识库/` 对应模块 |
| 无法判断 | `收集箱/` |

文件名优先使用 `日期-项目-文档类型-版本`。自动重命名必须在 source commit 前展示结果。

建立本轮允许提交路径清单。source commit 禁止包含：

- `.qoder/repowiki/`；
- `.agent-wiki/`；
- 非本轮文件；
- 其他 Agent 已有的暂存内容。

## Step 3：敏感扫描【硬卡点】

对所有 source commit 候选逐项扫描：

| 模式 | 处理 |
|---|---|
| 18 位身份证号 | 命中即停止 |
| 13～19 位连续银行卡号 | 命中即停止 |
| `token`、`secret`、`password`、`密码`、`access_key` | 命中即停止并复核上下文 |
| 人名与薪酬、工资、补偿金等相邻出现 | 命中即停止 |
| 账号、Cookie、私钥、访问凭证 | 命中即停止 |

列出命中文件和位置，先脱敏再重跑。用户声称已脱敏时仍需复核。

## Step 4：大文件与二进制摘要

- 单文件超过 50 MB：不入库，改为受控存储链接；
- 视频不入库；
- PDF、PPT、Excel、Word 生成同名 Markdown 摘要，写明日期、主题、关键结论和涉及系统；
- 摘要属于 source commit 候选，同样接受敏感扫描。

## Step 5：知识关联检查

修改 `HR系统知识库/` 时必须：

1. 检索同系统、同口径、同项目主题的既有文件；
2. 新内容添加相对链接；
3. 被关联文件补反向引用；
4. 新知识文件登记到模块总览和 `README.md`；
5. 运行 `python3 scripts/verify_links.py`，若仓库没有该脚本则使用现有等价校验并说明。

口径变化还要追加“口径变更记录”。

## Step 6：创建 source commit

只暂存路径白名单：

```bash
git add -- <本轮权威知识与材料路径>
git diff --cached --stat
git diff --cached --check
git commit -m "docs(<模块或项目>): <知识更新摘要>"
```

提交前展示文件清单。记录 `<SOURCE_COMMIT>`。此 commit 不得包含 Repo Wiki 或 `.agent-wiki` 文件，也不得在此时 push。

## Step 7：强制同步核心 Wiki

source commit 成功后，读取 `update-repowiki`；若 Agent 未安装该 Skill，则读取中央仓 `.qoder/skills/update-repowiki/SKILL.md`。在中央仓执行完整流程。

允许的返回状态：

- `READY_NO_WIKI_CHANGE`：已检查，本轮不需要 Wiki commit；
- `READY_WITH_WIKI_COMMIT <hash>`：已生成并校验 Wiki commit；
- `BLOCKED <原因>`：停止事务，不 push。

不得因为 Wiki 更新复杂、存在未映射来源或页面无需变化而跳过；必须编辑、记录 `reviewed`、记录 `ignored`，或明确阻塞。

## Step 8：派生内容复核

在 Wiki commit 创建前或提交完成后、push 前，对以下范围再次执行敏感扫描：

- `.qoder/repowiki/` 的本轮 diff；
- `.agent-wiki/manifest.json`；
- `.agent-wiki/source-index.json`。

确认 `update-repowiki validate` 通过，并检查两个 commit 之间没有夹带其他文件。命中敏感信息或校验失败时停止，不 push。

## Step 9：统一推送

只有以下条件全部满足才可推送：

- source commit 已创建；
- Wiki 返回 `READY_NO_WIKI_CHANGE` 或有效 Wiki commit；
- 两轮敏感扫描和链接/Wiki 校验通过；
- 用户已授权推送。

```bash
git log --oneline <本轮开始HEAD>..HEAD
git push <HRIS_REMOTE> main
```

直接入库请求中的“提交、同步、入库”以及 `archive-project` 的确认步骤可作为本轮限定范围的 push 授权；用户要求“仅本地、先预览”时不得 push。

推送被拒时可执行 `git pull --rebase <HRIS_REMOTE> main` 后重试；发生冲突立即停止，不强推。

## Commit 规范

- 项目总结：`docs(总结-<项目名>): <阶段或结项摘要>`
- 直接材料：`docs(<模块或项目>): <材料摘要>`
- Repo Wiki：`docs(repowiki): sync <项目或知识主题>`

最终汇报 source commit、Wiki commit 或无变更原因、目标远端名、分支和推送结果。

## 中途失败

保留文件改动和已创建的本地 commit，不自动回滚。说明事务停在哪个门禁以及恢复命令；在 `BLOCKED` 状态解除前禁止 push。
