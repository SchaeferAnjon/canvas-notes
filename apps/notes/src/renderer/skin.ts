/** 把一套主题套到窗口上（主窗口和速记小窗都用） */
import { skinOf, type SkinId } from '../shared/appearance'

export function applySkin(skin: SkinId, winbg: string | null) {
  const r = document.documentElement
  r.dataset.skin = skin
  r.dataset.tone = skinOf(skin).tone
  if (winbg && skin === 'deepsea') {
    r.dataset.winbg = 'photo'
    r.style.setProperty('--winbg-img', `url("${winbg}")`)
  } else {
    delete r.dataset.winbg
    r.style.removeProperty('--winbg-img')
  }
}
