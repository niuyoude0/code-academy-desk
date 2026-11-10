/**
 * @cad/course-tools — Code Academy Desk 业务工具插件 v2（P5.2.5）。
 *
 * 形状 = 官方作者契约（P5.0 spike 已验证）：ESM 导出 name/inject/apply，
 * 工具经 defineTool + ctx.tools.register 注册，随 vendor 分发、profile junction 解析。
 *
 * 设计原则：
 *  - 单源：课件校验/课程包读写/学习路径逻辑直接 import 应用源码（构建时 esbuild 打包进本文件），
 *    插件与应用永远同一套校验器，不复制规则。
 *  - 不造轮子：文件搜索/任意读文件用 DSH 原生能力，本插件只做结构化操作。
 *  - 危险操作不给：删除课程/章节、学习状态的写操作（startKp/completeKp/skipKp）一律不暴露。
 *
 * 数据根由宿主注入 env：CAD_COURSES_ROOT（课程包）、CAD_MATERIALS_ROOT（教材资料）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateLessonDocument } from '../shared/lesson-schema'
import { checkLessonCapacity } from '../shared/lesson-quality'
import {
  createCourseV2,
  addChapterV2,
  getManifestV2,
  getLessonV2,
  saveExerciseV2,
  getExerciseV2,
  updateGenerationV2
} from '../main/services/coursePackageV2'
import {
  initPath,
  replacePath,
  getPath,
  saveKpLesson,
  setKpGenFailed,
  getProgress,
  getLearningContext,
  saveKpDigest
} from '../main/services/learningPath'
import { getKpSource, readMaterialPage, listMaterialFiles } from '../main/services/kpSource'
import { getCourseStats } from '../main/services/courseStats'

/** Loader 身份（稳定，不得改）。 */
const name = 'course-tools'
/** 依赖的服务缝（sdk profile 均已挂载）。 */
const inject = ['tools']

interface Roots {
  coursesRoot: string
  materialsRoot: string
}

function roots(): Roots {
  const coursesRoot = process.env['CAD_COURSES_ROOT']
  const materialsRoot = process.env['CAD_MATERIALS_ROOT']
  if (coursesRoot == null || coursesRoot.length === 0 || materialsRoot == null || materialsRoot.length === 0) {
    throw new Error('宿主未注入 CAD_COURSES_ROOT / CAD_MATERIALS_ROOT（应用版本过旧或 dev 环境缺配置）')
  }
  return { coursesRoot, materialsRoot }
}

/** 统一出口：成功 {ok,data} / 失败 {ok,error}（不抛给 DSH，让模型拿到结构化错误好返工）。 */
async function exec(label: string, fn: () => Promise<unknown>): Promise<string> {
  try {
    const data = await fn()
    return JSON.stringify({ ok: true, data }, null, 1)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[course-tools] ${label} 失败: ${message}`)
    return JSON.stringify({ ok: false, error: message }, null, 1)
  }
}

const textOut = {
  schema: { type: 'string' },
  render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }]
}

const ID = { type: 'string', description: '课程包 id' } as const

/**
 * @param ctx {import('@deepseek-ai/cordis').Context}
 */
function apply(ctx: {
  tools: { register: (tool: unknown) => void }
}): void {
  let count = 0
  const reg = (tool: unknown): void => {
    ctx.tools.register(tool)
    count++
  }

  /* ===== A 建课骨架 ===== */

  reg(
    defineTool({
      name: 'cad_create_course',
      description:
        '创建 v2 课程包（目录脚手架 + manifest + 索引）。建课时第一步；已存在的课程 id 会拒绝覆盖。materialId 指向 userData/materials 下的教材资料目录（原教材永不复制进包）。',
      parameters: {
        courseId: { type: 'string', description: '课程包 id（字母/数字/-/_）', required: true },
        title: { type: 'string', description: '课程名', required: true },
        language: { type: 'string', description: '语言（默认 mixed）' },
        description: { type: 'string', description: '课程简介' },
        materialId: { type: 'string', description: '教材资料目录 id（写入 sourceRef）' },
        factsheets: { type: 'array', items: { type: 'string' }, description: '用到的 factsheet 文件名列表' },
        pageOffsets: { type: 'json', description: '页偏移数组 [{section?, offset}]（meta.json 直译）' }
      },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('create_course', async () => {
          const { coursesRoot } = roots()
          const sourceRef =
            typeof args.materialId === 'string' && args.materialId.length > 0
              ? {
                  materialId: args.materialId,
                  factsheets: Array.isArray(args.factsheets) ? (args.factsheets as string[]) : [],
                  pageOffsets: Array.isArray(args.pageOffsets) ? (args.pageOffsets as { section?: string; offset: number }[]) : []
                }
              : undefined
          return await createCourseV2(coursesRoot, {
            id: String(args.courseId),
            title: String(args.title),
            ...(typeof args.language === 'string' ? { language: args.language } : {}),
            ...(typeof args.description === 'string' ? { description: args.description } : {}),
            ...(sourceRef != null ? { sourceRef } : {})
          })
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_add_chapter',
      description: '向课程添加章节（建课第二步；每章一个，id 形如 ch-03）。',
      parameters: { courseId: { ...ID, required: true }, chapterId: { type: 'string', description: '章节 id', required: true }, title: { type: 'string', description: '章节名', required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('add_chapter', async () => {
          const { coursesRoot } = roots()
          return await addChapterV2(coursesRoot, String(args.courseId), { id: String(args.chapterId), title: String(args.title) })
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_get_manifest',
      description: '读课程 manifest（章节树 / lesson 引用 / sourceRef / 生成信息）。重生成前用它定位章与已有课件。',
      parameters: { courseId: { ...ID, required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_manifest', async () => {
          const { coursesRoot } = roots()
          return await getManifestV2(coursesRoot, String(args.courseId))
        })
    })
  )

  /* ===== B 学习路径 ===== */

  reg(
    defineTool({
      name: 'cad_init_path',
      description:
        '初始化学习路径 path.json（factsheet「知识点清单」直译为有序 KP 表）。KP 是最小教学生产单元：id 建议 chNN-kNN，保持教学顺序。已存在会拒绝（重排用 cad_replace_path）。建课后到此为止，课件等用户开始学习再按需生成。',
      parameters: {
        courseId: { ...ID, required: true },
        kps: {
          type: 'json',
          required: true,
          description: 'KP 数组 [{id, chapterId, title, bookPage?(书内页码), interactivity?(strong|medium|weak)}]'
        }
      },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('init_path', async () => {
          const { coursesRoot } = roots()
          if (!Array.isArray(args.kps)) throw new Error('kps 必须是数组')
          return await initPath(coursesRoot, String(args.courseId), args.kps as Parameters<typeof initPath>[2])
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_replace_path',
      description: '整体替换学习路径骨架（用户要求增删改 KP 时用；已生成课件文件保留不动）。',
      parameters: { courseId: { ...ID, required: true }, kps: { type: 'json', required: true, description: '同 cad_init_path 的 kps' } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('replace_path', async () => {
          const { coursesRoot } = roots()
          if (!Array.isArray(args.kps)) throw new Error('kps 必须是数组')
          return await replacePath(coursesRoot, String(args.courseId), args.kps as Parameters<typeof replacePath>[2])
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_get_path',
      description: '读学习路径（有序 KP 表 + 每个的生成状态 pending/ready/failed）。',
      parameters: { courseId: { ...ID, required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_path', async () => {
          const { coursesRoot } = roots()
          return await getPath(coursesRoot, String(args.courseId))
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_get_learning_context',
      description:
        '生成某 KP 课件前必调：返回已完成 KP 的 digest 摘要链、被跳过的 KP（gap 空缺提示）、下一 KP 标题（结尾预告）。这就是「上下文连续」——用它替代回读旧课件全文。',
      parameters: { courseId: { ...ID, required: true }, kpId: { type: 'string', description: '知识点 id', required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_learning_context', async () => {
          const { coursesRoot } = roots()
          return await getLearningContext(coursesRoot, String(args.courseId), String(args.kpId))
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_save_kp_lesson',
      description:
        '保存知识点课件（lessonId 必须 = KP id）。先校验后落盘：schema/铁律失败会拒绝写入并返回错误清单——拿错误清单返工，不要原样重试。',
      parameters: { courseId: { ...ID, required: true }, lesson: { type: 'json', required: true, description: '完整课件文档（schemaVersion 2.0，22 类块）' } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('save_kp_lesson', async () => {
          const { coursesRoot } = roots()
          return await saveKpLesson(coursesRoot, String(args.courseId), args.lesson)
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_save_kp_digest',
      description:
        '把本次生成的 KP digest（core：核心结论/公式 ≤500 字；takeaway：一句话收获 ≤500 字）写入学习进度的摘要链。保存课件成功后必调——后续 KP 生成时靠这条链保持上下文连续。',
      parameters: {
        courseId: { ...ID, required: true },
        kpId: { type: 'string', description: '知识点 id（=课件 lessonId）', required: true },
        core: { type: 'string', description: '核心结论/公式，≤500 字', required: true },
        takeaway: { type: 'string', description: '一句话收获，≤500 字', required: true }
      },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('save_kp_digest', async () => {
          const { coursesRoot } = roots()
          return await saveKpDigest(coursesRoot, String(args.courseId), String(args.kpId), {
            core: String(args.core ?? ''),
            takeaway: String(args.takeaway ?? '')
          })
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_set_kp_gen_failed',
      description: '标记某 KP 生成失败（返工 2 轮仍不过校验时的诚实出口；reason 写具体原因与缺什么料）。',
      parameters: { courseId: { ...ID, required: true }, kpId: { type: 'string', description: '知识点 id', required: true }, reason: { type: 'string', description: '失败原因', required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('set_kp_gen_failed', async () => {
          const { coursesRoot } = roots()
          await setKpGenFailed(coursesRoot, String(args.courseId), String(args.kpId), String(args.reason))
          return { marked: true }
        })
    })
  )

  /* ===== C 课件内容 ===== */

  reg(
    defineTool({
      name: 'cad_validate_course_blocks',
      description:
        '落盘前自检主闸门。返回 schema/铁律错误（error 级，必须修）与容量硬标准 warn 级（正文字数≥2500、quiz≥3、example≥2、可视化≥1、interactive≤1、quiz 答案对应性）。落盘前必须先跑本工具并清零 error。',
      parameters: { lesson: { type: 'json', required: true, description: '待检课件文档' } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('validate_course_blocks', async () => {
          if (args.lesson == null || typeof args.lesson !== 'object') throw new Error('lesson 必须是课件对象')
          const schema = validateLessonDocument(args.lesson)
          const blocks = (args.lesson as { blocks?: unknown }).blocks
          const capacity =
            Array.isArray(blocks) && schema.ok
              ? checkLessonCapacity(blocks as Parameters<typeof checkLessonCapacity>[0])
              : null
          return { schema, capacity }
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_get_lesson',
      description: '读回已有课件 JSON（重新生成时对照旧版结构与页码引用）。',
      parameters: { courseId: { ...ID, required: true }, chapterId: { type: 'string', description: '章节 id', required: true }, lessonId: { type: 'string', description: '课件 id（=KP id）', required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_lesson', async () => {
          const { coursesRoot } = roots()
          return await getLessonV2(coursesRoot, String(args.courseId), String(args.chapterId), String(args.lessonId))
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_save_exercise',
      description: '保存编程题（exercises/ex-<id>.json；课件 coding 块引用 exerciseId 的前提）。',
      parameters: { courseId: { ...ID, required: true }, exercise: { type: 'json', required: true, description: '练习文档（v1 Exercise 结构）' } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('save_exercise', async () => {
          const { coursesRoot } = roots()
          await saveExerciseV2(coursesRoot, String(args.courseId), args.exercise)
          return { saved: true }
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_get_exercise',
      description: '读回编程题（题面/起步文件/测试/参考解/来源页码）。',
      parameters: { courseId: { ...ID, required: true }, exerciseId: { type: 'string', description: '练习 id', required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_exercise', async () => {
          const { coursesRoot } = roots()
          return await getExerciseV2(coursesRoot, String(args.courseId), String(args.exerciseId))
        })
    })
  )

  /* ===== D 进度与任务 ===== */

  reg(
    defineTool({
      name: 'cad_update_job_progress',
      description: '任务进度播报（应用任务页消费）。长任务的阶段切换处调用：detail 写当前 KP 与计数。',
      parameters: {
        courseId: { ...ID, required: true },
        model: { type: 'string', description: '模型名' },
        skillVersion: { type: 'string', description: '技能版本（如 2.0）' },
        detail: { type: 'string', description: '当前阶段说明（写进 generation.lastRunAt 附近的展示位）' }
      },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('update_job_progress', async () => {
          const { coursesRoot } = roots()
          return await updateGenerationV2(coursesRoot, String(args.courseId), {
            ...(typeof args.model === 'string' ? { model: args.model } : {}),
            ...(typeof args.skillVersion === 'string' ? { skillVersion: args.skillVersion } : {}),
            lastRunAt: new Date().toISOString()
          })
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_course_stats',
      description: '课程统计一次返回：章/课件数、KP 生成状态计数、学习进度计数、审核计数、块型分布、正文字数、校验异常清单。汇报与进度播报的数据源。',
      parameters: { courseId: { ...ID, required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('course_stats', async () => {
          const { coursesRoot } = roots()
          return await getCourseStats(coursesRoot, String(args.courseId))
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_get_progress',
      description: '只读学习进度（每 KP 的 completed/skipped/learning 状态与 currentKpId）。只许读——学习状态的写操作属于应用 UI，不要试图替用户完成知识点。',
      parameters: { courseId: { ...ID, required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_progress', async () => {
          const { coursesRoot } = roots()
          return await getProgress(coursesRoot, String(args.courseId))
        })
    })
  )

  /* ===== E 教材资料结构化读取 ===== */

  reg(
    defineTool({
      name: 'cad_get_kp_source',
      description:
        '按 KP 一键切料（生成课件第一步）：返回该 KP 在 factsheet 的「知识点详情」节全文 + 页码自证的 ocr 原文（页首头部扫描，不靠换算）+ 相邻页文件名。页码铁律的 source 直接用返回的 pdfPage/bookPage/ocrFile。',
      parameters: { courseId: { ...ID, required: true }, kpId: { type: 'string', description: '知识点 id', required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_kp_source', async () => {
          const r = roots()
          return await getKpSource(r.coursesRoot, r.materialsRoot, String(args.courseId), String(args.kpId))
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_get_page',
      description: '读单页 ocr 转写（路径如 ocr/ch03/p0094.md；ocrFile 白名单限 ocr/ 下 .md）。抽查核对页码用。',
      parameters: { materialId: { type: 'string', description: '教材资料目录 id', required: true }, ocrFile: { type: 'string', description: 'ocr 相对路径', required: true } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('get_page', async () => {
          const { materialsRoot } = roots()
          return await readMaterialPage(materialsRoot, String(args.materialId), String(args.ocrFile))
        })
    })
  )

  reg(
    defineTool({
      name: 'cad_list_material_files',
      description: '列教材资料目录（一层，类型+大小）。meta.json/factsheet/qa-log 都在这里；更深的读取用 cad_get_page 或原生文件工具。',
      parameters: { materialId: { type: 'string', description: '教材资料目录 id', required: true }, subPath: { type: 'string', description: '子目录（可省）' } },
      output: textOut,
      execute: (args: Record<string, unknown>) =>
        exec('list_material_files', async () => {
          const { materialsRoot } = roots()
          return await listMaterialFiles(
            materialsRoot,
            String(args.materialId),
            typeof args.subPath === 'string' ? args.subPath : undefined
          )
        })
    })
  )

  console.error(`[course-tools] apply: registered ${count} tools`)
}

export { name, inject, apply }
