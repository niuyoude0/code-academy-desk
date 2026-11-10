# factsheet-guide：教材资料结构与页码换算

## 资料结构（导入后在教材资料根目录）

```
<material-root>/
├── meta.json               # 书名/版次/出版社/年份 + 页偏移表 + 章节映射（字段名可能不统一，按语义识别）
├── factsheet-chNN.md       # 按章蒸馏的事实清单（你的主要工作对象）
├── ocr/chNN/pNNN.md        # 逐页转写（回查原文用；页首有 `## PDF p.N | 书内页码 M` 元信息）
├── pages/pNNNN.png         # 原始页图（本应用导入时通常未复制，按 sourcePath 回查原位置）
├── pages.json              # 页图清单（pdf_page → file）
└── qa-log.md               # 抽查记录
```

## factsheet-chNN.md 的四节结构

1. `## 0. 章节地图` — 小节表（小节 | 书内页码 | 一句话主题），常含 PDF 页偏移说明（如「+14，即 书内 p.80 = PDF p.94」）
2. `## 1. 知识点清单` — 表格（# | 知识点 | 书内页码 | 一句话 | 适合交互 强/中/弱），预计 5–12 个，按教学顺序。
   **v2 语境：这一节就是 path.json 的直接来源**——每行一个 KP（id 建议 `chNN-kNN`，章内两位序号），title 用知识点名（中文，保留英文括注），bookPage 用书内页码，interactivity 直译 强/中/弱 → strong/medium/weak。
3. `## 2. 知识点详情` — 每个 KP 一节 `### K# · 标题 · 书内 p.X`，内含：
   - 交互命题候选（供你决定是否用 interactive/anim 块）
   - **必用事实**（逐字带页码——课件里 origin='book' 块的 source 主要出处）
   - 教材视觉词汇（图号表号 + 术语，供 diagram/chart 复刻用）
   - 易错点（→ callout pitfall）
   - 可直接用的例题（→ example；有明确输入输出样例时可改编成 quiz/coding）
4. `## 3. 章末习题清单` — 表格（题号 | 书内页码 | 一句话 | 涉及知识点 | 能否改造成交互）；有的章节此节为「待补」。

## 页码换算

- `pdfPage = bookPage + 页偏移`。meta.json 页偏移可能分区（如「正文 +14；附录 +6」），按区间取。
- `ocrFile` 写 `ocr/chNN/pNNN.md`（**三位页号**）：书内 p.80、偏移 +14 → PDF p.94 → `ocr/ch03/p0094.md`。
- factsheet「章节地图」若直接给了换算示例，以它为准。
- 换算多于一两次就写段 PTC（run_code）脚本批量算并核对，不要心算。

## 读取纪律

- meta.json 字段名不统一时按语义识别；缺的字段在汇报里列出留给用户补，不要编。
- factsheet 是「弹药清单」不是原书：单条事实存疑时回查 `ocr/chNN/pNNN.md` 对应页（该页首部元信息可二次核对页码）。
- 「待补/缺」的内容直接跳过，并在最终汇报里列出（用户可后续补资料）。

## 建课时的 sourceRef

`create_course` 的 sourceRef 填：materialId（资料目录 id）、factsheets（用到的文件名列表）、pageOffsets（分区偏移数组）。原教材**永不复制**进课程包。
