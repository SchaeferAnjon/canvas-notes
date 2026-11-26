/**
 * 记下这一刻 / 问 AI 之前，把「记到哪」落成一篇开着的文档：
 * - 中间没开文档（CN-70）：新建「收件箱/<视频标题>.md」（已经有就用那篇），属性「视频: <网址>」，在中间开一个新标签；
 * - 记到的是「未命名」「未命名 N」、这篇还没记过这个视频（CN-80 方向 B）：直接改名成视频名、加属性「视频: <网址>」，它就是这个视频的笔记。
 * 开新标签不抢键盘：编辑器开好后焦点还回原来的地方（视频网页），空格照样暂停 / 播放（弹窗不抢焦点）。
 */
import { setProp } from '@cn/format'
import { type Dest, isUntitled, safeTitle, type Site, watchUrl } from '../../shared/video'
import type { NoteDoc } from '../note-doc'
import { centerNow } from './store'

export interface VideoInfo {
  key: string
  title: string
  site: Site
  id: string
  p?: number
  url?: string
}

export interface Prepared {
  dest: Dest
  /** 这次新建了这一篇（提示里写「新建了《…》」，撤回时连它一起删） */
  created: boolean
  /** 这次把「未命名」改成了视频名：原来的路径（这次的提交里要带上它，旧文件的删除才一起进去） */
  from: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 等中间栏开着的文档变成 path（编辑器建好） */
async function docAt(path: string): Promise<NoteDoc> {
  for (let i = 0; i < 100; i++) {
    const d = centerNow()?.doc()
    if (d && d.path === path) return d
    await sleep(30)
  }
  throw new Error(`《${path.split('/').pop()!.replace(/\.md$/, '')}》没打开，记不进去`)
}

/** 开标签、改名会把焦点挪进编辑器；挪回原来的地方（右栏视频网页） */
async function keepFocus<T>(f: () => Promise<T>): Promise<T> {
  const was = document.activeElement as HTMLElement | null
  try {
    return await f()
  } finally {
    await sleep(0)
    // 原来焦点在视频网页（或别的输入框）：还回去；原来哪儿都不在：编辑器也别拿着，按键不会打进文档
    if (was && was !== document.body && was.isConnected) was.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }
}

export async function prepareDest(dest: Dest, v: VideoInfo): Promise<Prepared> {
  const c = centerNow()
  if (!c) throw new Error('软件还没准备好')
  const url = watchUrl(v)
  if (dest.kind === 'new') {
    return keepFocus(async () => {
      let path = dest.path
      let created = false
      const there = await window.cn.readNote(path).then(
        () => true,
        () => false,
      )
      if (!there) {
        const head = setProp('', '视频', url)
        path = await window.cn.createNote(path.slice(0, path.lastIndexOf('/')), dest.title, `${head}\n# ${dest.title}\n\n`)
        created = true
        c.refresh()
      }
      c.open(path)
      const doc = await docAt(path)
      // 光标放到最后：视频卡和这一刻接在标题下面，不插进开头的属性里
      doc.view.dispatch({ selection: { anchor: doc.view.state.doc.length } })
      return { dest: { kind: 'doc', path, title: path.split('/').pop()!.replace(/\.md$/, '') }, created, from: null }
    })
  }
  if (dest.kind !== 'doc' || !isUntitled(dest.title)) return { dest, created: false, from: null }
  const doc = c.doc()
  if (!doc || doc.path !== dest.path || doc.readOnly || doc.text.includes(`video=${v.key}`)) return { dest, created: false, from: null }
  return keepFocus(async () => {
    const name = safeTitle(v.title)
    await c.rename(dest.path, name)
    // 改名后路径变了（重名时软件会加序号）：等编辑器换上新路径
    let d: NoteDoc | null = null
    for (let i = 0; i < 100 && !(d && d.path !== dest.path); i++) {
      d = c.doc()
      if (!d || d.path === dest.path) await sleep(30)
    }
    // 改名没成（软件已经在底部说了原因）：照样记进原来那篇
    if (!d || d.path === dest.path) return { dest, created: false, from: null }
    d.setText(setProp(d.text, '视频', url))
    return { dest: { kind: 'doc', path: d.path, title: d.path.split('/').pop()!.replace(/\.md$/, '') }, created: false, from: dest.path }
  })
}
