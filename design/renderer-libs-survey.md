# 课件渲染库选型调研（P5.3 前置，2026-11-10）

> 三路并行调研，全部库经 npm registry（npmmirror / registry.npmjs.org）实查核实版本、许可证、
> peerDependencies、最近发布时间；许可风险项另核了 LICENSE 原文与官网定价页。
> 本文只记录事实与推荐，**未安装任何依赖、未改任何代码**。待确认后按结论落地。

## 0. 场景分层

| 层 | 谁用 | 说明 |
|---|---|---|
| **A 层：块渲染器** | 应用代码，AI 不感知 | 22 类 LessonBlock 的内置渲染：markdown / 公式 / 高亮 / mermaid / 图表 / anim 模板驱动 |
| **B 层：interactive 桥接** | AI 写的 TSX 经 esbuild 编译后 import | 白名单导入（现为 `react\|echarts\|fs\|system\|agent`），本调研直接决定扩容清单 |

---

## 1. 图表（chart 块 + interactive）

| 库 | 版本 | 许可 | 最近发布 | React19 | bundle | 结论 |
|---|---|---|---|---|---|---|
| **echarts** | 6.1.0 | Apache-2.0 | 2026-05 | 框架无关 | 全量 368KB gz；echarts/core 按需约 350–450KB min | **主方案（保持）**：option 纯 JSON、语料最多、中文文档最强；桥接只暴露按需注册后的 `<EChart option>` 封装 |
| recharts | 3.10.1 | MIT | 2026-11-03 | peer 含 ^19 | 150KB gz | 备选：AI 走 TSX 画简单图时 JSX 更顺手；暂不进，桥接已有 echarts |
| chart.js (+react-chartjs-2 5.3.1) | 4.6.1 | MIT | 2026-10 | 框架无关 | 70KB gz | 不引入：声明度与语料均不如 echarts |
| @antv/g2 5.4.8 / visx 4.0.0 | — | MIT | 活跃 | — | 377KB gz / 极小 | 不引入：g2 v5 语料少概念抽象，visx 非声明式，AI 生成失败率预期偏高 |

## 2. 图示/流程图/导图（diagram 块）

| 库 | 版本 | 许可 | 最近发布 | bundle | 结论 |
|---|---|---|---|---|---|
| **mermaid** | 12.3.0（v11 末版 11.17.2） | MIT | 2026-11-03 | 主 chunk 159KB gz，diagram 类型懒加载分包 | **主方案**：AI 文本→图事实标准；`mermaid.parse()` 预检→失败回喂重试闭环；全异步（initialize startOnLoad:false + render()）；v12 目标 ES2024，Electron 45 满足 |
| @markmap/view 1.1.0 (+markmap-lib 0.18.13) | MIT | 2026-11-10 | 极小（view 59KB） | 备选/二期：markdown→交互思维导图，与课件 MD 管线零转换；注意 1.x 刚升大版本，可钉 0.x 末版 |
| @penrose/core 3.3.1 | MIT | 2026-08 | 大（含求解器） | 不引入：自定义 DSL 语料少、学术项目节奏 |

## 3. 节点图/关系图（interactive 桥接候选）

| 库 | 版本 | 许可 | 最近发布 | React19 | bundle | 结论 |
|---|---|---|---|---|---|---|
| **@xyflow/react** | 12.12.1 | MIT | 2026-11-08 | peer >=17 | 60KB gz | **桥接主方案**：节点即 React 组件，内置拖拽/连线/缩放/minimap；图论/状态机/AST 类可视化的甜蜜点 |
| @antv/g6 5.1.1 | MIT | 2026-09 | 框架无关 | 400KB gz | 二期备选：万级节点拓扑/知识图谱重场景再进 |
| cytoscape 3.34.4 | MIT | 2026-10 | 框架无关 | ~435KB | 不引入：核心虽好但 React 包装割裂（react-cytoscapejs 尚可、cytoscape-react 小众、react-cytoscape 已死） |
| graphology 0.26 + sigma 4.0.5 (+@react-sigma/core 6.0.0 peer ^19) | MIT | 活跃 | 小 | 数据结构层标准库，当前无渲染需求不引入 |
| d3-force 3.0.1 / d3-hierarchy 3.1.3 | ISC | 稳定 | ~8/23KB | 仅作布局算法底座，不直接暴露给 AI |

## 4. 白板（评估后暂不内嵌）

- **tldraw 5.6.0：许可证一票否决**。LICENSE.md 原文核实：免费仅限开发/测试环境，**生产环境使用即违约**（水印+License Key 强制不可禁用+合规遥测回传）。对学生开放的教育产品即属生产使用。
- **@excalidraw/excalidraw 0.18.1：MIT 可免费商用无水印**，peer 含 ^19，自带 mermaid-to-excalidraw。代价是主入口 353KB gz + 懒加载共 3–4MB、0.x API 波动。→ 非刚需不进；若进，桥接只暴露"场景 JSON 输入"一种形态。

## 5. 动画（anim 块模板 + interactive）

| 库 | 版本 | 许可 | 最近发布 | React19 | 结论 |
|---|---|---|---|---|---|
| **motion** | 14.12.0 | MIT | 2026-11-10 | peer ^18\|\|^19 | **主方案**：framer-motion 官方新包名（同一套代码，不要再引 framer-motion）；AnimatePresence/layout/Reorder 覆盖 anim 模板与交互；AI 语料最多、写法声明式出错率最低 |
| gsap 3.15.1 | Standard No-Charge（2025-04 起全插件免费含商用） | 2026-11-05 | 框架无关 | 可选补充：timeline 精确到帧的编排 motion 没有；为控制 AI 出错面，一期只进 motion，验证后再评估 |
| @formkit/auto-animate 0.10.2 | MIT | 2026-11-06 | 无 peer | 轻量补充候选（一个 ref 的列表自动动画），可并入 controls 封装 |
| @react-spring/web 10.1.2 / animejs 4.5.0 | MIT | 活跃 | — | 不引入：与 motion 重叠 / v4 刚重写语料少 |
| @motion-canvas/core 3.17.2 | MIT | **停滞约 21 个月** | 非 React | 不引入：视频渲染运行时，非交互组件 |
| remotion 4.0.542 | 自定义（≤3 人盈利组织免费） | 极活跃 | >=16.8 | 不引入：定位离线视频渲染 + 许可按人头，双不匹配 |

## 6. 2D Canvas（interactive 重度模拟）

| 库 | 版本 | 许可 | React19 | 结论 |
|---|---|---|---|---|
| **react-konva 19.3.2 + konva 10.9.1** | MIT | **peer 精确 ^19.3.0**（与项目 React 19.3.1 对齐） | **桥接主方案**：声明式画布组件树，拖拽/图层/命中检测齐全，100KB；适合高密度画布/自由拖拽/内存布局位运算类模拟 |
| pixi.js 8.22 + @pixi/react 8.0.5 | MIT | @pixi/react peer >=19 但发布节奏慢 | 不引入：教学规模用不到 WebGL 天花板，声明式包装不如 react-konva 成熟 |
| fabric 7.4.0 | MIT | — | 不引入：对象编辑器定位，命令式胶水代码多 |
| p5 2.3.4 | **LGPL-2.1** | — | **不引入**：Electron 打包下 LGPL 合规别扭 + draw() 全局循环与 React 冲突，双重排除 |

## 7. 3D（二期评估）

- **three 0.187.0 + @react-three/fiber 9.8.2 + @react-three/drei 10.7.9**：MIT 全家；R3F v9 是为 React 19 重写的（peer `>=19 <19.4`，**升级 React 时需同步升 fiber**）；drei 硬依赖 fiber ^9，四件套同进同出。CPU/网络类课程 3D 需求低 → 建议二期。
- 物理：**matter-js 0.20.0**（纯 JS 零 WASM、AI 语料最多；停更 2.5 年但 API 冻结稳定，教学够用）为一期默认；**@dimforge/rapier2d-compat 0.21.0**（Apache-2.0，内嵌 WASM 免加载配置，确定性步进）为高阶可选；3D 物理 @react-three/rapier 2.2.0 随 3D 组二期。cannon-es（停滞 3 年）/planck（API 偏 C++ 风格）不进。

## 8. 数学（math/formula-list 块 + interactive 几何）

| 库 | 版本 | 许可 | 最近发布 | 结论 |
|---|---|---|---|---|
| **katex** | 0.19.1 | MIT | 2026-10-23 | **主方案**：直接 `renderToString` + 自写 ~15 行 `<TeX>` 包装；`katex/dist/katex.min.css` 字体由打包器带出。**不用 react-katex**（锁死 katex ^0.16 与最新版冲突）/ @matejmazur（3 年没动） |
| mathjax 4.1.3 | Apache-2.0 | 活跃 | 不引入：20MB，仅 MathML/AsciiMath 需求才值得；AI 生成 LaTeX 场景 katex 完胜 |
| **mafs** | 0.21.0 | MIT | **停滞约 2 年**（最后动作 2025-03 canary） | React 组件式数学可视化、AI 友好度最高、0.45MB；peer >=18 semver 上允许 19 但"无人验证过"→ 若进桥需先冒烟（官方示例在 React 19.3 跑通）+ patch-package 兜底 |
| jsxgraph 1.14.3 | **(MIT OR LGPL-3.0) 双许可** | 2026-11-06 | mafs 的 fallback：极活跃但命令式，需桥接层包几百行 React 声明式 wrapper；75MB 包要只引核心构建 |
| mathlive 0.111.4 | MIT | 活跃 | 仅当"学生输入公式"交互成立才引入（5.8MB） |
| mathbox 2.3.2-rc1 | MIT | **latest 即 2023 年 RC** | 不引入 |

## 9. 代码高亮/编辑器（code/coding 块）

| 库 | 版本 | 结论 |
|---|---|---|
| **shiki 4.6.0** | **主方案**（v4 已于 2026-02 发布，当前 4.6.0）。工程做法：`createHighlighterCore` + 细粒度 import（`shiki/langs/*.mjs`、`@shikijs/themes`）+ `@shikijs/engine-javascript` 纯 JS 引擎（免 wasm，桌面冷启动快）；进程内 memoized singleton；预热固定语言集（js/ts/py/c/cpp）+ 2 主题 |
| prismjs 1.30 / highlight.js 11.12 | 不选：精度/主题质量差距明显 |
| react-syntax-highlighter 16.1.2 | 不选：依赖还挂着 lowlight@1/hljs@10，历史包袱重 |
| **CodeMirror 6 + @uiw/react-codemirror 4.25.12**（peer react>=17，活跃） | 维持 P7 决策：coding 块编辑器与 P7 文件工作区同源；CM6 典型组合打包后几百 KB 级 |
| monaco-editor 0.57 | 不引入：101.7MB unpacked + worker + @monaco-editor/react 默认 CDN 加载（离线需重配 loader）；仅未来要浏览器内类型检查再评估 |

## 10. 控件/参数面板（interactive 内调节参数）

- **rc-slider 11.1.9**（MIT，Ant Design 背书，peer >=16.9 含 19，依赖链短）为底层；桥接层封装成统一风格 `controls` 模块（Slider/NumberInput/Toggle/PlayButton 等），AI 只能从白名单 import → 样式天然统一 + 降低出错率。
- leva 0.10.1 不上（devtools 风格与课件 UI 割裂、维护低频）；react-range 0.07MB 备选（2 年未更但 API 稳）。

## 11. 运行时 TSX 编译（interactive 管线，P5.6）

- **主进程 esbuild 0.28.2 二进制**唯一主路径：`transformAsync` loader:'tsx' + jsx:'automatic'，单文件毫秒级；桥接库设 external/alias 到注入 shim，产物只允许白名单 import。
  - 打包注意：electron-builder 需 `asarUnpack` 掉 `node_modules/@esbuild/**`（平台二进制 11.7MB 不能在 asar 内被 Node 加载）。
- esbuild-wasm（wasm ~10MB + 数百 ms 冷启动）不引入；@babel/standalone 8.1.1（6.6MB、慢一到两个数量级）仅作"纯网页演示模式"的 Plan B，不引入。

## 12. 正文 markdown（text/callout/quote 等块的基础）

- **react-markdown 10.1.0（MIT，peer react>=18 → React 19 ✓）+ remark-gfm 4.0.1**：标准管线，无争议。

---

## 13. 汇总：推荐清单与体积影响

### A 层（块渲染器内置，应用依赖）
| 用途 | 库 | 版本 |
|---|---|---|
| 正文 markdown | react-markdown + remark-gfm | 10.1.0 / 4.0.1 |
| 公式 | katex（直用+自包装） | 0.19.1 |
| 代码高亮 | shiki（core + JS 引擎 + 按需语言/主题） | 4.6.0 |
| 图示 | mermaid | v12.3.0 或钉 v11.17.2（待确认） |
| 图表 | echarts（echarts/core 按需注册） | 6.1.0 |
| anim 模板驱动 | motion | 14.12.0 |
| coding 块编辑器 | @uiw/react-codemirror（+@codemirror/lang-*） | 4.25.12 |

### B 层（interactive 桥接白名单，现状 `react|echarts|fs|system|agent` 建议扩容为）
**一期（推荐）**：`react`、`echarts`、`motion`、`konva`(react-konva)、`xyflow`(@xyflow/react)、`matter`(matter-js)、`controls`(自封装 rc-slider 等)、`mafs`（冒烟通过后）——对应 schema 枚举扩容。
**二期候选**：`three`(R3F+fiber+drei+rapier)、`gsap`、`rapier2d`、`mathlive`、`markmap`、`excalidraw`。

### 体积感受（全部懒加载/按需后）
A+B 一期全载约：echarts ~400KB + mermaid 主 chunk ~670KB(分包懒加载) + shiki 按语言 + katex ~300KB + motion ~50KB + konva ~400KB + xyflow ~190KB + matter ~90KB（min 级），Electron 本地加载无压力；桥接 chunk 按需 import() 拉取。

### 许可红线（已核实）
- tldraw：生产使用付费，**排除**。
- p5：LGPL，**排除**。
- remotion：≤3 人免费但定位不符，排除。
- 其余全部 MIT / Apache-2.0（gsap 为 No-Charge 全免费含商用，唯一禁区是与 Webflow 竞争的 no-code 工具，教育课件不涉及）；jsxgraph 选 MIT 分支；@react-three/rapier 仓库核实 MIT。

## 14. 选型结论（2026-11-10 用户已确认）

1. **B 层一期桥接清单**：推荐一期组合全部进入——`react`、`echarts`、`motion`、`konva`(react-konva)、`xyflow`、`matter`(matter-js)、`three`(fiber+drei+rapier 四件套)、`controls`(自封装)、`mafs`（冒烟通过后启用）。schema 侧已扩容 `BRIDGE_IMPORTS`（12 项，含 fs/system/agent 能力桥）。
2. **mafs**：进桥 + 先冒烟（锁 0.21.0，React 19.3 下跑官方示例 renderToString；失败退回 jsxgraph 方案）。
3. **mermaid**：v12.3.0。
4. **3D**：一期就进（three + @react-three/fiber 9 + drei，同进同出；注意 fiber peer `<19.4`，升级 React 需同步升 fiber）。
5. 二期候选（不进一期）：gsap、rapier2d-compat（独立 2D 物理）、mathlive、markmap、excalidraw、@antv/g6、recharts。
