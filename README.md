# Situational Awareness Manager (SAM) Extension

**Situational Awareness Manager (SAM)** 是一个专为 SillyTavern 设计的高级扩展插件。它是 SAM 核心脚本（Core Script）的可视化管理前端与辅助工具。
核心脚本位于此处：
https://github.com/DefinitelyNotProcrastinating/ST_var_manager/core.js

本插件旨在赋予 AI 角色更强的“情境感知”能力，通过可视化的方式管理 AI 的内部状态（State）、自动处理剧情总结、以及编辑存储在世界书（World Info）中的逻辑函数库。

## ✨ 主要功能

### 1. 🧠 状态管理 (Data State Manager)
*   **可视化 JSON 编辑**：直接查看和编辑 AI 当前的内部状态（`SAM_data`）。
*   **实时同步**：支持从后端获取最新状态，并手动提交更改（Commit）到当前的对话历史中。
*   **类型保护**：提供选项防止数据类型突变（Disable Data Type Mutation）。

### 2. 📝 智能总结系统 (Auto Summarization)
*   **自动触发**：根据设定的对话轮数频率（如每 30 条消息），自动在后台生成剧情总结。
*   **自定义提示词**：完全可配置的总结 Prompt，支持字数限制（Word Count）。
*   **静默生成**：使用 SillyTavern 的 Quiet Prompt 技术，不干扰当前对话。
*   **上下文优化**：支持在生成总结时跳过 World Info / Author's Note，以节省 Token 并聚焦于对话本身。

### 3. 🛠️ 函数库编辑器 (Function Library)
*   **World Info 集成**：直接在插件内编写 JavaScript 函数，并将其自动保存/注入到角色的世界书（World Info）中。
*   **高级配置**：为每个函数单独设置超时时间（Timeout）、执行顺序（Order）、周期性执行（Periodic Eval）以及网络访问权限（Network Access）。

### 4. ⚙️ 核心控制与设置
*   **自动检查点 (Auto Checkpoint)**：定期将 AI 状态保存到聊天记录中，方便回溯。
*   **状态监控**：实时显示 SAM Core 的运行状态（IDLE, PROCESSING, AWAIT_GENERATION）。
*   **防呆设计**：当检测不到角色卡中的 SAM 标识符时，自动锁定界面以防误操作。

## 📦 安装与依赖

### 必要依赖
本插件依赖于 **[JS-slash-runner](https://github.com/n0vi028/JS-slash-runner)** (by n0vi028) 来执行脚本逻辑。请确保你的 SillyTavern 已安装并启用了该插件。
本插件是 [SAM core]https://github.com/DefinitelyNotProcrastinating/ST_var_manager/core.js 的前端/编辑器。请确保卡内附带了这个脚本。

## 🚀 使用指南

### 1. 激活检测
插件启动时会自动检测当前加载的角色 World Info 中是否存在 `__SAM_IDENTIFIER__`。
*   **未检测到**：插件界面会显示警告，大部分功能将被锁定。
*   **检测成功**：状态栏显示 "Active"，所有功能解锁。

### 2. 界面概览
插件会在 SillyTavern 的扩展栏（Extensions Panel）中添加一个 **SAM Extension** 抽屉。点击 "Open Configuration Manager" 即可打开悬浮主窗口。

#### 💾 Data (数据面板)
*   这里显示原本隐藏在聊天记录中的 JSON 数据块。
*   你可以手动修改数值（例如角色的心情值、背包物品等），然后点击 **Commit Data Changes** 保存。

#### 📜 Summary (总结面板)
*   配置总结频率（Frequency）和最大字数（Max Words）。
*   查看历史生成的总结列表（Saved Response Summaries）。
*   点击 **Generate Summary Now** 手动触发一次总结。

#### 🔧 Functions (函数面板)
*   管理角色的逻辑脚本。
*   点击 `+` 新增函数，编辑 JS 代码。
*   点击 **Save to World Info** 将函数库写入当前角色的世界书。

#### ⚙️ Settings (设置面板)
*   全局开关 SAM 功能。
*   配置自动检查点频率。
*   切换 "Uniquely Identified Paths" 等高级数据选项。

## ⚠️ 注意事项

*   **手动刷新**：虽然插件会监听 Core 事件，但如果你手动修改了聊天记录或切换了聊天，建议点击界面下方的 **Refresh UI** 确保数据同步。
*   **Core 繁忙状态**：当 SAM Core 正在处理数据或生成时（状态非 IDLE），为了数据安全，编辑功能会被临时锁定。

## 🤝 贡献与反馈

如果你在使用过程中遇到 BUG 或有功能建议，欢迎提交 Issue。

---
