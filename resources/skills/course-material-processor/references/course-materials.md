# book-prep-ocr 产物格式细则（course-material-processor 的参考资料）

来源技能：`~/.zcode/skills/book-prep-ocr/`（五步流水线：渲染页图 → 逐页转写 → 按章蒸馏 → 质检 → 交接）。
本文是 Code Academy Desk 侧的格式速查，权威版本以技能目录 `references/` 为准。

## factsheet 知识点详情节示例（真实样本摘录）

```markdown
### K1 · 动态准则（Dynamic Discipline）· 书内 p.80
- **交互命题候选**：读者拨动时钟沿的位置……输入变化落进窗口内时 → 采样得到未定值。
- **必用事实**（逐字，带来源）：
  - 定义原文：「时序元件的孔径时间用时种沿前的建立时间（setup time）和时钟沿后的保持时间（hold time）定义。」（p.80）
  - 公式：`式 3.13`：$T_c \geq t_{pcq} + t_{pd} + t_{setup}$（p.110）
  - 数字：t_pcq=1.2 ns、t_setup=1.5 ns（p.110，例 3.10）
  - 图号：图 3.37 同步时序电路的时序规范（p.80）
- **教材视觉词汇**：不确定区用交叉影线；时间量用双向箭头标注。
- **易错点**：① 建立/保持合起来构成孔径时间；② 违反动态准则的后果是亚稳态。
- **可直接用的例题**：例 3.10（问：最高时钟频率）答案 137 MHz（p.111）。
```

## meta.json 常见字段（字段名不统一，按语义识别）

| 语义 | 常见字段名 |
|---|---|
| 书名 | `title` / `bookTitle` / `book_name` |
| 作者 | `authors` / `author` |
| 版次/出版社/年份 | `edition` / `publisher` / `year` |
| 页偏移 | `pageOffset`（数值）或 `pageOffsets` / `page_offset_table`（分区：`{section, offset}[]`） |
| 章节映射 | `chapters`（`{chapter, title, factsheet, bookPages?}[]`）或 `chapterMap` |

缺字段不是错误：把缺失项列进最终汇报清单，让用户补。

## [OCR 冲突] 处理

同一数字在 OCR 里前后矛盾时，factsheet 会同时列出两处页码并标 `[OCR 冲突]`。
课程构建时：**不要选边**，在课程草稿对应内容的 `source.note` 写「OCR 冲突：p.X 写 A，p.Y 写 B，需人工回查」，
并在汇报里列出该知识点待补。

## 质检红线（来自 qa-handoff.md）

- 数字是最高危项：转写错误的数字会直接变成教学错误。
- `[??]` 标记密集的页（>5 处）内容不可靠，构建时降低该页内容的引用优先级。
- 插图只有"可重画描述"（节点/边/层级/矩阵 0-1），讲义里用文字描述或重绘，不放原图裁剪。
