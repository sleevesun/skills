---
name: hris-query
description: HRIS 知识库只读查询。任何涉及 HR 系统的问题（HCM/人财一体、绩效、试用期转正、招聘TA、权限角色、数据口径、保密文档、组织架构、HR月报、HRIS 系统集成、外派补贴等）在回答前必须先通过本 Skill 检索中央 HRIS 知识库的本地 clone，再结合检索结果作答，不得凭记忆编造 HRIS 业务细节。只读，永不写入或推送知识仓。
---

# hris-query · HRIS 知识库只读查询

让 Agent 在回答 HRIS 业务问题前，先检索中央 HRIS 知识仓（远端含 `cnb.cool/Chordsun/HRIS`）的本地 clone：

- `.qoder/repowiki/zh/content/`：面向人的 Repo Wiki；
- `.qoder/repowiki/knowledge/zh/`：面向 Agent 的 Knowledge Card（含 `_index.yaml` 索引）；
- `.agent-wiki/source-index.json`：源文件 → Wiki 页面的公共索引。

## 前置条件

默认零配置：CLI 首次运行时自动浅克隆 CNB 中央仓（`https://cnb.cool/Chordsun/HRIS.git`）到 `~/.cache/hris-wiki/HRIS`（可用 `HRIS_WIKI_CACHE` 覆盖缓存目录），之后每次运行自动 `git pull` 保持内容新鲜。

若本机已有知识仓 clone，可显式指定以避免重复克隆：

```bash
export HRIS_WIKI_REPO=/path/to/hris-knowledge-repo
```

仓库为私有时，自动克隆需要本机已配置 CNB 访问凭据（git 登录态或 token）；克隆失败时向用户说明需申请 `cnb.cool/Chordsun/HRIS` 读取权限。无法访问知识库时，明确告知用户"未在本地知识库找到"，不得假装已检索，也不得猜测本机路径。

建议把本 Skill 自带的 CLI 链接到 PATH（一次性）：

```bash
ln -sf "$SKILL_DIR/scripts/hris-wiki" ~/.local/bin/hris-wiki
```

## 何时使用

用户问题涉及 HR 系统业务规则、流程参数、数据口径、权限角色、系统清单、项目进展等，一律先查后答。典型触发：HCM、人财一体、预算冻结、绩效、试用期转正、招聘 TA、HR 月报、保密文档、外派补贴、组织架构、PS/PeopleSoft 集成。

## 查询命令

```bash
hris-wiki query <关键词>...        # 全文检索（多词自动分词，OR 匹配）
hris-wiki cards [关键词]           # 浏览知识卡索引
hris-wiki ref <源文件路径>         # 反查引用某源文件的 Wiki 页面
hris-wiki show <页面相对路径>      # 读取页面全文（含 file:// 行级溯源）
hris-wiki repo                     # 输出知识仓根路径
```

未链接到 PATH 时可直接运行 `python3 "$SKILL_DIR/scripts/hris-wiki" ...`，或加 `--repo <路径>` 显式指定知识仓。

## 检索策略

1. 先用 `query` 以业务关键词检索；无命中时换同义词、状态码或模块名重试，最多 3 轮；
2. 命中后用 `show` 读取相关页面全文，按页面中的 `file://` 溯源核对原始口径；
3. 需要确认覆盖面时用 `cards` 与 `ref` 交叉验证；
4. 本地确实无命中，才可退回通用知识或联网检索，并在回答中声明"未在本地知识库找到"。

## 回答规范

- 结论必须给出 Wiki 页面路径与（如有）`file://` 行级溯源；
- Wiki 结论与实际代码、最新 PRD 或源文件冲突时，以源文件为准并向用户指出差异；
- 知识仓标记为保密的内容不得外发或粘贴到外部系统。

## 只读边界

本 Skill 只做检索与阅读：

- 不修改知识仓任何文件；
- 不执行 git commit / push / pull / rebase；
- 不调用写入类 Skill（入库、同步请走 `archive-project` / `submit-knowledge` / `update-repowiki`）。

## 失败处理

| 现象 | 处理 |
|---|---|
| 自动克隆失败 | 提示用户配置 CNB 凭据或向仓库管理员申请 `cnb.cool/Chordsun/HRIS` 访问权限 |
| 镜像更新失败（离线/凭据过期） | CLI 会警告并沿用现有副本；回答时注明知识可能滞后 |
| `.qoder/repowiki` 缺失 | 提示 clone 不完整，建议删除缓存目录重试或 `git pull` |
| 检索全部无命中 | 明确声明未找到，再按通用知识作答 |
