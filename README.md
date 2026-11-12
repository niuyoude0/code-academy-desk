# Code Academy Desk

教材驱动的 Windows 优先桌面端编程学习工作台（Electron 45 + React 19）。

核心闭环：**教材（OCR 产物）→ AI 按知识点生成标准化课件 JSON → React 渲染成交互式学习页 → 本地 Runner 判定编程题 → 学习进度驱动解锁下一个知识点**。

```
┌─ 顶部工具栏 = 课程目录（小节下拉 · 进度点 · 上一节/下一节 · 重新生成课件）──────────┐
├──────────────┬──────────────────────────┬──────────────────┤
│ 左栏 = 课件正文  │ 中栏 = 代码                 │ 右栏 = AI 助教（常驻） │
│ 22 类块文档流直排│ 编程题（题卡+CodeMirror+判定）│ 完整对话列            │
│ 概念/公式/小测   │ 文件工作区（git 快照）        │ 应用到编辑器/提示      │
│ coding 块=入口卡 │ 终端风判定面板               │ 底部输入框           │
│ 底部完成判定门   │                            │                   │
└──────────────┴──────────────────────────┴──────────────────┘
```

## 它解决什么问题

把一本扫描版教材变成**可交互、可判题、按知识点渐进解锁**的学习课程，全程只需消费教材本身——

- **AI 负责生产、React 负责渲染**：AI 只产结构化 JSON（22 类课件块：text/concept/theorem/quiz/anim/interactive…），样式与交互全部在渲染层。改版式零 AI 消耗，课件可校验、可导入导出。
- **页码铁律**：凡标注来源于教材的块必须带页码引用（pdfPage + 页偏移 + ocr 文件），教材没有的内容不得发明——机检（schema + 容量硬标准）+ 技能发出前自检双道关。
- **本地判定**：编程题在本地 Runner 跑（python / c / javascript 三档位，stdin-stdout 逐测试判定，超时杀树），quiz 本地判——学习闭环零 AI 消耗，AI 只在生成课件/答疑时介入。
- **Agent = DeepSeek Harness（DSH）**：独立进程 + stdio JSON-RPC，自带技能系统与沙箱审批；挂业务插件 `@cad/course-tools`（20 个 `cad_*` 工具）读写课程包，AI 永远拿不到学习状态的写权限（判定权在应用）。

## 快速开始

```bash
npm install          # 首次安装（Electron 二进制走 .npmrc 的 npmmirror 镜像）
npm run dev          # 开发模式
npm run typecheck    # 主进程 + 渲染进程双 tsconfig
npm run test         # vitest，137 用例（全部零 AI 消耗）
npm run dist         # electron-builder 出 NSIS 安装包 + 便携 exe
```

改了 `src/course-tools/` 后需要 `npm run build:plugin`（打进 DSH vendor）；改了沙箱白名单库后 `npm run build:bridge`。

**配置 AI Key**：应用内右上角 ⚙ → 填写 DeepSeek API Key（存本机 `%APPDATA%\code-academy-desk\agent-settings.json`，掩码显示，**永不进代码/日志/仓库**）。没有 Key 也能用：导入现成课程包学习，只有生成/重新生成课件需要 AI。

**导入示例课件**：仓库自带一个合成课程（22 类课件块全覆盖 + 编程题，零版权内容）——首页「导入课程」选择 [`examples/render-smoke.zip`](examples/render-smoke.zip) 即可体验完整闭环。源文件在 [`examples/render-smoke/`](examples/render-smoke/)，也可 `node scripts/seed-render-smoke.cjs` 直接写入本机数据盘。

## 工作流：怎么用一本教材建课

1. **教材预处理**（外部技能 [book-prep-ocr]）：扫描教材 → 产出 `factsheet-chNN.md`（章级知识点清单）+ `ocr/`（逐页转写）+ `meta.json`（页偏移），应用内「导入资料」存层。
2. **建骨架**：课程页空态「让 AI 助教建学习路径」→ AI 读 factsheet 生成有序 KP（知识点）表。
3. **逐节学习**：点开一个 KP → AI 按 `course-material-processor` 技能主循环生成该节课件（digest 摘要链保持上下文连续）→ 学习页渲染 → quiz ≥2/3 且编程题 Runner 判过 → 解锁下一节（保留应急门）。
4. **不满意就重生**：顶部「重新生成课件」（带确认）→ AI 重生成 → 落盘推送自动刷新课件区。

## 架构

```
Renderer (React 19, 无 Node 权限)
  三视图: 课程首页 / 学习页(三栏工作台) / 全页助教；块渲染: BlockRenderer → 22 类视图
        │ window.api (contextBridge)
Main (Electron main)
  IPC + services: coursePackageV2(课程包读写) learningPath(路径/进度/digest)
  runner(判题) workspaceFs(沙盒+git快照) interactiveCompile(esbuild) dshRuntime(DSH进程)
        │ spawn stdio JSON-RPC          │ fs (路径全限定)
  DSH Agent 进程                数据盘 %APPDATA%\code-academy-desk\
  (@cad/course-tools 插件)       courses/ materials/ workspace/{files,runs}/
```

- **interactive 沙箱**：AI 写的 TSX 组件经主进程 esbuild 编译，跑在 `cad-i://` 协议 iframe（opaque origin）里，import 白名单 12 桥（react/motion/echarts/konva/xyflow/matter/three/mafs/fs/system/agent/controls），源码级预扫描 + 产物兜底检查双道安全门。
- **权限档位**：只读 / 标准（workspace-write + 审批确认）/ 自由，直通 DSH 原生 `DSH_PERMISSION_MODE`；MCP 服务器可在设置里管理（变更即重启 Agent 进程）。
- **课程包**：`%APPDATA%\code-academy-desk\courses\<id>\` 下 manifest / path / progress / chapters / exercises / assets，zip 导入导出全量校验往返。

更多细节见 [`AI_HANDOVER.md`](AI_HANDOVER.md)（架构决策 + 接口全表 + 踩坑全集）、[`PROJECT_HANDOVER.md`](PROJECT_HANDOVER.md)（按时间线的运行日志）、[`docs/architecture.html`](docs/architecture.html)（架构图）。

## 目录结构

```
src/
  main/         主进程（IPC 注册 + services/ 服务层）
  preload/      contextBridge 暴露 window.api
  shared/       主/渲共享契约（IPC 类型 + zod schema：课件 22 块/课程包/学习路径）
  renderer/src/ React 渲染层（页面/三栏工作台/blocks 渲染管线）
  course-tools/ @cad/course-tools DSH 插件（20 个 cad_* 工具，esbuild 打进 vendor）
resources/
  skills/course-material-processor/   课件生成技能（质量标准/块目录/可视化设计指南）
  dsh-runtime/                        DSH vendor（安装步骤见下「已知注意事项」）
  interactive-bridge/                 沙箱静态资产与 12 预打包 chunk（构建产物）
scripts/        seed 渲染验收课程 / 桥与插件构建 / boot 探针
tests/          vitest 15 文件 137 用例（零 AI 消耗）
examples/       示例课件（render-smoke）
design/         设计稿（pen 源 + 首页双屏）
```

## 已知注意事项

- **DSH Runtime vendor**（git 忽略，克隆后需自备）：`cd resources/dsh-runtime && npm install --ignore-scripts --no-audit --no-fund`（禁 `--omit=optional`）；`node24/node.exe` 从 npmmirror 下载 v24 win-x64 zip 提取；最后 `npm run build:plugin`。缺它时应用其余功能可用，仅 AI 生成/对话不可用。
- **本机工具链**：python 在 PATH（判题用）；C 档位需 gcc（MinGW-w64）；无则对应档位报可读错误。
- **better-sqlite3** 需 VS Build Tools；当前索引用 JSON 文件替代，量级无压力。
- 未代码签名：首次运行 SmartScreen 提示选「仍要运行」。
- electron-vite dev 对 main 进程改动不总热重启——改 `src/main/` 后手动重启 dev。

## 开源协议

本项目以 [AGPL-3.0](LICENSE) 协议开源：任何修改版（包括把它做成闭源云服务/SaaS）都必须以同协议开源。项目作者自身的商业使用（闭源、收费、云服务）不受本协议约束——如果你想在商用场景下获得 AGPL 之外的授权，请联系仓库所有者。

## 状态

- 学习闭环（建课骨架 → 按需生成课件 → 三栏工作台学习 → 判题 → 渐进解锁）已全部打通，2026-11-12 全功能实机验收 12/12 通过。
- 进行中：设计稿（pen 画布 16 版）选型打磨、真 REPL 终端、发布线（vendor 裁剪/签名/自动更新）。
- 路线图明细见 `AI_HANDOVER.md` §12。
