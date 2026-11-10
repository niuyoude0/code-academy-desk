/**
 * controls 桥 chunk：统一风格参数控件（自封装，JetBrains 语义 token，与课件视觉一致）。
 * 全部为受控组件：value 在组件状态里，onChange 上抛——组件自己管状态。
 */
import { useState } from 'react'

const rowCls = 'ctrl-row'
const labelCls = 'ctrl-label'

/** 滑杆：label/min/max/step/value/onChange。 */
export function Slider({
  label,
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  unit = ''
}: {
  label: string
  min?: number
  max?: number
  step?: number
  value: number
  onChange: (v: number) => void
  unit?: string
}): JSX.Element {
  return (
    <label className={rowCls}>
      <span className={labelCls}>
        {label}
        <b className="ctrl-value">
          {value}
          {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

/** 数字输入：label/min/max/step/value/onChange。 */
export function NumberInput({
  label,
  min,
  max,
  step = 1,
  value,
  onChange
}: {
  label: string
  min?: number
  max?: number
  step?: number
  value: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className={rowCls}>
      <span className={labelCls}>{label}</span>
      <input
        className="ctrl-input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </label>
  )
}

/** 开关：label/value/onChange。 */
export function Toggle({
  label,
  value,
  onChange
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className={rowCls}>
      <span className={labelCls}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`ctrl-toggle ${value ? 'on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="ctrl-knob" />
      </button>
    </label>
  )
}

/** 播放/暂停按钮：playing/onToggle。 */
export function PlayButton({
  playing,
  onToggle
}: {
  playing: boolean
  onToggle: (v: boolean) => void
}): JSX.Element {
  return (
    <button type="button" className="ctrl-play" onClick={() => onToggle(!playing)}>
      {playing ? '⏸ 暂停' : '▶ 播放'}
    </button>
  )
}

/** 文本选择器：label/options[{value,label}]/value/onChange。 */
export function Select({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className={rowCls}>
      <span className={labelCls}>{label}</span>
      <select className="ctrl-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
