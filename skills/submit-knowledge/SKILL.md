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

## 动作授权与预览

执行前核对本地写入、commit 与 push 各自的授权范围。预览请求止于可审阅的总结和拟变更内容，不进入实际写入、提交或推送步骤。已有同范围准确授权由上游传递，不因调用本 Skill 而重问；专项扫描和校验门禁仍然必须通过。

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

先只读检查并记录当前状态，尚未完成以下核实时不要 pull、rebase、stash 或写入文件：

```bash
git status --porcelain
git branch --show-current
git remote -v
git rev-parse HEAD
```

- 分支必须是 `main`，除非用户明确指定其他受控流程；
- 有非本轮改动时先从现有记录核实归属，使用路径白名单隔离；无法判断或安全隔离时暂停相关写入，禁止混入；
- 不 reset、不覆盖、不自动 stash，也不自动处理无法判断的冲突；
- 仅在中央仓本地写入已授权、目标分支正确且工作区干净时，fetch 匹配远端并检查分叉；可快进时用 `git merge --ff-only <HRIS_REMOTE>/main` 更新基线，已是最新则继续；
- 存在未发布提交时核实其归属和最终推送范围。rebase 或其他历史改写需要覆盖具体提交和影响的授权；不足时只暂停相关同步，不自动改写已有提交；
- 更新后记录本轮开始 HEAD，供最终核对 commit 范围。由 archive-project 调用且本轮已开始写入时，继承其已核实的基线，不重复拉取或改写正在进行的事务。

## Step 2：分类、命名与路径白名单

| 材料类型 | 目标目录 |
|---|---|
| 在途项目原始材料 | `进行中项目文档/<项目名>/` |
| 历史归档材料 | `各系统历史文档/<年月-项目>/` |
| 权威知识新增或修订 | `HR系统知识库/` 对应模块 |
| 无法判断 | `收集箱/` |

文件名优先使用 `日期-项目-文档类型-版本`。自动重命名必须在 source commit 前展示结果。

一手权威材料与提炼知识同批入库：业务规则、时间口径、流程状态的权威源（PRD、方案、口径定义等）必须与对应提炼产物进入同一轮 source commit，落点 `进行中项目文档/<项目名>/`。提炼知识引用了未入库的一手材料时，在确认环节提示补齐；否则该知识在库内无法溯源，派生 Wiki 也无从校验。

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
5. 运行 `python3 scripts/verify_links.py`，若仓库没有该脚本则使用现有等价校验并说明；
6. 主语完整性检查：时间规则、流程节点、审批与发起类句子必须含操作主体。一手材料带主语而提炼句丢失（如“HRBP 开启评价”变成“开启评价”）判为知识衰减，退回修正后再提交；一手材料本身无主语时照原文入库，但在汇报中标注“该口径未写明操作主体”。

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

推送必须有针对具体远端、分支和本轮文件范围的明确批准；不单凭“提交”“同步”“入库”等词推定 push 授权。可以继承 `archive-project` 已展示这些信息并明确获得的本轮 push 批准，不重复询问同一批准。用户要求“仅本地”时不得 push；要求“先看结果”“先预览”时只给预览，不修改中央仓、不 commit、不 push。

推送被拒时，先检查认证、远端分叉及受影响提交，并在已有授权内恢复。需要 rebase 或其他历史改写时，核对授权是否覆盖具体提交和影响；不足时只暂停该同步步骤并请求相应决定，不自动改写。同步改变提交或内容后重新运行受影响的敏感扫描、链接/Wiki 校验并记录新 hash，再按原推送授权重试；授权范围变化时重新确认。发生无法安全处理的冲突时停止相关操作，保留现场，不强推。

## Commit 规范

- 项目总结：`docs(总结-<项目名>): <阶段或结项摘要>`
- 直接材料：`docs(<模块或项目>): <材料摘要>`
- Repo Wiki：`docs(repowiki): sync <项目或知识主题>`

最终汇报 source commit、Wiki commit 或无变更原因、目标远端名、分支和推送结果。

## 中途失败

保留文件改动和已创建的本地 commit，不自动回滚。说明事务停在哪个门禁以及恢复命令；在 `BLOCKED` 状态解除前禁止 push。
