/**
 * 自带贴纸 36 张的 SVG（packages/design/stickers，CC0，自己画的；由 scripts/stickers.mjs 从设计稿生成）：抽屉里、白板上画它；
 * 第一次用某一张时把它拷进库里的 附件/贴纸/<k>.svg（main/decor.ts）。
 */
import s_star from '@cn/design/stickers/star.svg?raw'
import s_bulb from '@cn/design/stickers/bulb.svg?raw'
import s_check from '@cn/design/stickers/check.svg?raw'
import s_ask from '@cn/design/stickers/ask.svg?raw'
import s_bang from '@cn/design/stickers/bang.svg?raw'
import s_book from '@cn/design/stickers/book.svg?raw'
import s_pencil from '@cn/design/stickers/pencil.svg?raw'
import s_cap from '@cn/design/stickers/cap.svg?raw'
import s_lens from '@cn/design/stickers/lens.svg?raw'
import s_clock from '@cn/design/stickers/clock.svg?raw'
import s_cup from '@cn/design/stickers/cup.svg?raw'
import s_fire from '@cn/design/stickers/fire.svg?raw'
import s_zd from '@cn/design/stickers/zd.svg?raw'
import s_kd from '@cn/design/stickers/kd.svg?raw'
import s_dc from '@cn/design/stickers/dc.svg?raw'
import s_yd from '@cn/design/stickers/yd.svg?raw'
import s_gd from '@cn/design/stickers/gd.svg?raw'
import s_wls from '@cn/design/stickers/wls.svg?raw'
import s_lg from '@cn/design/stickers/lg.svg?raw'
import s_fx from '@cn/design/stickers/fx.svg?raw'
import s_cy from '@cn/design/stickers/cy.svg?raw'
import s_todo from '@cn/design/stickers/todo.svg?raw'
import s_done from '@cn/design/stickers/done.svg?raw'
import s_bd from '@cn/design/stickers/bd.svg?raw'
import s_coffee from '@cn/design/stickers/coffee.svg?raw'
import s_heart from '@cn/design/stickers/heart.svg?raw'
import s_smile from '@cn/design/stickers/smile.svg?raw'
import s_spark from '@cn/design/stickers/spark.svg?raw'
import s_sun from '@cn/design/stickers/sun.svg?raw'
import s_cloud from '@cn/design/stickers/cloud.svg?raw'
import s_leaf from '@cn/design/stickers/leaf.svg?raw'
import s_cat from '@cn/design/stickers/cat.svg?raw'
import s_rocket from '@cn/design/stickers/rocket.svg?raw'
import s_moon from '@cn/design/stickers/moon.svg?raw'
import s_note from '@cn/design/stickers/note.svg?raw'
import s_rainbow from '@cn/design/stickers/rainbow.svg?raw'

export const STICKER_SVG: Record<string, string> = {
  star: s_star,
  bulb: s_bulb,
  check: s_check,
  ask: s_ask,
  bang: s_bang,
  book: s_book,
  pencil: s_pencil,
  cap: s_cap,
  lens: s_lens,
  clock: s_clock,
  cup: s_cup,
  fire: s_fire,
  zd: s_zd,
  kd: s_kd,
  dc: s_dc,
  yd: s_yd,
  gd: s_gd,
  wls: s_wls,
  lg: s_lg,
  fx: s_fx,
  cy: s_cy,
  todo: s_todo,
  done: s_done,
  bd: s_bd,
  coffee: s_coffee,
  heart: s_heart,
  smile: s_smile,
  spark: s_spark,
  sun: s_sun,
  cloud: s_cloud,
  leaf: s_leaf,
  cat: s_cat,
  rocket: s_rocket,
  moon: s_moon,
  note: s_note,
  rainbow: s_rainbow,
}

/** 自带贴纸当图用的地址（库里还没拷过去、或读不到时用这个画） */
export const stickerData = (k: string): string => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(STICKER_SVG[k] ?? '')
