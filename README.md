# Situational Awareness Manager (SAM) Extension for SillyTavern

**SAM Extension** 是 SillyTavern 的一个高级辅助插件，旨在为您的角色提供持久且动态的“态势感知”能力。

它是 **SAM Core Script** 的后端伴侣，负责处理繁重的自动化任务：生成分层摘要、维护动态知识库（Database），并提供可视化的管理界面。

> [!IMPORTANT]
> **本插件无法独立工作**。它是核心逻辑脚本的扩展载体。
> 请务必先下载并加载核心脚本：👉 **[core.js的链接](https://github.com/DefinitelyNotProcrastinating/ST_var_manager/blob/main/core.js)**

---

## ✨ 主要功能

*   **自动摘要 (Auto-Summarization)**:
    *   基于 FSM (有限状态机) 自动监测聊天进度。
    *   生成分层摘要（L1/L2/L3），将旧的聊天记录转化为连贯的剧情梗概。
    *   支持自定义摘要触发频率和 Prompt。
*   **动态数据库 (Dynamic Database)**:
    *   自动提取对话中的新设定（新角色、地点、物品），并将其转化为结构化的 `@.insert()` 指令存储。
    *   利用向量化或关键词匹配（取决于具体实现）在需要时调取相关设定。
*   **可视化仪表盘 (React UI)**:
    *   **摘要管理**: 查看、编辑或删除已生成的摘要。
    *   **数据概览**: 直接查看和修改底层的 JSON 数据 (SAM_data)。
    *   **Regex 过滤器**: 配置正则表达式，在摘要前清洗聊天记录（如去除心理活动或系统提示）。
    *   **设置面板**: 调整检查点频率、开关插件等。
*   **便捷宏 (Macros)**:
    *   提供两个核心宏，方便在 Prompt 或世界书中直接注入记忆和设定。

---

## 📦 安装方法

1.  打开 SillyTavern 的 **Extensions** (扩展) 选项卡。
2.  点击 **Install Extension**。
3.  输入本仓库的 URL 并安装。
4.  安装完成后，确保插件已启用。

---

## ⚙️ 配置与使用

### 1. 激活插件 (World Info 绑定)
为了防止插件在不相关的聊天中误触发，SAM 需要一个“锚点”。
*   在 SillyTavern 中为您当前的角色或世界书创建一个新的 **World Info (世界书)** 条目。
*   在该条目的 **Comment (注释)** 字段中填入以下标识符：
    ```text
    __SAM_IDENTIFIER__
    ```
*   插件检测到此标识符后，状态栏将从 "MISSING ID" 变为 "IDLE" 或 "Active"。

### 2. 注入宏 (Macros)
本插件注册了两个宏，您可以在 **World Info**、**Author's Note** 或 **Main Prompt** 中使用它们来让 AI 读取记忆：

| 宏名称 | 描述 |
| :--- | :--- |
| `{{SAM_serialized_memory}}` | 输出当前已生成的剧情摘要序列（L1/L2/L3）。 |
| `{{SAM_serialized_db}}` | 输出从对话中自动提取并存储的设定/知识库条目。 |

**示例用法 (推荐添加到 Main Prompt 或 Character Note):**

```text
[长期记忆]
{{SAM_serialized_memory}}

[当前已知情报]
{{SAM_serialized_db}}
```

### 3. 管理界面
点击扩展栏中的 **SAM Extension** 抽屉，然后点击 **Open Configuration Manager** 打开悬浮窗口。
*   **Summary**: 监控摘要生成进度，手动触发摘要，或修补 AI 生成的摘要内容。
*   **Regex**: 添加规则以过滤掉不希望进入摘要的内容（例如 `（.*）` 过滤括号内的动作）。
*   **Data**: 面向高级用户，直接编辑 JSON 状态树。

---

## 🤖 工作原理

1.  **监控**: 插件会在后台静默运行，根据设定的 `l2_summary_period` 监测聊天消息数量。
2.  **生成**: 当达到阈值时，它会暂停主线程，打包最近的聊天记录，并发送给 LLM 进行处理。
3.  **解析**: LLM 返回的内容会被解析为两部分：
    *   **L2摘要**: 添加到 `{{SAM_serialized_memory}}`。
    *   **插入指令**: 格式为 `@.insert(key="...", content="...", keywords=[...])` 的内容会被提取并存入数据库，供 `{{SAM_serialized_db}}` 调用。
4.  **更新**: 聊天记录会被更新，插入一个隐藏的数据块（Data Block），确保状态在页面刷新后依然保留。

---

## ⚠️ 注意事项

*   **Core Script**: 再次提醒，请配合 [core.js的链接](https://github.com/DefinitelyNotProcrastinating/ST_var_manager/blob/main/core.js) 使用以获得完整的逻辑支持。
*   **Token 消耗**: 生成摘要会产生额外的后台请求，请留意您的 API 使用量。
*   **数据备份**: 虽然插件有自动 Checkpoint 功能，但在进行大规模手动修改 Data JSON 前，建议备份您的聊天记录。

---
