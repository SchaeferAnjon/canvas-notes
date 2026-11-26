/**
 * 手机请这台 Mac 打开全能模式（手机 AI 对话头上只读、点了「请 Mac 打开」）：窗口底下的提示条一句话两颗按钮，点之前不自己收（两分钟没点主进程收起）。
 * - 这台在设置里关了：「iPad「…」想打开全能模式 · 不要 · 允许」，允许就打开设置 › AI › iPhone 和 iPad 里这台的开关；
 * - AI 对话选的不是本机命令行：「…想用全能模式：AI 对话现在用的是 X，要换成这台 Mac 上的命令行 · 不要 · 去换」，去换打开设置 › AI 的「AI对话」那一行。
 * 主进程在 main/mobile-ai/index.ts（mobileAi:wants、mobileAi:grant）。
 */
import { useEffect } from 'react'
import type { MobileAiWant } from '../../shared/mobile-ai'
import { t } from '../../shared/i18n'
import { ipcOn } from '../crash/ipc'
import { openSettingsAt } from '../settings/jump'

export interface WantNotice {
  text: string
  /** 「不要」 */
  no(): void
  /** 「允许」或「去换」 */
  yes: { label: string; run(): void; tip?: string }
}

export function wantNotice(w: MobileAiWant): WantNotice {
  const who = w.device === w.kind ? w.kind : `${w.kind}「${w.device}」`
  const no = () => void window.cnMobileAi.grant(w.id, false)
  if (w.why === 'device') return { text: t('{device}想打开全能模式', { device: who }), no, yes: { label: t('允许'), tip: t('允许以后那台设备上的 AI 能读写这台 Mac 上的文件、跑命令、上网'), run: () => void window.cnMobileAi.grant(w.id, true) } }
  return {
    text: t('{device}想用全能模式：AI 对话现在用的是 {engine}，要换成这台 Mac 上的命令行', { device: who, engine: w.engine }),
    no,
    yes: {
      label: t('去换'),
      run: () => {
        void window.cnMobileAi.grant(w.id, true)
        openSettingsAt('fChat')
      },
    },
  }
}

/** 还没人点的那一句变了：给最新的一句（都点完、过期了给 null） */
export function usePhoneWants(show: (n: WantNotice | null) => void) {
  useEffect(() => {
    const on = (list: MobileAiWant[]) => {
      const last = list[list.length - 1]
      show(last ? wantNotice(last) : null)
    }
    void window.cnMobileAi.wants().then(on, () => undefined)
    return ipcOn(window.cnMobileAi.onWants, 'cnMobileAi.onWants')(on)
  }, [])
}
