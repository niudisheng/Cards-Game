# 工程架构

> 配套文档：`docs/GDD.md`（玩法事实来源）、`docs/roadmap.md`（里程碑）
> 目标：用最小复杂度支撑"可测试的纯逻辑内核 + 可替换的渲染层"，并为后续 1000 局无头模拟保留通路。

## 1. 设计原则

1. **逻辑与渲染分离**：`src/sim/` 不 import 任何 DOM / Canvas / 浏览器 API，可在 Node 中跑批量模拟。
2. **单一状态树**：一局游戏的全部可变状态收敛在 `BattleState`，UI 只读；修改只能通过 `src/sim/` 导出的函数。
3. **数据驱动**：卡牌、敌人、波次、数值全部在 `src/data/`，代码里不出现魔法数字。
4. **固定时间步**：逻辑固定 `1/60s`，渲染帧率无关；同一初始种子 + 同一操作序列 = 同一结果。
5. **先做垂直切片**：每个里程碑都以"能在手机上完整玩一局"为准，不铺半成品系统。

## 2. 目录结构

```text
Cards-Game/
├─ docs/
│  ├─ GDD.md                 # 策划案 V0.1（唯一事实来源）
│  ├─ architecture.md        # 本文档
│  ├─ roadmap.md             # 里程碑与验收清单
│  └─ screenshots/           # 界面截图（README 引用）
├─ src/
│  ├─ main.ts                # 入口：状态、1/60 循环、输入、暂停/重开/结算
│  ├─ core/                  # 与玩法无关的通用工具
│  │  ├─ types.ts            # Lane / Row / CardId / EnemyId / Phase 等基础类型
│  │  ├─ rng.ts              # 可复现随机（mulberry32）
│  │  └─ grid.ts             # 格子坐标与索引工具
│  ├─ data/                  # 纯数据 + 数据结构定义
│  │  ├─ schema.ts           # CardDef / EnemyDef / WaveDef 类型
│  │  ├─ cards.ts            # 12 张卡（含单位/法术参数）
│  │  ├─ enemies.ts          # 6 种敌人
│  │  ├─ waves.ts            # 3 波 + Boss 波时间轴
│  │  ├─ tuning.ts           # 魔力/手牌/战场/屏障全局数值
│  │  └─ deck.ts             # 卡组构建与固定初始手牌
│  ├─ sim/                   # 纯逻辑内核（无 DOM）
│  │  ├─ state.ts            # BattleState 定义与 createBattleState
│  │  ├─ economy.ts          # 魔力、抽牌、弃牌、洗牌
│  │  ├─ entities.ts         # Unit / Enemy / Effect 工厂与 id 分配
│  │  └─ battle.ts           # stepBattle：刷怪、推进、阻挡、攻击、法术、屏障、胜负
│  ├─ ui/
│  │  ├─ render/
│  │  │  ├─ theme.ts         # 颜色/字号/间距令牌
│  │  │  ├─ canvas.ts        # 画布装配、DPR、尺寸同步
│  │  │  └─ battlefield.ts   # 战场：布局计算、命中测试、单位/敌人/特效绘制
│  │  └─ dom/
│  │     ├─ hud.ts           # 顶部波次预告、魔力条、屏障
│  │     ├─ hand.ts          # 手牌渲染与卡牌详情
│  │     └─ help.ts          # 玩法说明弹窗（首次自动打开，打开时暂停推进）
│  └─ styles/
│     ├─ base.css            # reset、主题变量、手机框
│     ├─ layout.css          # 竖屏三段式布局、状态栏、魔力条
│     └─ hand.css            # 手牌、卡牌详情与玩法弹窗
├─ tests/                    # Vitest 单元测试（逻辑层）
├─ tools/                    # （M4）无头模拟、批量平衡报告
├─ index.html
├─ package.json
├─ tsconfig.json
└─ vite.config.ts
```

命名约定：`sim` 下的模块只导出纯函数与类型；实体用结构化对象而非 class（便于序列化、存档、回放）。

## 3. 数据流

```text
             ┌──────────────┐
  data/*.ts  │  BattleState │  ← sim/*.ts（固定步长 step）
             └──────┬───────┘
                    │ 只读快照
        ┌───────────┴───────────┐
        ↓                       ↓
  ui/render/*（Canvas）    ui/dom/*（DOM HUD/手牌）
        ↑                       ↑
        └──── main.ts（rAF、输入事件、暂停/重开）────┘
```

- 输入层只产生语义化指令：`deployCard(state, uid, lane, row)`、`castCard(state, uid, target)`、`pause()`、`restart()`；不直接改状态。
- `main.ts` 把点击（`pointerdown`）换算为 `cellAt(layout, x, y)`，再交给 `deployCard` / `castCard`；Canvas 不保存玩法状态。
- 渲染层每帧从 `BattleState` 读，不缓存权威数据；伤害飘字由 sim 以轻量 `Floater` 事件写入（可被单测断言），绘制与渐隐由 `ui/render` 消费。
- 调试面板直接读状态树，不做额外埋点。

## 4. 运行模型

- 主循环：`requestAnimationFrame` 累积 `dt`（单帧上限 0.1s），按 `FIXED_STEP = 1/60` 消费，单帧最多补 8 步，防止切后台后爆炸。
- `stepBattle(state, dt)` 内部顺序固定为：`elapsed/phase → 刷怪 → 经济（魔力→抽牌）→ 特效计时 → 敌人推进/攻击/技能 → 单位索敌/攻击/死亡 → 胜负`。顺序变化会改变结果，改动需同步测试。
- 暂停：不进入 `stepBattle`，但渲染继续；`paused` 是独立布尔值，不占用 `phase`。
- 帮助弹窗、卡牌详情打开时也冻结推进（`help.isOpen()` / `sheet.isOpen()`），避免读说明时漏怪；关闭后自然恢复。

## 5. 状态模型

```ts
interface BattleState {
  phase: 'preparation' | 'wave' | 'intermission' | 'victory' | 'defeat';
  elapsed: number;              // 局内秒数，暂停时不增长
  paused: boolean;
  seed: number;
  economy: EconomyState;        // 魔力、手牌、抽牌堆、弃牌堆、抽牌计时
  barriers: Record<Lane, boolean>; // true = 完好
  units: Unit[];
  enemies: Enemy[];
  effects: Effect[];
  floaters: Floater[];          // 伤害/状态飘字，ttl 由 sim 递减
  spawnQueue: SpawnEvent[];     // 绝对时间轴展开后的刷怪队列
  spawnCursor: number;
  nextId: number;
  bossSpawned: boolean;
  bossDefeated: boolean;
  result: 'victory' | 'defeat' | null;
  resultReason: string;
  stats: BattleStats;           // cardsPlayed / unitsDeployed / kills / spellsCast / leaks / manaOverflow / playTimestamps
}
```

坐标约定：敌人 `progress` 以“格”为单位，`0` 为第一排上沿、`3` 为核心上沿；出生与屏障击退均为 `0.15`（画在入口下方，避免压住入口文案）。被阻挡时近战停在单位所在格的上沿外侧 `row - 0.05`（第一排允许到 `-0.05`，画在入口与格子的缝隙里），射程 2 的敌人停在 `row - 0.45`（第一排夹到 `-0.15`），这样敌人不会和单位精灵叠在一起。

`EconomyState` 已实现：魔力的自然恢复与上限截断、手牌上限时暂停抽牌计时、抽牌堆耗尽自动洗回弃牌堆、固定初始手牌（从 12 张牌堆中扣除后洗牌）。

卡牌以 `CardInstance { uid, card }` 存在于手牌，`CardId` 为静态定义；这样同名卡可独立选中、丢弃、回放。

## 6. 关键实现决策

| 决策 | 理由 |
|---|---|
| 用 `sim/` 取代策划案中的 `engine/` | 明确"纯逻辑、可无头运行"的边界，测试和 1000 局模拟不需要浏览器 |
| 实体用普通对象 + 纯函数，不用 class | 状态可 JSON 序列化，便于回放、快照测试、AI 模拟 |
| 波次用绝对时间轴（`startAt/endAt` + `spawns`）而非嵌套状态机 | 波次表可直接对照 GDD；阶段由 `elapsed` 推导，减少非法状态 |
| 抽牌计时在满手时冻结而非重置 | 对应"手牌满是等待的代价"：空出位置后不立即白送一张 |
| 种子随机内置于 sim | 保证模拟可复现，平衡调参时差异只来自策略 |
| Canvas 只画战场，HUD/手牌用 DOM | 文字排版与触摸目标更可靠，移动端可访问性更好 |
| 数值全部走 `data/tuning.ts` | 调参不改逻辑；后续可接外部 JSON/远程配置 |
| M1 交互用“点选卡牌 → 点空格”而非拖拽 | 竖屏手指拖拽会遮挡目标格，点选命中更稳；拖拽作为 M2 可选增强 |
| 所有单位都阻挡敌人（忽略 `blocks` 字段） | GDD 4.2 规定“到达有单位的格子即停下攻击”，阻挡是位置规则而非卡牌特权 |
| 敌人出生在 `progress = 0.15` | 既在入口内可见，又不会把立绘画进“敌军入口”文案里 |
| 法术/单位效果立即结算，不做飞行物 | 原型阶段优先可读性与可测性；视觉用短 TTL 特效表达 |
| 伤害飘字与攻击/受击闪光由 sim 产生 | 让“谁打谁、掉多少血”可被测试断言；渲染只负责颜色、上浮与渐隐，避免规则藏在 DOM/Canvas |
| 所有攻击连线在棋子绘制后统一叠加 | 若先画线再画单位，格子的半透明底色会把线吃掉；统一叠加后远程弹道和近战连线都清晰可见 |

## 7. 扩展点（V0.2+）

- **新卡**：在 `data/cards.ts` 增加定义；若引入新效果，在 `data/schema.ts` 的 `SpellEffect` / 单位特性联合类型中加分支，并在 `sim` 对应结算器实现。禁止在数据里写函数。
- **新敌人**：`data/enemies.ts` 增加条目；特殊行为以 trait 标记，逻辑放 `sim/enemies.ts`。
- **新关卡**：`data/waves.ts` 增加时间轴，判定逻辑不变；多关卡时按 `stageId` 选择数据。
- **局内三选一**：新增 `sim/rewards.ts`，在波间阶段插入 `reward` 子状态；不改战斗结算。
- **存档/回放**：`BattleState` + 输入指令序列即可回放；随机数状态需一并序列化。
- **模拟器**：`tools/simulate.ts` 复用 `sim`，注入简单 AI 策略，输出胜率、出牌间隔、魔力溢出、部署分布。

## 8. 测试策略

- 单元测试（Vitest，34 项）：`tests/economy.test.ts`（经济/抽牌/洗牌）、`tests/data.test.ts`（数据表一致性）、`tests/battle.test.ts`（部署、阻挡、伤害、法术、跳路者、自爆、Boss、屏障、胜负、临时单位、攻击/受击飘字）。
- 快照测试：给定种子跑固定步数，断言关键状态（用于防回归）。
- 冒烟测试（CDP 脚本 `.tmp/play.mjs` / `.tmp/verify.mjs`）：真实 390×844 视口，点击卡牌、点格部署、施放火球、暂停、读到失败结算。
- 平衡模拟（M4）：1000 局，胜率目标 30%—60%，平均出牌间隔 5—10s，魔力满溢 < 30%。

## 9. 工程约定

- TypeScript `strict`，禁用 `any`（确需时写 `unknown` + 收窄）。
- 导入统一用 `@/` 别名指向 `src/`。
- 提交粒度按里程碑/功能，不提交 `dist/`、`node_modules/`。
- 任何玩法数值改动必须同时更新 `docs/GDD.md` 对应表格，避免文档漂移。
- 移动端优先：新增交互先在 480×800 视口验证触摸目标 ≥ 44px。
