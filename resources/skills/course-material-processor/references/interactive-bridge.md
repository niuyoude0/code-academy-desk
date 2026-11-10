# interactive-bridge：交互组件桥接手册（独立受限 Renderer + 白名单桥）

interactive 块 = 你写的 **单个 TSX 文件源码**（默认导出 React 函数组件），存进 `source` 字段。执行环境是**独立受限渲染沙箱**：编译在主进程 esbuild（白名单外 import 直接编译失败并回喂错误），运行在 opaque-origin 沙箱 iframe——**摸不到 Node、宿主 DOM 与任何敏感 API**，宿主能力只能走白名单桥。

## 硬规矩（违反 = 编译失败 / 渲染失败）

1. **只 import 白名单桥**（下表 12+1 项）。`fs`/`os`/`child_process`/`electron`/`node:*` 等一切模块与相对导入 `./xxx` 都会被编译器硬拒绝。
2. **必须声明 `bridgeImports`**：实际用到的桥名（如 `["react","motion","controls"]`）。声明与实际 import 不符 = 编译失败被回喂返工。
3. **默认导出组件**：`export default function Demo() {...}`。禁顶层副作用（顶层 fetch/定时器/写状态）。
4. 源码 ≤500KB；ESM import only（禁 `require`）；禁 `eval`/`new Function`/动态字符串 import。
5. **禁网络访问**：没有 fetch 可用的场景语义（数据从桥/props 来）。
6. **热路径不跨桥**：动画帧循环、canvas 重绘、物理步进全部在组件内自驱（数据先取回、本地 state 驱动）；桥调用只出现在初始取数和用户意图事件（点按钮/提交）。跨桥调用是异步 IPC（毫秒级），放帧循环里会卡。
7. React 19；esbuild 只转译不查类型，按类型正确的写法写。

## 桥清单（import 形状 = 编译后真实可用的形状）

| 桥名 | import 形状 | 用途 |
|---|---|---|
| react | `import { useState, useMemo } from 'react'` | React 19 内置 |
| motion | `import { motion, AnimatePresence, Reorder } from 'motion'` | 声明式动画/进出场/拖拽排序 |
| echarts | `import { EChart } from 'echarts'` | 图表：`<EChart option={纯JSON} height={320} />`（已注册常用图型；禁底层实例 API，事件回调一律没有——联动用 controls 改 option 再 setState） |
| konva | `import { Stage, Layer, Rect, Circle, Text, Konva } from 'konva'` | 2D 画布（react-konva）：高密度元素/自由拖拽/命中检测 |
| xyflow | `import { ReactFlow, applyNodeChanges } from 'xyflow'` | 节点图/流程图/拓扑（自带样式与 minimap） |
| matter | `import Matter from 'matter'` | 2D 物理模拟（重力/碰撞） |
| three | `import { Canvas, useFrame } from 'three'`；`import { OrbitControls, Text, Grid } from 'three/drei'` | 3D（声明式 R3F；禁命令式 new WebGLRenderer）。'three' 与 'three/drei' 指向同一 chunk，three 实例唯一 |
| controls | `import { Slider, NumberInput, Toggle, PlayButton, Select } from 'controls'` | 统一风格受控参数控件（value 在你手里，onChange 上抛） |
| mafs | `import { Mafs, Coordinates, Plot, Point, useMovablePoint, LaTeX, Theme } from 'mafs'` | 数学坐标图/交互几何 |
| fs | `import { readCourseFile, readCourseAsset, getProgress, getManifest } from 'fs'` | **课程数据只读桥**（见下） |
| system | `import { getSystemInfo } from 'system'` | `{platform, locale, appVersion}` |
| agent | `import { askTutor } from 'agent'` | 转学习页"问助教"管道（fire-and-forget，无回复通道；别拿它做核心教学逻辑） |

## fs 桥（课程数据只读桥）——组件要课程上下文时的唯一正路

```ts
import { readCourseFile, readCourseAsset, getProgress, getManifest } from 'fs'

const lessonJson = await readCourseFile('chapters/ch01/ch01-k01.json')   // 课程包内文本
const img      = await readCourseAsset('assets/demo.png')               // assets/ 图片 → data URL
const progress = await getProgress()   // { currentKpId, kps:[{kpId,state,quizBest,...}] }
const manifest = await getManifest()   // { title, chapters:[{id,title,lessons:[...]}] }
```

- 允许读：`manifest.json / path.json / progress.json / chapters/** / exercises/**`（文本 ≤2MB）与 `assets/**` 图片（≤20MB）。
- 一切都在**主进程侧强制**：`..`/绝对路径/白名单外目录直接报错。组件里不用做防御，但不要写出会失败的路径。
- **写入不存在**：学习进度只由应用的学习判定门改；组件只读。

## 布局样式

沙箱与宿主不同源、**不继承 Tailwind**。bootstrap 提供有限工具类（flex/gap-1..4/items-center/justify-*/w-full/tc/bold/mono/small/dim/acc/rounded/border/bg-panel/p-1..3/mb-*/mt-* 等常用集合）+ JetBrains 语义 token（--color-acc 等 CSS 变量）。复杂样式用**内联 style**；画布类桥（konva/three）用各自样式体系。controls 控件已带统一风格。

## 实测坑（违反即白屏/报错）

- **mafs**：`<Mafs>` 必须传 `ssr`（否则测量宽度为 0，**整个子树不挂载**，白屏）：`<Mafs ssr viewBox={{x:[-3,3],y:[-2,2]}} height={300}>`。Plot.OfX 的函数属性名是 **`y`**；LaTeX 传 **`tex` 属性**非 children；Text.attach 是八方位缩写 `'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'`。
- **motion**：包名 `motion`（非 framer-motion）；`<motion.div animate={{}} transition={{}}>`。
- **xyflow**：受控模式记得 `onNodesChange` + `applyNodeChanges`；nodes/edges id 唯一。
- **konva**：可视元素必须在 `<Stage><Layer>` 内；`<Text text={...}>`（CSS 在画布内无效）。
- **matter**：自驱循环用 `Matter.Engine.update(engine, dt)`（在 requestAnimationFrame 里，纯本地不跨桥）。
- **three**：一切动效在 `useFrame` 内做；drei 组件在 `<Canvas>` 内使用。
- **echarts**：option 是普通对象；联动 = controls 改 state → 新 option 重渲染。
- 默认导出必须是**函数组件**；异步组件用内部 state + useEffect 加载桥数据。

## 最小范例（参数探索骨架：controls + motion + fs 桥取进度）

```tsx
import { useEffect, useState } from 'react'
import { Slider, Toggle } from 'controls'
import { motion } from 'motion'
import { getProgress } from 'fs'

export default function Demo() {
  const [k, setK] = useState(2)
  const [show, setShow] = useState(true)
  const [doneCount, setDoneCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void getProgress().then((p: any) => {
      if (alive) setDoneCount((p?.kps ?? []).filter((x: any) => x.state === 'completed').length)
    })
    return () => { alive = false }
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <Slider label="增益 k" min={1} max={5} step={0.1} value={k} onChange={setK} />
      <Toggle label="显示曲线" value={show} onChange={setShow} />
      {doneCount != null && <div className="small dim">已完成知识点：{doneCount}</div>}
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tc mono">
          y = k·x，当前 k = {k.toFixed(1)}
        </motion.div>
      )}
    </div>
  )
}
```

## 使用纪律

- **每课件 ≤1 个 interactive 块**；anim 模板/mermaid/echarts 图表能表达的不用 interactive。
- 组件状态自洽：不依赖外部全局；卸载即清理（useEffect 返回清理函数）。
- 需要课程数据（进度/其他小节）→ fs 桥只读；需要"问助教"→ agent 桥；两者都别在帧循环里调。
- 教学优先：交互要回答一个明确的学习问题（factsheet「交互命题候选」就是干这个的），不为炫技。
- mermaid 提醒（diagram 块）：节点标签含 `[` 时必须双引号包裹，如 `A["a[i]"]`，否则解析失败。
