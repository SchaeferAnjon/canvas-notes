import { Codicon, type CodiconName } from '@cn/design'
import { onMessageMenu } from './ctx/message-menu'
import { fmValue, isMindmap, resetLayout, splitDoc } from '@cn/format'
import { Markdown } from './md-render'
import { AiError } from './ai-error'
import { ByLogo } from './engine-logo'
import { pastedUrl } from './paste-images'
import { AiHead, AwayBar, Chip, type DockNav, Sees } from './ai-head'
import { AiInput, MatMsg, QuoteCap, sendText, useComposer, useConvPick } from './composer'
import * as C from './ai-chats'
import { folderCount, HANDS, type Place, seenOf } from './ai-place'
import { type FolderSug, fileInPrompt, folderSugs, folderSumPrompt, newTarget, parseFileIn, skeleton, sumTargets } from './folder-ai'
import { useKnownFiles } from './files/store'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentContext, StoredMsg, ToolStep } from '../shared/agent'
import { imageNames, type Material } from '../shared/materials'
import type { CommitInfo, DuplicatePair, NoteFile } from '../shared/api'
import { CLIPS, titleOf } from '../shared/layout'
import './ai.css'
import {
  articlePrompt,
  askPrompt,
  COMMANDS,
  draftText,
  inboxPrompt,
  parseMoves,
  dreamSummary,
  PENDING_COMMANDS,
  TIDY_BOARD,
  summaryPrompt,
  SYSTEM,
  topicFolder,
  today,
  translatePrompt,
  withSummaryCard,
} from './ai-commands'
import { GROUPS } from './dream/useDream'
import type { NoteDoc, ViewMode } from './note-doc'
import type { Tab } from './tabs'

type Msg = C.Msg
type Action = NonNullable<Msg['actions']>[number]

type Change = NonNullable<StoredMsg['change']>

/** AI 那一格里的命令各用自己的图标（这一格整个都是 AI，引擎标志在输入框底行；同一条命令和 ⌘K 里同一个图标） */
const ICONS: Record<string, CodiconName> = {
  整理收件箱: 'inbox',
  整理当前白板: 'layers',
  总结这块白板: 'layout',
  写成文章: 'edit',
  翻译: 'whole-word',
  找重复: 'files',
  剪藏当前网页: 'quote',
  现在梦游: 'wand',
}

let seq = Date.now()

const lastSeg = (p: string) => p.split('/').pop() || p

/**
 * 做成了、只是没提交上：黄色 warning 图标 + 一行说明（「卡存好了，提交没成功」），下面 12 号淡字写原因，再一个「再提交一次」。
 * 和 AI 出错那行（ai-error.tsx）同一种排法
 */
function CommitWarn(props: { text: string; onRetry(): void }) {
  const at = props.text.indexOf('：')
  const [title, why] = at > 0 ? [props.text.slice(0, at), props.text.slice(at + 1)] : [props.text, '']
  return (
    <div className="warn" role="status" data-testid="ai-warn">
      <div className="t">
        <Codicon name="warning" size={12} className="ic" />
        <span>{title}</span>
      </div>
      {why && <div className="why">{why}</div>}
      <div className="acts">
        <button className="btn btn-xs" onClick={props.onRetry}>
          <Codicon name="git-commit" size={12} />
          再提交一次
        </button>
      </div>
    </div>
  )
}

/** AI 的改动写进文件了、只是没提交上；message 是中文原因，retry 是「再提交一次」要提交的文件和说明 */
class CommitFailed extends Error {
  constructor(
    why: string,
    readonly retry: NonNullable<StoredMsg['retry']>,
  ) {
    super(why)
  }
}

export interface AiPanelProps {
  /** 这一格没开、或在读 PDF（格里是读 PDF 的 AI）：藏起来，不卸下（正在生成的那一轮不断） */
  hidden: boolean
  /** 这段对话是哪个地方的（头上胶囊写它的名字）：这里的，或者对话菜单里点开的别处的（nav.away） */
  place: Place
  /** 对话菜单、「这是在…问的 · 回到…」 */
  nav: DockNav
  /** 开着的这篇是书摘（「看得到」写「书摘：书名」） */
  digest: boolean
  tab: Tab | null
  mode: ViewMode
  doc(): NoteDoc | null
  notes: NoteFile[]
  webUrl: string | null
  /** 右栏开着网页（「看得到」多一颗网页，能动手换成网页的） */
  webOpen: boolean
  /** 现在看的是什么（当前标签、右栏网页、选中的字），每一轮发给 AI */
  context(mentions: string[]): AgentContext
  onClose(): void
  onOpen(path: string): void
  onShowHistory(): void
  /** 在右栏打开梦游报告 */
  onShowDream(): void
  onChanged(): void
  /** 一打开就跑这条（seq 变了再跑一次） */
  autoRun?: { text: string; seq: number } | null
  /**
   * 文档里选字 ⌘J、右键「问 AI」：这段字成为输入框顶上那一排的第一块引用（src 是来源「《文档标题》」），光标在它后面，不自动发
   * （seq 变了再放一次；同一个标签再来一次换掉它，换了标签拿掉它）
   */
  draft?: { text: string; src: string; seq: number } | null
}

export function AiPanel(props: AiPanelProps) {
  const place = props.place
  // 每个地方各存各的对话（D 组 CN-132，ai-chats.ts）；正在答的那一轮全软件一个，记着是哪个地方的
  const { msgs, loaded, pick: ownPick } = C.useChat(place)
  const turn = C.runningNow()
  /** 这个地方正在答的那一轮 */
  const running = turn?.key === place.key ? turn.id : null
  /** 别的地方在答（主进程一次只跑一轮 AI 动手）：这里先不发，发送键说为什么 */
  const busyElsewhere = !!turn && turn.key !== place.key
  /** 输入框上面一行提示（「最多4张」、加图没成的原因），3 秒后收起 */
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const showNote = (t: string) => {
    setPasteNote(t)
    setTimeout(() => setPasteNote((x) => (x === t ? null : x)), 3000)
  }
  // 输入框的字和顶上那一排材料（第 2b 段，composer.tsx）
  const c = useComposer(showNote)
  const input = c.text
  const setInput = c.setText
  // 谁来答 · 模型 · effort（CN-91 方向 C）：模型和 effort 记在这个地方的对话里，没选过用设置 › AI「AI 对话」那一行
  const cp = useConvPick(ownPick, (p) => C.setPick(place.key, p), showNote)
  const engine = cp.pick.engine
  const engines = cp.engines
  const [menuIdx, setMenuIdx] = useState(0)
  const [mentions, setMentions] = useState<string[]>([])
  const list = useRef<HTMLDivElement>(null)
  /** 对话列表停在最底下（新的字、进度出来时跟着滚） */
  const pinned = useRef(true)
  const box = c.ta

  const notePath = props.tab?.type === 'note' ? props.tab.path : null
  const noteFile = props.notes.find((n) => n.path === notePath)
  const isBoard = !!noteFile?.board || props.mode === 'board'
  const inbox = props.notes.filter((n) => n.kind === 'inbox')
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'

  useEffect(() => {
    if (!props.hidden) box.current?.focus()
  }, [props.hidden])
  const draftSeq = useRef(0)
  // 文档里带进来的那一块跟着那个标签：换了标签就拿掉它（和它在字里的编号），自己接着打的问题留着，不拿上一篇的话问这一篇
  useEffect(() => {
    c.dropDocQuotes(props.tab?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tab?.id])
  useEffect(() => {
    const d = props.draft
    if (!d || d.seq === draftSeq.current) return
    draftSeq.current = d.seq
    // 成为第一块引用，光标在它后面；已经打了的问题留着（在编号后面），同一个标签里再来一次换掉这一块
    c.add({ kind: 'quote', text: d.text.trim().slice(0, 20_000), src: d.src }, { doc: { tab: props.tab?.id ?? null } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draft?.seq])
  const ranSeq = useRef(0)
  useEffect(() => {
    const a = props.autoRun
    if (!a || a.seq === ranSeq.current || !loaded) return
    ranSeq.current = a.seq
    void run(a.text)
  }, [props.autoRun?.seq, loaded])
  useEffect(() => {
    // 跟着最新的往下滚；人往上翻着看时不拽回去（找重复每 0.3 秒刷新一次，不然一直被拉到底）
    if (pinned.current) list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [msgs])

  // ---------- 菜单 ----------
  const slash = /^\/(\S*)$/.exec(input)
  const at = /(?:^|\s)@(\S*)$/.exec(input)
  const cmdItems = slash ? COMMANDS.filter((c) => c.name.includes(slash[1]!)) : []
  const atItems = at
    ? props.notes
        .filter((n) => n.kind === 'work' && titleOf(n.path).toLowerCase().includes(at[1]!.toLowerCase()) && !mentions.includes(n.path))
        .slice(0, 8)
    : []
  const menuLen = slash ? cmdItems.length : at ? atItems.length : 0

  /**
   * 空对话里的建议：这一页能用的 / 命令（文档不出名字写着「白板」的），右栏开着网页时「剪藏当前网页」排第一（和能动手一样），最多三颗。
   * 文件夹页照小样给这个文件夹的（总结、挪进来、照上一篇开一篇，folder-ai.ts），做不到的不放
   */
  function suggestions(folder: string | null): { text: string; icon: CodiconName; go(): void }[] {
    const cmd = (name: string) => ({ text: '/' + name, icon: ICONS[name] ?? 'comment-discussion', go: () => void run('/' + name) })
    const web = props.webOpen && props.webUrl ? [cmd('剪藏当前网页')] : []
    const own =
      folder !== null
        ? folderSugs(folder, props.notes, today()).map((s) => ({ text: s.text, icon: s.icon, go: () => void runFolder(folder, s) }))
        : (props.tab?.type === 'inbox'
            ? ['整理收件箱', '找重复']
            : isBoard
              ? ['总结这块白板', '写成文章', '整理收件箱']
              : notePath
                ? ['翻译', '整理收件箱']
                : ['整理收件箱', '现在梦游']
          ).map(cmd)
    return [...web, ...own].slice(0, 3)
  }

  // ---------- 跑命令 ----------
  // 加进这一轮开始时那个地方的对话（答的时候换了页面也写回原处）；改一条按编号找，在哪个地方都一样
  const push = (m: Msg) => {
    pinned.current = true
    C.update(place.key, (x) => [...x, { ...m, time: Date.now() }], place.label)
  }
  const patch = (id: number, p: Partial<Msg>) => C.patch(id, p)

  async function noteText(path: string): Promise<string> {
    const d = props.doc()
    if (d && d.path === path) return d.text
    return (await window.cn.readNote(path)).text
  }

  /** 只聊天的命令：live 时边生成边显示 */
  async function askAi(id: number, prompt: string, live: boolean): Promise<string> {
    if (live) patch(id, { live: true, text: '' })
    try {
      return await window.cn.aiAsk(id, SYSTEM, prompt)
    } finally {
      patch(id, { live: false })
    }
  }

  async function applyChange(id: number, change: Parameters<typeof window.cn.aiChange>[0], kinds: Record<string, string>) {
    const d = props.doc()
    if (d) await d.save()
    const r = await window.cn.aiChange(change)
    props.onChanged()
    // 改动写进文件了、只是没提交上：交给调用的照实说（「卡存好了，提交没成功：…」），不当成 AI 没答出来
    if (r && 'failed' in r) throw new CommitFailed(r.failed, { paths: r.paths, message: r.message, kinds })
    const commit = r
    if (commit) patch(id, { change: { commit, kinds } })
    return commit
  }

  /**
   * 「再提交一次」：只提交 AI 那次改的文件、用原来的「AI：…」说明（第 5 轮：以前是「现在提交」整个库，把别处正写着的笔记一起提交成
   * 「更新 2 个文件」，消息里也没了撤回）。提交上了：提醒换成「提交好了」，下面和一次就提交上的一样给「改了几个文件 · 撤回」；
   * 又没成：写明这是第几次也没成和这次的原因（以前一个字不变，看不出点过）
   */
  async function retryCommit(m: StoredMsg) {
    const warn = m.warn!
    const lead = warn.slice(0, warn.indexOf('：'))
    const tries = (m.tries ?? 1) + 1
    try {
      const c = m.retry ? await window.cn.aiCommit(m.retry.paths, m.retry.message) : await window.cn.commit()
      const did = lead.replace(/，提交没成功$/, '')
      // 自动提交抢先把 AI 改的收进去了：照实说，下面照样给「撤回」，只撤回那次里 AI 改的几个文件（第 6 轮）
      const taken = c && 'taken' in c ? c.taken : null
      patch(m.id, {
        warn: undefined,
        retry: undefined,
        tries: undefined,
        done: taken ? `${did}，已经由自动提交收进去了` : c ? `${did}，提交好了` : '没有要提交的改动了',
        ...(taken && m.retry
          ? { change: { commit: taken, kinds: m.retry.kinds, only: { paths: m.retry.paths, message: m.retry.message } } }
          : c && !('taken' in c) && m.retry
            ? { change: { commit: c, kinds: m.retry.kinds } }
            : {}),
      })
    } catch (e) {
      patch(m.id, { warn: `${lead}：第${tries}次也没提交上，${errText(e)}`, tries })
    }
    props.onChanged()
  }

  async function revert(id: number, c: Change) {
    try {
      const r = await window.cn.aiRevert(c.commit.hash, c.only)
      if (r) patch(id, { change: { ...c, reverted: r } })
      props.onChanged()
    } catch (e) {
      patch(id, { error: errText(e) })
    }
  }

  /** mats：这一句带的材料（输入框顶上那一排，多段引用方向 B）；「再问一次」这些只带字 */
  async function run(raw: string, mats: Material[] = []) {
    // 只贴了图、字里除了编号没别的字：问「这张图讲的是什么」（同读 PDF，CN-24）
    const text = sendText(raw, mats)
    if ((!text && !mats.length) || C.runningNow()) return
    // / 命令只看字：材料留在输入框里
    const cmdLine = /^\//.test(text)
    const own = cmdLine ? [] : mats
    if (own.length) c.clear()
    else setInput('')
    push({ id: seq++, role: 'user', text, ...(own.length ? { mats: own } : {}) })
    const id = seq++
    const cmd = /^\/(\S+)/.exec(text)?.[1]
    push({ id, role: 'ai', pending: true })
    // 找重复（大库要算十几秒）不占着对话：算的时候照样能发新问题，它在自己那条消息里报进度、能单独停下
    if (cmd === '找重复') return void findDuplicates(id)
    C.setRunning({ id, key: place.key, label: place.label })
    try {
      // 不是现成的命令：去掉斜杠，当成一句话交给 AI 去做
      if (cmd && !COMMANDS.some((c) => c.name === cmd)) return await agentTurn(id, text.slice(1))
      if (cmd === '整理当前白板') {
        if (!notePath) return patch(id, { pending: false, error: '先打开一块白板' })
        // 普通文档的白板就是按节摆（doc-board 的规则）：不用问 AI，摆回原样就是整理好的样子
        const body = await noteText(notePath)
        if (fmValue(body, 'type') !== 'board' && !isMindmap(body)) {
          const d = props.doc()
          const next = resetLayout(body)
          const b = splitDoc(next)
          if (d && d.path === notePath && next !== body) d.setText(next)
          return patch(id, { pending: false, text: `照文档的节摆好了：${b.columns.length}列、${b.total}张卡${next !== body ? '，单独摆出来的卡都放回了它那一节' : ''}。` })
        }
        return await agentTurn(id, TIDY_BOARD)
      }
      if (cmd === '现在梦游') return await dreamNow(id)
      if (cmd && PENDING_COMMANDS[cmd]) return await pendingCommand(id, cmd)
      if (cmd === '整理收件箱') return await tidyInbox(id)
      if (cmd === '总结这块白板' || cmd === '写成文章') {
        if (!notePath) return patch(id, { pending: false, error: '先打开一块白板或一篇笔记' })
        const body = await noteText(notePath)
        const cards = (body.match(/^<!-- card /gm) ?? []).length
        const read = `读了 ${notePath}${cards ? ` · ${cards}张卡片` : ''}`
        patch(id, { read })
        if (cmd === '总结这块白板') {
          const reply = await askAi(id, summaryPrompt(notePath, body), true)
          const actions: Action[] = []
          if (fmValue(body, 'type') === 'board' || cards > 0) {
            actions.push({
              label: '存成卡片',
              primary: true,
              run: async () => {
                const cur = (await window.cn.readNote(notePath)).text
                const { text: next } = withSummaryCard(cur, reply)
                try {
                  await applyChange(id, { message: `总结「${titleOf(notePath)}」存成卡片`, writes: [{ path: notePath, text: next }] }, { [notePath]: '改' })
                } catch (e) {
                  if (!(e instanceof CommitFailed)) throw e
                  return patch(id, { actions: [], warn: `卡存好了，提交没成功：${e.message}`, retry: e.retry })
                }
                patch(id, { actions: [], done: '存到了白板左下角' })
              },
            })
          }
          patch(id, { pending: false, text: reply, actions })
        } else {
          const article = await askAi(id, articlePrompt(notePath, body), true)
          const name = `${titleOf(notePath)}：文章草稿`
          const draft = draftText(notePath, article)
          const commit = await applyChange(id, { message: `按「${titleOf(notePath)}」写成文章草稿`, writes: [{ path: `${name}.md`, text: draft, create: true }] }, {})
          const path = commit?.files.find((f) => f.path.endsWith('.md'))?.path ?? `${name}.md`
          if (commit) patch(id, { change: { commit, kinds: { [path]: '新' } } })
          const words = article.replace(/\s/g, '').length
          patch(id, {
            pending: false,
            text: undefined,
            draft: { path, words, head: article.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 3).join('\n') },
            actions: [{ label: '打开', primary: true, run: () => props.onOpen(path) }],
          })
        }
        return
      }
      if (cmd === '翻译') {
        const d = props.doc()
        const sel = d ? d.view.state.sliceDoc(d.view.state.selection.main.from, d.view.state.selection.main.to) : ''
        const src = sel.trim() || (notePath ? await noteText(notePath) : '')
        if (!src.trim()) return patch(id, { pending: false, error: '先在文档里选中一段，或者打开一篇笔记' })
        patch(id, { read: sel.trim() ? `读了选中的${sel.length}个字` : `读了 ${notePath}` })
        const reply = await askAi(id, translatePrompt(src), true)
        patch(id, { pending: false, text: reply })
        return
      }
      await agentTurn(id, text, own)
    } catch (e) {
      if (e instanceof CommitFailed) patch(id, { pending: false, warn: `改好了，提交没成功：${e.message}`, retry: e.retry })
      else patch(id, { pending: false, error: errText(e) })
    } finally {
      C.setRunning(null)
    }
  }

  /** 文件夹页的建议（D 组小样）：问的那句照原话进对话，下面是做的结果 */
  async function runFolder(folder: string, s: FolderSug) {
    if (C.runningNow()) return
    push({ id: seq++, role: 'user', text: s.text })
    const id = seq++
    push({ id, role: 'ai', pending: true })
    C.setRunning({ id, key: place.key, label: place.label })
    try {
      if (s.kind === 'sum') await folderSum(id, folder)
      else if (s.kind === 'file') await fileIn(id, folder)
      else await newInFolder(id, folder)
    } catch (e) {
      if (e instanceof CommitFailed) patch(id, { pending: false, warn: `改好了，提交没成功：${e.message}`, retry: e.retry })
      else patch(id, { pending: false, error: errText(e) })
    } finally {
      C.setRunning(null)
    }
  }

  /** 把这周的周记总结成三句话：周记读这周那篇，别的文件夹读最近改的几篇 */
  async function folderSum(id: number, folder: string) {
    const list = sumTargets(folder, props.notes)
    if (!list.length) return patch(id, { pending: false, text: '这个文件夹里还没有文档。' })
    const items = await Promise.all(list.map(async (n) => ({ path: n.path, text: await noteText(n.path) })))
    patch(id, { read: list.length === 1 ? `读了「${titleOf(list[0]!.path)}」` : `读了文件夹「${lastSeg(folder)}」${list.length}篇` })
    const reply = await askAi(id, folderSumPrompt(folder, items), true)
    patch(id, { pending: false, text: reply })
  }

  /** 收件箱里和这个文件夹有关的挪进来：AI 挑，列出来，你点同意才挪，一次提交可撤回 */
  async function fileIn(id: number, folder: string) {
    const name = lastSeg(folder)
    if (!inbox.length) return patch(id, { pending: false, text: '收件箱是空的，没有要挪的。' })
    const items = await Promise.all(inbox.map(async (n) => ({ path: n.path, text: (await window.cn.readNote(n.path)).text })))
    const have = props.notes.filter((n) => n.path.startsWith(folder + '/')).map((n) => titleOf(n.path)).slice(0, 50)
    const read = `读了收件箱${inbox.length}条`
    patch(id, { read })
    const paths = parseFileIn(await askAi(id, fileInPrompt(folder, items, have), false), inbox)
    if (!paths.length) return patch(id, { pending: false, text: `收件箱里没找到和${name}有关的，先都留着。` })
    patch(id, {
      pending: false,
      text: `和${name}有关的${paths.length}条，挪进「${folder}」：`,
      moves: paths.map((p) => ({ path: p, topic: name, to: folder })),
      actions: [
        {
          label: '同意，挪过去',
          primary: true,
          run: async () => {
            const kinds: Record<string, string> = {}
            for (const p of paths) kinds[`${folder}/${p.split('/').pop()}`] = '移动'
            await applyChange(id, { message: `把收件箱里${paths.length}条挪进「${folder}」`, moves: paths.map((p) => ({ from: p, toFolder: folder })) }, kinds)
            patch(id, { actions: [], done: `挪好了${paths.length}条` })
          },
        },
      ],
    })
  }

  /** 照上周的样子开一篇：属性和小节照最新那篇，内容空着；开好就打开它（不问 AI） */
  async function newInFolder(id: number, folder: string) {
    const t = newTarget(folder, props.notes, today())
    if (!t) return patch(id, { pending: false, error: '认不出下一篇叫什么' })
    const from = titleOf(t.from.path)
    const text = skeleton(await noteText(t.from.path), from, t.name, today())
    const commit = await applyChange(id, { message: `照「${from}」开一篇「${t.name}」`, writes: [{ path: t.path, text, create: true }] }, {})
    const path = commit?.files.find((f) => f.path.endsWith('.md'))?.path ?? t.path
    if (commit) patch(id, { change: { commit, kinds: { [path]: '新' } } })
    patch(id, { pending: false, read: `照「${from}」的属性和小节`, text: `开好了「${titleOf(path)}」，内容空着等你写。` })
    props.onOpen(path)
  }

  /** 直接说的话：交给选好的引擎，它能用工具操纵网页、白板、文档；mats 是带的材料（字里的 ①② 照旧，后面按同一套编号列出每块，图叫「图②」，图一起附上） */
  async function agentTurn(id: number, text: string, mats: Material[] = []) {
    // 回答头上写全「Claude Code · Opus 5.5 · High」：这个对话这一问用的
    patch(id, { live: true, engine, text: '', by: cp.label })
    const ctx = props.context(mentions)
    const pasted = imageNames(mats)
    try {
      // 接着这个地方自己的会话（D 组 CN-132）；模型和 effort 是这个对话选的（CN-91）
      const r = await window.cn.aiTurn({
        id,
        engine,
        text,
        context: ctx,
        place: { key: place.key, label: place.label },
        ...cp.req,
        ...(pasted.length ? { pasted } : {}),
        ...(mats.length ? { mats } : {}),
      })
      C.patch(id, (m) => ({
        ...m,
        pending: false,
        live: false,
        text: r.text || m.text || undefined,
        ...(r.error ? { error: r.error } : {}),
        ...(r.commit ? { change: { commit: r.commit, kinds: r.kinds, ...(r.moved ? { moved: r.moved } : {}) } } : {}),
        // 改好了、提交没成功（没署名、锁一直不放）：照实说，「再提交一次」只提交这一轮改的那几个文件
        ...(r.failed ? { warn: `改好了，提交没成功：${r.failed.failed}`, retry: { paths: r.failed.paths, message: r.failed.message, kinds: r.kinds } } : {}),
      }))
      if (r.commit || r.failed) props.onChanged()
    } finally {
      patch(id, { live: false })
    }
  }

  /** 找重复每条消息列出了几对（先列 50，「再显示 50 对」往下加；别把上万对一次铺开） */
  const [dupShown, setDupShown] = useState<Record<number, number>>({})
  /** 正在算的找重复是哪一条消息 */
  const dupping = useRef<number | null>(null)
  /**
   * 找重复：只列出来，不改文件；两篇都能点开。边算边报「已比 N/M 篇」，先找到的先列出来（像的在前）；
   * 「停下」直接结束算的进程，已经找到的留着。
   */
  async function findDuplicates(id: number) {
    if (dupping.current !== null) return patch(id, { pending: false, text: '上一次找重复还在算，等它算完或者先停下。' })
    dupping.current = id
    let found: DuplicatePair[] = []
    let prog = { done: 0, total: 0 }
    patch(id, { dupProgress: prog })
    const off = window.cn.onDuplicatesProgress((p) => {
      prog = { done: p.done, total: p.total }
      if (p.pairs.length) found = byScore([...found, ...p.pairs])
      patch(id, { dupProgress: prog, ...(found.length ? { dups: found } : {}) })
    })
    try {
      const pairs = await window.cn.findDuplicates({ webUrl: props.webUrl })
      if (!pairs.length) return patch(id, { pending: false, dupProgress: undefined, dups: undefined, text: '没找到重复的。' })
      patch(id, { pending: false, dupProgress: undefined, text: `找到${pairs.length}对可能重复的，像的在前：`, dups: pairs })
    } catch (e) {
      if (errText(e) !== '停下了') return patch(id, { pending: false, dupProgress: undefined, error: errText(e) })
      const where = prog.total ? `比了${prog.done}/${prog.total}篇` : '还没开始比'
      patch(id, {
        pending: false,
        dupProgress: undefined,
        text: found.length ? `停下了（${where}），先找到的${found.length}对，像的在前：` : `停下了（${where}），还没找到重复的。`,
        dups: found.length ? found : undefined,
      })
    } finally {
      off()
      dupping.current = null
    }
  }

  /** 现在梦游：改动在单独的分支上，跑完说整理了几条、分几组，给个按钮打开右栏报告 */
  async function dreamNow(id: number) {
    patch(id, { read: '正在梦游：整理收件箱、补双链、找重复、写本周小结' })
    const report = await window.cn.dreamNow({ webUrl: props.webUrl })
    const s = dreamSummary(report, GROUPS)
    patch(id, { pending: false, read: undefined, text: s.text, dream: { items: s.items, groups: s.groups } })
  }

  /** 还在别的同事那里做的命令：window.cn 上有对应方法才调 */
  async function pendingCommand(id: number, cmd: string) {
    const fn = (window.cn as unknown as Record<string, unknown>)[PENDING_COMMANDS[cmd]!]
    if (typeof fn !== 'function') return patch(id, { pending: false, text: '这条命令还在做' })
    const r: unknown = await (fn as (arg: { webUrl: string | null }) => Promise<unknown>).call(window.cn, { webUrl: props.webUrl })
    props.onChanged()
    patch(id, { pending: false, text: typeof r === 'string' && r ? r : '做好了' })
  }

  async function tidyInbox(id: number) {
    if (!inbox.length) return patch(id, { pending: false, text: '收件箱是空的，没有要整理的。' })
    const items = await Promise.all(inbox.map(async (n) => ({ path: n.path, text: (await window.cn.readNote(n.path)).text })))
    const topics = [...new Set(props.notes.filter((n) => n.kind === 'clip').map((n) => n.topic!))]
    const reply = await askAi(id, inboxPrompt(items, topics), false)
    const moves = parseMoves(reply, inbox)
    if (!moves.length) return patch(id, { pending: false, read: `读了收件箱${inbox.length}条`, text: '这几条都没把握放哪，先留在收件箱。' })
    patch(id, {
      pending: false,
      read: `读了收件箱${inbox.length}条`,
      text: `有把握的${moves.length}条，挪到这些主题：`,
      moves,
      actions: [
        {
          label: '同意，挪过去',
          primary: true,
          run: async () => {
            const kinds: Record<string, string> = {}
            for (const m of moves) kinds[`${topicFolder(m.topic)}/${m.path.split('/').pop()}`] = '移动'
            await applyChange(id, { message: `整理收件箱：挪了 ${moves.length} 条`, moves: moves.map((m) => ({ from: m.path, toFolder: topicFolder(m.topic) })) }, kinds)
            patch(id, { actions: [], done: `挪好了${moves.length}条` })
          },
        },
      ],
    })
  }

  function stop() {
    if (running === null) return
    void window.cn.aiStop(running)
    void window.cn.aiTurnStop(running)
  }

  /** 新对话：这个地方的对话清掉（会话号一起清） */
  function newChat() {
    C.clear(place.key)
    setMentions([])
  }

  // ---------- 输入 ----------
  function pick(i: number) {
    if (slash) {
      const c = cmdItems[i]
      if (c) void run('/' + c.name)
    } else if (at) {
      const n = atItems[i]
      if (!n) return
      setMentions((m) => [...m, n.path])
      setInput(input.slice(0, input.length - at[1]!.length - 1) + '@' + titleOf(n.path) + ' ')
    }
    setMenuIdx(0)
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (menuLen) {
      if (e.key === 'ArrowDown') return (e.preventDefault(), setMenuIdx((i) => (i + 1) % menuLen))
      if (e.key === 'ArrowUp') return (e.preventDefault(), setMenuIdx((i) => (i - 1 + menuLen) % menuLen))
      if (e.key === 'Enter') return (e.preventDefault(), pick(menuIdx))
      if (e.key === 'Escape') return (e.preventDefault(), setInput(''))
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void run(input, c.plain())
    } else if (e.key === 'Escape') {
      props.onClose()
    }
  }

  // 看得到（D 组 CN-132）：这一页（文件夹页「文件夹：周记 · 1篇」、首页「首页」……不再写「没打开笔记」），右栏开着网页再多一颗网页，@ 点名的笔记
  const files = useKnownFiles()
  const folder = props.tab?.type === 'folder' ? props.tab.folder : props.tab?.type === 'topic' ? `${CLIPS}/${props.tab.topic}` : null
  const count = useMemo(() => (folder === null ? 0 : folderCount(folder, files)), [folder, files])
  const seen = seenOf(props.tab, { board: isBoard, digest: props.digest, inbox: inbox.length, count: () => count })
  const web = props.webOpen ? props.webUrl : null
  // 空对话放不下时一级级收：先藏大标题；还放不下就只留前两颗建议、大标题放得下再画回来；再不行两样都收
  // （按这一格实际放不放得下量，不按固定高度：建议有两颗有三颗、那句有一行有两行）
  const empty = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = empty.current
    const box = list.current
    if (!el || !box) return
    const fit = () => {
      for (const level of [[], ['tight1'], ['tight2'], ['tight1', 'tight2']]) {
        el.classList.remove('tight1', 'tight2')
        el.classList.add(...level)
        if (box.scrollHeight <= box.clientHeight) return
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  })
  const sees: { label: string; on?: boolean }[] = [{ label: seen.see, on: true }, ...(web ? [{ label: `网页：${hostOf(web)}` }] : []), ...mentions.map((m) => ({ label: `@${titleOf(m)}` }))]
  // 它在这一页能替你做的动作（右栏网页开着时是网页的，最可能是要它动网页）
  const hands = web ? HANDS.web : seen.hands

  return (
    <aside className="right aicell ai" aria-label="AI 对话" hidden={props.hidden}>
      <AiHead label={place.label} nav={props.nav} newTip="新对话" newDisabled={running !== null} onNew={newChat} onCollapse={props.onClose} />
      {props.nav.away ? (
        <AwayBar nav={props.nav} />
      ) : (
      <Sees testid="ai-sees">
        {sees.map((s) => (
          <Chip key={s.label} on={s.on}>
            {s.label}
          </Chip>
        ))}
        {hands && <Chip hands>{`能动手：${hands}`}</Chip>}
      </Sees>
      )}
      <div
        className="msgs"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {/* 空对话（D 组小样）：这是哪里的对话、别处问过的在头上菜单里；下面是这一页能用的命令 */}
        {loaded && msgs.length === 0 && (
          <div className="ai-empty" ref={empty}>
            <h2>想让它做什么？</h2>
            {/* 「⌄」字画出来像个下标 v：换成和头上对话胶囊同一个 chevron-down 图标 */}
            {/* 名字最后一个字、⌄ 和「」里。」不折开：中文的收尾括号不落到行首，⌄ 不单独挂在行尾 */}
            <p>
              {`这里是「${place.label}」的对话；别处问过的在上面「${[...place.label].slice(0, -1).join('')}`}
              <span className="nobr">
                {[...place.label].slice(-1).join('')}
                <Codicon name="chevron-down" size={12} className="cv" />
                {'」里。'}
              </span>
            </p>
            {suggestions(folder).map((s) => (
              <button key={s.text} className="sug" onClick={s.go}>
                <Codicon name={s.icon} size={14} />
                <span className="truncate">{s.text}</span>
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="um-wrap">
              {m.pasted && (
                <div className="um-imgs">
                  {m.pasted.map((n) => (
                    <img key={n} src={pastedUrl(n)} alt="粘贴的图" />
                  ))}
                </div>
              )}
              {m.mats?.length ? (
                <MatMsg text={m.text ?? ''} mats={m.mats} onContextMenu={(e) => onMessageMenu(e, m.text ?? '')} />
              ) : (
                <div className="um" onContextMenu={(e) => onMessageMenu(e, m.text ?? '')}>
                  {m.text}
                </div>
              )}
            </div>
          ) : (
            <div key={m.id} className="am" data-testid="ai-msg" data-engine={m.engine} data-src="AI的回答" onContextMenu={(e) => !m.pending && onMessageMenu(e, m.text ?? '')}>
              {(m.read || m.by) && (
                <div className="read">
                  {m.read && <Codicon name="check" size={12} />}
                  {m.read && <span className="rd">{m.read}</span>}
                  {m.by && (
                    <span className="by">
                      {m.read ? ' · ' : ''}
                      <ByLogo by={m.by} />
                      {m.by}
                    </span>
                  )}
                </div>
              )}
              {m.steps?.map((s) => (
                <StepRow key={s.id} s={s} />
              ))}
              {m.pending && !m.text && !m.steps?.length && !m.dupProgress && <div className="thinking">{m.engine ? `${engines.find((e) => e.id === m.engine)?.label ?? ''}正在想…` : '正在想…'}</div>}
              {m.error && (
                <AiError
                  raw={m.error}
                  engine={{ id: m.engine ?? engine, label: engines.find((e) => e.id === (m.engine ?? engine))?.label }}
                  {...(() => {
                    const q = msgs[i - 1]?.role === 'user' ? msgs[i - 1]!.text : undefined
                    return q && !C.runningNow()
                      ? {
                          onRetry: () => void run(q),
                          onRephrase: () => {
                            setInput(q)
                            requestAnimationFrame(() => box.current?.focus())
                          },
                        }
                      : {}
                  })()}
                />
              )}
              {m.text && (
                <div className="txt">
                  <Markdown text={m.text} math />
                </div>
              )}
              {m.moves && (
                <div className="moves">
                  {m.moves.map((x) => (
                    <div key={x.path} className="mv">
                      {/* 名字放不下整行省略号（不在词中间断行），悬停看全名 */}
                      <span className="truncate" title={titleOf(x.path)}>
                        {titleOf(x.path)}
                      </span>
                      <span className="to">→ {x.to ?? topicFolder(x.topic)}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.dups && (
                <div className="dups" data-testid="ai-dups">
                  {/* 先列像的前 50 对，「再显示 50 对」往下加（上万对一次铺开太重；算的时候每 0.3 秒刷新一次） */}
                  {m.dups.slice(0, dupShown[m.id] ?? DUP_PAGE).map((d) => (
                    <div key={d.a + '|' + d.b} className="dup">
                      <div className="pair">
                        <button className="lnk" onClick={() => props.onOpen(d.a)}>
                          {titleOf(d.a)}
                        </button>
                        <span className="vs">↔</span>
                        <button className="lnk" onClick={() => props.onOpen(d.b)}>
                          {titleOf(d.b)}
                        </button>
                        <span className="sp" />
                        <span className="num score">{Math.round(d.score * 100)}%</span>
                      </div>
                      <div className="why">{d.why}</div>
                    </div>
                  ))}
                  {m.dups.length > (dupShown[m.id] ?? DUP_PAGE) && (
                    <button className="lnk dupmore" onClick={() => setDupShown((x) => ({ ...x, [m.id]: (x[m.id] ?? DUP_PAGE) + DUP_PAGE }))}>
                      {`再显示${Math.min(DUP_PAGE, m.dups.length - (dupShown[m.id] ?? DUP_PAGE))}对（还有${m.dups.length - (dupShown[m.id] ?? DUP_PAGE)}对）`}
                    </button>
                  )}
                </div>
              )}
              {/* 进度和「停下」放在列出来的几对下面：对话停在最底下时一眼看得到 */}
              {m.dupProgress && m.pending && (
                <div className="read tstep run dupprog" data-testid="dup-progress" role="status">
                  <Codicon name="loading" size={12} className="spin" />
                  <span className="rd">
                    {m.dupProgress.total ? (
                      <>
                        正在找重复：已比<span className="num">{m.dupProgress.done}/{m.dupProgress.total}</span>篇
                        {m.dups?.length ? (
                          <>
                            ，找到<span className="num">{m.dups.length}</span>对
                          </>
                        ) : null}
                      </>
                    ) : (
                      '正在读全库、切字…'
                    )}
                  </span>
                  <button className="btn btn-sm" onClick={() => void window.cn.stopDuplicates()}>
                    <Codicon name="debug-stop" size={12} />
                    停下
                  </button>
                </div>
              )}
              {m.draft && (
                <div className="dprev">
                  <div className="dh">
                    <Codicon name="file-text" size={14} />
                    <b className="truncate">{titleOf(m.draft.path)}</b>
                  </div>
                  <div className="dmeta">
                    <code>{m.draft.path}</code> · <span className="num">{m.draft.words}</span>字 · AI写的草稿
                  </div>
                  <p>{m.draft.head}</p>
                </div>
              )}
              {m.done && <div className="done">{m.done}</div>}
              {m.warn && <CommitWarn text={m.warn} onRetry={() => void retryCommit(m)} />}
              {m.dream && (
                <div className="acts">
                  <button className="btn btn-sm btn-primary" onClick={props.onShowDream}>
                    <Codicon name="wand" size={12} />
                    打开梦游报告
                  </button>
                </div>
              )}
              {!!m.actions?.length && (
                <div className="acts">
                  {m.actions.map((a) => (
                    <button
                      key={a.label}
                      className={'btn btn-sm' + (a.primary ? ' btn-primary' : '')}
                      onClick={() =>
                        void Promise.resolve(a.run()).catch((e) =>
                          patch(m.id, e instanceof CommitFailed ? { actions: [], warn: `改好了，提交没成功：${e.message}`, retry: e.retry } : { error: errText(e) }),
                        )
                      }
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              {m.change && <ChangeBlock change={m.change} onRevert={() => void revert(m.id, m.change!)} onHistory={props.onShowHistory} />}
            </div>
          ),
        )}
      </div>
      {/* 回答里选一段：「引用 ⇧⌘L · 拷贝」，引用成为输入框顶上那一排的一块 */}
      <QuoteCap list={list} active={!props.hidden} onQuote={(text, src) => c.add({ kind: 'quote', text, src })} />
      <AiInput
        c={c}
        placeholder={`跟${engines.find((e) => e.id === engine)?.label ?? 'Claude Code'}说，/ 选命令，@ 引用笔记`}
        hint="↵ 发送"
        picks={cp.picks}
        omni={cp.omni}
        running={running !== null}
        sendDisabled={(!input.trim() && !c.mats.length) || busyElsewhere}
        sendTip={busyElsewhere ? `「${turn!.label}」那边还在答，答完再发` : undefined}
        onSend={() => void run(input, c.plain())}
        onStop={stop}
        onKeyDown={onKey}
        onChange={() => setMenuIdx(0)}
        onNotice={showNote}
        list={list}
      >
        {pasteNote && <div className="nocmd">{pasteNote}</div>}
        {menuLen > 0 && (
          <div className="cmdmenu" role="listbox" aria-label={slash ? '命令' : '引用笔记'}>
            {slash
              ? cmdItems.map((it, i) => (
                  <button key={it.name} role="option" aria-selected={i === menuIdx} className={i === menuIdx ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                    <span className="ib">
                      <Codicon name={ICONS[it.name] ?? 'comment-discussion'} size={14} />
                    </span>
                    <span>
                      <b>{it.name}</b>
                      <span>{it.desc}</span>
                    </span>
                  </button>
                ))
              : atItems.map((n, i) => (
                  <button key={n.path} role="option" aria-selected={i === menuIdx} className={i === menuIdx ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                    <span className="ib">
                      <Codicon name={n.board ? 'layout' : 'file-text'} size={14} />
                    </span>
                    <span>
                      <b>{titleOf(n.path)}</b>
                      <span>{n.board ? `白板 · ${n.board.cards}张卡片` : '文档'}</span>
                    </span>
                  </button>
                ))}
            <div className="keys">↑↓ 选择 · ↵ 执行 · esc 关闭</div>
          </div>
        )}
        {slash && cmdItems.length === 0 && <div className="nocmd">没有这条命令，回车直接交给AI去做</div>}
      </AiInput>
    </aside>
  )
}

/** 找重复一次先列几对 */
const DUP_PAGE = 50

/** 找重复的一对对：像的在前 */
const byScore = (pairs: DuplicatePair[]) => pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))


/**
 * 一步的那一行（DESIGN.v3 2.3）：在做转圈、做完绿勾、出错红叉跟原因；命令、库外的路径是等宽的一段，和前面的字之间留 3px（不手打空格）。
 * AI 对话、读 PDF 的回答共用
 */
export function StepRow({ s }: { s: ToolStep }) {
  return (
    <div className={'read tstep ' + s.status} data-testid="ai-step" title={s.detail ?? s.code}>
      <Codicon name={s.status === 'run' ? 'loading' : s.status === 'ok' ? 'check' : 'close'} size={12} className={s.status === 'run' ? 'spin' : ''} />
      {s.label}
      {s.code && <code className="sc">{s.code}</code>}
      {s.status === 'err' && s.detail && <span className="why">：{s.detail}</span>}
    </div>
  )
}

/**
 * AI 这一轮的改动预览（DESIGN.md「AI 改动预览」）：改了几个文件 · 提交号 · 撤回；读 PDF 的回答下面也用它（没有「在历史里看」时不放那颗）。
 * 改名、挪动的一篇只占一行「旧名 → 新名」（Git 没认出改名时旧路径那行不单列，加减行数也不写：那是整篇删了又加的数）
 */
export function ChangeBlock({ change, onRevert, onHistory }: { change: Change; onRevert(): void; onHistory?(): void }) {
  const c: CommitInfo = change.commit
  const moved = change.moved ?? {}
  const olds = new Set(Object.values(moved))
  const listed = new Set(c.files.map((f) => f.path))
  const files = c.files.filter((f) => !olds.has(f.path))
  return (
    <div className={'aichg' + (change.reverted ? ' reverted' : '')} data-testid="ai-change">
      <div className="hd">
        <Codicon name="git-commit" size={14} />
        {change.reverted ? '已撤回' : `改了${files.length}个文件`}
        <code>{(change.reverted ?? c).hash.slice(0, 7)}</code>
        <span className="sp" />
        {!change.reverted && (
          <button className="btn btn-sm" onClick={onRevert}>
            <Codicon name="discard" size={12} />
            撤回
          </button>
        )}
      </div>
      {files.map((f) => {
        const from = moved[f.path]
        // Git 自己认出了改名（旧路径不在单子上）：加减行数是真的改了几行；没认出时那是整篇删了又加，不写
        const counts = !from || !listed.has(from)
        return (
          <div key={f.path} className={'fr' + (from ? ' renamed' : '')}>
            {from ? (
              <span className="truncate" title={`${from} → ${f.path}`}>
                <span className="was">{from}</span>
                <Codicon name="arrow-right" size={12} className="to" />
                {f.path}
              </span>
            ) : (
              <span className="truncate">{f.path}</span>
            )}
            <span className="k">{change.kinds[f.path] ?? (f.removed === 0 && f.added > 0 ? '新' : '改')}</span>
            {counts && <span className="num add">+{f.added}</span>}
            {counts && <span className="num del">−{f.removed}</span>}
          </div>
        )
      })}
      <div className="ft">
        {change.reverted ? '又做了一次反向提交，文件回到了AI改之前' : change.only ? '自动提交收进去的' : '已提交到main'}
        {onHistory && (
          <button className="lnk" onClick={onHistory}>
            在历史里看
          </button>
        )}
      </div>
    </div>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
