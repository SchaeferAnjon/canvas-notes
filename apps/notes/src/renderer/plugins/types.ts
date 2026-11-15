/**
 * 内置插件在界面这边的接口（主进程那边见 main/plugins/host.ts，总说明见 shared/plugins.ts）。
 * 一个 RendererPlugin 可以有：网页标签条右边的按钮（点了做一件事，或者开它的弹窗）、⌘F 面板里的命令、设置页里的一块。
 */
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { PluginInfo } from '../../shared/plugins'
import type { PaletteCommand } from '../Palette'

/** 右栏当前的网页 */
export interface WebPage {
  /** webContents id（插件按钮、网页里的状态按它对） */
  wcId: number
  url: string
  title: string
}

/** 按钮现在的样子 */
export interface ButtonLook {
  label: string
  title: string
  icon: LucideIcon
  /** 亮着（李子紫），比如正在双语 */
  on?: boolean
  /** 图标实心，比如这一页已经收藏 */
  filled?: boolean
}

export interface RendererPlugin {
  id: string
  /** 插件面板、设置里用的图标 */
  icon: LucideIcon
  /** 网页标签条右边的按钮：useLook 是个 hook，按当前网页给按钮的样子；click 不给就是开关它的弹窗 */
  button?: {
    useLook(page: WebPage | null): ButtonLook
    click?(page: WebPage | null): void
  }
  /** 弹窗（按钮下面），比如书签管家 */
  Popup?: ComponentType<{ page: WebPage | null; onClose(): void }>
  /** ⌘F 面板里的命令 */
  commands?(page: WebPage | null): PaletteCommand[]
  /** 设置 · 插件里这个插件的那一块 */
  Settings?: ComponentType<{ info: PluginInfo; onChange(patch: Record<string, unknown>): void; onNotice(t: string): void }>
}
