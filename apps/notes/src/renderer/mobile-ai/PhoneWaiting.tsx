/**
 * 手机全能模式：iPhone / iPad 经这台 Mac 问 AI、正停在要点头的那一步（删文件、推送……）时，Mac 右栏 AI 对话顶上一句
 * 「iPhone「小手机」上的 AI 在等那边点头：删掉《甲》」（点头只在手机上点，这里只说一声）。主进程在 main/mobile-ai/index.ts（mobileAi:waiting）。
 */
import { useEffect, useState } from 'react'
import { Codicon } from '@cn/design'
import type { MobileAiWaiting } from '../../shared/mobile-ai'
import { useT } from '../i18n'
import { ipcOn } from '../crash/ipc'
import './mobile-ai.css'

export function PhoneWaiting() {
  const t = useT()
  const [list, setList] = useState<MobileAiWaiting[]>([])
  useEffect(() => {
    void window.cnMobileAi.waiting().then(setList, () => undefined)
    return ipcOn(window.cnMobileAi.onWaiting, 'cnMobileAi.onWaiting')(setList)
  }, [])
  if (!list.length) return null
  return (
    <div className="mai-wait" data-testid="mobile-ai-waiting" role="status">
      {list.map((w, i) => (
        <div key={i} className="mai-wait-row">
          <Codicon name="device-mobile" size={14} />
          <span>{t('{device}上的 AI 在等那边点头：{what}', { device: w.device === w.kind ? w.kind : `${w.kind}「${w.device}」`, what: w.label.replace(/^等你点头：/, '') })}</span>
        </div>
      ))}
    </div>
  )
}
