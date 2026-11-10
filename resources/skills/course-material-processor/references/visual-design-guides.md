# visual-design-guides：四类可视化块的细分设计规则（v2）

> diagram / chart / anim / interactive 是课件"图形化"的主载体。本文是每类块的**设计硬规则**，
> 与 blocks-catalog.md（字段契约）互补：那边管"字段怎么填"，这边管"怎么画才易懂、才有趣"。
> 素材来源（2026-11-11 调研）：mermaid/echarts/motion 官方文档、anthropics/skills 官方仓库
> （frontend-design + web-artifacts-builder）、Mayer 多媒体学习原则、Bret Victor
> 《Explorable Explanations》、3Blue1Brown 讲解法。出处见各节内联标注。

## 一、diagram（mermaid）：画"关系与流程"

**选型**：流程/分支 → `flowchart TD`；层次/包含 → `graph TD` + subgraph；状态机 → `stateDiagram-v2`；
时序交互 → `sequenceDiagram`；分类树 → `graph TD`。同一层节点 ≤7 个（超了拆两图或 subgraph 分组）。

**语法硬规则**（来源：mermaid.js.org/syntax/flowchart.html + intro/syntax-reference.html）：
1. **方向语义**：`TD` 自上而下（教学默认）、`LR` 左右（管道/数据流）。subgraph 内可写 `direction`，
   但**子图内任一节点连到外部时该 direction 被忽略**——全图保持一种主方向最稳。
2. **特殊字符必须双引号包裹**：`A["a[i]"]`、`A["(注意)"]`；裸写 `A[a[i]]` 直接 parse error。
   节点文本内要显示引号用 HTML 实体（`#quot;`）。
3. **保留词陷阱**：节点文本里的小写 `end` 会破图——写 `End`/`END` 或套引号（官方明文）。
4. **连线后紧跟 o/x 会被解析成圆头/叉头线**：`A---oB` 变圆头线；中间加空格（`A --- oB`）。
5. **节点形状语义化**：`[矩形]`=处理、`{菱形}`=判断、`([stadium])`=起止、`[(圆柱)]`=存储、
   `[/平行四边形/]`=输入输出。不要全图一个形状。
6. **边要带话**：判断分支的边必须写条件（`--"a[j] > key"-->`）；`-.->` 虚线=可选/回退路径。
7. **样式走 classDef**（外部 CSS 会被静默覆盖）：教学图语义三色——
   起点/正常 `classDef ok fill:#e8f0fe,stroke:#3574f0`、终点/成功 `fill:#e6f4ea,stroke:#4f9257`、
   错误/危险 `fill:#fce8e6,stroke:#d14343`。不要彩虹图。
8. **subgraph 必须有标题**（`subgraph 编译期 ... end`）；注释用 `%%`，注释里别出现 `{}`。
9. 复杂图（>15 节点）分两步走：先骨架后细节；生成后必须 `validate_course_blocks`（解析失败回喂返工）。

**反模式**：一张图 20+ 节点；菱形分支不带条件标签；所有节点连一个汇聚点。

## 二、chart（echarts 纯 JSON）：画"数量与分布"

**选型**（官方 get-started + 图表选型共识）：趋势随连续量 → `line`；类别对比 → `bar`；
占比（**≤5 项**）→ `pie`；两变量关系 → `scatter`；密度 → `heatmap`；数值跨度大/看倍数 → `yAxis.type='log'`。

**硬规则**（来源：echarts.apache.org handbook；option 是**纯 JSON**，禁函数/回调）：
1. **五件套**：`tooltip`、`legend`（多系列）、`xAxis/yAxis`（**轴名必写** `name:`）、`series[{name,type,data}]`、
   `grid({top:40,bottom:50,left:60,right:30})` 防裁切。
2. **formatter 只用字符串模板**：`{a}`=系列名、`{b}`=数据名、`{c}`=值、`{d}`=百分比（饼）；
   axis 触发多系列：`'{b0}: {c0}<br/>{b1}: {c1}'`。**函数 formatter 与 valueFormatter 一律禁用**（纯 JSON 约束）。
3. **tooltip.trigger**：有类目轴（柱/线）用 `'axis'`；散点/饼用 `'item'`。柱状图配 `axisPointer:{type:'shadow'}`。
4. **类目标签防重叠**：`axisLabel:{rotate:0~90}`；`interval:0` 全显。数值轴需要不被零点压缩时 `yAxis.scale:true`（散点）。
5. **配色语义**（主题已内置浅色板）：成功 `#4f9257`、警示 `#9e6b00`、危险 `#d14343`、主色 `#3574f0`；
   同一课件同一含义同一色；**系列 ≤4 条**。
6. **大数换算进数据**：没有函数格式化可用——直接写 5.2 + 轴名"百万次"，别塞 5200000。
7. **数据零发明**：数据出自 factsheet/OCR；AI 示意数据 `origin:'ai-supplement'` 且注明"示意数据"。
8. 图 title 只写图自名，别重复课件标题（concept 块已承担）。

**反模式**：3D/玫瑰图（低信息密度）；饼图 >5 块；无轴名；同轴混多量纲（改双轴或拆图）。

## 三、anim（帧 DSL）：画"过程与变化"

**选型**：排序/查找/入栈出栈/指针移动/树遍历/BFS-DFS/哈希冲突——所有"一步步怎么变"。

**硬规则**（帧结构见 blocks-catalog；动效参数依据 motion.dev 官方 transitions 文档，渲染器已按此实现）：
1. **帧数 6–24**：太少看不出过程，太多滚不动；核心算法长就拆两段 anim。
2. **每帧必写 `note`**：一句话"这步干了什么"——note 是学习者实际在读的东西。
3. **状态连续**：相邻帧只差本步改动；**完成后加终帧**（全数组有序/栈空等终态标注）。
4. **pointer 用真实变量名**（`i`/`j`/`key`/`l`/`r`），与 code 块变量一致——图文对照。
5. **highlight 只标本帧焦点**（比较中的两个下标/当前节点），不累积——"当前步"语义。
6. 首帧 data = 输入原样，学习者可自己预演。
7. 动效基调（渲染层已内置，写 md/note 时配合）：位移/高亮用 0.3–0.8s easeInOut 的节奏感，
   出入列表元素带退场动画（AnimatePresence + 稳定 key）——**单步播放优于自动连播**（Mayer 分段原则）。

**反模式**：跳帧（输入直接跳输出）；指针名和代码对不上；全部帧都高亮。

## 四、interactive（沙箱 TSX）：画"可探索的直觉"

**选型门槛**（先过这关再动手）：只有当**参数探索**带来 anim/mermaid 给不了的直觉时才用——
参数扫描（k·n² 拖 k 看曲线）、可操作模拟（手动入栈出栈）、坐标几何（mafs 函数/向量场）。
展示型内容一律降级到 anim/diagram/chart。每课件 ≤1 个。

**硬规则**（沙箱契约见 interactive-bridge.md；设计纪律融合 anthropics/skills frontend-design
与 web-artifacts-builder 的公开规范）：
1. **单一交互焦点**：一个组件讲一件事；要对比就上下两个小组件，不做万能演示器。
2. **控件即语义**：Slider 的 min/max/step 要有教学含义（k 取 0.5–3 覆盖"比 n² 快/慢"两侧）；
   初始值选"一眼看懂"的状态。参数应"点拖即改"（Bret Victor：门槛最低的交互）。
3. **透明性/叙事托底**（Victor）：组件必须**能不交互也读懂**——默认渲染引导式步骤/当前参数下的完整结果，
   交互探索是附加；正文里写清"拖动 k 观察曲线如何变"。
4. **视觉纪律**：根容器 `flex flex-col gap-3`；数字/公式 `mono` 类；状态文字 `dim` 类；
   控件行 `ctrl-row`。只用桥 CSS 工具类与内联 style（浅色主题 token 已内置于 bridge.css）。
5. **文案跟着动作走**（frontend-design 规范）：控件标签写用户视角的功能（"比较倍率 k"），
   按钮写"重新模拟"不写"提交"；错误提示说清哪错了怎么修。
6. **克制**（frontend-design 动效纪律）：动效只为回应操作（拖动→曲线重画）与一次入场淡入；
   禁止持续循环动画与处处 hover 效果——"一个记忆点，其余安静"。
7. **零成本防御**：桥调用（fs/progress）放 `useEffect`；长任务会被心跳看门狗标记。
8. **bridgeImports 声明 = 实际 import**；mafs 桥可用（数学坐标图首选）。

**反模式**：用 interactive 做静态展示；一次拖 5 个滑块；必须交互才能看懂。

## 五、图形块的通用教学排版规则（Mayer 原则 + 3B1B 讲法落地）

1. **指图说话**（空间贴近原则）：图形块前后的 md 必须有一句"看上图第 2 步……"引导；标签/指针名直接出现在图内。
2. **图随事实走**：图放在首次用到它的事实之后，不堆开头；连续多个图形块中间必须有正文隔开。
3. **每图回答一个问题**：factsheet「交互命题候选」写了图该回答什么——图要能回答。
4. **视觉先于形式语言**（3B1B）：先给图景/动画，再给符号定义——七段式的段 3（直觉）永远在段 4（定理）前。
5. **信号原则**：高亮/加粗只给当前焦点（"处处提示等于没有提示"——Mayer）。
6. **对话式语气**（Mayer 个性化原则）：正文用"你/我们"（"我们把 key 插进有序区"），定义段除外。
7. **浅色主题**：宿主为 IDEA 浅色（白底/浅灰面板/#3574f0 强调）；SVG/图表不写死深色背景。
