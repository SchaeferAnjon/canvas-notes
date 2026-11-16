/** 自带的封面（8 张照片、4 种渐变）和深海蓝的两张窗口背景照片。照片出处见 THIRD_PARTY_NOTICES.md */
import type { BuiltinCover, Cover } from '../shared/home'
import aurora from './assets/covers/aurora.jpg'
import auroraT from './assets/covers/aurora.thumb.jpg'
import blackBeach from './assets/covers/black-beach.jpg'
import blackBeachT from './assets/covers/black-beach.thumb.jpg'
import gullfoss from './assets/covers/gullfoss.jpg'
import gullfossT from './assets/covers/gullfoss.thumb.jpg'
import iceCave from './assets/covers/ice-cave.jpg'
import iceCaveT from './assets/covers/ice-cave.thumb.jpg'
import icebergs from './assets/covers/icebergs.jpg'
import icebergsT from './assets/covers/icebergs.thumb.jpg'
import kirkjufell from './assets/covers/kirkjufell.jpg'
import kirkjufellT from './assets/covers/kirkjufell.thumb.jpg'
import myvatn from './assets/covers/myvatn.jpg'
import myvatnT from './assets/covers/myvatn.thumb.jpg'
import vik from './assets/covers/vik.jpg'
import vikT from './assets/covers/vik.thumb.jpg'

export const GRADIENTS: Record<string, string> = {
  glow: 'radial-gradient(900px 300px at 18% -20%, rgba(110,160,255,.85), transparent 60%), radial-gradient(700px 300px at 85% 0%, rgba(170,120,255,.55), transparent 60%), linear-gradient(180deg, #0E2250, #061230)',
  plum: 'radial-gradient(800px 300px at 80% 120%, rgba(255,190,150,.75), transparent 60%), linear-gradient(120deg, #3B1747, #8E4AA0 55%, #E7A98F)',
  paper: 'radial-gradient(600px 260px at 20% 30%, rgba(214,196,160,.55), transparent 60%), radial-gradient(500px 240px at 85% 80%, rgba(196,170,200,.45), transparent 60%), linear-gradient(180deg, #F6F0E2, #EDE4D2)',
  mist: 'radial-gradient(700px 260px at 30% 0%, rgba(255,255,255,.9), transparent 60%), linear-gradient(180deg, #DCDDE3, #BFC3CC)',
}

export const COVERS: { id: BuiltinCover; name: string; kind: 'photo' | 'grad'; full?: string; thumb?: string; dark: boolean }[] = [
  { id: 'aurora', name: '极光', kind: 'photo', full: aurora, thumb: auroraT, dark: true },
  { id: 'kirkjufell', name: '教会山', kind: 'photo', full: kirkjufell, thumb: kirkjufellT, dark: false },
  { id: 'ice-cave', name: '蓝冰洞', kind: 'photo', full: iceCave, thumb: iceCaveT, dark: true },
  { id: 'icebergs', name: '冰河湖', kind: 'photo', full: icebergs, thumb: icebergsT, dark: false },
  { id: 'gullfoss', name: '黄金瀑布', kind: 'photo', full: gullfoss, thumb: gullfossT, dark: false },
  { id: 'black-beach', name: '黑沙滩', kind: 'photo', full: blackBeach, thumb: blackBeachT, dark: false },
  { id: 'vik', name: '维克教堂', kind: 'photo', full: vik, thumb: vikT, dark: false },
  { id: 'myvatn', name: '米湖极光', kind: 'photo', full: myvatn, thumb: myvatnT, dark: true },
  { id: 'glow', name: '深海光', kind: 'grad', dark: true },
  { id: 'plum', name: '李子暮色', kind: 'grad', dark: true },
  { id: 'paper', name: '米白纸', kind: 'grad', dark: false },
  { id: 'mist', name: '晨雾灰', kind: 'grad', dark: false },
]

export const WINBG_PHOTOS = { aurora, cave: iceCave }
export const WINBG_THUMBS = { aurora: auroraT, cave: iceCaveT }

/** 封面的 CSS background-image；thumb 用小图 */
export function coverImage(c: Cover, thumb = false): string {
  if (c.kind === 'file') return `url("cn-file://vault/${c.path.split('/').map(encodeURIComponent).join('/')}")`
  const b = COVERS.find((x) => x.id === c.id)!
  return b.kind === 'grad' ? GRADIENTS[b.id]! : `url("${thumb ? b.thumb : b.full}")`
}
