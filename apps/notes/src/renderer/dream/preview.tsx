import { composing } from '../ime'
/**
 * 梦游预览（设计稿 design-mindmap 方向 B 第 8 节）：点报告里的「预览」，左栏（以后是目录树、文件夹首页）换成改好以后的样子，
 * 中间栏顶上一条「正在预览梦游的整理」：跟 AI 说哪里不对、退出预览、丢掉、收下这 N 处。
 * 收下 / 丢掉 / 撤回 / 重做都走主线（dream-main.ts），这里只管状态和那几样浮在中间栏上的东西。
 */
import { Codicon } from '@cn/design'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DreamReport, NoteFile } from '../../shared/api'
import { type Moved, pendingMoves, previewLine, previewOf } from '../../shared/dream-preview'
import { titleOf } from '../../shared/layout'
import { expectDreamChange } from './own-change'
import { errText, takenSay } from './useDream'
import { NoteDoc } from '../note-doc'

interface Toast {
  text: string
  /** 窄时换成的短写法（提交号照样整个露着），整句放进悬停提示 */
  short?: string
  commit?: string | null
  undo?: { ids: string[]; taken?: string }
}

export type DreamPreview = ReturnType<typeof useDreamPreview>

export function useDreamPreview(
  dream: { report: DreamReport | null; setReport(r: DreamReport): void },
  notes: NoteFile[],
  onNotice: (t: string) => void,
  /** 撤不回：底栏说原因、带「在历史里看」（这里的提示条连「撤回」一起收掉，不留一个点了还是同一句的按钮） */
  onUndoFailed: (e: unknown) => void,
) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ids: string[]; label: string; chips: string[] } | null>(null)
  const [redoing, setRedoing] = useState<{ ids: string[]; text: string } | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const moves = useMemo(() => pendingMoves(dream.report), [dream.report])
  const pv = useMemo(() => previewOf(notes, moves), [notes, moves])

  // 都处理完了自己退出预览
  useEffect(() => {
    if (on && !moves.length && !redoing) setOn(false)
  }, [on, moves.length, redoing])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  async function run<T>(f: () => Promise<T>): Promise<T | null> {
    setBusy(true)
    try {
      return await f()
    } catch (e) {
      onNotice(errText(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const n = (ids: string[]) => `${ids.length}处`
  /** 这几条要挪、要改的文件：这几秒里是软件自己改的 */
  const own = (ids: string[]) => expectDreamChange((dream.report?.items ?? []).filter((i) => ids.includes(i.id)))
  const self = {
    on,
    busy,
    moves,
    preview: pv,
    feedback,
    redoing,
    toast,
    line: previewLine(moves),
    setOn,
    /** 预览里点一篇挪来的：打开它在 main 上原来的那篇 */
    realPath: (p: string) => (on ? (pv.marks.get(p)?.from ?? p) : p),
    async take(ids: string[]) {
      // 收下是软件自己挪、改名：开着的那篇标签跟过去，不说「在外面改名」
      own(ids)
      // 编辑器里刚打、还没自动保存的字先存盘，和梦游的改动一起合
      const r = await run(async () => (await NoteDoc.saveAll(), window.cn.dreamTakeMany(ids)))
      if (!r) return
      dream.setReport(r.report)
      // 合不上的那几条留着待看：提示说收下了几处、哪条没收下、为什么；撤回只撤收下的
      const took = ids.filter((id) => r.report.items.find((i) => i.id === id)?.state === 'taken')
      const stuck = takenSay(ids, r.report)
      if (!took.length) {
        setToast(null)
        onNotice(stuck ?? '一处都没收下')
        return
      }
      setToast({ text: stuck ?? `收下了${n(took)}，已提交到${r.report.base}`, short: '已收下 ·', commit: r.commit, ...(r.commit ? { undo: { ids: took, taken: r.commit } } : {}) })
    },
    async drop(ids: string[]) {
      const r = await run(() => window.cn.dreamDropMany(ids))
      if (!r) return
      dream.setReport(r)
      setToast({ text: `丢掉了${n(ids)} · 收件箱保持原样`, undo: { ids } })
    },
    async undo(u: { ids: string[]; taken?: string }) {
      own(u.ids)
      setBusy(true)
      let r: Awaited<ReturnType<typeof window.cn.dreamUndo>>
      try {
        await NoteDoc.saveAll()
        r = await window.cn.dreamUndo(u)
      } catch (e) {
        setToast(null)
        onUndoFailed(e)
        return
      } finally {
        setBusy(false)
      }
      dream.setReport(r.report)
      setToast(u.taken ? { text: '已撤回 · 文件回到收件箱，原来的名字 · 新提交', commit: r.commit } : { text: '撤回了 · 又回到待看' })
    },
    /** 跟 AI 说哪里不对：label 是弹层标题里的「这 3 处」「「第3讲…」」 */
    ask(ids: string[], label: string) {
      const titles = (dream.report?.items ?? []).filter((i) => ids.includes(i.id)).map((i) => i.move?.to ?? '')
      const chips = [
        titles.some((t) => t.startsWith('生活/')) ? '速记放 写作 下面' : null,
        titles.some((t) => titleOf(t).length > 10) ? '名字太长了' : null,
        titles.some((t) => t.startsWith('课程/')) ? '课程里的别改名' : null,
        '先留在收件箱',
      ].filter((c): c is string => !!c)
      setFeedback({ ids, label, chips })
    },
    closeFeedback: () => setFeedback(null),
    async redo(ids: string[], text: string) {
      setFeedback(null)
      setRedoing({ ids, text })
      setOn(true)
      try {
        const r = await window.cn.dreamRedo(ids, text)
        dream.setReport(r.report)
        setToast({ text: r.changed ? `重做好了 · ${r.changed}处变了，标着「按你说的改了」，再看看` : 'AI看了一遍，没有要改的；换个说法再试试' })
      } catch (e) {
        const msg = errText(e)
        if (!/停下了/.test(msg)) onNotice(msg)
      } finally {
        setRedoing(null)
      }
    },
    stopRedo: () => void window.cn.dreamRedoStop(),
    closeToast: () => setToast(null),
  }
  return self
}

/** 预览条（放进底栏：底栏整条变成它，VS Code 调试时底栏变色的做法）、跟 AI 说的弹层、底部提示 */
export function PreviewOverlay(props: { pv: DreamPreview }) {
  const { pv } = props
  useEffect(() => {
    if (!pv.on) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pv.feedback) return
      if (pv.redoing) pv.stopRedo()
      else pv.setOn(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pv.on, pv.feedback, pv.redoing])
  const ids = pv.moves.map((m) => m.id)
  // 底栏里留的位置（shell/StatusBar 的 #pv-slot）
  const slot = typeof document === 'undefined' ? null : document.getElementById('pv-slot')
  return (
    <>
      {pv.on && slot && createPortal(
        <div className="pv-bar" role="status" aria-label="正在预览梦游的整理" data-testid="preview-bar">
          <span className="pd" />
          {pv.redoing ? (
            <>
              <span>
                AI按你说的重做中 ·「{pv.redoing.text}」
              </span>
              <button className="btn btn-ghost btn-xs" onClick={pv.stopRedo}>
                停下<span className="kbd-in">esc</span>
              </button>
            </>
          ) : (
            <>
              {/* 窗口窄时说明缩短、「跟 AI 说」只留图标，最要紧的那句不被省略号截掉 */}
              <span className="pv-long">正在预览梦游的整理 · {pv.line}</span>
              <span className="pv-short">
                预览梦游 · <span className="num">{pv.moves.length}</span>处
              </span>
              <button className="btn btn-ghost btn-xs pv-ask" disabled={!ids.length} onClick={() => pv.ask(ids, `这 ${ids.length} 处`)} aria-label="跟 AI 说哪里不对" data-tip="跟AI说哪里不对" data-side="above">
                <Codicon name="sparkle" size={14} />
                <span className="pv-lb">跟AI说哪里不对</span>
              </button>
              {/* 顺序照设计稿（主界面 design/frame）：跟 AI 说哪里不对 ｜ 丢掉 ｜ 收下这 N 处 ｜ 退出预览 esc */}
              <button className="btn btn-xs" disabled={pv.busy || !ids.length} onClick={() => void pv.drop(ids)}>
                丢掉
              </button>
              <button className="btn btn-primary btn-xs" disabled={pv.busy || !ids.length} onClick={() => void pv.take(ids)}>
                {pv.moves.length > 12 ? '收下全部' : `收下这${ids.length}处`}
              </button>
              <button className="btn btn-ghost btn-xs" onClick={() => pv.setOn(false)}>
                退出预览<span className="kbd-in">esc</span>
              </button>
            </>
          )}
        </div>,
        slot,
      )}
      {pv.feedback && <FeedbackPop key={pv.feedback.ids.join()} pv={pv} />}
      {pv.toast && (
        // 外面一层铺满中间栏的宽，按它换短写法（容器查询量不了按内容定宽的提示条自己）
        <div className="pv-toast-box">
        <div className={'pv-toast' + (pv.toast.short ? ' has-short' : '')} role="status" data-testid="preview-toast">
          {pv.toast.commit !== undefined && <Codicon name="git-commit" size={14} />}
          <span className="long">{pv.toast.text}</span>
          {pv.toast.short && (
            <span className="short" data-tip={pv.toast.text} data-side="above">
              {pv.toast.short}
            </span>
          )}
          {pv.toast.commit && <code className="num">{pv.toast.commit.slice(0, 7)}</code>}
          {pv.toast.undo && (
            <button className="btn btn-ghost btn-xs" disabled={pv.busy} onClick={() => void pv.undo(pv.toast!.undo!).then(() => undefined)}>
              <Codicon name="discard" size={12} />
              撤回
            </button>
          )}
          <button className="iconbtn sm" aria-label="关掉提示" onClick={pv.closeToast}>
            <Codicon name="close" size={12} />
          </button>
        </div>
        </div>
      )}
    </>
  )
}

function FeedbackPop(props: { pv: DreamPreview }) {
  const { pv } = props
  const f = pv.feedback!
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => area.current?.focus(), [])
  const send = () => text.trim() && void pv.redo(f.ids, text.trim())
  return (
    <div className="pv-pop" role="dialog" aria-label={`跟 AI 说${f.label}哪里不对`}>
      <h4>{`跟AI说${f.label}哪里不对`}</h4>
      <textarea
        ref={area}
        rows={3}
        aria-label="哪里不对"
        placeholder="比如：这几篇应该在 生活 下面；名字太长"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (composing(e)) return
          if (e.key === 'Enter' && e.metaKey) (e.preventDefault(), send())
          if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), pv.closeFeedback())
        }}
      />
      <div className="chips">
        {f.chips.map((c) => (
          <button key={c} className="chip" onClick={() => setText(c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="help">AI在同一个梦游分支上按你说的重做，做好了再给你预览；你没提到的不动。</p>
      <div className="act">
        <button className="btn btn-ghost btn-sm" onClick={pv.closeFeedback}>
          取消
        </button>
        <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={send}>
          <Codicon name="sparkle" size={14} />
          重做<span className="kbd-in">⌘↵</span>
        </button>
      </div>
    </div>
  )
}

/** 左栏里收件箱原来的位置留影子：划掉的原名 + 「挪到 线性代数」；多了只露几条（别把上万条全铺开） */
export function GhostRows(props: { pv: DreamPreview }) {
  const { ghosts } = props.pv.preview
  if (!ghosts.length) return null
  const SHOW = 5
  return (
    <div className="s-group pv-ghosts" role="group" aria-label="收件箱 · 挪走的">
      <div className="sh">
        收件箱
        <span className="sub">挪走的</span>
      </div>
      {ghosts.slice(0, SHOW).map((g) => (
        <div key={g.id} className="si pv-ghost" title={`挪到 ${g.to}`}>
          <Codicon name="inbox" />
          <s className="truncate">{titleOf(g.from)}</s>
          <span className="to truncate">{`挪到${g.to.split('/').slice(-2, -1)[0] ?? ''}`}</span>
        </div>
      ))}
      {ghosts.length > SHOW && <p className="s-none">{`还有${ghosts.length - SHOW}条挪走的`}</p>}
    </div>
  )
}

/** 左栏挪来的一行右边：「新」标签；悬停出 收下这一处 / 丢掉这一处 */
export function MovedMark(props: { m: Moved; pv: DreamPreview }) {
  const { m, pv } = props
  return (
    <span className="pv-mark">
      <span className="tag-new" title={`原名 ${titleOf(m.from)}${m.redo ? ` · 按你说的改了` : ''}`}>
        新
      </span>
      <span className="pv-hover" onClick={(e) => e.stopPropagation()}>
        <span role="button" tabIndex={0} className="iconbtn xs" aria-label="收下这一处" title="收下这一处" onClick={() => void pv.take([m.id])}>
          <Codicon name="check" size={12} />
        </span>
        <span role="button" tabIndex={0} className="iconbtn xs" aria-label="丢掉这一处" title="丢掉这一处" onClick={() => void pv.drop([m.id])}>
          <Codicon name="close" size={12} />
        </span>
      </span>
    </span>
  )
}
