# SAM 进阶指南：构建真正的 RPG 核心

在 SAM 的体系中，**作者就是上帝**。SAM 不会凭空猜想你想要什么变量，你必须亲手定义它们。

一张合格的“SAM 驱动卡”必须形成一个完整的**数据闭环**。这个闭环由三个核心动作组成：

1.  **Persistence (存)**：通过 Checkpoint (检查点) 机制，把数据保存在聊天记录里，防止丢失。
2.  **Read (读)**：通过 EJS 代码，把后台的数据“渲染”成文本，塞进 Prompt 里让 AI 看到。
3.  **Write (写)**：通过 `@.command`，教 AI 如何修改这些数据。

接下来，我们以一个 **RPG 冒险游戏** 为例，分 8 步构建这个核心。

---

## 第一步：构思 (Conception)
**——“我到底需要什么变量？”**

不要写代码，先用脑子想。一个 RPG 游戏需要什么？
*   **基础属性**：HP（生命值）、Gold（金币）、Level（等级）。
*   **复合属性**：Inventory（背包，是一个列表）、Quests（任务，包含任务名和状态）。
*   **环境属性**：Time（当前时间）、Location（地点）。

> **作者须知**：变量越少越好。过多的变量会占用 Token，也会让 AI 变笨。只保留核心数据。

## 第二步：Schema 设计 (Schema Design)
**——“给变量造一个家”**

我们需要设计一个 JSON 结构（Schema）。在 SAM 中，所有自定义变量都放在 `static` 对象下。

```json
{
  "static": {
    "hp": 100,
    "max_hp": 100,
    "gold": 50,
    "inventory": ["生锈的剑", "面包"],
    "quests": [
      { "id": 1, "name": "讨伐史莱姆", "status": "active" }
    ]
  }
}
```
*记住这个结构，后面的读写都要依据它。*

## 第三步：明确操作逻辑 (Operation Logic)
**——“我想怎么改这些数据？”**

你需要提前规划好 AI 可能用到的操作：
*   **简单的**：扣血、加钱 -> 使用 `SET` 或 `ADD`。
*   **列表追加**：捡到一个苹果 -> 使用 `ADD` 对准 `inventory` 数组。
*   **复杂的（对象操作）**：把“讨伐史莱姆”任务的状态改为“completed” -> 这需要 `SELECT_SET`。

> **难点**：`SELECT_SET` 是 SAM 的精髓。它的逻辑是：“在列表 A 中，找到属性 B 等于 C 的那个东西，把它的属性 D 改为 E”。这使得SAM很适合处理大量复杂的object……但也让它本身变得复杂。

## 第四步：读取与渲染 (EJS Render)
**——“把数据喂给 AI 的眼睛”**

这是 SAM 区别于普通变量插件的地方。我们需要使用 **EJS (Embedded JavaScript)** 将数据动态注入到 Prompt 中。
推荐将这段代码放在 **Character Note (角色备注)** 或 **Main Prompt** 的顶部。

**写法示例：**

```ejs
[RPG System Output]
/Interact with the world based on the following state/
<%
    // 1. 从系统获取当前数据
    const sam = getvar("SAM_data");
    const s = sam ? sam.static : {}; 
    // 2. 容错处理：如果没有数据，s 就是空对象，防止报错
%>
Current Status:
- HP: ${s.hp} / ${s.max_hp}
- Gold: ${s.gold}
- Inventory: ${JSON.stringify(s.inventory)} 
- Active Quests: ${JSON.stringify(s.quests)}
```

*   **技巧**：对于背包和任务列表，直接使用 `JSON.stringify()` 是最高效的。虽然看起来像代码，但现代大模型（Claude/GPT-4）非常擅长阅读 JSON，这比你手写自然语言描述更省 Token 且更精准。

## 第五步：指令集植入 (Command ISA)
**——“教 AI 的手怎么动”**

现在 AI 看到数据了（第四步），但它还不知道怎么改。你需要把“说明书”写进 Prompt（建议放在 Depth 0 或 System Prompt）。

**Prompt 模板（针对本 RPG）：**

```text
[System Command Authorization]
You update the game state using ONLY the following commands at the end of your response:

1. Basic:
@.SET("static.hp", 90);
@.ADD("static.gold", 50); // Add gold
@.ADD("static.inventory", "Magic Potion"); // Pick up item

2. Quest Update (Advanced):
// Syntax: SELECT_SET(ListPath, MatchKey, MatchValue, TargetKey, NewValue)
// Example: Find quest with name "Kill Slime" and set status to "done"
@.SELECT_SET("static.quests", "name", "Kill Slime", "status", "done");

IMPORTANT:
- Always check the "Current Status" block before making changes.
- Output commands strictly at the very end.
```
*祈祷吧，祈祷 AI 能读懂并遵守这些语法。通常 Claude 和 GPT-4 都能完美执行，小模型可能需要更多的例子。*

## 第五步半：接入 SAM 记忆 (Memory Injection)
**——“接入长期记忆库”**

SAM 拥有自动摘要功能。我们需要把摘要内容也通过 EJS 读进来。
在 Prompt 中加入：

```text
[Past Summary]
{{SAM_serialized_memory}}

[World Knowledge Database]
{{SAM_serialized_db}}
```
*这两个 Macro 是 SAM 自带的，会自动展开为当前的剧情摘要和数据库条目。*

## 第六步：设置优先级 (Depth Settings)
**——“确保系统指令最先被看到”**

在 SillyTavern 的 **Advanced Formatting** 中：
*   将包含 EJS 渲染（第四步）和 指令集（第五步）的 Prompt 设为 **Depth = 0**（或者非常靠近 0 的位置）。
*   **原因**：AI 生成回复是“续写”。它必须**先**看到当前有多少血（状态），**再**看到怎么扣血的说明书（指令），**最后**才是剧情发展。顺序错了，逻辑就崩了。

## 第七步：初始化 (Initialization)
**——“第一推的力量”**

我们要防止“开局没数据”的尴尬。

1.  **World Info 设置**：建立 `__SAM_base_data__` 词条，填入第二步设计的 JSON。这是“出厂设置”。
2.  **First Message Checkpoint (首条消息检查点)**：
    在角色卡的 **First Message (开场白)** 的最末尾，你可以手动加入一个隐藏的数据块，强行确立初始状态。
    
    *(这需要你手动把 JSON 转为一行或紧凑格式)*
    ```text
    (开场白内容...欢迎来到冒险世界...)
    
    $$$$$$data_block$$$$$$
    { "static": { "hp": 100, "gold": 50 ... } }
    $$$$$$data_block_end$$$$$$
    ```
    *这样做的好处是，玩家一进游戏，SAM 就会立刻捕捉到这个块，第一轮对话开始时数据就已经加载完毕了。*

## 第八步：构建前端显示 (Frontend UI)
**——“给玩家看的界面”**

SAM 自身没有一直悬浮的 UI。作为作者，你肯定不希望玩家去读后台 JSON。
我们需要利用 **Regex Script** 或 **Quick Reply Script** 在每条消息下方“画”一个状态栏。

**方法：使用 Regex 脚本**
*目标：在每条 AI 回复的末尾，追加一段可视化的 HTML。*

*   **Regex Pattern**: `$` (匹配行尾)
*   **Script (JavaScript)**:

```javascript
// 这是一个伪代码示例，需要配合 ST 的脚本加载器
(async () => {
    // 1. 获取数据
    const data = await getVariables(); // 假设这是获取 SAM_data 的函数
    const s = data.SAM_data.static;
    
    // 2. 构建 HTML
    const html = `
    <div style="border:1px solid #444; padding:5px; margin-top:10px; font-size:12px; opacity:0.8;">
        ❤️ HP: ${s.hp} | 💰 Gold: ${s.gold} <br>
        🎒 Bag: ${s.inventory.join(', ')}
    </div>
    `;
    
    // 3. 返回给 UI 显示 (依赖具体插件实现，如 Slash Runner)
    return html; 
})();
```

通过这一步，玩家看到的是漂亮的血条和金币数，而不需要知道后面发生了什么复杂的 EJS 渲染和 JSON 交互。

---

**总结**

如果你完成了以上 8 步，你就不仅仅是在写一个角色卡，你是在用 SillyTavern 的外壳写一个 **文字冒险游戏引擎**。
1.  **想** (Variables)
2.  **定** (Schema)
3.  **算** (Logic)
4.  **显** (EJS)
5.  **教** (Command)
6.  **排** (Depth)
7.  **始** (Init)
8.  **美** (UI)
