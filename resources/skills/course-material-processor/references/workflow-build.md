# workflow-build：工具调用与返工循环细节

## 首次建课（主循环 A）的工具序列

```
create_course { id, title, sourceRef: { materialId, factsheets: ["factsheet-ch03.md", ...], pageOffsets: [{section:"正文", offset:14}] } }
add_chapter   { courseId, chapter: { id: "ch-03", title: "时序逻辑设计" } }   × 每章
init_path     { courseId, kps: [
                { id: "ch03-k01", chapterId: "ch-03", title: "SR 锁存器", bookPage: 78, interactivity: "strong" },
                { id: "ch03-k02", chapterId: "ch-03", title: "D 触发器",  bookPage: 80 },
                ...每章 5–12 个，保持 factsheet 教学顺序
              ] }
update_job_progress { stage: "骨架完成", detail: "3 章 21 个知识点，等待按需生成" }
```

- KP id 建议 `chNN-kNN`（章内两位序号）；全路径唯一，init_path 会查重。
- **不生成任何课件**。汇报骨架后等待用户开始学习。
- path.json 已存在时会拒绝——用户要求重排骨架时用 `replace_path`（已生成课件文件保留不动）。

## 单 KP 生成（主循环 B）的工具序列

```
get_learning_context { courseId, kpId }
  → { preceding: [ {kpId,title,core,takeaway} | {kpId,title,gap:true} ], nextKpTitle, kpId, title, bookPage, interactivity }

（读 factsheet 该 KP 详情节 + 相关 ocr 页；页码换算用 PTC run_code）

（若有编程题）save_exercise { courseId, exercise: { id: "ex-ch03-k02-1", title, statement, source: {...}, starterFiles, tests, referenceSolution } }

validate_course_blocks { courseId?, lesson }        ← 落盘前自检（错误回喂，≤2 轮）
save_kp_lesson       { courseId, lesson }            ← lessonId 必须 = kpId；内部再校验一次并回填 genStatus=ready

update_job_progress { stage: "单 KP 完成", detail: "ch03-k02《D 触发器》：18 块 2760 字，可视化=mermaid 状态机" }
```

## 返工循环（质量闸门）

```
validate_course_blocks → errors[]
  ├─ 铁律错误（缺页码/选项<2/links 断链）→ 立即修，优先级最高
  ├─ schema 错误（字段/长度/枚举）→ 按 path 定位逐条修
  ├─ warn 级（容量硬标准）→ 补内容
  └─ mermaid/echarts 解析失败 → 重写该块
（最多 2 轮；仍失败）
set_kp_gen_failed { courseId, kpId, reason: "具体原因" }
→ 如实汇报：失败在哪个块、缺什么料、建议用户怎么补
```

**禁止**：绕过 validate 直接 save_kp_lesson（落盘层还会再校验并拒绝，浪费一轮）；把 warn 级问题瞒在汇报里。

## digest 交付

每次成功生成 KP 课件，**落盘后立即调 `save_kp_digest(courseId, kpId, core, takeaway)`** 把摘要写入 progress.json 摘要链——不要只放在汇报文本里（应用读取的是链上的结构化 digest，不是你的回复）：

```json
{ "kpId": "ch03-k02", "core": "核心结论/公式 ≤500 字", "takeaway": "一句话收获 ≤500 字" }
```

兜底：若你漏调，应用在用户完成判定通过时会从课件 summary/keypoint 块自动提取一份写入——但自动提取的措辞不如你提炼的精准，链上空缺期间生成的 KP 上下文质量会下降。

## 重新生成（用户要求重做某 KP）

- 流程与主循环 B 完全一致（save_kp_lesson 覆写同一文件，manifest 不新增引用）。
- 若 review.json 有该 KP 的 `feedback`（人工反馈），**必须先满足反馈再谈其他标准**。
- 重新生成不影响其他 KP 课件与学习进度。

## 回溯与跳过的应对

- 用户回溯重学旧 KP：正常生成/重新生成；上下文里它后面的 KP 也在（digest 链按 path 顺序给出已完成项），但**不要**把后学内容提前泄露进旧 KP 课件。
- 上下文出现 `gap:true` 的 KP（被跳过）：课件开场用一句话交代空缺（"上一节 X 我们跳过了，本节只需要知道……"），并用 2–3 句补足该空缺的最小必要背景。

## 汇报模板（每个 KP 生成完）

```
已完成 ch03-k02《D 触发器》课件：
- 18 块（concept1/definition2/theorem1/example2/quiz3/diagram1/summary1/...），正文约 2760 字
- 页码覆盖：书内 p.79–p.82（PDF p.93–p.96），3 条事实已抽查核对
- 可视化：mermaid 状态机（Q̄ 反馈回路）；未用 interactive（anim 模板不适用于本主题）
- digest：core/takeaway 已 save_kp_digest 入链
- 待应用侧：完成判定 → 解锁 ch03-k03《寄存器》
```
