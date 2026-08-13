# skills

一组可复用、可独立安装的 Codex Skills，覆盖图示设计、PRD 页面标注、社交媒体知识归档、WOA 聊天总结、WorkBuddy 主题制作和浏览器驱动的多模型咨询。

Reusable Codex skills for diagramming, PRD-to-UI annotation, social-media archiving, WOA chat summarization, WorkBuddy theme packaging, and browser-based multi-model consultation.

## 包含的 Skills

| Skill | 功能 | 额外依赖 |
| --- | --- | --- |
| `excalidraw-diagramming` | 创建、编辑、校验并导出可继续编辑的 Excalidraw 图 | 能处理 `.excalidraw` 和 SVG 的工具环境 |
| `drawai-diagramming` | 创建、重构和校验 draw.io / DrawAI 图 | 推荐配置 draw.io MCP；基础 SVG 导出回退需要 Python 3 |
| `workbuddy-skin-studio` | 生成、校验和打包 WorkBuddy `.wbtheme.zip` 主题 | Node.js、npm、已安装的 WorkBuddy |
| `prd-ui-annotator` | 把 PRD 映射为页面编号标注、富文本提示和机器可读映射 | 目标前端项目及其现有构建工具 |
| `social-media-archive` | 将抖音、小红书、Bilibili 等内容整理为知识库 Markdown | 至少一种内容抓取、转写或用户提供原文的方式 |
| `summarize-woa-chat` | 在 macOS/Windows 上按群聊或联系人按需读取并总结 WOA 记录 | Node.js 22/24/26；Windows 首次使用需运行 bootstrap |
| `gpt56-sol-pro-consult` | 通过 ChatGPT Web 的 GPT 5.6 Sol Pro 获取结构化二次意见 | Codex Chrome 插件；ChatGPT 登录态和 Pro 模型权限 |
| `gemini36-flash-consult` | 通过 Gemini Web 的 3.6 Flash + 扩展思考获取二次意见 | Codex Chrome 插件；Gemini 登录态和对应模型权限 |
| `deepseek-consult` | 通过 DeepSeek Web 自动路由快速、深度思考和智能搜索/专家模式 | Codex Chrome 插件；DeepSeek 登录态 |

每个目录都是独立 Skill，只包含运行所需的说明、元数据、脚本和参考资源。

## 安装

### 使用 Codex 自带的 Skill Installer

安装单个 Skill：

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo sleevesun/skills \
  --path skills/excalidraw-diagramming
```

一次安装全部 Skill：

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo sleevesun/skills \
  --path \
    skills/excalidraw-diagramming \
    skills/drawai-diagramming \
    skills/workbuddy-skin-studio \
    skills/prd-ui-annotator \
    skills/social-media-archive \
    skills/summarize-woa-chat \
    skills/gpt56-sol-pro-consult \
    skills/gemini36-flash-consult \
    skills/deepseek-consult
```

安装完成后，在下一轮 Codex 对话中即可使用。目标目录已经存在时，安装器会停止而不会覆盖；请先自行备份或移走旧版本。

### 手动安装

克隆仓库后，将需要的目录复制到 `${CODEX_HOME:-~/.codex}/skills/`。目录名必须与 `SKILL.md` 中的 `name` 保持一致。

## 首次配置

### drawai-diagramming

优先配置能够创建、读取、编辑和导出 draw.io 文件的 MCP 工具。没有 draw.io MCP 时，Skill 对基础、未压缩的 mxGraph 文件提供 Python SVG 预览回退，但完整编辑和高保真导出仍建议使用 draw.io。

### workbuddy-skin-studio

安装后先在 Skill 目录运行：

```bash
npm ci
npm test
```

Skill 会自动寻找 WorkBuddy。非标准安装位置可通过 `WORKBUDDY_APP`（macOS 应用包）或 `WORKBUDDY_EXECUTABLE`（可执行文件）指定。主题应用会重启 WorkBuddy 并通过仅绑定回环地址的调试端口注入样式，因此执行写入或重启前必须取得用户确认。

### social-media-archive

首次使用前复制 [`configuration.example.yaml`](skills/social-media-archive/references/configuration.example.yaml)，按其中说明设置知识库根目录、索引、收件箱和可用提取工具。配置优先级为：

1. 当前请求中用户明确提供的值；
2. 项目根目录 `.social-media-archive.yaml`；
3. 环境变量 `SOCIAL_MEDIA_ARCHIVE_ROOT`；
4. 用户配置目录中的 `social-media-archive/config.yaml`；
5. 缺失时由 Skill 向用户询问，不猜测本机路径。

配置文件可能包含私人路径，默认不应提交到公开仓库。

### summarize-woa-chat

要求本机已安装 WOA，且当前系统用户已登录过。首次使用先在 Skill 目录执行：

```bash
node scripts/woa-chat.mjs doctor
```

Windows 如返回 `needs_bootstrap`，再执行 `node scripts/bootstrap.mjs`。该 bootstrap 不依赖 npm，只在 Skill 目录安装经完整性校验的固定版本 native 依赖。未指定时间时，Skill 默认按需读取最近 15 天，不创建定时任务或常驻缓存进程。

## 安全与隐私

- 仓库不包含作者本机绝对路径、账号、Token、Cookie 或登录状态。
- `social-media-archive` 只有在取得真实内容后才生成归档，不根据 URL 或标题猜测内容。
- `workbuddy-skin-studio` 不修改 `app.asar`，不允许主题包执行任意脚本或加载远程资源，并要求用户确认重启和应用操作。
- `summarize-woa-chat` 仅读取用户指定的会话和时间窗，不持久化密钥、Token 或签名 URL，不主动下载附件或发布总结。
- 使用任何第三方平台抓取工具时，请遵守平台条款、版权要求和当地法律。

## 开发与验证

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/excalidraw-diagramming
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/drawai-diagramming
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/workbuddy-skin-studio
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/prd-ui-annotator
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/social-media-archive
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/summarize-woa-chat
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/gpt56-sol-pro-consult
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/gemini36-flash-consult
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/deepseek-consult
node --test skills/summarize-woa-chat/tests/*.test.mjs
python3 -m unittest discover -s skills/gpt56-sol-pro-consult/tests -v
python3 -m unittest discover -s skills/gemini36-flash-consult/tests -v
python3 -m unittest discover -s skills/deepseek-consult/tests -v
```

各 Skill 的专项测试和依赖要求以其 `SKILL.md` 为准。

## 贡献

欢迎提交 Issue 或 Pull Request。请保持 `SKILL.md` 精简，将可执行逻辑放入 `scripts/`，详细但非必读资料放入 `references/`，并确保示例不含个人路径、内部系统信息或凭证。

## 许可

本仓库采用 [MIT License](LICENSE)。第三方依赖保留各自许可；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
