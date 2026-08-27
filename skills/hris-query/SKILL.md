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

默认零配置：CLI 首次运行时自动浅克隆 CNB 中央仓（`https://cnb.cool/Chordsun/HRIS.git`）到用户主目录下的 `~/.cache/hris-wiki/HRIS`（Windows 上即 `C:\Users\<you>\.cache\hris-wiki\HRIS`；可用 `HRIS_WIKI_CACHE` 覆盖缓存目录），之后每次运行自动 `git pull` 保持内容新鲜。

### 首次使用：公司邮箱认证

首次自动克隆前会要求身份认证：

1. 交互式终端会提示输入公司邮箱；非交互环境（Agent、CI、脚本）请设置 `HRIS_WIKI_EMAIL=<邮箱>`；
2. 仅接受以 `@pwrd.com` 结尾的邮箱，其他邮箱一律拒绝；
3. 认证通过后，用户名与只读令牌保存到 `~/.cache/hris-wiki/auth.json`（权限 600），今后无需再次认证。

```bash
# 非交互环境示例
export HRIS_WIKI_EMAIL=yourname@pwrd.com
hris-wiki query 试用期转正
```

> 注意：该认证只是使用引导层面的门槛；内置的只读令牌随本仓库公开分发，
> 不构成真正的访问控制，请勿将知识库内容转发给公司外部。

若本机已有知识仓 clone，可显式指定以避免触发自动克隆与认证：

```bash
export HRIS_WIKI_REPO=/path/to/hris-knowledge-repo
```

Windows（cmd）下等价写法为 `set "HRIS_WIKI_REPO=C:\path\to\hris-knowledge-repo"`。

自动克隆所需的只读令牌已内置于 CLI，通过邮箱认证后即可使用；克隆失败时向用户说明并检查邮箱认证状态或网络。无法访问知识库时，明确告知用户"未在本地知识库找到"，不得假装已检索，也不得猜测本机路径。

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

    `%SKILL_DIR%` 由 Skill 宿主注入；手动使用时替换为本机绝对路径，例如 `C:\Users\<you>\.workbuddy\skills\hris-query`。
  - 或在 PATH 目录放一个 `hris-wiki.bat`（模板见 `scripts/hris-wiki.bat`），之后即可 `hris-wiki query <关键词>`。

注意：脚本首行的 `#!/usr/bin/env python3` shebang 只在 macOS / Linux / Git Bash 下生效；Windows 原生 cmd / PowerShell 会忽略它，必须通过 `python`（或 `py`）显式调用，不能双击运行。

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

未链接到 PATH 时直接运行脚本即可：

- macOS / Linux：`python3 "$SKILL_DIR/scripts/hris-wiki" ...`
- Windows：`python "%SKILL_DIR%\scripts\hris-wiki" ...`（`python3` 不可用时改用 `python` 或 `py`）

两种写法均可加 `--repo <路径>` 显式指定知识仓。Agent 宿主（如 WorkBuddy）场景下，`SKILL_DIR` 由宿主解析提供，Agent 应使用宿主给出的绝对路径，不要自行拼接 `~` 或 `$SKILL_DIR`。

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
| 自动克隆失败 | 确认邮箱认证已通过（`@pwrd.com`）、网络可达；仍失败则向仓库管理员确认仓库状态 |
| 镜像更新失败（离线/令牌失效） | CLI 会警告并沿用现有副本；回答时注明知识可能滞后；令牌失效需联系仓库管理员更换内置令牌 |
| `.qoder/repowiki` 缺失 | 提示 clone 不完整，建议删除缓存目录重试或 `git pull` |
| 检索全部无命中 | 明确声明未找到，再按通用知识作答 |
