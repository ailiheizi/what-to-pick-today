import type { ComponentType } from 'react'

/** 候选组件定义 —— 模拟 Component Builder 的产出（ComponentContract + Generated Files） */
export type CandidateDef = {
  id: string
  label: string
  style: 'conservative' | 'expressive' | 'experimental'
  blurb: string
  Component: ComponentType
}

/** 页面槽位 —— Planner 拆分出来的 Component Contract */
export type SlotDef = {
  id: string
  role: string
  width: 'fixed' | 'fluid'
  inputs: string[]
  outputs: string[]
  dependencies: string[]
  previewH: number
  candidates: CandidateDef[]
}

export type Scenario = {
  id: string
  title: string
  projectName: string
  match: RegExp
  plannerNotes: string[]
  layout: 'dashboard' | 'landing' | 'freeform'
  slots: SlotDef[]
}
