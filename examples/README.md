# 示例课件

`render-smoke` —— 渲染验收种子课程（本地脚本合成，**零版权内容、零 AI 消耗**）。

- `render-smoke/`：课程包源文件（v2 结构：manifest / path / progress / chapters / exercises / assets）
- `render-smoke.zip`：可直接导入的课程包（首页「导入课程」选择此文件）

内容覆盖：

- 22 类课件块全量（text/concept/definition/theorem/math/callout/quote/keypoint/thinking/example/compare/table/timeline/formula-list/code/diagram/chart/anim/quiz/coding/interactive/image/summary）
- 编程题 `ex-insertion-sort`（python 插入排序，3 个 stdin-stdout 测试，可体验本地 Runner 判定）
- 交互式组件（滑杆/Toggle/motion 动画，跑在 cad-i:// 沙箱）

重新生成本机副本：`node scripts/seed-render-smoke.cjs`（写入 `%APPDATA%\code-academy-desk\courses\zz-render-smoke`，可重复执行）。

注意：zip 内 `manifest.json` 在压缩包根目录（与应用内导出格式一致）；改动源文件后用任意保留 `/` 路径分隔符的方式重新打包即可。
