import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { ECharts } from 'echarts/core'

type EchartsModule = typeof import('echarts/core')

let echartsLoad: Promise<EchartsModule> | null = null

const THEME = 'cad-dark'
const PALETTE = ['#3574f0', '#57965c', '#be9117', '#db5c5c', '#977bf0', '#3fa7c4', '#d0a8ff', '#6ea86e']

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
      textStyle: { color: '#dfe1e5', fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif' },
      title: { textStyle: { color: '#dfe1e5' }, subtextStyle: { color: '#9da0a8' } },
      legend: { textStyle: { color: '#9da0a8' } },
      tooltip: {
        backgroundColor: '#2b2d30',
        borderColor: '#393b40',
        textStyle: { color: '#dfe1e5', fontSize: 12 }
      },
      categoryAxis: {
        axisLine: { lineStyle: { color: '#43454a' } },
        axisTick: { lineStyle: { color: '#43454a' } },
        axisLabel: { color: '#9da0a8' },
        splitLine: { lineStyle: { color: '#393b40' } },
        nameTextStyle: { color: '#9da0a8' }
      },
      valueAxis: {
        axisLine: { lineStyle: { color: '#43454a' } },
        axisTick: { lineStyle: { color: '#43454a' } },
        axisLabel: { color: '#9da0a8' },
        splitLine: { lineStyle: { color: '#393b40' } },
        nameTextStyle: { color: '#9da0a8' }
      }
    })
    return echarts
  })()
  return echartsLoad
}

/** chart 块（ECharts option 纯 JSON）。主题统一 JetBrains 暗色，option 里不写死颜色也能出效果。 */
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
