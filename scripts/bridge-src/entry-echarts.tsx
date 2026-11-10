/**
 * echarts 桥 chunk：封装为单个 <EChart option={纯JSON} /> 组件（技能文档约定：
 * 禁碰底层实例 API，事件回调一律没有——需要联动就用 controls 桥改 option 再 setState）。
 */
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import {
  LineChart, BarChart, PieChart, ScatterChart, EffectScatterChart, RadarChart,
  HeatmapChart, GraphChart, BoxplotChart, CandlestickChart, FunnelChart, GaugeChart
} from 'echarts/charts'
import {
  GridComponent, PolarComponent, RadarComponent, TooltipComponent, LegendComponent,
  TitleComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent,
  MarkPointComponent, MarkAreaComponent, GraphicComponent, DatasetComponent, TransformComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart, PieChart, ScatterChart, EffectScatterChart, RadarChart,
  HeatmapChart, GraphChart, BoxplotChart, CandlestickChart, FunnelChart, GaugeChart,
  GridComponent, PolarComponent, RadarComponent, TooltipComponent, LegendComponent,
  TitleComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkPointComponent,
  MarkAreaComponent, GraphicComponent, DatasetComponent, TransformComponent, CanvasRenderer
])

export function EChart({ option, height = 320 }: { option: Record<string, unknown>; height?: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const chart = echarts.init(ref.current, 'cad-dark')
    chart.setOption({ backgroundColor: 'transparent', ...option })
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
    }
  }, [option])
  return <div ref={ref} style={{ width: '100%', height }} />
}
