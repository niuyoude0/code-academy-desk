# Code Academy Desk

教材驱动的 Windows 优先桌面端编程学习工作台。技术选型依据见上级目录《Code_Academy_Desk_Technology_Selection_Report.html》（v1.1）。

## 开发

```bash
npm install        # 首次安装（electron 二进制下载较慢）
npm run dev        # 开发模式（主进程/渲染进程热更新）
npm run build      # 构建 out/
npm run typecheck  # 主进程 + 渲染进程双 tsconfig 类型检查
npm run smoke      # 构建 + 冒烟测试（--smoke：窗口加载后输出 SMOKE_OK 并自动退出）
```

## 结构

```
src/
  main/       主进程（窗口、IPC 注册；后续：Runner 服务/存储/教材导入/Agent）
  preload/    contextBridge 暴露 window.api
  shared/     主/渲染共享的 IPC 契约与类型
  renderer/   React 19 + Tailwind v4 渲染层（三栏工作台）
```

## 路线图状态（对应选型报告 P1–P11）

- [x] P1 项目底座：Electron 45 + electron-vite 6 + React 19 + TS 5.9 + Tailwind v4
- [x] P2 基础 IPC 骨架：类型化通道 + IpcResult 信封 + 冒烟测试（SMOKE_OK）
- [x] P3 课程首页：JetBrains New UI 风格（设计稿 design/home.pen 双屏）→ React 实现：继续学习横幅 + 全部课程网格 + 导入/导出/移除（内联确认）+ 空状态 + 右下角通知条；**已通过 computer-use 端到端验收**（导入 zip → 对话框 → 课程卡实时渲染）
- [x] P5（存层 + 技能）：**教材资料导入**（book-prep-ocr 技能产物原样存层到 userData/materials/，跳过 pages/ 大图；meta.json 宽松解析——字段名不统一按语义识别、缺失留给 Agent）+ **技能系统 MVP**（agentskills.io SKILL.md 契约：扫描/校验/安装/内置技能首发复制）+ **内置技能 course-material-processor**（教 Agent 把 factsheet/ocr/meta.json 构建成课程：零发明/页码必填/OCR 冲突不取舍/来源标识）。vitest 28 测试全通过
- [x] P8 核心（统一 Runner 执行器，随 P5.8 提前落地）：`services/runner.ts`——python/c/javascript 三档位本地直跑 + 超时强杀 + stdin/stdout 测试判定；P7 文件工作区可复用
- [x] P11（打包管线提前验证）：`npm run dist` 产出 NSIS 安装包 + 便携 exe，打包产物冒烟通过（未签名，签名与自动更新后续补）
- [x] P9（Agent 主干，**DSH Runtime 单通道**）：架构决策 2026-11-10——Agent 层采用 **DSH（DeepSeek Harness）独立进程 + stdio JSON-RPC**，Vercel AI SDK 主干已按用户决策（B 极简）删除。`dshRuntime.ts`：spawn 自带 Node 24 + `@deepseek-ai/dsh@0.2.2-rc.1 --profile sdk`（含技能），协议 initialize/prompt/session.event；`approval/request` 桥接原生对话框；会话上下文归 DSH（JSONL 持久化，应用只持 sessionId，支持跨重启 resume）；`user-question/ask` 暂答 cancelled；stop=杀进程懒重启（协议无取消方法）。vendor 部署 `resources/dsh-runtime/`（npm --ignore-scripts + 可选平台包，node24.exe 86MB；**打包体积裁剪留待 P11**）。聊天页：工具卡片、停止、新对话、设置弹窗（key 本机掩码存储）。**待补**：~~沙箱档位 UI~~（P9.7）、~~MCP 管理~~（P9.8）、~~课件 Schema v2~~（P5.1）、~~插件桥~~（P5.0）、~~课程包 v2 读写~~（P5.2）、生成任务页（P5.4）/技能 v2（P5.3）/BlockRenderer（P5.5–P5.6）/校对界面（P5.7）
- [x] P5.3（知识点驱动学习路径 + 技能 v2，2026-11-10）：用户六原则拍板（知识点=最小生产单元/按需生成/渐进解锁/独立持久化/上下文连续/可回溯+可跳过）。**数据层**：`src/shared/learning-path-schema.ts`（path.json 有序 KP 表 + progress.json 学习状态与 digest 链）+ `services/learningPath.ts`（initPath/replacePath/saveKpLesson[lessonId 必须=KP id，复用 saveLessonV2 铁律校验]/startKp[线性解锁+回溯不拨指针]/completeKp[quiz≥2/3 且编程未通过，forced 应急门]/skipKp/getLearningContext[digest 链+gap 占位+下一 KP 预告]）；path/progress 随课程包 zip 往返迁移（courseId 与 manifest 一致性校验）。**技能 v2**：`resources/skills/course-material-processor/` 重写——SKILL.md 主文档（单 KP 按需生成主循环）+ references/{factsheet-guide,blocks-catalog,quality-standard,interactive-bridge,workflow-build}.md + examples/lesson-example.json（随包校验有测试护栏）。容量硬标准（≥2500 字/quiz≥3/example≥2/可视化≥1/interactive≤1）与七段式块映射继承 discrete-math-tutor。**顺带修复 P5.1 schema bug**：DiagramBlock 的 mermaid 文本误用 `source` 字段覆盖页码引用 → 改独立 `mermaid` 字段。**渲染库选型**（design/renderer-libs-survey.md）：A 层=react-markdown/katex 直用/shiki 4/mermaid 12.3/echarts 6/motion 14/CM6；B 层桥接白名单 12 项入 schema `BRIDGE_IMPORTS`（motion/konva/xyflow/matter/three[一期就进]/controls/mafs[冒烟通过]/echarts/fs/system/agent）；mafs×React19 冒烟 3/3（jsdom+act）；许可红线：tldraw 付费排除/p5 LGPL 排除。interactive 编译管线定案：主进程 esbuild 二进制 + 桥接 external/alias + asarUnpack @esbuild/**
- [x] P5.2（课程包 v2 读写）：`src/shared/course-v2-schema.ts`（manifest/SourceRef/GenerationInfo/ReviewRecord/练习复用 v1 Exercise）+ `services/coursePackageV2.ts`——create/addChapter/saveLesson（**先校验后落盘**，铁律失败拒写）/getLesson/saveExercise/review 状态流转/updateGeneration（任务进度）/zip 导入导出（先全量校验后落盘，失败回滚；v2 清单 `manifest.json` 与 v1 `course-package.json` 共存同根同索引，索引自带 schemaVersion 与审核进度计数）。局部重生成=覆写单个 lesson 文件
- [x] P5.0（插件桥 spike→固化，2026-11-10 全绿）：DSH 官方插件路线落地——自定义 profile `cad`（`--from-default-profile sdk` 创建），profile node_modules **junction** 到 vendor 树解决 bare-specifier 解析作用域，应用托管 profile `cordis.patch.yml`（course-tools 行 + MCP 行）。业务插件 `@cad/course-tools`（`defineTool`+`ctx.tools.register`，官方作者契约）随 vendor 分发。spike 实测：插件加载 ✓ / MCP stdio 真连接 ✓（tools/list served）/ initialize ✓
- [x] P5.1（课件 Schema v2）：`src/shared/lesson-schema.ts`——22 类 LessonBlock 判别联合（text/concept/definition/theorem/math/callout/quote/keypoint/thinking/example/compare/table/timeline/formula-list/image/summary/code/diagram/chart/anim/quiz/coding/interactive），铁律校验（origin=book 必带页码引用、choice 必带选项、summary.links 引用完整性），`validateLessonDocument` 前后端/插件三处同源，v1 知识点适配（无页码降级 ai-supplement）。D2 决策落地：`interactive` 块收 AI 生成的 TSX 组件源码（无沙箱、esbuild 编译、能力桥），后续任务实现管线
- [x] P9.8（MCP 管理）：AI 助教页"MCP"按钮——列表/添加/启停/删除（stdio 与 streamable-http 双传输，env/headers 每行 KEY=VALUE）。配置存 `userData/mcp-servers.json`；变更即生成 DSH 调用 patch（`userData/dsh/mcp.generated.yml`，`- insert` 每服务器一行 `@deepseek-ai/dsh-mcp-client`）并重启进程，下一轮生效；工具名 `mcp__<serverName>__<tool>`；启动失败的服务器不影响其余功能（failOnStartupError:false）。Windows 提示：npx 需 cmd /c 包装
- [x] P9.7（权限档位 UI）：设置弹窗三档单选——只读 / 标准（workspace-write+确认）/ 自由（danger-full-access+免确认），经 DSH 原生 `DSH_PERMISSION_MODE` 环境变量联动沙箱与审批（无需自定义 patch）；变更即重启 DSH 进程，下一轮生效。Windows 沙箱经 ACL 限制令牌执行，个别硬链接场景为尽力而为（enforcement: partial）
- [x] P5.2.5（course-tools 插件 v2，2026-11-10）：`@cad/course-tools` 从 spike 升级为 **20 个业务工具**——A 建课骨架（create_course/add_chapter/get_manifest）、B 学习路径（init_path/replace_path/get_path/get_learning_context/save_kp_lesson/set_kp_gen_failed）、C 课件内容（validate_course_blocks[error 级铁律 + **warn 级容量硬标准机检**]/get_lesson/save_exercise/get_exercise/get_reviews）、D 进度（update_job_progress/course_stats/get_progress[只读]）、E 资料结构化读取（**get_kp_source**[factsheet 节切取+ocr 页首头部扫描页码自证]/get_page/list_material_files）。**单源架构**：`src/course-tools/index.ts` 直接 import 应用源码，`npm run build:plugin`（esbuild，176 模块 1.1MB）打进 vendor，profile junction 解析 `@deepseek-ai/dsh-tools` external；宿主注入 `CAD_COURSES_ROOT`/`CAD_MATERIALS_ROOT` env（dshRuntime spawn）。学习状态写操作（startKp/completeKp/skipKp）与删除类操作**故意不暴露**。真实 DSH 进程验证：registered 20 tools（boot-spike，零模型调用）。新增纯服务：lesson-quality.ts（容量机检）、kpSource.ts（KP 取料）、courseStats.ts（统计聚合）
- [x] P5.4（学习路径页，2026-11-10 深夜）：**知识点驱动学习入口**。三视图路由（home/course/agent，App.tsx 常驻挂载）+ 课程卡点击/继续学习横幅打开课程页。`LearningPathPage`：左列有序 KP 表（锁定/待生成/失败/就绪/学习中/已完成/已跳过 七态徽标，解锁规则渲染侧镜像主进程），按需生成=拼固定提示词直通 AI 助教自动发送（pendingPrompt 管道，AgentChatPage sendText 抽取 + lastPromptRef 防 StrictMode 双发）；右侧学习视图轻量渲染 MVP（quiz choice/blank 本地判定交互、code/math/example/keypoint/thinking/formula-list/summary/compare 直出、diagram/chart/anim/interactive/coding 占位卡标注 P5.5–P5.8 接入）+ **完成判定门**（quiz≥2/3 启用完成→解锁下一 KP；含编程题或未达标显式应急门 forced；判定后自动清选、轮询 5s 刷新 genStatus）。IPC 五通道（path:get/kp:start/kp:skip/kp:complete/lesson:get，`src/main/pathIpc.ts`）。建课骨架入口：path.json 缺失时空态「让 AI 助教建学习路径」（提示词按技能主循环 A）。digest 由 Agent 产出，判定定稿接线留 P5.7 校对页提取
- [x] P5.5（BlockRenderer 块渲染器，2026-11-10）：A 层选型库正式接入（react-markdown 10.1+remark-gfm/remark-math+rehype-katex、katex 0.19 直用、shiki 4.6 core+@shikijs/engine-javascript 免 wasm 细粒度按需语言、mermaid 12.3、echarts 6.1 core 按需注册、motion 14.12），全部 vite 懒加载分包。`src/renderer/src/components/blocks/`：BlockRenderer 22 类块统一分派 + Md（GFM+KaTeX 行内公式+fenced 代码 shiki 高亮，白名单外语言回退纯文本）+ Katex + CodeView + MermaidView（dark 主题/strict 安全级/语法错误回显原文）+ ChartView（cad-dark 注册主题对齐 JetBrains 色板，纯 JSON option 零回调）+ AnimView（8 模板帧 DSL：array/stack/queue/linkedList/tree/graph/hashTable/matrix，motion 帧切换+指针+高亮，坏帧数据 ErrorBoundary 降级）+ ImageView + QuizCard（自学习页迁入）+ BlockShell。image 块新增 `course:asset:read` IPC（assets/ 前缀铁律+20MB 上限+MIME 白名单 → data URL）。学习视图占位卡全部换真渲染（interactive/coding 留 P5.6/P5.8 占位）。标题类字段（concept/definition/theorem/example/compare/anim）用行内 md 宽容渲染（AI 常在标题写 LaTeX）。**验证**：typecheck 0 错 / vitest 102 全绿（新增 blocksRender.test.tsx 11 用例：KaTeX/md 表格/shiki 真实 chunk 懒加载/anim 帧切换+坏帧降级/judgeQuiz）+ **Electron 实机目检全项通过**（本机脚本 seed-render-smoke.cjs 造含全部重块测试课程，零 AI 消耗：KaTeX 行内+展示公式、shiki python 高亮、mermaid 流程图正路径+错误回退路径、echarts 暗色曲线+tooltip、anim 帧切换指针高亮、image 资源通路、quiz 交互、完成判定门）
- [x] P5.6（interactive 编译管线，2026-11-11 凌晨）：**D2 裁决落地（独立受限 Renderer + 白名单桥，用户拍板"允许复杂交互和真实编译执行，但不允许直接访问 Node 和应用敏感 API"）**。**编译链路**：`src/main/services/interactiveCompile.ts`——主进程 esbuild（0.28 二进制，asarUnpack @esbuild/**，esbuild 已挪 dependencies）把 AI 生成的 TSX 转译为 ESM，白名单 import 编译期重写为 `cad-i://bridge/chunks/*.js` 绝对 URL；**安全门 1 = 源码级 import 预扫描**（关键发现：esbuild 在解析层丢弃未使用的 import，`treeShaking:false` 也拦不住，onResolve 根本不触发——白名单审查必须在源码文本上做），含**具名导出校验**（`import { readFileSync } from 'fs'` 编译期即报"fs 桥没有导出 readFileSync"）；安全门 2 = 产物兜底检查（node:/require）；编译缓存按 sha256。**沙箱执行**：`cad-i://` 自定义协议（standard/secure/supportFetchAPI/corsEnabled；Electron 45 Privileges 无 isolatable，站点隔离不可用——进程内 opaque origin 沙箱即安全边界）serve `resources/interactive-bridge/`（scripts/build-bridge-libs.mjs 预打包 12 chunk 3.3MB：react/motion/echarts[封装 EChart]/konva/xyflow/matter/three[fiber+drei 同 chunk 保实例唯一]/controls[自封装 5 控件]/mafs/fs/system/agent + mafs/xyflow css + 字体；B 层库装 devDeps 不进 asar）。`InteractiveBlockView` 宿主：`<iframe sandbox="allow-scripts">` opaque origin 摸不到宿主，postMessage 桥中继 → `interactive:bridge` IPC → 主进程强制只读/路径限定（fs.readCourseFile[限 manifest/path/progress/review/chapters/exercises 文本 ≤2MB]/readCourseAsset[复用 image 块铁律]/getProgress/getManifest/system.getInfo；agent.askTutor 是渲染层本地动作）；init 双向门控（编译就绪 + iframe ready）+ 心跳（2s，长任务漂移自检 >3s 提示卡顿、>8s 挂死 → 重载按钮）+ 高度自适应。**踩坑记录**：宿主 CSP `frame-src cad-i:` 必须显式加（ERR_BLOCKED_BY_CSP）；react chunk 入口须含 forwardRef（motion 内部依赖）+ Component/createRoot/createElement；bootstrap 解构 import；bridge.css 工具类名对齐 Tailwind（flex-col 等）。**验证**：typecheck 0 错 / vitest **118 全绿**（+18：编译白名单/别名/具名导出/缓存、桥路径限定/穿越拒绝/asset 通道）+ **实机验收全项通过**（种子课程 interactive 组件：滑杆 k=2→3 拖动联动、Toggle、motion 动画文本、**fs 桥真实读回 progress.json**、编译错误卡回喂路径）。
- [x] P5.7（课件校对界面 + digest 定稿，2026-11-11）：**ReviewPage**（学习页 header「课件校对」进入）——左列章节分组课件表（人审状态+校验双徽标）；右侧 = BlockRenderer 全量真渲染预览（**interactive 同沙箱 = 所见即所得**，quiz 走 QuizCard 可试答）+ validate 面板（铁律 error 红 / 容量 warn 黄 + 重校验）+ **页码抽查**（块角标与 chips → OCR 对照抽屉：课件摘录 ↔ ocr 原文，ocrFile 直读优先、bookPage 扫描页首头部自证、±1 邻页回查）+ **digest 定稿编辑器**（KP 课件）+ 状态流转 draft→valid|approved|failed（failed 主进程现跑校验写入错误清单；**有 error 禁批准**）。**digest 链三通道定稿**（修复 P5.4 残留「判定通过未传 digest → 前序 KP 被当 gap」）：① Agent 新工具 `cad_save_kp_digest`（插件 21 工具，技能主循环 B 第 7 步）② completeKp 三级兜底自动提取（summary/keypoint）③ 校对页人工编辑；`saveKpDigest` upsert：无条目建 learning 条目不推进解锁。主进程新增 `services/reviewView.ts`（overview 聚合：损坏课件折进 errors 不抛 / OCR 页定位）+ `reviewIpc.ts`（review:get/setStatus/validate/pageText + kp:digest:save）。**验证**：typecheck 0 错 / vitest **126 全绿**（+8）+ 实机验收全项（坏课铁律卡+禁批准、页码抽屉、digest 保存落盘回显、valid 流转徽标）
- [x] P5.8（编程题接 Runner 执行 + P8 核心落地，2026-11-11）：**`services/runner.ts` 统一执行器**——临时工作区 `workspace/runs/<courseId>/<exerciseId>/`（每次清空重写）、语言档位 python（PATH + PYTHONUTF8=1）/ c（gcc 编译+运行）/ javascript（**vendor node24 优先**）、spawn 直跑不经 shell、超时 taskkill /T /F 杀树、stdin 喂 TestCase.input → stdout 归一比对（CRLF/行尾空白/末尾空行）、C 档编译失败不跑测试、工具链缺失可读报错。IPC：`exercise:get` + `runner:run`。**CodingBlockView**（BlockRenderer coding 分支真组件，学习页/校对页共用）：拉练习 → 题面 md → **CodeMirror 6 编辑器**（懒加载分包：@uiw/react-codemirror + lang-python/cpp/javascript + one-dark，readOnly 锁定题给文件）→ 运行 → 逐测试 pass/fail 对照面板（期望/实际/stderr 可展开）→ 全过 onPassed。**完成判定门转正（D6 收口）**：quiz≥2/3 且编程 Runner 判定通过 = 正常 completed（completeKp 带 codingPassed），应急门保留。seed 补 ex-insertion-sort（python 插入排序 3 测试）。**验证**：typecheck 0 错 / vitest **134 全绿**（+8：真实本机执行——python 判定过/不过/超时杀树、多文件子目录起步、node24 js 档位、gcc 缺失错误路径、归一化/白名单/路径安全）+ 实机全链路（起步代码 2/3 部分通过判定精确 → 正确实现 3/3 ✓ → 完成门「编程题已通过」转正）
- [ ] P5（AI 构建闭环）：✅ 全部完成（P5.0–P5.8）
- [ ] P6 三栏工作台（讲义渲染 / 可拖拽分栏）
- [ ] P7 文件工作区（文件树 + CodeMirror 6 + git 快照）
- [ ] P8 统一 Runner（Python/C 直跑 + 超时强杀）
- [ ] P10 学习记录
- [ ] SQLite 接线（P4 索引暂用 index.json，需先安装 VS Build Tools 才能编译 better-sqlite3）

## 交付物

- `release/Code Academy Desk-<版本>-setup.exe`：NSIS 安装包（可选安装目录、创建桌面快捷方式）
- `release/Code Academy Desk-<版本>-portable.exe`：便携版单文件，双击即用

## 已知环境注意事项

- **DSH Runtime vendor**：`resources/dsh-runtime/` 由独立 package.json 管理（`@deepseek-ai/dsh@0.2.2-rc.1`），必须用 `npm install --ignore-scripts --no-audit --no-fund` 安装（原生二进制走 optionalDependencies 平台包，禁 `--omit=optional`；带 scripts 会因 sherpa-onnx 走 GitHub 下载失败整树回滚）。更新 DSH 版本时同步更新该 package.json 并重装
- GitHub 直连不稳定：Electron/electron-builder 二进制已在 `.npmrc` 配置 npmmirror 镜像；下载大文件如再中断，可开代理后重跑 `npm run dist`（electron-builder 有本地缓存续传）
- 手动放置 Electron 二进制时 `path.txt` 必须无换行符（`printf 'electron.exe' > ...`）
- 未代码签名：首次运行如遇 SmartScreen 提示，选"仍要运行"
- **better-sqlite3 需要 VS Build Tools**（本机未装）：接入前先 `winget install Microsoft.VisualStudio.2022.BuildTools` 并勾选 C++ 工作负载，否则 `npm run dist` 会失败；当前课程索引用 JSON 文件临时替代（`src/main/services/coursePackage.ts` 内已标注）
