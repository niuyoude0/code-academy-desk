# blocks-catalog：22 类课件块规范

课件 = 一个 JSON 文档，渲染层按块型分派 React 组件。所有块共用基础字段：

```json
{ "id": "b-前缀+序号", "origin": "book | ai-supplement", "source": { "pdfPage": 94, "bookPage": 80, "ocrFile": "ocr/ch03/p0094.md" } }
```

- `id`：课件内唯一，`summary.links` 用它做交叉引用。
- `origin='book'` 的块 **必须** 带 `source`（校验器硬拒绝）。`ai-supplement` 不需要 source。
- markdown 字段（下称 `md`）支持 KaTeX 行内公式与 GFM；代码高亮由渲染层处理。

## 三条校验铁律（硬拒绝，返工主因）

1. `origin='book'` 无 `source` → 拒绝。
2. `quiz(kind='choice')` 选项 < 2 → 拒绝。
3. `summary.links` 引用了不存在的块 id → 拒绝。

## 文本与知识类

| 块 | 用途 | 专有字段 | 常见错误 |
|---|---|---|---|
| text | 普通正文段 | `md` | 把整章塞一个 text 块——应拆成多块，每块一个意思 |
| concept | 概念主讲块（含悬念开场） | `title` `md` `tags?` | 开场直接抛定义——先悬念后定义（见 quality-standard） |
| definition | 术语定义 | `term` `md` | 定义改写失真——教材定义逐字引用 |
| theorem | 定理/性质 | `name?` `md` `proof?` | proof 不注依据——每步标（由 xx 性质 / 代入式(3.2)） |
| math | 独立公式 | `latex` `block?` | 用 md 内嵌 `$...$` 写长公式——长式改用本块 |
| callout | 提示卡 | `kind: note\|warning\|pitfall` `md` | 滥用 note——易错点一律 pitfall |
| quote | 教材原文摘录 | `md` `attribution?` | 忘带 source——本块是页码铁律主要载体 |
| keypoint | 要点卡（可转闪卡） | `front` `back` | front 写成结论——front 应是提问 |
| thinking | 思考题（不给答案给 hint） | `md` `hint?` | hint 直接给答案——给思路 |
| example | 例题分步讲解 | `title` `steps[{md}]` | 一步到底不分步——每步一个动作 + 依据 |
| compare | 多列对比 | `title` `columns[2..6]` `rows[{label,cells[2..6]}]` | 列数与 cells 数不一致 |
| table | 数据表 | `caption?` `md`（markdown 表格） | 用 compare 承载纯数据——数值表用 table |
| timeline | 发展史/流程时间线 | `items[{label,md}]≥2` | 顺序错乱——按时间/流程正序 |
| formula-list | 公式清单 | `items[{name,latex,note?}]` | name 为空泛词——写公式名/式号 |
| image | 教材插图 | `path`（assets/ 内相对路径）`alt` | path 指向包外/不存在文件 |
| summary | 收束总结 | `points[]` `links?` | links 指向不存在块 id（铁律 3） |

## 代码类

| 块 | 用途 | 专有字段 | 常见错误 |
|---|---|---|---|
| code | 代码展示 | `language` `code` `runnable?` | language 用中文——用 `verilog`/`c`/`python` 等小写标识 |

## 图形与可视化

> 设计硬规则（怎么画才易懂/有趣/不踩语法坑）见 [visual-design-guides.md](visual-design-guides.md)——diagram/chart/anim/interactive 动手前先读对应节。

| 块 | 用途 | 专有字段 | 常见错误 |
|---|---|---|---|
| diagram | 流程/层次/状态机 | `engine:'mermaid'` `mermaid`（mermaid 文本；**字段名不是 source**——source 保留给页码引用） | 语法错误——生成后必须 `validate_course_blocks`，mermaid 解析失败会回喂；**节点标签含 `[` 必须双引号包裹**（`A["a[i]"]`），裸写 `A[a[i]]` 直接 parse error |
| chart | 数据图表 | `echartsOption`（纯 JSON） | option 里写函数/回调——**纯 JSON**，零回调约定 |
| anim | 数据结构动态过程 | `template: array\|stack\|queue\|linkedList\|tree\|graph\|hashTable\|matrix` `title?` `frames[2..500]` | 自创模板名；帧数据结构与模板不匹配 |

**anim 帧结构**（数据驱动 DSL，AI 不产代码）：

```json
{ "data": { "items": [3,1,2] },        // 模板渲染的数据本体
  "pointers": { "i": 0, "j": 2 },      // 指针/游标（可选）
  "highlight": [0, 2],                 // 高亮下标（可选）
  "note": "比较 a[0] 与 a[2]" }         // 一步一句话（可选）
```

`data` 的形状按模板约定：array→`items` 数组；stack/queue→`items` 数组（一端操作）；linkedList→`nodes[{val,next}]`；tree→嵌套 `{val,children}`；graph→`{nodes:[{id}],edges:[{from,to}]}`；hashTable→`buckets`；matrix→`rows` 二维数组。模板渲染器负责视觉呈现，你只管数据每帧怎么变。

## 练习类

| 块 | 用途 | 专有字段 | 常见错误 |
|---|---|---|---|
| quiz | 选择/填空 | `kind: choice\|blank` `question` `options?` `answer` `explanation?` | choice 选项<2（铁律 2）；answer 写选项文本——写 key（如 `"A"`，多选逗号分隔）；blank 的 answer 写参考答案文本 |
| coding | 编程题引用 | `exerciseId` | 引用的 exercise 文件没落盘——先 `save_exercise` 再引用 |
| interactive | 自由交互组件 | `title` `source`（TSX ≤500KB）`bridgeImports` | 白名单外 import；忘声明 bridgeImports；每课件 ≤1 个 |

quiz/coding 的判定在应用侧（D6：本地判 + 编程题发 DSH 执行），你只管出题正确。

**quiz 出题纪律**：每课件 ≥3 个，覆盖该 KP 的必用事实；干扰项要有教学意义（来自真实易错点），不要"明显不对"的凑数项；`explanation` 写为什么错。

## 课件文档骨架

```json
{
  "schemaVersion": "2.0",
  "lessonId": "ch03-k02",            // 必须 = path.json 里的 KP id
  "title": "D 触发器",
  "generatedBy": { "model": "deepseek-chat", "skillVersion": "2.0", "generatedAt": "2026-11-10T12:00:00Z" },
  "blocks": [ ... ]
}
```

完整样例见 [../examples/lesson-example.json](../examples/lesson-example.json)（结构模板；实际生成须满足容量硬标准）。
