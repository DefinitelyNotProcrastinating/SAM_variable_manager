# 第三步：构建“黑盒”——强大的 Function 自动化系统

AI 不擅长数学，也不擅长处理复杂的连锁反应。如果你让 AI 去计算“基于角速度和爆炸半径的导弹伤害”，它一定会胡说八道。

**SAM 的 Function 系统就是为了解决这个问题。** 它的核心理念是：**AI 负责“叙事”，代码负责“计算”。**

## 1. 核心概念：状态突变 (State Mutation)

在 SAM 的函数中，规则非常简单且残酷：
*   **输入 (Input)**：函数只接收一个东西——当前的 `state` (整个 SAM 数据对象)。
*   **过程 (Process)**：你可以写任何 JavaScript 代码来读取、计算、判断。
*   **输出 (Output)**：**没有返回值 (return)**。你必须直接修改传入的 `state` 对象。

**比喻**：AI 是驾驶员，Function 是引擎。驾驶员只需要踩油门（触发函数），引擎负责燃烧汽油、转动齿轮、最后修改时速表（修改 State）。驾驶员不需要知道引擎里发生了什么。

---

## 2. 定义函数的三个要素

要在 SAM 的插件界面（Functions 标签页）中定义一个函数，你需要设置三样东西：

### A. 函数名与参数 (Name & Params)
*   **Name**: 例如 `calculate_mining_yield`。
*   **Params**: 也就是参数名，例如 `dtime` (时间差), `efficiency` (效率)。
*   *注意：`state` 是默认注入的第一个参数，你不需要在参数列表里写它。*

### B. 函数体 (Function Body - JS)
这是魔法发生的地方。你可以访问 `state.static` 来获取任何变量。

**案例：EVE Online 风格的伤害计算**
假设你不想让 AI 乱算伤害，你想基于物理公式计算。

```javascript
// 这是一个名为 "calc_turret_damage" 的函数体
// 参数假设为: weapon_id, target_id

// 1. 获取数据 (Read)
var weapon = state.static.ship.weapons[weapon_id];
var target = state.static.enemies[target_id];

// 2. 执行复杂的 EVE 风格数学计算 (Process)
// 命中率公式：0.5 ^ ( ((角速度 * 40000) / 追踪速度) ^ 2 ) ... 复杂的数学
var chance = Math.pow(0.5, Math.pow((target.angular_velocity * 40000 / weapon.tracking), 2));
var raw_damage = weapon.damage_multiplier * 50;
var final_damage = raw_damage * chance;

// 3. 修改状态 (Write/Mutate)
// 我们直接修改敌人的血量，不需要 return
target.hp -= final_damage;
state.static.last_combat_log = `炮台命中！造成了 ${Math.floor(final_damage)} 点伤害 (命中率: ${(chance*100).toFixed(1)}%)`;
```

### C. 触发频率与方式 (Trigger & Frequency)
这是大战略卡的核心。你如何让这个函数跑起来？

*   **Manual (手动/AI触发)**:
    *   **设定**: `Periodic = false`。
    *   **用法**: AI 或用户必须显式发送指令 `@.EVAL("calc_turret_damage", 1, 0);`。
    *   **场景**: 只有在特定事件（如开火）时才运行。

*   **Periodic (周期性/自动触发) —— 大战略卡的神器**:
    *   **设定**: `Periodic = true`。
    *   **用法**: **不需要任何指令**。每当 AI 生成完回复，或者用户发送消息，这个函数都会自动在后台运行一次。
    *   **场景**: 矿井产出、时间流逝、伤口感染恶化。

---

## 3. 实战：如何实现“大战略”自动化 (The Game Loop)

假设你要做一个经营模拟，玩家只要说“跳过这周”，后台就要自动计算这周所有的矿产收入。

**逻辑流：**
1.  **AI 的工作**：AI 只需要更新时间。
    指令：`@.TIME("2025-06-01");` （AI 仅仅把时间往后拨了）
2.  **SAM 的工作**：SAM 捕捉到 `TIME` 指令，计算出 `dtime` (时间差，比如 7 天)，然后存入 `state.dtime`。
3.  **Function 的工作**：你写一个设为 `Periodic` 的函数 `update_economy`。

**Function Body (`update_economy`):**
```javascript
// 检查是否有时间流逝
if (state.dtime > 0) {
    // 获取当前矿井等级
    var mine_lvl = state.static.my_colony.mine_level;
    // 计算产出：等级 * 天数 * 10
    var income = mine_lvl * state.dtime * 10;
    
    // 直接入库
    state.static.resources.gold += income;
    
    // 留下日志给 AI 看（可选）
    state.static.system_log = `过去 ${state.dtime} 天内，矿井产出了 ${income} 金币。`;
    
    // 重置 dtime，防止重复计算（如果系统没自动重置的话）
    state.dtime = 0; 
}
```

**结果**：
AI 根本不知道怎么算乘法。AI 只是说了一句“一周过去了”。
下一秒，EJS 渲染出的界面上，玩家的金币就自动增加了 700 块。
**这就是“代码接管计算”。**

---

## 4. 这里的核心技巧：对 AI "隐身"

AI 是很聪明的，也是很蠢的。
如果你把 `update_economy` 这个函数名写在 Prompt 里告诉 AI，AI 可能会自作聪明地去调用它：`@.EVAL(update_economy)`。
这会导致灾难——比如一回合内经济被计算了两次（一次自动，一次 AI 乱调）。

**最佳实践：**
1.  **不要在 System Prompt 里提及这些后台函数。** 让 AI 以为这个世界就是会自动运转的。
2.  **AI 的任务只是由果推因**。AI 看到 `state.static.resources.gold` 变多了（通过 EJS 读取），它只需要在描写里写：“看来这周收成不错。”
3.  **如果需要 AI 触发战斗计算**：封装一个简单的指令给它。
    *   告诉 AI：攻击时请用 `@.EVAL(attack_enemy, self_id, target_id)`。

---

## 5. 作者工具推荐

**强烈建议：使用 SAM Extension (前端插件)**

1.  打开 SillyTavern 的 Extensions 菜单。
2.  打开 SAM 面板，点击 **"Functions"** 标签页。
3.  在这里，你可以像在 IDE 里一样编写代码，有换行，有参数框。
4.  点击 "Save to World Info"，插件会自动帮你把代码压缩、转义并存入 `__SAM_IDENTIFIER__` 词条。

**总结给作者的话：**
不要让 AI 做算术题。AI 的算术能力是波动的，而 JavaScript 的算术能力是永恒的。用 Function 把你的角色卡变成一个逻辑严密的游戏。
