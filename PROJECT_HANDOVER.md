# PROJECT_HANDOVER — Code Academy Desk 项目交接文档

> 更新时间：2026-11-11 00:15（+08:00）——已核对至 **P5.6 完成**（vitest 118 基线）
> 事实来源：实际代码仓库（第一事实源）+ 本会话已确认的设计决策
> 状态标注体系：**✅已完成**（代码已实现且经测试验证）/ **🔶部分完成** / **📐已设计未实现** / **⏳待确认**（用户尚未裁决）
> 本文档由 AI 生成后经仓库实况核对；未标注"待确认"的内容均已在代码中落地并有对应测试或实测证据。

---

## 1. 项目概览

**Code Academy Desk** 是一款 Windows 优先的桌面端编程学习工作台：用户导入计算机教材，AI 理解教材内容并制作标准化、可交互的结构化课件，最终在桌面工作台中学习。

- **目标用户**：使用中文教材自学计算机科学的独立学习者（首个样例教材：《数字设计与计算机体系结构》OCR 产物）。
- **核心使用场景**：导入教材 → AI 按技能把教材内容构建成课程 → 知识点驱动学习路径逐点学习（BlockRenderer 全量渲染 + interactive 沙箱交互）→ 完成判定解锁下一知识点 → 三栏工作台（P6）与判题（P8）。
- **交付形态（用户硬性要求）**：Windows exe——NSIS 安装包 + 便携版（P11 打包管线已验证；未代码签名）。
- **开发方式**：AI 结对开发，重大架构选型必须先解释影响再由用户确认；测试对 AI API 消耗敏感（一律零消耗单测，真实 API 只做最小连通验证）。
- **版本管理**：git 仓库已建立（2026-11-11 首次提交）；vendor 二进制按 .gitignore 排除，重装步骤见 §12。

原始需求文档：`C:\Users\35597\.zcode\workspace\1794245542069-cdfc1e79-c94e-4290-bc48-12f35ab3abe2\`（会话早期输入）。

## 2. 产品目标与功能需求

### 功能需求全景（v1.1）

| 需求 | 状态 |
|---|---|
| 课程首页（课程网格/导入导出/移除/空状态/Toast） | ✅已完成（P3，computer-use 端到端验收过） |
| 课程包 v1 导入/导出（zip） | ✅已完成（P4） |
| 教材资料导入（book-prep-ocr OCR 产物原样存层） | ✅已完成（P5 存层） |
| 技能系统（agentskills.io SKILL.md：扫描/校验/安装/内置技能首发复制） | ✅已完成（MVP） |
| 技能 v2 course-material-processor（知识点驱动主循环 A/B + 5 references + 示例） | ✅已完成（P5.3） |
| 业务工具插件 @cad/course-tools（**21 工具**五组：建骨架/学习路径/课件内容/进度/资料读取） | ✅已完成（P5.2.5 基础 20 + P5.7 加 cad_save_kp_digest；真实 DSH 进程 registered 20 tools） |
| AI 助教（DSH Agent：流式聊天/工具调用/审批/停止/新对话/会话恢复） | ✅已完成（P9.6） |
| 权限档位（沙箱三档 + 审批联动） | ✅已完成（P9.7） |
| MCP 服务器管理 UI | ✅已完成（P9.8） |
| 课件 Schema v2（22 类 Block）+ 校验器 + 容量机检 | ✅已完成（P5.1/P5.2.5） |
| 课程包 v2 读写（manifest/局部重生成/zip + path/progress 随包迁移；~~review~~ 2026-11-11 随校对功能移除） | ✅已完成（P5.2/P5.3） |
| **知识点驱动学习路径**（path.json/progress.json/线性解锁/回溯不拨指针/可跳过/digest 链） | ✅已完成（P5.3a） |
| **学习路径页**（七态 KP 表/按需生成触发/学习视图/完成判定门 quiz≥2/3+forced 应急） | ✅已完成（P5.4） |
| **BlockRenderer**（22 类块全量真渲染：react-markdown/KaTeX/shiki/mermaid/echarts/anim 帧模板/image 资源通道） | ✅已完成（P5.5，实机目检全项通过） |
| **interactive 沙箱执行**（esbuild 编译 + cad-i:// 沙箱 iframe + 白名单桥 12 chunk） | ✅已完成（P5.6，实机验收：滑杆联动/fs 桥读进度/错误卡回喂） |
| ECharts 可视化 | ✅已完成（P5.5：A 层 ChartView + interactive EChart 桥） |
| 算法动画/数据结构交互演示 | ✅已完成（P5.5：anim 8 模板帧解释器 + motion） |
| ~~课件校对界面~~ → **一键重新生成课件** | 🔴 2026-11-11 用户拍板整体移除（P5.7 代码已清）；重新生成入口在学习页 header |
| Source Manager：PDF/EPUB 静默预处理 | 📐已设计未实现（D3 决策已定） |
| 三栏学习工作台 | 📐已设计未实现（P6） |
| 文件工作区（文件树+CodeMirror 6+git 快照） | 未开始（P7） |
| **统一 Runner**（Python/C/JS 本地执行 + stdin/stdout 测试判定） | ✅核心已完成（P5.8 顺带落 P8：`runner.ts` 服务 + 编程题接通；P7 文件工作区的通用命令执行可复用） |
| 学习记录/进度 | 🔶部分完成（progress.json 学习状态轴已落地；P10 汇总报表/统计页未做） |
| SQLite 持久化 | 🔶部分完成（策略已定：index.json 先行；阻塞项见 §10） |
| MCP 工具接入（如 MySQL） | ✅已完成（DSH 原生 dsh-mcp-client + 管理 UI） |
| 代码签名与自动更新 | 未开始 |

## 3. 技术栈

| 技术 | 版本/来源 | 用途 |
|---|---|---|
| Electron | 45.2.3（npmmirror 镜像） | 桌面壳；**内嵌 Node 被 DSH 原生件指纹白名单拒绝，DSH 必须用自带 node24** |
| electron-vite 6 + Vite 8 | devDeps | 主进程 CJS 产物 + 渲染层构建 |
| React 19 / TS 5.9.3 | TS 钉 5.9（避开 Go 版 TS7） | 渲染层 |
| Tailwind CSS v4 | @tailwindcss/vite | JetBrains New UI 语义 token（13px 基准） |
| zod v4 | dep | 全部 Schema 校验 |
| **A 层渲染（P5.5 实装）** | react-markdown 10.1+remark-gfm/remark-math+rehype-katex、katex 0.19.1、shiki 4.6.0（core+JS 引擎免 wasm 按需语言）、mermaid 12.3.0、echarts 6.1.0（core 按需）、motion 14.12 | 课件块真渲染；全部 vite 懒加载分包 |
| **B 层桥接（P5.6 实装）** | konva 10.9/react-konva 19.3.2、@xyflow/react 12.12、matter-js 0.20、three 0.187+@react-three/fiber 9.8+drei 10.7（**devDeps**，构建期打进桥 chunk 不进 asar） | interactive 组件白名单库 |
| esbuild 0.28 | **dependencies**（主进程运行时编译）+ asarUnpack @esbuild/** | interactive TSX 编译 + course-tools 插件打包 |
| JSZip 3.10 / gray-matter 4.0.3 / lucide-react 1.70 | deps | zip / SKILL.md frontmatter / 图标 |
| **DSH（DeepSeek Harness）** | `@deepseek-ai/dsh@0.2.2-rc.1`（官方预览版，钉死） | Agent Runtime（独立进程）；工具/MCP/技能/会话全用官方能力 |
| node24 便携版 | v24.11.0（86MB） | DSH 运行时 |
| better-sqlite3 + Drizzle | 规划中 | 持久化（阻塞：本机无 VS Build Tools，见 §10） |
| CodeMirror 6 / xterm.js / node-pty / react-resizable-panels / react-arborist | 未安装 | P6–P8（选型报告已定） |

## 4. 系统总体架构

### 数据流（课程构建闭环主线）

```
教材来源（OCR 产物已实现；PDF/EPUB 静默任务流已设计）
  → Source Manager（courseMaterials.ts 原样存层 userData/materials/）
  → Course Builder（DSH Agent + 技能 v2：主循环 A 建学习路径骨架 / B 单 KP 按需生成课件；
     course-tools 20 工具；validate_course_blocks 实时自检 + 容量机检）
  → 课程包 v2 持久化（coursePackageV2.ts + path.json/progress.json）
  → 【🔴 P5.7 校对界面 2026-11-11 已整体移除——质量责任前移到机检+生成侧自检（skill v2.1），入口改「一键重新生成课件」】
  → Course Renderer（✅ P5.5/P5.6：BlockRenderer 22 类块全量渲染 + interactive 沙箱）
  → 学习路径页完成判定（quiz≥2/3 解锁下一 KP）
```

**职责铁律**：解析只在主进程、生成只在 DSH、渲染只在 React；三层只通过"带版本的数据文件"交接，互不 import 代码。

### 模块职责与进程边界

| 层 | 文件 | 职责 |
|---|---|---|
| 主进程入口 | `src/main/index.ts` | 窗口/smoke/各域 IPC 注册（Course/Skill/Material/Path/Interactive/Agent/Mcp）/cad-i 协议注册（ready 前）/before-quit 关停 DSH |
| 学习路径域 IPC | `src/main/pathIpc.ts` | path:get / kp:start|skip|complete / lesson:get / course:asset:read（IpcResult 信封） |
| ~~校对域 IPC~~ | ~~`src/main/reviewIpc.ts`~~ | 🔴 已删除（2026-11-11 校对功能移除） |
| ~~校对视图服务~~ | ~~`src/main/services/reviewView.ts`~~ | 🔴 已删除（2026-11-11） |
| Runner 服务 | `src/main/services/runner.ts` | runExercise（python/c/javascript 档位；临时工作区；超时杀树；stdin/stdout 归一判定）/ normalizeRunnerLanguage / normalizeOutput / parseFiles；`runnerIpc.ts` 注册 exercise:get + runner:run |
| interactive 域 | `src/main/interactiveIpc.ts` | interactive:compile / interactive:bridge / **cad-i:// 协议**（serve 沙箱 bootstrap+chunks；registerSchemesAsPrivileged 须在 ready 前顶层调用） |
| DSH 运行时 | `src/main/services/dshRuntime.ts` | spawn node24+dsh（profile `cad`）、ensureProfile（幂等 junction/托管 patch）、JSON-RPC、approval→原生对话框、stop=杀进程懒重启；spawn env 注入 CAD_COURSES_ROOT/CAD_MATERIALS_ROOT |
| 学习路径服务 | `src/main/services/learningPath.ts` | initPath/replacePath/saveKpLesson/startKp（解锁+回溯不拨指针）/completeKp（quiz≥2/3+forced；**digest 缺省时从课件 summary/keypoint 自动提取入链——P5.4 残留已修**）/skipKp/getLearningContext（digest 链+gap 占位）/saveKpDigest（upsert：无条目建 learning 条目不推进解锁）/extractDigestFromDoc |
| interactive 编译 | `src/main/services/interactiveCompile.ts` | **安全门 1 = 源码级 import 预扫描**（esbuild 会丢弃未使用 import 绕过 onResolve！）+ 具名导出校验（AI_NAMED_EXPORTS）+ 白名单重写插件 → `cad-i://bridge/chunks/*.js`；sha256 缓存；安全门 2 = 产物兜底 |
| interactive 桥 | `src/main/services/interactiveBridge.ts` | fs 桥课程数据只读（readCourseFileText 限 manifest/path/progress/review/chapters/exercises ≤2MB；asset 复用 getCourseAssetDataUrl）+ getProgress/getManifest；路径限定全在主进程 |
| KP 取料/统计/机检 | `src/main/services/kpSource.ts` / `courseStats.ts` / `lesson-quality.ts` | factsheet 节切取+ocr 页码自证 / 课程统计聚合 / 容量硬标准机检（warn 级） |
| 课件 Schema v2 | `src/shared/lesson-schema.ts` | 22 类 LessonBlock + BRIDGE_IMPORTS 12 项 + `validateLessonDocument` 三铁律 + v1 适配 |
| 学习路径 Schema | `src/shared/learning-path-schema.ts` | PathFile（有序 KP 表 genStatus/lessonFile）/ProgressFile（state/quizBest/codingPassed/digest）/KpLearningContext |
| 课程包 v2 | `src/shared/course-v2-schema.ts` + `coursePackageV2.ts` | manifest/review/zip 往返 + `getCourseAssetDataUrl`（assets 铁律） |
| course-tools 插件单源 | `src/course-tools/index.ts` → `npm run build:plugin`（esbuild 176 模块 1.1MB） | 20 工具直接 import 应用源码；`@deepseek-ai/dsh-tools` external 经 profile junction 解析 |
| 技能 v2 | `resources/skills/course-material-processor/` | SKILL.md（主循环 A/B）+ references/{factsheet-guide, blocks-catalog, quality-standard, interactive-bridge, workflow-build}.md + examples/lesson-example.json |
| **块渲染器（渲染层）** | `src/renderer/src/components/blocks/` | BlockRenderer（22 类分派）/Md（GFM+KaTeX+shiki）/Katex/CodeView/MermaidView/ChartView（cad-dark 主题）/AnimView（8 模板帧解释器）/ImageView/InteractiveBlockView（沙箱宿主）/QuizCard/BlockShell/highlighter |
| 学习路径页 | `src/renderer/src/components/LearningPathPage.tsx` | 七态 KP 表/生成提示词管道/**豆包式居中阅读列**/完成判定门（压平底栏）；header「重新生成课件」入口（2026-11-11） |
| ~~课件校对页~~ | ~~`src/renderer/src/components/ReviewPage.tsx`~~ | 🔴 已删除；App.tsx 三视图路由（home/course/agent） |
| vendor | `resources/dsh-runtime/` | node24 + 全量 DSH + `node_modules/@cad/`（业务插件构建产物）；**git 忽略 node_modules/node24/spike-home**，重装步骤见 §12 |
| 桥 chunk 产物 | `resources/interactive-bridge/`（git 忽略，`npm run build:bridge` 再生成） | bootstrap.html（沙箱文档）/bridge.css/chunks/*.js |

### IPC 通道（`src/shared/ipc.ts`，IpcResult<T> 信封）

`app:info/ping`；`course:import/list/get/remove/export`（v1）+ `course:asset:read`（P5.5 image 块）；`skill:*`；`material:*`；`agent:chat/abort/resume/settings:*/event`；`mcp:*`；`path:get`、`kp:start|skip|complete`、`lesson:get`（P5.4）；~~`kp:digest:save`、`review:*`~~（P5.7，2026-11-11 移除）；`interactive:compile`、`interactive:bridge`（P5.6）。

## 5. 核心数据模型

### 课件 Block v2（✅，22 类判别联合）

text/concept/definition/theorem/math/callout/quote（页码铁律主载体）/keypoint/thinking/example/compare/table/timeline/formula-list/image/summary（links 引用完整性）/code/diagram（**mermaid 字段**，非 source）/chart（echartsOption 纯 JSON 零回调）/anim（8 模板帧 DSL）/quiz（choice|blank）/coding（exerciseId）/interactive（TSX≤500KB + bridgeImports 白名单）。

三铁律：① origin=book 必带 source；② choice≥2 选项；③ summary.links 存在。容量机检（warn）：≥2500 字/quiz≥3/example≥2/可视化≥1/interactive≤1。

### 学习路径（P5.3，✅）

```
coursesRoot/<courseId>/
├── manifest.json / chapters/ / exercises/ / assets/   （P5.2；~~review.json~~ 已废弃，旧目录残留为惰性文件）
├── path.json      # PathFile：kps[{id=lessonId, chapterId, title, bookPage?, interactivity?, genStatus:pending|ready|failed, lessonFile?, genError?}]
└── progress.json  # ProgressFile：currentKpId? + kps[{kpId, state:learning|completed|skipped, forced?, quizBest?, codingPassed?, digest{core,takeaway}?}]
```

语义：解锁=前序全 completed/skipped；**回溯重学不拨 currentKpId 指针、旧 digest 保留**；跳过留 digest 空缺（getLearningContext 以 gap:true 占位）；path/progress 随课程包 zip 往返迁移（courseId 与 manifest 一致性校验）。

### interactive 编译管线（P5.6，✅）

```
AI 生成 TSX（source ≤500KB）
  → interactive:compile（主进程 esbuild：预扫描安全门 → 白名单 import 重写为 cad-i://bridge/chunks/*.js → ESM）
  → <iframe sandbox="allow-scripts">（opaque origin，摸不到宿主/Node）
  → bootstrap.html：cadBridge 客户端 + 错误边界 + 心跳(2s，漂移>3s 卡顿提示/>8s 挂死重载) + 尺寸自适应
  → 桥调用 postMessage → 宿主中继 → interactive:bridge IPC → 主进程强制只读/路径限定
```

桥面：9 个 UI 库 chunk（react/motion/echarts[EChart 封装]/konva/xyflow/matter/three[fiber+drei 同 chunk 保实例唯一]/controls[自封装 5 控件]/mafs）+ 3 个宿主桥（fs=课程数据只读[readCourseFile/readCourseAsset/getProgress/getManifest]、system=getSystemInfo、agent=askTutor 转问助教管道）。技能文档 `references/interactive-bridge.md` 是 AI 侧契约（硬规矩：热路径不跨桥）。

### DSH 会话（DSH 持有，应用只存关联）

JSONL 落 `$DSH_HOME/sessions/`；渲染层 localStorage 持 sessionId，重启后 `agentResume`。

## 6. 模块实现现状（关键函数级）

| 文件 | 关键导出 | 状态 |
|---|---|---|
| `dshRuntime.ts` | `resolveDshPaths`/`ensureProfile`/`createDshRuntime`/`extractJsonFrames`/`mapSessionEvent` | ✅ |
| `learningPath.ts` | `initPath`/`replacePath`/`getPath`/`saveKpLesson`/`setKpGenFailed`/`startKp`/`completeKp`（digest 自动提取兜底）/`skipKp`/`getLearningContext`/`isKpUnlocked`/`deriveCurrentKp`/`getProgress`/`saveKpDigest`/`extractDigestFromDoc` | ✅ |
| ~~`reviewView.ts`~~ | 校对视图服务 | 🔴 已删除（2026-11-11） |
| ~~`reviewIpc.ts`~~ | 校对域 IPC | 🔴 已删除（2026-11-11） |
| `interactiveCompile.ts` | `compileInteractiveComponent`/`scanImportSpecifiers`/`AI_IMPORT_MAP`/`AI_NAMED_EXPORTS`/`InteractiveCompileError`/`clearCompileCache` | ✅ |
| `interactiveBridge.ts` | `readCourseFileText`/`readCourseAssetDataUrl`/`getCourseProgress`/`getCourseManifest`/`InteractiveBridgeError` | ✅ |
| `interactiveIpc.ts` | `registerInteractiveProtocolScheme`（ready 前）/`registerInteractiveIpc`（协议 handler + 双通道） | ✅ |
| `pathIpc.ts` | `registerPathIpc`（path/kp/lesson/asset 四组通道） | ✅ |
| `coursePackageV2.ts` | v2 全套 + `getCourseAssetDataUrl`（assets/ 前缀铁律+20MB+MIME 白名单） | ✅ |
| `kpSource.ts`/`courseStats.ts`/`lesson-quality.ts` | `getKpSource`/`readMaterialPage`/`listMaterialFiles`；`getCourseStats`；`checkLessonCapacity`/`countTextWords` | ✅ |
| `lesson-schema.ts` | 22 *BlockSchema + `BRIDGE_IMPORTS` + 单块类型导出（AnimBlock/QuizBlock/InteractiveBlock…） | ✅ |
| `src/course-tools/index.ts` | 21 工具（P5.7 加 `cad_save_kp_digest`；build:plugin → vendor @cad/course-tools/lib/index.js） | ✅ |
| 渲染层 blocks/ | 12 个组件（见 §4） | ✅ |
| ~~渲染层 ReviewPage.tsx~~ | 校对页 | 🔴 已删除（2026-11-11） |
| `scripts/build-bridge-libs.mjs` | 12 chunk 预打包（react 入口须含 forwardRef/Component/createRoot；three+fiber+drei 同 chunk） | ✅ |
| `scripts/seed-render-smoke.cjs` | 实机验收种子课程生成器（零 AI 消耗；含全部 22 类块样例） | ✅ |
| `resources/dsh-runtime/spike-home/` | P5.0 spike 残留 | 可整体删除（已 git 忽略） |

## 7. P 阶段开发进度表

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| P1/P2/P3/P4/P5存层 | 底座/IPC/首页/数据模型 v1/技能 MVP | ✅ | 测试+computer-use 验收 |
| P9.6/9.7/9.8 | DSH 单通道/权限档位/MCP 管理 | ✅ | 测试+实测 |
| P11 | 打包管线（NSIS+portable） | ✅ | release/ 已产出（未签名） |
| **P5.0** | 插件桥（官方 profile 路线） | ✅ | spike 三绿 |
| **P5.1** | 课件 Schema v2（+P5.3 修 diagram.source 冲突 bug） | ✅ | 测试 |
| **P5.2** | 课程包 v2 读写 | ✅ | zip 篡改拒绝实测 |
| **P5.2.5** | course-tools 插件 v2（20 工具单源架构） | ✅ | boot-spike registered 20 tools |
| **P5.3** | 技能 v2 + 学习路径数据层（用户六原则拍板） | ✅ | 测试 |
| **P5.4** | 学习路径页 + 完成判定门 | ✅ | 实机验收 |
| **P5.5** | BlockRenderer（A 层库全量真渲染） | ✅ | vitest 102 + 实机目检全项 |
| **P5.6** | interactive 编译管线（D2 裁决落地） | ✅ | vitest 118 + 实机验收全项 |
| **P5.7** | 校对界面（人审 + digest 提取定稿；P5.4 残留修复） | ✅ | vitest 126 + 实机验收全项 |
| **P5.8** | 编程题接执行（Runner 本地判，完成门转正） | ✅ | vitest 134 + 实机全链路 |
| P6/P7/P8/P10 | 三栏工作台/文件工作区/学习记录汇总 | 未开始（**P8 核心执行器已随 P5.8 落地**：runner.ts） | — |
| SQLite | better-sqlite3+Drizzle | 🔶阻塞（无 VS Build Tools） | — |

**当前正在开发**：P5.7/P5.8 ✅（2026-11-11）。下一主线 **P6 三栏工作台**。测试基线 **134/134（15 文件）**；验收三连 `npm run typecheck` → `npx vitest run` → `npm run smoke`（SMOKE_OK）。

## 8. 已确认技术决策（全部【已确认】，用户逐项拍板）

1. **D1 课件内容模型 = 纯 Block JSON**：22 类判别联合，禁自由 HTML、禁 AI 直接生成网页。
2. **D2 交互组件 = AI 生成 TSX + 独立受限 Renderer + 白名单桥**（2026-11-11 用户终裁，取代早先"无沙箱 Node 全能力"）：允许复杂交互和真实编译执行，不允许直接访问 Node 和应用敏感 API；课程文件/进度以**只读桥**形式可达（用户明确要求）。落地见 §5 编译管线。
3. **D3 PDF/EPUB = 静默 agent 预处理**（无对话框）；应用内直读列为后续可选。
4. **D4 业务桥 = DSH 官方插件机制**（P5.0 完成）：profile `cad` + junction + 托管 patch；DSH 原生能力优先（普查清单：jobs/workflow/subagent/PTC/ripgrep/tool-present/storage-domain/session-query-sqlite/office-to-pdf 等，勿自建）。
5. **D5 持久化 = index.json 先行**，装 VS Build Tools 后迁 Drizzle。
6. **D6 判题 = 选择/填空本地判**（quiz≥2/3 且编程未失败才 completed，forced 应急门）；编程题先"发 DSH 执行"，P8 后接本地判题。
7. **Agent 层单通道 = DSH**（Vercel AI SDK 已彻底删除，勿恢复）。
8. **技能加载用 DSH 原生**：`<dshHome>/skills` 零配置热加载。
9. **聊天 Artifact 与课程课件是不同系统**：dsh-artifact 永不作课程载体。
10. **AI 消耗纪律**：测试一律零消耗（Mock/真实本机执行/本地种子课程），真实 API 只做最小连通验证。
11. **知识点驱动六原则**（P5.3 用户拍板）：知识点=最小教学生产单元/按需生成/渐进解锁/独立持久化/上下文连续（digest 链）/可回溯可跳过。

## 9. 待确认选型（⚠️新会话优先与用户澄清）

1. PDF/EPUB 应用内直读（pdfjs/foliate-js）是否要做、何时做（当前决策：只走 agent 静默预处理）。
2. dsh-artifact 社区插件是否引入（仅聊天可视化用途）。
3. 代码签名与自动更新方案（exe 未签名，SmartScreen 需"仍要运行"）。
4. SQLite 迁移需要用户先装 VS Build Tools（`winget install Microsoft.VisualStudio.2022.BuildTools` 勾 C++ 工作负载）——迁移时机待用户定。
5. cad_save_asset（course-tools 工具扩充候选，用户未表态）。

## 10. 已知问题与技术债务

| # | 问题/债务 | 影响/处置 |
|---|---|---|
| 1 | DSH 为官方**预览版 0.2.2-rc.1** | 版本钉死；升级需回归 spike + 全量测试 |
| 2 | vendor 体积 ~1GB（node_modules 895MB + node24 86MB） | exe 打包过大；P11 裁剪（git 已排除，不进仓库） |
| 3 | MCP 在正式 profile `cad` 下的完整链路尚未跑过一次真实对话 | P5.7 联调时首验 |
| 4 | `spike-home/` 残留 | 已 git 忽略，可整体删除 |
| 5 | junction 依赖 vendor 与 $DSH_HOME 同卷（NTFS） | 常规安装同卷无碍 |
| 6 | Electron 内嵌 Node 被指纹白名单拒 | 勿改回 ELECTRON_RUN_AS_NODE；用 node24 |
| 7 | bash heredoc 追加超 ~209 行会截断破坏文件 | 长内容一律 Write/Edit 工具 |
| 8 | vendor 安装铁律：`npm install --ignore-scripts --no-audit --no-fund`，禁 `--omit=optional` | 重装/升级 DSH 时遵守 |
| 9 | GitHub 直连不稳；Electron 二进制走 npmmirror | 大文件失败开代理重跑 |
| 10 | **本机 npm 装大包易被网络截断 + 并发两个 npm 会互相剪树**（P5.6 实测：后台 install 用过期 package.json 回写抹掉 7 个依赖） | 依赖变更一律单次前台 `npm install`，完成后核对 package.json + 关键包版本 |
| 11 | exe 未签名；无自动更新 | 后续处理 |
| 12 | better-sqlite3 编不过（无 VS Build Tools） | 见 §9-4 |
| 13 | **esbuild 在解析层丢弃未使用 import**（treeShaking:false 拦不住） | interactive 白名单审查必须在源码文本上做（已实现，见 §5） |
| 14 | Electron 45 `Privileges` 无 `isolatable`——自定义协议无法站点隔离 | interactive 沙箱为进程内 opaque origin；挂死防护靠心跳+重载 |
| 15 | mermaid 节点标签含 `[` 必须双引号包裹（`A["a[i]"]`） | 已写进技能文档；渲染失败会红卡回喂原文 |
| 16 | electron-vite **主进程改动不热更**（pid 不变），必须重启 dev；渲染层 HMR 正常 | 调试主进程时注意 |
| 17 | App 三视图常驻挂载——返回再进课程不会重读课件，须点「开始学习」走 loadLesson | 已知行为 |
| 18 | ~~P5.4 残留：学习页判定通过未传 digest~~ | **P5.7 已修**：completeKp 三级兜底（显式传入 > 链上已有 > 课件 summary/keypoint 自动提取）；Agent 另有 cad_save_kp_digest、校对页可人工定稿 |

## 11. 下一步开发计划（当前主线：P5.8）



### P6 三栏工作台 + P7 文件工作区（✅ 2026-11-11 凌晨完成）

- **P6**：`react-resizable-panels@2` 三栏（KP 列 | 阅读列 | 工作台侧栏）——拖拽宽度，`autoSaveId` localStorage 持久化布局；学习页 header 增「助教/文件」开关。**AI 助教抽为 `agentChatStore` 单例**（useSyncExternalStore）：全页 AgentChatPage 与新 `AgentSidePanel` 共用同一 DSH 会话/消息流/事件订阅（一份订阅，两视图纯渲染壳）；`requestPrompt`（空闲即发、忙则挂起 finish 后补发）取代 pendingPrompt 管道；`ChatTranscript` 共享消息流渲染（compact 双模式）
- **P7**：`services/workspaceFs.ts`——每课程持久沙盒 `<workspaceRoot>/files/<courseId>/`（与 runner 的 runs/ 隔离），路径限定（穿越/绝对/反斜杠/空段拒绝）+ 512KB 文本上限 + 点文件/.git 过滤；**isomorphic-git 快照**（init 幂等 + add + commit best-effort，失败不阻塞写入）；IPC `workspace:tree/read/write`；`FileWorkbenchView`（react-arborist 文件树[ResizeObserver 测高] + CodeMirror 懒加载 + 内联新建文件[Electron 禁 prompt] + 保存显示快照 hash）
- **验证**：typecheck 0 错 / vitest **132 全绿**（+4 workspace）/ 实机（三栏拖拽布局、新建 demo.py、编辑保存、git 快照链 e7e001a9→04c04807 磁盘核验）
- **踩坑**：①workspace IPC handler 忘 await → data 是 Promise → structured clone 失败（渲染层无限「加载…」）②electron-vite dev 对 main 源码改动不总是热重启（改 main 后需手动重启 dev）③react-resizable-panels v4 是 Workspace/Tabset 全新 API，需钉 v2（PanelGroup/PanelResizeHandle 经典 API）



### P8 收尾（通用执行）+ P10 学习记录（✅ 2026-11-11 晨完成，commit 1d87b35）

- **P8 收口**：`runner.ts` 增 `runScript`——通用单文件执行（py/js/c；复用沙盒/超时杀树；捕获 stdout/stderr/退出码；扩展名定语言白名单）。IPC `workspace:run`（内容直传 = 直接跑编辑器草稿，不要求先保存）。文件工作区编辑器增「运行」按钮（绿）+ 输出面板（退出码/语言/耗时/超时标记/stdout/stderr/收起）
- **P10**：索引条目增 `totalKps/completedKps`——`refreshIndexEntry` 聚合 path.json 总数 × progress.json 结算数（completed/skipped 视为已过），重建条目保留 `lastStudiedAt`（upsert 整条替换语义）；`touchCourseLearning` 挂到 startKp/completeKp/skipKp 三个学习动作。首页 CourseRow「n/m 已完成」、ContinueBanner 真实进度条 + 百分比 + 「继续学习」排序有真实时间戳
- **验证**：typecheck 0 错 / vitest **134 全绿**（+2 runScript）/ 实机（工作区跑 python：退出码 0 + stdout 面板；跳过动作 → 首页 1/2 + 50% 进度条 + 「上次学习 刚刚」）
- **遗留**：runScript 的 c 档位本机无 gcc（装 MinGW-w64 后即通）；快照历史查看 UI（P7 后续）；课程卸载不清理 workspace/files/<id>（卸载时可顺带删）

### P5.7 校对界面（✅ 2026-11-11 完成）

- **校对页 `ReviewPage.tsx`**（学习页 header「课件校对」进入）：左列章节分组课件表（人审状态+校验双徽标+统计条）；右侧 = BlockRenderer 全量真渲染预览（**interactive 同沙箱=所见即所得**，quiz 走 QuizCard 可试答）+ validate 面板（error 红/warn 容量黄+重校验）+ 页码抽查（chips 与块角标 → OCR 对照抽屉：课件摘录↔ocr 原文，ocrFile 直读优先/bookPage 扫描自证/±1 邻页回查）+ **digest 定稿编辑器**（KP 课件）+ 状态流转（标记有效/批准/标记失败——failed 由主进程现跑校验写入错误清单；**有 error 禁批准**）
- **digest 定稿三通道**（P5.4 残留修复）：① Agent `cad_save_kp_digest`（插件 21 工具，技能主循环 B 第 7 步）；② completeKp 三级兜底（显式传入 > 链上已有 > 课件 summary/keypoint 自动提取，链不断）；③ 校对页人工编辑（kp:digest:save）。saveKpDigest upsert：无条目建 learning 条目不推进解锁
- **服务**：`reviewView.ts`（overview/validate/OCR 页）+ `reviewIpc.ts`（5 通道）+ ipc 契约 ReviewOverview/OcrPageResult
- 顺带：blocks-catalog.md 补 mermaid 括号提醒；seed 脚本补 sourceRef/OCR 材料/坏课样本
- **实机验收全项通过**：坏课铁律错误卡+禁批准 / 好课容量 warn / 页码抽查抽屉 / digest 保存落盘+回显 / valid 状态流转徽标
- 未做（后续补）：course_stats 展示位；「重新生成」按钮（当前靠问助教）

### P5.8 编程题接执行（✅ 2026-11-11，顺带落 P8 核心）

- **Runner 服务 `services/runner.ts`**（P8 核心）：临时工作区 `workspace/runs/<courseId>/<exerciseId>/`（每次清空重写）；语言档位 python（PATH，PYTHONUTF8=1）/ c（gcc 编译+运行）/ javascript（**vendor node24 优先**，缺省 PATH node）；spawn 直跑不经 shell（无引号转义面）；超时 taskkill /T /F 杀树；stdout 归一比对（CRLF/行尾空白/末尾空行）；C 档 compile.ok=false 不跑测试；工具链缺失给可读错误（「未找到 gcc：请安装 MinGW-w64」）
- **IPC**：`exercise:get`（练习文档）+ `runner:run`（runnerIpc.ts；node24Path 由宿主传入）
- **渲染层**：`CodingBlockView`（拉练习→题面 md→CodeMirror 6 编辑器[懒加载分包，@uiw/react-codemirror + lang-python/cpp/javascript + one-dark]→运行→逐测试 pass/fail 对照面板[期望/实际/stderr 可展开]→全过 onPassed）→ BlockRenderer coding 分支真组件（替换占位卡）
- **完成门转正**：canComplete = quiz≥2/3 且（无编程题 或 codingPassed）；completeKp 带 codingPassed；应急门保留
- **seed**：ex-insertion-sort（python 插入排序 stdin 题，3 测试）
- **实机验收全链路**：起步代码 → 2/3（无序用例红，已有序/单元素天然过——判定区分精确）→ 写入正确实现 → 3/3 通过 ✓ → 完成门转正「编程题已通过」
- 未做（后续补）：练习页内参考解查看；C 档真实 gcc 环境（本机无 gcc，vitest 覆盖了缺失错误路径）

### P6 三栏工作台 → P7 文件工作区 → P10 学习记录

依赖链：P5 闭环全部完成（digest/人审/编程判定）。
每步验收三连：`npm run typecheck` → `npx vitest run`（基线 **134/134**）→ `npm run smoke`。

## 12. 新会话接手指南

1. **先读**：本文件 → memory `C:\Users\35597\.zcode\cli\memories\projects\draft-3be231bf-37fe-41ce-9d7b-c87ef1852bc9-33ee712c3221b000\memory\code-academy-desk-project.md`（最全进度）与 `key-verified-facts-agent-stack.md` → `README.md`（路线图）。
2. **代码入口**：主进程 `src/main/index.ts`；学习路径 `src/main/services/learningPath.ts` + `pathIpc.ts`；校对（已移除）；interactive 管线 `src/main/services/interactiveCompile.ts` + `interactiveIpc.ts`；课件契约 `src/shared/lesson-schema.ts`；渲染层 `src/renderer/src/App.tsx` + `components/LearningPathPage.tsx` + `components/ReviewPage.tsx` + `components/blocks/`。
3. **命令**：`npm run dev` / `npm run typecheck` / `npx vitest run`（基线 126）/ `npm run smoke` / `npm run dist`（exe）/ `npm run build:plugin`（course-tools）/ `npm run build:bridge`（interactive 桥 chunk）。
4. **git**：仓库已建立；`resources/dsh-runtime/{node_modules,node24,spike-home}` 与 `resources/interactive-bridge/` 按设计**不进仓库**。**全新 clone 后必须执行三步**再 dev：
   - `cd resources/dsh-runtime && npm install --ignore-scripts --no-audit --no-fund`（禁 --omit=optional；带 scripts 会因 sherpa-onnx GitHub 下载失败整树回滚）
   - node24：下载 npmmirror `v24.11.0/win-x64/node.exe` 放 `resources/dsh-runtime/node24/node.exe`
   - 项目根 `npm run build:plugin && npm run build:bridge`
5. **DSH 相关**：profile `cad` 在 `%APPDATA%/code-academy-desk/dsh/home/profiles/cad`（首启自动创建）；`--dump-config(-schema)` 可本地审计。
6. **实机验收工具**：`node scripts/seed-render-smoke.cjs` 生成含全部 22 类块的「渲染验收种子课程」（零 AI 消耗），看完 `zz-render-smoke` 课程手动删或重跑脚本覆盖。
7. **约定**：JetBrains 语义 token；IPC 一律 IpcResult 信封；通道命名 `<domain>:<action>`；重大架构改动先解释影响等用户确认；不重建 AI SDK 层；不重复实现 DSH 原生能力。
8. **敏感信息**：DeepSeek API Key 在 `%APPDATA%\code-academy-desk\agent-settings.json`，勿进代码/日志/文档/仓库。
