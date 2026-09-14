---
name: hris-query
description: HRIS 知识库只读查询。任何涉及 HR 系统的问题（HCM/人财一体、绩效、试用期转正、招聘TA、权限角色、数据口径、保密文档、组织架构、HR月报、HRIS 系统集成、外派补贴等）在回答前必须先通过本 Skill 检索中央 HRIS 知识库的本地 clone，再结合检索结果作答，不得凭记忆编造 HRIS 业务细节。只读，永不写入或推送知识仓。
---

# hris-query · HRIS 知识库只读查询

让 Agent 在回答 HRIS 业务问题前，先检索中央 HRIS 知识仓（远端含 `cnb.cool/Chordsun/HRIS`）的本地 clone，查询按权威度分层并自动标注：

- ① 权威知识库 `HR系统知识库/`：现行权威口径源文件，引用优先；
- ② Repo Wiki `.qoder/repowiki/`：`zh/content/` 面向人的 Wiki 页面 + `knowledge/zh/` 面向 Agent 的 Knowledge Card（含 `_index.yaml` 索引）；
- ③ 历史归档摘要 `各系统历史文档/`：2019-2024 历史口径（如 Michelle 交接归档），引用注意时效；
- ④ 进行中文档 `进行中项目文档/`：在途未定稿，默认不搜，`query --all` 开启；
- `.agent-wiki/source-index.json`：源文件/目录 → Wiki 页面的公共索引（支持目录级 scope 反查）。

每条检索结果标注层级与最后更新年月；`未提交` 表示文件尚未纳入 git 跟踪（草稿），`-` 表示日期不可用。

## 前置条件

默认零配置：CLI 首次运行时自动浅克隆 CNB 中央仓（`https://cnb.cool/Chordsun/HRIS.git`）到用户主目录下的 `~/.cache/hris-wiki/HRIS`（Windows 上即 `C:\Users\<you>\.cache\hris-wiki\HRIS`；可用 `HRIS_WIKI_CACHE` 覆盖缓存目录），之后每次运行自动 `git pull` 保持内容新鲜。认证由用户输入完成，令牌保存到 `~/.cache/hris-wiki/auth.json`（权限 600）并用于镜像更新。

### 首次使用：邮箱认证 + 管理员令牌

首次自动克隆前需要完成认证：

1. 输入公司邮箱：交互式终端会直接提示；非交互环境（Agent、CI、脚本）设置 `HRIS_WIKI_EMAIL=<邮箱>`。仅接受以 `@pwrd.com` 结尾的邮箱，其他邮箱一律拒绝；
2. 提供访问令牌：向知识库管理员索取 `cnb.cool/Chordsun/HRIS` 的只读令牌（CNB 个人令牌），交互式提示输入，非交互环境设置 `HRIS_WIKI_TOKEN=<令牌>`，可用 `HRIS_WIKI_USERNAME=<用户名>` 指定 Git 用户名（默认 `cnb`）；
3. 认证通过后，邮箱、用户名与令牌保存到 `~/.cache/hris-wiki/auth.json`（权限 600），今后无需再次认证。

```bash
# 非交互环境示例
export HRIS_WIKI_EMAIL=yourname@pwrd.com
export HRIS_WIKI_TOKEN=<管理员发放的只读令牌>
hris-wiki query 试用期转正
```

> 令牌属于个人凭据，请勿分享或提交到任何仓库；令牌泄露或失效时向管理员申请更换。

若本机已有知识仓 clone，可显式指定以避免触发自动克隆与认证：

```bash
export HRIS_WIKI_REPO=/path/to/hris-knowledge-repo
```

Windows（cmd）下等价写法为 `set "HRIS_WIKI_REPO=C:\path\to\hris-knowledge-repo"`。

自动克隆使用首次认证时保存的个人令牌；克隆失败时向用户说明并检查令牌是否有效。无法访问知识库时，明确告知用户"未在本地知识库找到"，不得假装已检索，也不得猜测本机路径。

#### 链接到 PATH（可选，跨平台）

- **macOS / Linux**（一次性）：

  ```bash
  ln -sf "$SKILL_DIR/scripts/hris-wiki" ~/.local/bin/hris-wiki
  ```

- **Windows**（无 `ln` / `~/.local/bin`，且 `python3` 通常不在 PATH）：
  - 直接用 Python 运行脚本（推荐的手动使用方式）：

    ```bat
    python "%SKILL_DIR%\scripts\hris-wiki" query <关键词>
    ```

    `%SKILL_DIR%` 由 Skill 宿主注入；手动使用时替换为本机实际路径（例如 `%CODEX_HOME%\skills\hris-query`，或在 WorkBuddy 环境下如 `%USERPROFILE%\.workbuddy\skills\hris-query`）。
  - 或在 PATH 目录放一个 `hris-wiki.bat`（模板见 `scripts/hris-wiki.bat`），之后即可 `hris-wiki query <关键词>`。

注意：脚本首行的 `#!/usr/bin/env python3` shebang 只在 macOS / Linux / Git Bash 下生效；Windows 原生 cmd / PowerShell 会忽略它，必须通过 `python`（或 `py`）显式调用，不能双击运行。

## 何时使用

用户问题涉及 HR 系统业务规则、流程参数、数据口径、权限角色、系统清单、项目进展等，一律先查后答。典型触发：HCM、人财一体、预算冻结、绩效、试用期转正、招聘 TA、HR 月报、保密文档、外派补贴、组织架构、PS/PeopleSoft 集成。

## 查询命令

```bash
hris-wiki query [--or] [--all] <关键词>...   # 全文检索（默认多词 AND，--or 任一命中；--all 追加④进行中文档）
hris-wiki cards [关键词]           # 浏览知识卡索引
hris-wiki ref <源文件或目录路径>   # 反查引用某源文件/目录（含目录级 scope）的 Wiki 页面
hris-wiki show <页面相对路径>      # 读取页面全文（含 file:// 行级溯源）
hris-wiki repo                     # 输出知识仓根路径
```

未链接到 PATH 时直接运行脚本即可：

- macOS / Linux：`python3 "$SKILL_DIR/scripts/hris-wiki" ...`
- Windows：`python "%SKILL_DIR%\scripts\hris-wiki" ...`（`python3` 不可用时改用 `python` 或 `py`）

两种写法均可加 `--repo <路径>` 显式指定知识仓。Agent 宿主（如 WorkBuddy）场景下，`SKILL_DIR` 由宿主解析提供，Agent 应使用宿主给出的绝对路径，不要自行拼接 `~` 或 `$SKILL_DIR`。

## 检索策略

1. 先用 `query` 以业务关键词检索（多词 AND 收窄结果；过窄时换词或加 `--or`）；无命中时换同义词、状态码或模块名重试，最多 3 轮；
2. 结果按层级引用：优先采纳 ① 权威知识库与 ② Repo Wiki；③ 历史归档仅作历史口径参考，引用时注明"历史口径，注意时效"；④ 进行中文档仅在显式 `--all` 检索时参考，须标注"在途未定稿"；
3. 命中后用 `show` 读取相关页面全文，按页面中的 `file://` 溯源核对原始口径；
4. 需要确认覆盖面时用 `cards` 与 `ref` 交叉验证（归档目录可直接 `ref <目录路径>`）；
5. 本地确实无命中，才可退回通用知识或联网检索，并在回答中声明"未在本地知识库找到"。

## 回答规范

- 结论必须给出 Wiki 页面路径与（如有）`file://` 行级溯源；
- Wiki 结论与实际代码、最新 PRD 或源文件冲突时，以源文件为准并向用户指出差异；
- 操作主体防推断【硬规则】：涉及“谁发起、谁审批、谁操作、自动还是手动”的结论必须以知识库明文主语为据。知识库仅有被动句（如“入职满 4.5 个月时开启评价”）或未写明主体时，必须回答“知识库未明确该步骤由谁执行”，可并列候选解读但不得选定其一作为确定结论，并提示该口径疑似知识库缺口、建议以 PRD 等一手材料核实或走入库流程补充；
- 知识仓标记为保密的内容不得外发或粘贴到外部系统。

## 只读边界

本 Skill 只做检索与阅读：

- 不修改知识仓任何文件，不执行 git commit / push / rebase；
- 仅有的 git 写盘动作是自动镜像的克隆与 `git pull --ff-only` 更新，只作用于 `~/.cache/hris-wiki` 镜像副本，不影响任何用户仓库；
- 不调用写入类 Skill（入库、同步请走 `archive-project` / `submit-knowledge` / `update-repowiki`）。

## 失败处理

| 现象 | 处理 |
|---|---|
| 自动克隆失败 | 确认邮箱（`@pwrd.com`）与令牌均有效；令牌无效或无权限时联系知识库管理员重新发放 |
| 镜像更新失败（离线/令牌失效） | CLI 会警告并沿用现有副本；回答时注明知识可能滞后；令牌失效时删除 `auth.json` 重新认证 |
| `.qoder/repowiki` 缺失 | 提示 clone 不完整，建议删除缓存目录重试或手动 `git pull` |
| 结果标注"已跳过 N 个云端未取回的占位文件" | 知识仓位于 iCloud 等按需同步盘，部分文件未下载；如需检索可在访达中打开或 `brctl download <路径>` 后重试 |
| 结果日期显示 `-` | git 历史查询超时或镜像为浅克隆（无完整历史）；不影响内容检索，仅时效标注缺失 |
| 检索全部无命中 | 明确声明未找到，再按通用知识作答 |
| 多来源均为无主语被动句 | 视为知识库缺口信号：声明“知识库未明确操作主体”，禁止推断为系统自动或人工，建议补充一手材料入库 |
