# Code Academy Desk — AI 交接文档

> 写给下一个接手本项目的 AI。读完这一份即可获得全部上下文：项目是什么、怎么跑、架构为什么这样、每个文件干什么、接口长什么样、踩过哪些坑、接下来做什么。
> 最后更新：2026-11-11（commit `1d87b35`）。运行日志式的历史见 `PROJECT_HANDOVER.md`（更细但按时间组织）。

---

## 0. 先读这个：身份与铁律

**项目**：Code Academy Desk——Windows 优先的桌面编程学习工作台（Electron 45 + React 19）。核心闭环：**教材（OCR 产物）→ AI 按技能生成标准化课件 JSON → React 渲染成交互式学习页 → 本地 Runner 判定编程题 → 学习进度驱动解锁**。最终交付 Windows exe。

**用户**：独立开发者，中文交流。AI 消耗敏感（真实 AI 调用是花钱的，测试默认零消耗本机执行；动用真实 DSH 对话前确认授权）。

**铁律（违反 = 返工）**：
1. **AI 负责生产、React 负责渲染**：AI 只产结构化 JSON（+interactive 块的受限 TSX），**禁自由 HTML 课程**。样式/主题全部在渲染层——改版不碰数据管线、零 AI 消耗。
2. **页码铁律**：`origin='book'` 的课件块必须带 `source`（pdfPage = 书内页码 + 页偏移 + ocrFile）；教材没有的内容不得发明（`origin='ai-supplement'` 标注）。
3. **敏感信息**：DeepSeek API Key 在 `%APPDATA%\code-academy-desk\agent-settings.json`，**绝不进代码/日志/文档/仓库**；查配置只打印字段名与布尔值，不回显值。
4. **重大选型先问用户**；官方有现成的库就不重复造轮子。
5. 质量责任前移（2026-11-11）：人工校对功能已删除，机检（`validate_course_blocks`）+ 技能发出前自检（页码回查 ≥3 条）是仅有的两道关。

**命令**：`npm run dev`（开发）/ `npm run test`（vitest，当前 134 全绿）/ `npm run typecheck`（双 tsconfig）/ `npm run build:plugin`（course-tools 插件打包，改了 `src/course-tools/` 后必须跑）/ `npm run build:bridge`（改沙箱白名单库后）/ `npm run dist`（electron-builder 出 exe）。

---

## 1. 核心概念（术语表）

| 术语 | 含义 |
|---|---|
| **KP（知识点）** | 最小教学生产单元。`path.json` 里的有序条目，id 形如 `ch01-k01` |
| **课件（lesson）** | 一个 KP 的教学 JSON：`chapters/<章>/<kpId>.json`，由 22 类结构化块组成 |
| **块（block）** | 课件最小渲染单元（text/concept/definition/theorem/quiz/anim/interactive…共 22 类，见 §7） |
| **digest 摘要链** | 每个已完成 KP 的 `core/takeaway` 摘要存进 progress.json——生成下一个 KP 时的上下文连续性来源 |
| **book-prep-ocr** | 用户的外部技能：扫描教材 → `factsheet-chNN.md`（章级事实清单）+ `ocr/` 逐页转写 + `meta.json` 页偏移。是本应用的材料层输入 |
| **DSH** | DeepSeek Harness——Agent 层的独立进程（`@deepseek-ai/dsh`，stdio JSON-RPC），自带技能系统/沙箱/审批 |
| **course-tools** | 挂在 DSH 上的插件（20 个 `cad_*` 工具），让 AI 能读写课程包 |
| **Runner** | 本机代码执行器（python/c/javascript），编程题判定 + 工作区通用执行共用 |
| **interactive 沙箱** | AI 写的 TSX → 主进程 esbuild 编译 → `sandbox` iframe（cad-i:// 协议）+ 白名单 postMessage 桥 |

---

## 2. 技术栈（精确到用途）

| 层 | 技术 | 用途 |
|---|---|---|
| 壳 | Electron 45.2.3 | 桌面容器；自定义 cad-i:// 协议（沙箱 iframe） |
| UI | React 19.3.1 + Tailwind CSS 4（`@theme` token）+ lucide-react 图标 | 全部渲染层；主题 = IDEA Light（`src/renderer/src/styles/globals.css`） |
| 构建 | electron-vite + Vite 8.3.7 | main/preload/renderer 三段构建；vite 自动分包（mermaid/echarts/shiki/CodeMirror 懒加载） |
| Markdown/公式/代码 | react-markdown 10 + remark-gfm/math + rehype-katex；katex；shiki 4（github-light，JS 引擎免 wasm） | `Md.tsx`/`Katex.tsx`/`CodeView.tsx` |
| 图形 | mermaid 12（neutral 主题）/ echarts 6（按需注册 + 浅色主题）/ motion 14（anim 帧 DSL 渲染）/ mafs（沙箱内数学坐标图） | 各视图组件 |
| 编辑器 | @uiw/react-codemirror 4 + lang-python/cpp/javascript（React.lazy 分包） | 编程题 + 文件工作区 |
| 工作台 | react-resizable-panels **@2**（v4 是全新 Workspace/Tabset API，勿升）+ react-arborist | P6 三栏 + P7 文件树 |
| Agent | @deepseek-ai/dsh（vendor 在 `resources/dsh-runtime/`，自带 node24）+ dsh-tools 插件协议 | Agent 层（见 §6.4） |
| 数据 | zod 4（全部 schema）；jszip（课程包）；isomorphic-git（工作区快照）；esbuild（沙箱编译）；gray-matter | 主进程 |

---

## 3. 架构总览

### 3.1 分层（进程边界）

```
┌─ Renderer（React，无 Node 权限）────────────────────────────┐
│ 页面：CourseHomePage / LearningPathPage(三栏工作台) / AgentChatPage │
│ 块渲染：BlockRenderer → 22 类视图组件（blocks/）                  │
│ 共享单例：agentChatStore（全页助教与侧栏共用 DSH 会话）             │
└──────────────┬──────────────────────────────────────────┘
               │ window.api（contextBridge，src/preload/index.ts）
┌──────────────▼─ Main（Electron main，全权）──────────────────┐
│ IPC 注册：index.ts 内联(course/skill/material/mcp/agent)        │
│          + pathIpc / runnerIpc / workspaceIpc / interactiveIpc  │
│ 服务 services/：coursePackageV2(课程包读写) learningPath(路径/   │
│   进度/digest) runner(执行) workspaceFs(沙盒+git快照)            │
│   interactiveCompile(ESBUILD) interactiveBridge(白名单桥)        │
│   dshRuntime(DSH进程) kpSource(取料) courseMaterials/skills/     │
│   agentSettings/mcpServers/shell/courseStats                    │
└──────┬───────────────────────┬───────────────────────────────┘
       │ spawn(stdio JSON-RPC)  │ fs（全部路径限定）
┌──────▼────────┐   ┌───────────▼─────────────────────────────┐
│ DSH Agent 进程 │   │ 数据盘 %APPDATA%\code-academy-desk\      │
│ vendor node24  │   │  courses/<课程id>/…  materials/…         │
│ + course-tools │   │  workspace/files/<id>/（P7沙盒+.git）     │
│ 技能系统/沙箱   │   │  workspace/runs/<id>/（Runner临时区）     │
└───────────────┘   └─────────────────────────────────────────┘
```

### 3.2 关键架构决策（历史拍板，勿轻易翻案）

| # | 决策 | 理由 |
|---|---|---|
| D1 | AI 产 JSON、React 渲染，禁自由 HTML | 样式单一来源、可校验、校对即渲染、换肤零 AI 消耗 |
| D2 | interactive 块 = 独立受限 Renderer + 白名单桥（非共享沙箱） | 允许复杂交互但摸不到 Node/宿主；opaque origin 即安全边界 |
| D3 | 生成触发 = 拼固定提示词直通助教自动发送（无生成表单） | 流程固定在技能里，UI 只做入口 |
| D6 | 完成判定门 = quiz ≥2/3 且（含编程题时 Runner 判过）；应急门 forced 保留 | 本地判定零消耗 |
| 2026-11-11 | **删除人工校对页** → 一键重新生成课件 | 用户拍板；质量前移到机检+自检 |
| 2026-11-11 | 视觉 = IDEA Light 文档流（弃暗色卡片式） | 用户拍板；参考豆包阅读列排版 |

### 3.3 课件生产数据流

```
book-prep-ocr（外部技能）→ materials/<id>/{factsheets, ocr/, meta.json}
  → 用户导入资料（material:import）
  → AI 主循环 A：读 factsheet 知识点清单 → cad_create_course + cad_init_path → path.json（KP 骨架）
  → 用户开始学习某 KP → 主循环 B：
      get_learning_context(digest 链) → get_kp_source(factsheet 节+ocr 页)
      → 写课件 JSON（22 类块）+ digest → cad_validate_course_blocks（error≤0，返工≤2轮）
      → 发出前自检（页码回查≥3）→ cad_save_kp_lesson（zod+铁律校验后落盘）
      → cad_save_kp_digest（摘要链入链）
  → 学习页 BlockRenderer 渲染；quiz 本地判 / coding 走 Runner / 完成判定门
```

---

## 4. 目录结构（完整清单）

```
code-academy-desk/
├─ AI_HANDOVER.md / PROJECT_HANDOVER.md / README.md     ← 本文档 / 运行日志 / 简介
├─ package.json                                          ← electron 45.2.3 / react 19.3.1 / vite 8.3.7
├─ src/
│  ├─ shared/                                            ← 主/渲共用契约（零副作用）
│  │  ├─ ipc.ts              IpcChannel 常量 + DesktopApi 接口 + 全部 IPC 载荷类型
│  │  ├─ course-schema.ts    v1 课程包/Exercise/CourseIndexEntry
│  │  ├─ course-v2-schema.ts manifest/SourceRef/GenerationInfo（v2）
│  │  ├─ learning-path-schema.ts path.json/progress.json schema
│  │  ├─ lesson-schema.ts    ★22 类课件块 zod schema + validateLessonDocument（铁律）
│  │  └─ lesson-quality.ts   容量硬标准机检（字数/例题数/quiz 数/可视化数）
│  ├─ main/
│  │  ├─ index.ts            入口；内联 course/skill/material/mcp/agent 五组 IPC 注册
│  │  ├─ pathIpc.ts          path:get / kp:start|skip|complete / lesson:get
│  │  ├─ runnerIpc.ts        exercise:get / runner:run（编程题判定）
│  │  ├─ workspaceIpc.ts     workspace:tree/read/write/run（P7/P8）
│  │  ├─ interactiveIpc.ts   interactive:compile/bridge + cad-i:// 协议注册
│  │  └─ services/
│  │     ├─ coursePackage.ts      v1 课程包 + index.json 读写（listCourses/upsert）
│  │     ├─ coursePackageV2.ts    v2 课程包：create/addChapter/saveLessonV2（校验后落盘）/
│  │     │                        zip 往返/refreshIndexEntry（P10 进度聚合）/touchCourseLearning
│  │     ├─ learningPath.ts       initPath/replacePath/startKp/completeKp/skipKp/saveKpDigest/
│  │     │                        getLearningContext（digest 链组装）/setKpGenFailed
│  │     ├─ runner.ts             ★runExercise（stdin/stdout 逐测试判定）+ runScript（P8 通用单文件）
│  │     ├─ workspaceFs.ts        P7：课程沙盒 tree/read/write + isomorphic-git 快照
│  │     ├─ interactiveCompile.ts esbuild 编译 AI TSX（白名单 import 重写→cad-i chunks；源码级预扫描）
│  │     ├─ interactiveBridge.ts  fs/progress/asset 只读桥（路径限定在主进程强制）
│  │     ├─ dshRuntime.ts         DSH 进程生命周期（spawn/boot/request 守卫/杀树懒重启）
│  │     ├─ kpSource.ts           KP 取料：factsheet 节切取 + ocr 页码自证扫描
│  │     ├─ courseMaterials.ts    book-prep-ocr 产物导入/读取
│  │     ├─ skills.ts             技能安装（ensureBuiltinSkills：只装新不覆盖）
│  │     ├─ agentSettings.ts      API Key/模型/权限档位（本机存储）
│  │     ├─ mcpServers.ts         MCP 服务器配置（变更→重启 DSH）
│  │     ├─ shell.ts              PowerShell 桥 + 输出解码/限幅
│  │     └─ courseStats.ts        只读聚合（cad_course_stats 数据源）
│  ├─ course-tools/index.ts  ★DSH 插件：20 个 cad_* 工具（直接 import 主进程服务，
│  │                          `npm run build:plugin` esbuild 打进 vendor）
│  └─ preload/index.ts       contextBridge：window.api 全 surface
├─ src/renderer/src/
│  ├─ App.tsx                三视图常驻挂载（home/course/agent）；agentChatStore.init()
│  ├─ agentChatStore.ts      ★P6 聊天单例（useSyncExternalStore；会话/事件订阅一份）
│  ├─ styles/globals.css     ★IDEA Light 主题 token + .md-view 文档排版 + shiki 容器
│  ├─ components/
│  │  ├─ CourseHomePage/CourseCard(CourseRow)/ContinueBanner/EmptyState/Toast
│  │  ├─ LearningPathPage.tsx ★三栏工作台（PanelGroup）+ StudyView 阅读列 + 完成判定门
│  │  ├─ AgentChatPage.tsx    全页助教（薄视图）+ AgentSettingsModal + McpManagerModal
│  │  ├─ AgentSidePanel.tsx   P6 侧栏助教（compact）；ChatTranscript.tsx 共享消息流
│  │  ├─ FileWorkbenchView.tsx P7 文件工作区（arborist 树+CodeMirror+运行+保存快照）
│  │  └─ blocks/              ← 课件渲染管线（见 §9）
│  └─ lib/langStyle.ts        语言图标/配色/时间
├─ resources/
│  ├─ dsh-runtime/            vendor：node24 + @deepseek-ai/dsh（~1GB，P11 要裁剪）
│  ├─ interactive-bridge/     cad-i:// 静态资产：index.html(color-scheme light!)/bridge.css/12 个预打包 chunk
│  └─ skills/course-material-processor/  ★生成技能 v2.1（见 §8）
├─ scripts/                   build-bridge-libs.mjs / build-course-tools.mjs / seed-render-smoke.cjs / dsh-boot-probe.cjs / bridge-src/
└─ tests/                     15 个文件 134 用例（vitest node 环境；全部零 AI 消耗）
```

---

## 5. 功能进度总表（P1–P11）

| Phase | 内容 | 状态 |
|---|---|---|
| P1–P4 | 应用壳/v1 课程包/Agent(DSH)/MCP/设置 | ✅ |
| P5.0–P5.8 | 插件桥/课程包 v2/技能/学习路径页/BlockRenderer/interactive 沙箱/~~校对页~~（已删）/编程题 Runner | ✅ |
| P6 | **三栏工作台**（PanelGroup + agentChatStore 单例 + AgentSidePanel） | ✅ 1d87b35 |
| P7 | **文件工作区**（workspaceFs + git 快照 + arborist + CodeMirror） | ✅ 1d87b35（快照历史 UI 未做） |
| P8 | 统一 Runner：编程题判定 + **runScript 通用执行**（工作区运行按钮/输出面板） | ✅ 1d87b35 |
| P9 | Agent 主干（DSH 单通道/权限档位/MCP 管理/设置） | ✅ |
| P10 | 学习记录：索引真实进度聚合 + 首页进度条/继续学习排序 | ✅ 1d87b35 |
| P11 | 发布：vendor 裁剪（dsh-runtime ~1GB→按需）/代码签名/自动更新/SQLite 迁移（**需用户先装 VS Build Tools**） | ⬜ 未开始 |

已验证基线：typecheck 0 错 · vitest **134/134** · 实机走查（三栏/文件工作区/Runner/沙箱/助教）通过。

---

## 6. 接口设计

### 6.1 IPC 全表（通道 → 用途；载荷类型都在 `src/shared/ipc.ts`）

| 通道 | 方向 | 用途 |
|---|---|---|
| `app:info` / `ping` | — | 版本/连通 |
| `course:import/list/get/remove/export` | 渲→主 | v1 课程包 zip 导入导出 + 索引 |
| `course:asset:read` | 渲→主 | 课件 assets 图片 → dataURL（image 块） |
| `skill:list/get/readFile/install` | 渲→主 | 技能浏览（内置安装到 userData/skills，只装新不覆盖） |
| `material:import/list/readFile/remove` | 渲→主 | book-prep-ocr 材料导入/读取 |
| `agent:chat/abort/resume` | 渲→主 | DSH 会话一轮（流事件走 `agent:event` 推送） |
| `agent:settings:get/set` | 渲→主 | Key/模型/权限档位（值不回显渲染层） |
| `mcp:list/add/update/remove` | 渲→主 | MCP 配置（变更→重启 DSH） |
| `path:get` | 渲→主 | CoursePathView{path, progress} |
| `kp:start/skip/complete` | 渲→主 | 学习动作（解锁校验/判定门在主进程；touch 索引进度） |
| `lesson:get` | 渲→主 | 读课件 JSON（学习视图渲染） |
| `exercise:get` / `runner:run` | 渲→主 | 编程题文档 / 逐测试判定（RunResult） |
| `workspace:tree/read/write/run` | 渲→主 | P7 文件树/读/写（git 快照）/ P8 通用执行（ScriptRunResult） |
| `interactive:compile` / `interactive:bridge` | 渲→主 | 沙箱 TSX 编译 / iframe 桥中继（fs 只读等） |

### 6.2 course-tools 插件工具（20 个，AI 侧接口）

| 组 | 工具 |
|---|---|
| A 建课骨架 | `cad_create_course` `cad_add_chapter` `cad_get_manifest` |
| B 学习路径 | `cad_init_path` `cad_replace_path` `cad_get_path` `cad_get_learning_context` `cad_save_kp_lesson` `cad_set_kp_gen_failed` |
| C 课件内容 | `cad_validate_course_blocks`（error=铁律/schema，warn=容量）`cad_get_lesson` `cad_save_exercise` `cad_get_exercise` |
| D 进度 | `cad_update_job_progress` `cad_course_stats` `cad_get_progress`（只读） |
| E 资料 | `cad_get_kp_source`（factsheet 节+ocr 页）`cad_get_page` `cad_list_material_files` |
| digest | `cad_save_kp_digest`（upsert；learning 态不推进解锁） |

**学习状态写操作（start/complete/skip）与删除类操作故意不暴露给 AI**——判定权在应用。

### 6.3 主进程服务关键 API

```ts
// runner.ts（P8）
runExercise({ workspaceRoot, courseId, exerciseId, language, files, tests, timeoutMs?, node24Path? })
  → RunResult { language, compile?, results[](逐测试 passed/expected/actual/stderr/timedOut), passedAll, totalRunMs, entryPath }
runScript({ workspaceRoot, courseId, fileName, content, timeoutMs?, node24Path? })
  → ScriptRunResult { language, stdout, stderr, exitCode, timedOut, durationMs }
// 沙盒 = <workspaceRoot>/runs/<courseId>/<exerciseId|_scratch>/（每次清空重写）
// 语言档位：python(PATH+PYTHONUTF8=1) / c(gcc 编译+main.exe) / javascript(vendor node24 优先)
// 超时：taskkill /T /F 杀树；stdout 归一比对（CRLF→LF/去行尾空白/去末尾空行）

// workspaceFs.ts（P7）
listWorkspaceTree(workspaceRoot, courseId) → WorkspaceNode[]   // .git/点文件过滤，≤800 节点
readWorkspaceFile(workspaceRoot, courseId, relPath) → { content }   // ≤512KB 文本，路径限定
writeWorkspaceFile(workspaceRoot, courseId, relPath, content) → { commit }  // 写入+git 快照(best-effort)
// 沙盒 = <workspaceRoot>/files/<courseId>/（与 runs/ 隔离；卸载课程暂不清理——遗留）

// learningPath.ts
startKp / completeKp(判定门+digest 兜底提取) / skipKp        // 三个动作尾部都 touchCourseLearning
saveKpDigest(coursesRoot, courseId, kpId, {core,takeaway})    // upsert；learning 不推进解锁
getLearningContext(coursesRoot, courseId, kpId)               // digest 链+gap+下一 KP 预告（生成上下文）

// coursePackageV2.ts
saveLessonV2(coursesRoot, courseId, chapterId, lesson)        // zod+铁律校验失败抛错（message 含清单）
refreshIndexEntry(coursesRoot, courseId)                      // P10：章节/练习/进度聚合（保留 lastStudiedAt）
touchCourseLearning(coursesRoot, courseId)                    // 学习动作后：重算进度+盖时间戳
```

### 6.4 DSH 协议要点（`dshRuntime.ts`）

- spawn：vendor `node24/node.exe @deepseek-ai/dsh/lib/bin.js --profile cad`，env 带 `DSH_HOME`（userData/dsh/home）、`DSH_PERMISSION_MODE`（**精确枚举** `read-only|workspace-write|danger-full-access`，错值→插件 ValidationError 启动失败）、`DEEPSEEK_API_KEY`、`CAD_COURSES_ROOT`、`CAD_MATERIALS_ROOT`
- stdio JSON-RPC：`initialize` 握手（**request 守卫只查 child != null——查 initialized 会死锁**，这是修过的 bug）→ `prompt` → `session.event` 流
- 会话归 DSH（JSONL 持久化）；应用只持 sessionId，跨重启 `agent:resume`
- MCP 配置变更 → 杀进程懒重启；`stop` = 杀树（协议无取消）
- `approval/request` 桥接原生确认对话框；`user-question/ask` 暂答 cancelled

---

## 7. 数据契约

### 7.1 课程包目录（v2，`%APPDATA%\code-academy-desk\courses\<id>\`）

```
manifest.json      章节树 + sourceRef{materialId,factsheets,pageOffsets} + generation
path.json          KP 有序表 {id, chapterId, title, bookPage, interactivity, genStatus, lessonFile, genError?}
progress.json      {currentKpId, kps:[{kpId, state(learning|completed|skipped), digest?, quizBest?, forced?, completedAt?}]}
index.json(根)     课程索引（chapterCount/exerciseCount/lastStudiedAt/totalKps/completedKps——P10）
chapters/<章>/<kpId>.json    课件
exercises/ex-*.json          编程题（题面/starterFiles/tests/referenceSolution）
assets/                      课件插图
review.json                  旧版人审清单——已废弃，惰性文件不再读写
```

### 7.2 课件 22 类块（`lesson-schema.ts`；全部块带 `id/origin/source?`）

- **文本知识**：text、concept(title+悬念开场+tags)、definition(term 教材原文)、theorem(proof 每步注依据)、math(latex)、callout(note/warning/pitfall)、quote(页码铁律主载体)、keypoint(闪卡 Q/A)、thinking(思考题+hint)、example(steps 分步)、compare、table、timeline、formula-list、summary(points+links 交叉引用)
- **代码**：code(language 白名单 shiki)
- **图形**：diagram(mermaid)、chart(echartsOption 纯 JSON 零回调)、anim(8 模板帧 DSL：array/stack/queue/linkedList/tree/graph/hashTable/matrix)、interactive(TSX≤500KB+bridgeImports 白名单)
- **练习**：quiz(choice≥2 选项铁律/blank)、coding(exerciseId 引用)
- **铁律校验**（validateLessonDocument）：①book 无 source 拒 ②choice<2 选项拒 ③summary.links 引用不存在块 id 拒
- **容量机检**（lesson-quality）：正文≥2500 字、example≥2、quiz≥3、可视化≥2、interactive≤1

---

## 8. Skill 体系（生成质量的本体）

`resources/skills/course-material-processor/`（v2.1，安装到 userData 后生效；**ensureBuiltinSkills 只装新不覆盖，改完技能要手动同步** `cp -r resources/skills/course-material-processor "$APPDATA/code-academy-desk/skills/"`）：

- `SKILL.md`：主循环 A（建骨架）/ 主循环 B（单 KP 生成 9 步）/ 有趣教学硬标准（悬念开场+≥1 有趣例子+画面感）/ 重新生成模式 / 铁律 / 块选择决策表
- `references/quality-standard.md`：七段式块映射 + 容量硬标准 + **发出前自检（页码回查≥3 必做）**
- `references/visual-design-guides.md`：四类可视化块设计硬规则（mermaid 语法陷阱/echarts 纯 JSON 约束/anim 帧纪律/interactive 选型门槛——素材源 anthropics/skills frontend-design+web-artifacts-builder、官方文档、Mayer/3B1B）
- `references/blocks-catalog.md`（22 块字段契约）、`factsheet-guide.md`（页偏移换算）、`interactive-bridge.md`（12 桥 API+禁区）、`workflow-build.md`（工具调用细节）、`course-materials.md`（资料结构）

沙箱白名单 import（interactive 块可用）：react / motion / echarts / konva / xyflow / matter / three / mafs / controls / fs / system / agent（12 chunk 预打包在 `resources/interactive-bridge/`，改白名单后 `npm run build:bridge`）。

---

## 9. 渲染层组件地图

**页面**：`CourseHomePage`（IDEA 列表行+继续学习真实进度条）→ `LearningPathPage`（PanelGroup 三栏：KP 列表 | 阅读列 max-w-820 | 工作台侧栏 tabs[助教/文件]；完成判定门压平底栏）→ `AgentChatPage`（全页助教，与侧栏共用 store）。

**块渲染管线**：`BlockRenderer`（22 类分派，chrome='read'|'review'）→ `BlockShell`（read=文档流+页边页码注记；review=轻容器）→ 各视图：`Md`（react-markdown 管线）/ `Katex` / `CodeView`(shiki) / `MermaidView` / `ChartView`(echarts 主题) / `AnimView`(motion+8 模板) / `ImageView` / `InteractiveBlockView`(沙箱宿主+心跳看门狗) / `CodingBlockView`(CodeMirror+Runner) / `QuizCard`。

**主题 token**（globals.css `@theme`）：bg #FFF / panel #F7F8FA / line #E3E6E9 / tx #1E1F22 / tx2 #6C707E / acc #3574F0 / ok #4F9257 / warn #9E6B00 / bad #D14343 / thm #8B5CF6(定理紫) / ins #0E9384(思考青) + font-serif 衬线栈。沙箱侧 `resources/interactive-bridge/bridge.css` 有同款副本（两进程不同源，token 各一份，**改主题要两边同步**）。

---

## 10. 踩坑全集（最值钱的部分）

1. **DSH request 守卫死锁**：守卫查 `initialized` 会拦掉自己的 initialize 握手（initialized 只有握手成功才置位）→ 只查 `child == null`，握手后在 chat 层再显式校验。
2. **DSH_PERMISSION_MODE 错值**（如 'standard'）→ sandbox-policy 插件 ValidationError 启动失败；必须精确三枚举。
3. **electron-vite dev 对 main 源码改动不总热重启**——改 main 后手动重启 dev（杀 electron-vite node 进程整树）。
4. **IPC handler 忘 await** → data 是 Promise → structured clone 失败（"An object could not be cloned"），渲染层表现为无限 loading。
5. **iframe 黑底**：`resources/interactive-bridge/index.html` 的 `color-scheme` 必须随主题改（现在 light）。
6. **ensureBuiltinSkills 只装新不覆盖**：改内置技能后必须手动同步到 userData/skills。
7. **upsertIndexEntry 是整条替换**：refreshIndexEntry 重建条目时要保留 lastStudiedAt。
8. **react-resizable-panels v4 是全新 Workspace/Tabset API**——本项目钉 @2.x（PanelGroup/PanelResizeHandle）。
9. **Tailwind 类名里写 `ocr/*/` 会终止 JSDoc 注释**（`*/`）。
10. **esbuild 丢弃未使用 import**——interactive 白名单审查必须在源码文本上做预扫描（onResolve 钩子拦不住）。
11. **宿主 CSP 需显式 `frame-src cad-i:`**；react chunk 入口须含 forwardRef（motion 依赖）。
12. dev 后台管道接 `head` 会 EPIPE → Electron 弹窗；后台跑 dev 用重定向文件别接管道。
13. bash heredoc 传含 `\n` 的代码字符串会被吃转义——写文件用 python 显式 chr(92) 或分次 Edit。
14. CodeMirror 主题切换：`@uiw/react-codemirror` 不传 theme 即默认浅色；one-dark 已卸载。
15. CUA 实机操作（应用验收用）：视口外按钮点击被吞；AX 树 400 元素截断；frame 过期需重新截图。

---

## 11. 环境与纪律

- 数据根：`%APPDATA%\code-academy-desk\`（courses/ materials/ workspace/{files,runs}/ dsh/ skills/ agent-settings.json）
- 种子验收课程：`node scripts/seed-render-smoke.cjs` 写入 `zz-render-smoke`（22 类块全量+练习，可重复执行先删后写）
- 真实材料：`C:\Users\35597\Desktop\book-ocr`（《Java 2 实用教程（第 7 版）》已建课 `java-2-practical-7e`：5 章 66 KP）
- 测试纪律：全部零 AI 消耗；真实 DSH 对话前必须获用户授权
- git：本地仓库无 remote（用户提出即加）；提交按里程碑，中文消息

## 12. 下一步路线（按优先级）

1. **P11 发布线**：vendor 裁剪（dsh-runtime 只留 win32 包+裁 node_modules，~1GB→目标 <300MB）→ electron-builder 签名/自动更新 → SQLite 迁移（**需用户先装 VS Build Tools**，better-sqlite3 编译）——迁移前 index/progress 均为 JSON 文件，量级无压力
2. P7 后续：快照历史查看 UI（isomorphic-git log 已可用）
3. 小项：课程移除时清理 workspace/files/<id>；skill 主循环 A 边界约束加强（AI 曾越出"到此为止"继续建课件）
4. 已知平台缺口：本机无 gcc（c 档位装 MinGW-w64 后自动通）
