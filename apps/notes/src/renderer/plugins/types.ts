/**
 * 内置插件在界面这边的接口（主进程那边见 main/plugins/host.ts，总说明见 shared/plugins.ts）。
 * 一个 RendererPlugin 可以有：地址栏右边的按钮（点了做一件事，或者开它的弹窗）、「⋯」菜单里的项、⌘F 面板里的命令、设置页里的一块。
 */
import { type CodiconName } from '@cn/design'
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
  icon: CodiconName
  /** 亮着（李子紫），比如正在双语 */
  on?: boolean
  /** 图标实心，比如这一页已经收藏 */
  filled?: boolean
}

export interface RendererPlugin {
  id: string
  /** 插件面板、设置里用的图标 */
  icon: CodiconName
  /** 地址栏右边的按钮：useLook 是个 hook，按当前网页给按钮的样子；click 不给就是开关它的弹窗 */
  button?: {
    /** 放哪：address = 地址栏里（这一页的开关，像双语翻译）；toolbar = 地址栏右边（默认） */
    slot?: 'address' | 'toolbar'
    /** 自己画的按钮（双语翻译：左边开关、右边小箭头开菜单）；给了就不用 useLook */
    Control?: ComponentType<{ page: WebPage | null; open: boolean; onPopup(id: string | null): void }>
    useLook(page: WebPage | null): ButtonLook
    click?(page: WebPage | null): void
    /** 「⋯」菜单里也放一项（快捷键在那里看得到）；只在有 click 时用 */
    menu?: { label: string; keys?: string }
  }
  /** 弹窗；mode 是 this-page 时只管这一页（地址栏星星开的小卡），all 是整理全部 */
  Popup?: ComponentType<{ page: WebPage | null; mode?: 'this-page' | 'all'; onClose(): void }>
  /** 「⋯」菜单「这一页」组里的项（role=menuitem 的按钮），比如书签管家的「稍后再看」；做完调 onDone 收起菜单 */
  PageMenu?: ComponentType<{ page: WebPage | null; onDone(): void; onNotice(t: string): void }>
  /** ⌘F 面板里的命令 */
  commands?(page: WebPage | null): PaletteCommand[]
  /** 设置 · 插件里这个插件的那一块 */
  Settings?: ComponentType<{ info: PluginInfo; onChange(patch: Record<string, unknown>): void; onNotice(t: string): void }>
}
