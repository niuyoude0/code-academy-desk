import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { ECharts } from 'echarts/core'

type EchartsModule = typeof import('echarts/core')

let echartsLoad: Promise<EchartsModule> | null = null

const THEME = 'cad-light'
const PALETTE = ['#3574f0', '#4f9257', '#9e6b00', '#d14343', '#977bf0', '#3fa7c4', '#d0a8ff', '#6ea86e']

/**
 * echarts 6 按需注册单例（design/renderer-libs-survey.md：echarts/core + 常用图表/组件）。
 * AI 产 option 纯 JSON、零回调约定；未注册的系列类型 echarts 会告警但不崩。
 */
function loadEcharts(): Promise<EchartsModule> {
  echartsLoad ??= (async () => {
    const [echarts, charts, comps, renderers] = await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers')
    ])
    const {
      LineChart, BarChart, PieChart, ScatterChart, EffectScatterChart, RadarChart,
      HeatmapChart, GraphChart, BoxplotChart, CandlestickChart, FunnelChart, GaugeChart
    } = charts
    const {
      GridComponent, PolarComponent, RadarComponent, TooltipComponent, LegendComponent,
      TitleComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkPointComponent,
      MarkAreaComponent, GraphicComponent, DatasetComponent, TransformComponent
    } = comps
    echarts.use([
      LineChart, BarChart, PieChart, ScatterChart, EffectScatterChart, RadarChart,
      HeatmapChart, GraphChart, BoxplotChart, CandlestickChart, FunnelChart, GaugeChart,
      GridComponent, PolarComponent, RadarComponent, TooltipComponent, LegendComponent,
      TitleComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkPointComponent,
      MarkAreaComponent, GraphicComponent, DatasetComponent, TransformComponent,
      renderers.CanvasRenderer
    ])
    echarts.registerTheme(THEME, {
      backgroundColor: 'transparent',
      color: PALETTE,
      textStyle: { color: '#1e1f22', fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif' },
      title: { textStyle: { color: '#1e1f22' }, subtextStyle: { color: '#6c707e' } },
      legend: { textStyle: { color: '#6c707e' } },
      tooltip: {
        backgroundColor: '#ffffff',
        borderColor: '#e3e6e9',
        textStyle: { color: '#1e1f22', fontSize: 12 }
      },
      categoryAxis: {
        axisLine: { lineStyle: { color: '#dce0e4' } },
        axisTick: { lineStyle: { color: '#dce0e4' } },
        axisLabel: { color: '#6c707e' },
        splitLine: { lineStyle: { color: '#eceef2' } },
        nameTextStyle: { color: '#6c707e' }
      },
      valueAxis: {
        axisLine: { lineStyle: { color: '#dce0e4' } },
        axisTick: { lineStyle: { color: '#dce0e4' } },
        axisLabel: { color: '#6c707e' },
        splitLine: { lineStyle: { color: '#eceef2' } },
        nameTextStyle: { color: '#6c707e' }
      }
    })
    return echarts
  })()
  return echartsLoad
}

/** chart 块（ECharts option 纯 JSON）。主题统一 JetBrains 浅色，option 里不写死颜色也能出效果。 */
export function ChartView({ option }: { option: Record<string, unknown> }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let chart: ECharts | null = null
    let ro: ResizeObserver | null = null
    setErr(null)
    void loadEcharts()
      .then((echarts) => {
        if (!alive || ref.current == null) return
        chart = echarts.init(ref.current, THEME)
        chart.setOption({ backgroundColor: 'transparent', ...option } as never)
        ro = new ResizeObserver(() => chart?.resize())
        ro.observe(ref.current)
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
      ro?.disconnect()
      chart?.dispose()
    }
  }, [option])

  if (err != null) {
    return (
      <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle size={13} /> 图表渲染失败：{err}
        </span>
      </div>
    )
  }
  return <div ref={ref} className="h-[320px] w-full" />
}
