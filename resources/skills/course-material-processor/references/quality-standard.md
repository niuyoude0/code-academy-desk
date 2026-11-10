# quality-standard：七段式块映射与容量硬标准

方法论继承 discrete-math-tutor（七段式深讲/最低容量硬标准/悬念开场/发出前自检），载体从聊天正文升级为结构化块。**缺段 = 水课件，返工。**

## 七段式 → 块序列映射（每个 KP 课件的标准组织）

| 段 | 块序列 | 要求 |
|---|---|---|
| 1 悬念/动机开场 | `concept`（首段悬念）或 `callout(note)` | 30–80 字：真实问题/历史故事/反直觉现象，让学习者在定义出现前就想知道答案 |
| 2 完整定义 | `definition`（+`quote` 原文佐证） | 教材级完整定义，逐字引用原文，带页码 |
| 3 直觉解释/类比 | `text` + `thinking` | 通俗解释 + 1 个类比；thinking 抛一个问题让学习者先想 |
| 4 定理与证明 | `theorem`（proof 每步注依据） | 该 KP 涉及的定理完整呈现；无关定理不硬塞 |
| 5 例题（≥2 有正有反） | `example` ×≥2 + `callout(pitfall)` | 正例走通、反例踩坑；易错点单独 pitfall 卡 |
| 6 高密度可视化 ≥1 | `diagram` / `chart` / `anim` / `interactive` 至少其一 | 优先级：anim 模板可表达 > mermaid > chart > interactive（慎用）；factsheet「交互命题候选」是选题依据 |
| 7 检验与总结 | `quiz` ≥3 + `summary`（+`keypoint` 1–3 张） | quiz 覆盖必用事实与易错点；summary.links 交叉引用真实块 id |

## 容量硬标准（validate_course_blocks 会按 warn 级报告，缺了必须补）

| 项 | 标准 |
|---|---|
| 正文字数 | 全部 md/proof/steps 累计 **≥2500 字**（中文计） |
| example | ≥2 个（至少 1 反例/踩坑向） |
| quiz | ≥3 个 |
| 可视化块 | ≥1 个 |
| interactive | ≤1 个（能不用就不用） |
| blocks 总数 | ≤500（schema 硬限，一般 15–30 块正好） |
| 单块 md | ≤200k 字符（schema 硬限） |

代码块/公式/表格不计入正文字数——它们是正文之外的密度。

## digest 产出规范（生成课件的同一次任务输出）

```json
{ "core": "≤500 字：该 KP 的核心结论/公式/机理，学习者忘了一切之后应该记住的", 
  "takeaway": "≤500 字：一句话收获 + 与下一个 KP 的衔接点" }
```

- 只写已学事实，不前瞻未来 KP（除 takeaway 的一句衔接）。
- 跳过的 KP 会在上下文里以 gap 出现——你生成时要用一句话向学习者交代空缺（"上一节 X 我们跳过了，不影响本节"）。

## 发出前自检（机检项与人审项分开）

**机检项**（validate_course_blocks 返工循环覆盖，≤2 轮）：
- [ ] schema 全字段合法；三条铁律通过
- [ ] 容量硬标准五项达标
- [ ] mermaid 语法可解析；echartsOption 纯 JSON 无回调
- [ ] interactive 的 bridgeImports 与实际 import 一致且全在白名单
- [ ] coding 引用的 exerciseId 已用 save_exercise 落盘
- [ ] quiz answer 与 options key 对应（多选逗号分隔无空格）

**人审项**（汇报里提示校对页重点看）：
- [ ] 随机抽 3 条 book 事实，页码在 factsheet 里真实存在
- [ ] 数字逐字符一致（单位/下标/进制前缀）
- [ ] 悬念开场是真的悬念（不是"本节我们学习……"）
- [ ] 可视化直接回答了 factsheet 的交互命题

## 返工循环

1. `validate_course_blocks(lesson)` → 错误清单
2. 按错误逐条修（铁律/错误回喂最高优先级）
3. 回到 1，最多 **2 轮**；仍失败 → `set_kp_gen_failed(kpId, 原因)` 并如实汇报，不要把坏文档硬塞给 save_kp_lesson
