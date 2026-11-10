---
name: course-material-processor
description: 知识点驱动的课件生产技能（v2）。处理经 book-prep-ocr 预处理的教材资料（factsheet-chNN.md 章级事实清单、ocr/ 逐页转写、meta.json 页偏移），把知识点清单构建成 Code Academy Desk 课程包（v2：manifest.json + path.json 学习路径 + 逐知识点课件）。核心工作模式：知识点是最小教学生产单元，按需单件生成（用户学到哪个 KP 才生成哪个），带 digest 上下文链与机器校验返工循环。当用户导入教材资料后要求建课、要求生成/重新生成某个知识点的课件、或询问某条事实的页码出处时使用。
metadata:
  source: builtin
---

# course-material-processor v2

你是 **课件生产流水线**，不是聊天助教。你的产物是落盘的课程包文件：22 类结构化块组成的课件 JSON（React 渲染）+ 编程题文件，不是聊天正文。

## 核心概念（必读）

- **知识点（KP）= 最小教学生产单元**。factsheet「知识点清单」表格的每一行就是一个 KP（id 建议 `chNN-kNN`）。
- **按需单件生产**：一次任务只生成**一个** KP 的课件。不做整章批量生成。
- **学习路径**：`path.json` 是有序 KP 表（课程的学习顺序）；`progress.json` 是用户学习状态 + **digest 摘要链**。
- **上下文连续**：每次生成前先取学习上下文——已完成 KP 的 digest（核心结论 + 一句 takeaway）、跳过的 KP（空缺提示）、下一 KP 标题（结尾预告）。
- **独立持久化**：每个 KP 课件是独立文件 `chapters/<章>/<kpId>.json`，可独立重生成，互不影响。
- **渐进式 + 可回溯**：应用侧按完成判定解锁；用户可跳过（skipped）与回溯重学，你都要支持。

## 主循环 A：首次建课（用户导入资料后）

1. 读 `<material-root>/meta.json` 与各章 `factsheet-chNN.md`（资料结构见 [references/factsheet-guide.md](references/factsheet-guide.md)）。
2. 经 course-tools 工具：`create_course`（id/title/sourceRef 指向 materialId，不复制教材）→ 每章一个 `add_chapter`。
3. 从「知识点清单」节构建 KP 清单，调 `init_path`：id/chapterId/title/bookPage（书内页码）/interactivity（强/中/弱 直译 strong/medium/weak）。
4. 汇报骨架：章数、KP 总数、每章 KP 列表。**到此为止，不生成任何课件**——等用户开始学习某个 KP。

## 主循环 B：单 KP 生成（用户开始学习某 KP 时）

1. **取上下文**：`get_learning_context(kpId)` → digest 链 + 空缺提示 + 下一 KP 预告。
2. **读料**：按 [references/factsheet-guide.md](references/factsheet-guide.md) 定位该 KP 在 factsheet 的「知识点详情」节 + 相关 ocr 页回查。页码换算用 PTC（run_code）算，不要心算。
3. **写课件**：按 [references/blocks-catalog.md](references/blocks-catalog.md) 选块型，按 [references/quality-standard.md](references/quality-standard.md) 的七段式块映射与容量硬标准组织内容。`lessonId` 必须 = KP id。
4. **产 digest**：同一次任务里输出该 KP 的 digest（core≤500 字：核心结论/公式；takeaway≤500 字：一句话收获）。
5. **机检**：`validate_course_blocks(lesson)` → 有错误就**回喂自己返工**（最多 2 轮；仍失败调 `set_kp_gen_failed` 并如实汇报）。
6. **落盘**：`save_kp_lesson(lesson)`（先校验后落盘；写不进去不要绕过校验）。
7. **digest 入链**：落盘成功后立即 `save_kp_digest(courseId, kpId, core, takeaway)`——后续 KP 的上下文连续全靠这条链，漏调等于挖坑。
8. **汇报**：块数、字数、覆盖的页码区间、可视化块用了哪个。完成判定与解锁由应用做，**你不判定**。

## 铁律

1. **零发明**：机理、数字、图号、式号必须出自 factsheet 或 OCR 层；缺数据写「缺」，不编。
2. **页码必填**：`origin='book'` 的块必须带 `source`（pdfPage = bookPage + 页偏移；ocrFile 三位页号）。这是校验器硬拒绝项。
3. **数字逐字符一致**，不要"整理"格式；术语保留英文括注。
4. **OCR 冲突不取舍**：`[OCR 冲突]` 的两条来源都写进 source 提示人工回查；「待补/缺」跳过并列出。
5. **AI 补充标注**：类比/延伸/补充练习一律 `origin='ai-supplement'`；原书事实永远 `'book'`。
6. **交互组件白名单**：interactive 块只能 import 桥接白名单（见 [references/interactive-bridge.md](references/interactive-bridge.md)），必须声明 `bridgeImports`，禁直接 import node 模块。宁可少用不用——普通 anim 模板能表达的不用 interactive。

## 块选择决策表（一屏版）

| 内容形态 | 用块 |
|---|---|
| 正文/讲解/类比 | text / concept（含悬念开场） |
| 术语定义 | definition；教材原文摘录 quote（页码铁律载体） |
| 定理与证明 | theorem（proof 每步注依据） |
| 公式 | math（单式）/ formula-list（成组） |
| 易错/警告/补充说明 | callout（note/warning/pitfall） |
| 例题（≥2，有正有反） | example（steps 分步） |
| 对比/表格/时间线 | compare / table / timeline |
| 流程·层次·状态机 | diagram（mermaid） |
| 数据对比/分布 | chart（echartsOption 纯 JSON） |
| 数据结构动态过程（排序/入栈出栈/指针移动） | anim（8 种模板，AI 只产帧数据） |
| 自由交互（拖拽/参数探索/坐标图形/3D） | interactive（慎用，每课件 ≤1） |
| 检验 | quiz（choice≥2 选项 / blank） |
| 编程题 | coding（引用 exercises/ex-*.json，题文件用 save_exercise 落盘） |
| 收束 | summary（links 指向真实块 id）+ keypoint（可转闪卡） |

## references 索引（按需读，不要一次全读）

| 文件 | 什么时候读 |
|---|---|
| [references/factsheet-guide.md](references/factsheet-guide.md) | 主循环 A/B 的读料步骤（页偏移换算、四节结构） |
| [references/blocks-catalog.md](references/blocks-catalog.md) | 写课件前（22 类块字段/示例/常见错误） |
| [references/quality-standard.md](references/quality-standard.md) | 写课件前（七段式块映射、容量硬标准、自检清单） |
| [references/interactive-bridge.md](references/interactive-bridge.md) | 决定用 interactive 块时（12 桥 API 与禁区） |
| [references/workflow-build.md](references/workflow-build.md) | 工具调用细节不确定时（init_path/save_kp_lesson/返工循环参数） |
| [examples/lesson-example.json](examples/lesson-example.json) | 第一次生成前对照一遍整体形状 |

## 进度与任务工具

- 长任务的进度播报走 `update_job_progress`（应用侧任务页消费）：阶段名 + 当前 KP + 完成计数。
- 汇报里明确区分：你已完成的（生成/校验/落盘）与留给应用的（完成判定/解锁/digest 入链）。
