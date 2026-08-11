---
name: workbuddy-skin-studio
description: "生成、校验和打包可分享的 WorkBuddy .wbtheme.zip 主题包。用于根据本地图片和主题描述创建主题、预览或验证主题包、打包主题，或在 macOS/Windows 上安全应用和恢复 WorkBuddy 主题。"
---

# WorkBuddy Skin Studio

这是一个在安装者本机 WorkBuddy 中运行的主题包生成 Skill。它读取用户选择的图片和主题描述，生成可分享的 `.wbtheme.zip`；交付包包含平台对应的一键启动器，接收者解压后双击即可应用，不需要打开终端。

## 首次安装

在 Skill 目录运行 `npm ci` 安装锁定版本的 `@codedrobe/core`，再运行 `npm test`。不得提交或分发 `node_modules`。WorkBuddy 位于非标准路径时，macOS 可设置 `WORKBUDDY_APP` 或 `WORKBUDDY_EXECUTABLE`，Windows 可设置 `WORKBUDDY_EXECUTABLE`。缺少依赖或找不到应用时停止并说明配置方法，不自动从网络安装软件。

## 输入

- 主题 ID、显示名称和主题描述。
- 一张本地图片；图片只会复制进包内 `theme.codedrobe-theme/assets/`，不会把原始绝对路径写入包。
- 目标平台：`macos`、`windows` 或 `both`。
- 可选强调色。

## 输出

Skill 会生成并校验一个主题目录，再打包为 `.wbtheme.zip`。包包含外层 `manifest.json`、使用说明、预览、视觉卡片、内层声明式 `.codedrobe-theme`、固定版本 runtime、平台入口和一键启动器：macOS 为 `.app`，Windows 为隐藏窗口的 `.vbs`。

内层主题仍是数据包，不得包含可执行 JavaScript，不包含远程资源、密钥、用户绝对路径，也不会修改 `app.asar`。外层启动器是固定、受审计的包装层，只能调用包内 runtime 和对应平台入口，不能执行主题包中的任意脚本；如果缺少可用运行时或 WorkBuddy，必须弹出错误并 fail closed。

在 macOS 上等待 WorkBuddy 完全退出，再直接启动应用包内的 Electron，并传入仅绑定 `127.0.0.1:9336` 的调试参数；不要用 LaunchServices 环境变量代替 Electron 参数。Windows 同样只向已验证的 WorkBuddy 启动入口传入本机回环调试参数。不要改写应用包，也不要把主题内容当作脚本执行。

重启后等待 CDP 就绪并重新探测 renderer，执行 DOM 地标预检，再注入 CSS。应用时必须注册新文档自动重新注入，并在当前页面使用守护器恢复被页面更新移除的样式，避免 Windows 启动阶段的页面重载让主题消失。注入后先复核样式节点、主题标记和必需地标，再进行计算样式验证和延迟稳定性复核；不能仅凭 `<style>` 节点存在就报告成功。对页面初始化期间的短暂断连进行有限重试；验证失败时注销持久注入、恢复官方样式、记录失败状态并停止。运行状态默认写入用户应用数据目录，不写回主题包。

## 应用规则

先校验主题包并展示目标平台、视觉卡片和安全摘要。交付给接收者时，优先引导其双击对应平台的一键启动器；启动器先做本地校验，再显示“重启并应用”系统确认框。任何写入或重启前必须取得用户明确确认；取消时不要重启或注入。失败时恢复或保留官方 WorkBuddy，不执行降级写入。

## 典型调用

```text
node scripts/generate-theme-package.mjs --id mayday-ashin-summer \
  --name "五月天阿信夏日舞台" \
  --description "明亮、青春、天空蓝与暖黄色舞台光" \
  --art /path/to/image.png --targets both
node scripts/validate-theme-package.mjs --package-dir ./mayday-ashin-summer.wbtheme
node scripts/pack-theme-package.mjs --package-dir ./mayday-ashin-summer.wbtheme \
  --output ./mayday-ashin-summer.wbtheme.zip
```

打包完成后，接收者直接使用：

- macOS：双击 `launchers/macos/Apply WorkBuddy Theme.app`。
- Windows：双击 `launchers/windows/Apply WorkBuddy Theme.vbs`。
- 恢复官方样式：双击对应平台的 `Restore` 启动器。

生成器、校验器和打包器都应由本机 Skill 以参数数组调用，不拼接 shell 命令；启动器只调用固定 runtime；任何路径、安全声明、平台不匹配或运行时缺失都必须 fail closed。
