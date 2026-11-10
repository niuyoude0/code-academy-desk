/* eslint-disable */
/**
 * P5.5 实机验收种子：向 userData/courses 写入一个含全部重块类型的测试课程（零 AI 消耗）。
 * 用法：node scripts/seed-render-smoke.cjs   （重复执行会先删除旧种子）
 */
const fs = require('fs')
const path = require('path')

const coursesRoot = path.join(process.env.APPDATA, 'code-academy-desk', 'courses')
const id = 'zz-render-smoke'
const dir = path.join(coursesRoot, id)
const now = new Date().toISOString()

fs.rmSync(dir, { recursive: true, force: true })
for (const sub of ['chapters/ch01', 'assets']) {
  fs.mkdirSync(path.join(dir, sub), { recursive: true })
}

const src = (pdfPage, bookPage) => ({ pdfPage, bookPage, ocrFile: `ocr/ch01/p0${pdfPage}.md` })

const blocks = [
  { id: 'b01', type: 'concept', origin: 'book', source: src(94, 80), title: '排序：从插入排序说起', md: '为什么 **插入排序** 像整理手里的扑克牌？$n^2$ 的复杂度背后藏着一个重要观察：\n\n- 已排序部分永远有序\n- 每步只处理一个新元素\n\n| 情形 | 复杂度 |\n|---|---|\n| 最好 | $O(n)$ |\n| 最坏 | $O(n^2)$ |\n\n```python\ndef insertion_sort(a):\n    for i in range(1, len(a)):\n        key = a[i]\n        j = i - 1\n        while j >= 0 and a[j] > key:\n            a[j + 1] = a[j]\n            j -= 1\n        a[j + 1] = key\n    return a\n```', tags: ['排序', '入门'] },
  { id: 'b02', type: 'definition', origin: 'book', source: src(95, 80), term: '稳定排序', md: '相等元素排序后**相对顺序不变**的排序算法。' },
  { id: 'b03', type: 'quote', origin: 'book', source: src(95, 81), md: '插入排序对小规模或近乎有序的数据非常高效。', attribution: '教材 §3.2' },
  { id: 'b04', type: 'math', origin: 'book', source: src(96, 82), latex: 'T(n) = \\sum_{i=1}^{n-1} t_i = \\frac{n(n-1)}{2}', block: true },
  { id: 'b05', type: 'theorem', origin: 'book', source: src(96, 82), name: '定理 3.1（插入排序正确性）', md: '插入排序结束后序列非降。', proof: '循环不变式：第 $i$ 轮开始时 $a[0..i-1]$ 有序。（由归纳法 + 内层 while 保持有序性得证。）' },
  { id: 'b06', type: 'formula-list', origin: 'ai-supplement', items: [ { name: '平均比较次数', latex: '\\frac{n^2-n}{4}', note: '等概率假设' }, { name: '二分插入比较', latex: 'O(n\\log n)', note: '查找用二分，移动仍 O(n)' } ] },
  { id: 'b07', type: 'callout', origin: 'ai-supplement', kind: 'pitfall', md: '内层条件是 `a[j] > key`，写成 `>=` 会把**稳定排序变成不稳定**。' },
  { id: 'b08', type: 'keypoint', origin: 'book', source: src(97, 83), front: '插入排序为什么对近乎有序的数据接近线性？', back: '内层 while 几乎不执行，总移动次数正比于逆序对数 $I$，$T(n)=O(n+I)$。' },
  { id: 'b09', type: 'thinking', origin: 'ai-supplement', md: '如果把数组换成链表，插入排序的比较次数和移动次数怎么变？', hint: '链表没有随机访问——二分查找失效，但"移动"变成 O(1) 的指针操作。' },
  { id: 'b10', type: 'example', origin: 'book', source: src(97, 84), title: '手算 [3,1,2] 的插入排序', steps: [ { md: '取 `key=1`，与 3 比较：$1<3$，3 右移' }, { md: 'j 到头，`a[0]=1` → `[1,3,2]`' }, { md: '取 `key=2`，与 3 比较 → 右移 → 与 1 比较 → 停' }, { md: '`a[1]=2` → `[1,2,3]`，结束' } ] },
  { id: 'b11', type: 'compare', origin: 'ai-supplement', title: '三种 $O(n^2)$ 排序对比', columns: ['算法', '最好', '最坏', '稳定'], rows: [ { label: '插入', cells: ['O(n)', 'O(n²)', '是'] }, { label: '冒泡', cells: ['O(n)', 'O(n²)', '是'] }, { label: '选择', cells: ['O(n²)', 'O(n²)', '否'] } ] },
  { id: 'b12', type: 'timeline', origin: 'ai-supplement', items: [ { label: '1946', md: 'ENIAC 时代，插入排序已在早期程序中出现' }, { label: '1959', md: 'Shell 提出分组插入（希尔排序）' }, { label: '1962', md: '快排问世，$O(n\\log n)$ 时代开启' } ] },
  { id: 'b13', type: 'table', origin: 'book', source: src(98, 85), caption: '各排序算法复杂度速查', md: '| 算法 | 平均 | 最坏 | 空间 |\n|---|---|---|---|\n| 插入 | $O(n^2)$ | $O(n^2)$ | $O(1)$ |\n| 归并 | $O(n\\log n)$ | $O(n\\log n)$ | $O(n)$ |\n| 快排 | $O(n\\log n)$ | $O(n^2)$ | $O(\\log n)$ |' },
  { id: 'b14', type: 'diagram', engine: 'mermaid', origin: 'book', source: src(98, 85), mermaid: 'flowchart TD\n  A["取 key = a[i]"] --> B{"j 从 i-1 向左扫描"}\n  B -->|"a[j] > key"| C["a[j+1] = a[j]"]\n  C --> B\n  B -->|"a[j] <= key"| D["a[j+1] = key"]\n  D --> E{"i 到头?"}\n  E -->|否| A\n  E -->|是| F["有序区 +1"]' },
  { id: 'b15', type: 'chart', origin: 'ai-supplement', echartsOption: { title: { text: '比较次数随 n 增长', left: 'center', textStyle: { fontSize: 13 } }, tooltip: { trigger: 'axis' }, legend: { data: ['插入排序', '归并排序'], bottom: 0, textStyle: { fontSize: 11 } }, grid: { top: 40, bottom: 50 }, xAxis: { type: 'category', data: [10, 50, 100, 500, 1000, 5000] }, yAxis: { type: 'value', name: '次数' }, series: [ { name: '插入排序', type: 'line', smooth: true, data: [45, 1225, 4950, 124750, 499500, 12497500] }, { name: '归并排序', type: 'line', smooth: true, data: [34, 282, 664, 4478, 9964, 55160] } ] } },
  { id: 'b16', type: 'anim', origin: 'ai-supplement', template: 'array', title: '插入排序逐步执行', frames: [ { data: { items: [3, 1, 2] }, note: '初始：无序区 [3,1,2]' }, { data: { items: [3, 3, 2] }, pointers: { key: 1 }, highlight: [0, 1], note: 'key=1，3 右移一位' }, { data: { items: [1, 3, 2] }, pointers: { key: 0 }, highlight: [0], note: 'key 放入 a[0]' }, { data: { items: [1, 3, 3] }, pointers: { key: 2 }, highlight: [1, 2], note: 'key=2，3 右移一位' }, { data: { items: [1, 2, 3] }, highlight: [0, 1, 2], note: '完成：全数组有序' } ] },
  { id: 'b17', type: 'image', origin: 'book', source: src(99, 86), path: 'assets/demo.png', alt: '插入排序示意图（种子占位图）' },
  { id: 'b18', type: 'quiz', origin: 'book', source: src(99, 86), kind: 'choice', question: '插入排序内层循环条件 `a[j] > key` 改为 `a[j] >= key` 会怎样？', options: [ { key: 'A', text: '结果仍正确，但失去稳定性' }, { key: 'B', text: '结果错误' }, { key: 'C', text: '复杂度从 $O(n^2)$ 降为 $O(n \\log n)$' } ], answer: 'A', explanation: '相等元素会被交换到前面——**稳定性破坏**；正确性与复杂度都不变。' },
  { id: 'b19', type: 'quiz', origin: 'ai-supplement', kind: 'choice', question: '下列哪些是稳定排序？（多选）', options: [ { key: 'A', text: '插入排序' }, { key: 'B', text: '冒泡排序' }, { key: 'C', text: '快速排序' }, { key: 'D', text: '归并排序' } ], answer: 'A,B,D', explanation: '快排 partition 会打乱相等元素相对顺序。' },
  { id: 'b20', type: 'quiz', origin: 'ai-supplement', kind: 'blank', question: '插入排序对含 $I$ 个逆序对的数组的时间复杂度是 $O(n + \\ \\ \\ )$。', answer: 'I', explanation: '比较/移动次数正比于逆序对数。' },
  { id: 'b21', type: 'interactive', title: '手动模拟插入排序（P5.6 沙箱渲染）', origin: 'ai-supplement', bridgeImports: ['react', 'motion', 'controls', 'fs'], source: [
    "import { useEffect, useState } from 'react'",
    "import { motion } from 'motion'",
    "import { Slider, Toggle } from 'controls'",
    "import { getProgress } from 'fs'",
    '',
    'export default function Demo() {',
    '  const [k, setK] = useState(2)',
    '  const [show, setShow] = useState(true)',
    '  const [doneCount, setDoneCount] = useState(null)',
    '  useEffect(() => {',
    '    let alive = true',
    '    void getProgress().then((p) => {',
    '      if (alive) setDoneCount((p?.kps ?? []).filter((x) => x.state === \'completed\').length)',
    '    }).catch(() => { if (alive) setDoneCount(-1) })',
    '    return () => { alive = false }',
    '  }, [])',
    '  return (',
    '    <div className="flex flex-col gap-3">',
    '      <Slider label="比较倍率 k" min={1} max={5} step={0.1} value={k} onChange={setK} />',
    '      <Toggle label="显示公式" value={show} onChange={setShow} />',
    "      <div className=\"small dim\">fs 桥读进度：已完成知识点 {doneCount == null ? '…' : doneCount === -1 ? '读取失败' : doneCount} 个</div>",
    '      {show && (',
    '        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tc mono">',
    '          T(n) = k·n²，当前 k = {k.toFixed(1)} → {(k * 9).toFixed(0)} 次比较（n=9）',
    '        </motion.div>',
    '      )}',
    '    </div>',
    '  )',
    '}'
  ].join('\n') },
  { id: 'b22', type: 'coding', exerciseId: 'ex-insertion-sort', origin: 'book', source: src(100, 87) },
  { id: 'b23', type: 'summary', origin: 'ai-supplement', points: [ '插入排序 = 维护有序前缀，逐个插入新元素', '复杂度由**逆序对数**决定：$T(n) = O(n + I)$', '稳定、原地、对小数据/近有序数据首选' ], links: ['b02', 'b05', 'b08'] }
]

const lesson = {
  schemaVersion: '2.0',
  lessonId: 'ch01-k01',
  title: '插入排序',
  generatedBy: { model: 'seed-script', skillVersion: '2.0', generatedAt: now },
  blocks
}

const manifest = {
  schemaVersion: '2.0',
  id,
  title: '渲染验收种子课程',
  language: 'mixed',
  description: 'P5.5/P5.7 实机验收用（本地脚本生成，可随时删除）',
  createdAt: now,
  updatedAt: now,
  sourceRef: { materialId: 'zz-material', factsheets: [], pageOffsets: [] },
  chapters: [ { id: 'ch01', title: '第一章', lessons: [
    { lessonId: 'ch01-k01', title: '插入排序', file: 'chapters/ch01/ch01-k01.json' },
    { lessonId: 'ch01-k00-legacy', title: '遗留坏课（缺页码）', file: 'chapters/ch01/ch01-k00-legacy.json' }
  ] } ]
}

const pathFile = {
  schemaVersion: '2.0',
  courseId: id,
  updatedAt: now,
  kps: [
    { id: 'ch01-k01', chapterId: 'ch01', title: '插入排序', bookPage: 80, interactivity: 'strong', genStatus: 'ready', lessonFile: 'chapters/ch01/ch01-k01.json' },
    { id: 'ch01-k02', chapterId: 'ch01', title: '希尔排序（未生成）', bookPage: 88, interactivity: 'medium', genStatus: 'pending' }
  ]
}

const progressFile = { schemaVersion: '2.0', courseId: id, updatedAt: now, currentKpId: 'ch01-k01', kps: [] }

fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
fs.writeFileSync(path.join(dir, 'path.json'), JSON.stringify(pathFile, null, 2))
fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(progressFile, null, 2))
fs.writeFileSync(path.join(dir, 'chapters', 'ch01', 'ch01-k01.json'), JSON.stringify(lesson, null, 2))
// P5.7 校对页验收：坏课样本（origin=book 缺 source → 铁律 error）直接写盘绕过校验
fs.writeFileSync(path.join(dir, 'chapters', 'ch01', 'ch01-k00-legacy.json'), JSON.stringify({
  schemaVersion: '2.0',
  lessonId: 'ch01-k00-legacy',
  title: '遗留坏课（缺页码）',
  blocks: [
    { id: 'x1', type: 'text', origin: 'book', md: '这一块声明来自教材却没有页码引用——校验器应报 b1.source 铁律错误。' }
  ]
}, null, 2))
// P5.7 页码抽查验收：造教材资料 OCR 页（页首头 = kpSource/reviewView 扫描自证格式）
const materialsRoot = path.join(process.env.APPDATA, 'code-academy-desk', 'materials')
for (const [pdfPage, bookPage, body] of [
  [94, 80, '3.2 插入排序。排序问题可以类比整理扑克牌：左手为已排序区，右手每次取一张插入合适位置。'],
  [95, 81, '插入排序对小规模或近乎有序的数据非常高效。定义：稳定排序要求相等元素相对顺序不变。'],
  [96, 82, '定理 3.1：插入排序结束后序列非降。证明采用循环不变式。T(n) = n(n-1)/2。']
]) {
  const pageDir = path.join(materialsRoot, 'zz-material', 'ocr', 'ch01')
  fs.mkdirSync(pageDir, { recursive: true })
  fs.writeFileSync(path.join(pageDir, `p0${pdfPage}.md`), `## PDF p.${pdfPage} | 书内页码 ${bookPage}\n\n${body}\n`, 'utf-8')
}
// P5.8 编程题验收：练习文件（python 插入排序 stdin/stdout 判定）
fs.mkdirSync(path.join(dir, 'exercises'), { recursive: true })
fs.writeFileSync(path.join(dir, 'exercises', 'ex-insertion-sort.json'), JSON.stringify({
  id: 'ex-insertion-sort',
  number: '3.2',
  title: '实现插入排序',
  statement: '读入整数 `n` 和 `n` 个整数，**用插入排序**将它们升序排列后逐行输出。\n\n`n` 满足 `1 ≤ n ≤ 1000`。',
  source: { origin: 'book', bookPageRefs: [{ pdfPage: 99, bookPage: 86 }] },
  knowledgePointIds: ['ch01-k01'],
  starterFiles: [
    { path: 'main.py', language: 'python', readOnly: false, content: 'n = int(input())\na = [int(x) for x in input().split()]\n\n# TODO: 用插入排序将 a 升序排列\n\nfor x in a:\n    print(x)\n' }
  ],
  tests: [
    { id: 't1', name: '三个元素', input: '3\n3 1 2\n', expectedOutput: '1\n2\n3\n' },
    { id: 't2', name: '已有序', input: '4\n1 2 3 4\n', expectedOutput: '1\n2\n3\n4\n' },
    { id: 't3', name: '单元素', input: '1\n7\n', expectedOutput: '7\n' }
  ],
  referenceSolution: [
    { path: 'solution.py', language: 'python', readOnly: true, content: 'n = int(input())\na = [int(x) for x in input().split()]\nfor i in range(1, n):\n    key = a[i]\n    j = i - 1\n    while j >= 0 and a[j] > key:\n        a[j + 1] = a[j]\n        j -= 1\n    a[j + 1] = key\nfor x in a:\n    print(x)\n' }
  ]
}, null, 2))

// 1x1 红色像素 PNG（演示 assets 通路）
fs.writeFileSync(path.join(dir, 'assets', 'demo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))

// 课程索引
const indexFile = path.join(coursesRoot, 'index.json')
let index = { courses: [] }
if (fs.existsSync(indexFile)) index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'))
index.courses = index.courses.filter((c) => c.id !== id)
index.courses.push({ id, title: manifest.title, language: 'mixed', chapterCount: 1, exerciseCount: 0, importedAt: now })
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2))

console.log('SEEDED', dir)
