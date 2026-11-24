/**
 * 设置 › 回答下面那排（task-eavzx，款式页「62-回答按钮款式」第二版 r2-settings / r2-edit，照「选中小条」那两页做）：
 * - 「这一排现在是这样」：AI 对话 / 读 PDF / 网页 / 视频分段看，拿真的 AnswerBar 画在一句示例回答下面；下面一行写 ⋯ 里有什么；
 * - 「功能按钮」：拷贝 · 插进文档 · ⋯ 固定在左边，只列不改；
 * - 「快捷回复」：和选中小条同一种能拖的三段表（排上，不设上限、放不下的自动进 ⋯ / 收进 ⋯ / 不出现），每行我的 / 自带、在哪出现、键、⋯；
 *   上面「从我的命令里挑…」「加一颗」；
 * - 编辑一颗：名字、提示词（+ 这条回答 这些空、例子、AI 收到的样子）、在哪答、快捷键、在哪能用、放在哪段、存在哪；
 * - 「回答里选中一句」：自己的 AI 命令每条一个勾，勾着的列在 AI 回答里选中一句弹的小菜单「问这句」下面（命令.json 的 answerSel，默认都勾着）。
 * 一颗快捷回复就是命令库里的一条命令（存好以后 ⌘K、/ 菜单也叫得到）。改了马上存，底下「已存 · 撤回」。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { AnswerBar, type AbAct, type AbMenuItem } from '@cn/ai-chat/answer-bar'
import { PageHead as BasePageHead, useSaid } from '@cn/design/settings'
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { type AiCmd, rulesOfPrompt } from '../../shared/ai-cmds'
import { setKey, swapKey } from '../../shared/commands'
import { t as tNow } from '../../shared/i18n'
import { ANSWER_SEL_CAP, answerSelOn, dropReply, fillReply, moveReply, REPLY_PLACES, setAnswerSel, REPLY_VARS, type ReplyConfig, replyItem, type ReplyOut, type ReplyPlace, type ReplyVar, type ReplyZone, SAY_MAX, zoneOfReply } from '../../shared/replies'
import { deleteAiCmd, localAiCmds, saveAiCmd, setLocalAiCmds } from '../commands/store'
import { AiIcon } from '../engine-logo'
import { useT } from '../i18n'
import { availNow, keyFor, withKeys } from '../keys'
import { onRepliesRequest, type OpenReplies, newReplyCmd, replyNameMax, replyOwnsOf, repliesRequestNow, replyView, saveReply, sayOf, updateReplies, useReplyTable } from '../replies/store'
import { cmdConfig, updateCmds, useCmds } from '../search/cmd-store'
import { Ico, KeyRow, type KeyMode, Pop, SmallSeg, ZoneList } from './sb-kit'
import './replies.css'

type T = ReturnType<typeof useT>

const ZONES: readonly ReplyZone[] = ['on', 'more', 'off']

/** 那句里「这条回答」那个空照界面语言怎么写（点「+ 这条回答」、例子里放的那个） */
export const answerToken = () => (tNow('这条回答') === '这条回答' ? '{这条回答}' : '{this answer}') // 不翻：那句里的占位，存进文件

/** 预览、「AI 收到的样子」用的示例回答（每一处一句） */
const SAMPLE: Record<ReplyPlace, string> = {
  chat: '这是一条回答：先说结论，再举一个例子……', // 不翻：画的地方 t()
  pdf: '这是讲解（第 1 页）……', // 不翻
  web: '这是讲解（网页上这一段）……', // 不翻
  video: '这是讲解（12:30 这一刻）……', // 不翻
}

/** 示例回答把空都填上（那句里 {你问的那句}、{第几页}、{看得到的材料} 填什么） */
const sampleVars = (t: T, place: ReplyPlace): Record<ReplyVar, string> => ({
  answer: t(SAMPLE[place]),
  question: t('这一页在讲什么？'),
  page: place === 'pdf' ? '1' : '',
  material: place === 'pdf' ? t('《第3讲》第 1 页') : place === 'chat' ? '' : t('网页上你框的那一段'),
})

/** ⋯ 上面那一段在这一处有什么（宿主加的那几样照各处的样子写；存进收件箱在最后一组，r100） */
function menuOf(t: T, place: ReplyPlace): string[] {
  const mid = place === 'pdf' || place === 'web' ? [t('在笔记里看')] : place === 'video' ? [t('到 AI 对话里接着聊')] : []
  return [...mid, t('拷贝为 Markdown')]
}

/** 表里「在哪出现」那一格 */
function whereText(t: T, it: { note?: string; where: readonly ReplyPlace[] }): string {
  if (it.note) return t(it.note)
  if (it.where.length === 4) return t('四处都有')
  return REPLY_PLACES.filter(([k]) => it.where.includes(k))
    .map(([, n]) => t(n, { ctx: '在哪能用' }))
    .join(' · ')
}

/** 只当快捷回复用的（设置里加的、「存成快捷回复」存的）：删掉就删这条命令；从我的命令里挑的只拿掉快捷回复，命令留着 */
const onlyReply = (c: AiCmd) => c.where.length === 0

/** 已经处理过的那一次跳过来（设置关了又开，不再照旧的那一次开编辑页） */
let handled = 0

export function RepliesPage() {
  const t = useT()
  const said = useSaid()
  const { replies, mine } = useReplyTable()
  const req = useSyncExternalStore(onRepliesRequest, repliesRequestNow)
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [place, setPlace] = useState<ReplyPlace>(req?.o.place ?? 'pdf')
  const [flash, setFlash] = useState<{ id: string; seq: number } | null>(null)
  // 从回答里选中一句的小菜单「调整…」跳过来：列表滚到「回答里选中一句」那一节
  const [toSel, setToSel] = useState(0)

  // 从回答下面 ⋯「调整这一排…」、「存成快捷回复」小卡跳过来
  useEffect(() => {
    if (!req || req.seq === handled) return
    handled = req.seq
    if (req.o.place) setPlace(req.o.place)
    if (req.o.at === 'sel') setToSel(req.seq)
    if (req.o.view === 'edit') startDraft(req.o.id ?? null, req.o)
    else back()
  }, [req?.seq])

  function startDraft(id: string | null, o: Partial<OpenReplies> & { key?: boolean } = {}) {
    const c = id ? mine.find((x) => x.id === id) : undefined
    setDraft(
      c
        ? { id: c.id, name: c.name, say: sayOf(c), out: c.reply?.out ?? 'here', key: keyFor(c.id) ?? '', keyMode: null, where: c.reply?.where.length ? [...c.reply.where] : ['chat'], zone: zoneOfReply(replies, c.id) ?? 'on', store: c.store, rec: !!o.key, sel: answerSelOn(cmdConfig().answerSel, c.id) }
        : { id: null, name: o.preset?.name ?? '', say: o.preset?.say ?? '', out: 'here', key: '', keyMode: null, where: o.preset?.where.length ? [...o.preset.where] : ['chat', 'pdf', 'web', 'video'], zone: 'on', store: 'vault', rec: false, sel: true },
    )
    setView('edit')
  }
  function back() {
    setView('list')
    setDraft(null)
  }

  if (view === 'edit' && draft)
    return (
      <EditView
        t={t}
        mine={mine}
        draft={draft}
        place={place}
        setDraft={setDraft}
        onBack={back}
        onSaved={(id, hint, undo) => {
          back()
          setFlash({ id, seq: Date.now() })
          said.saved(hint, undo)
        }}
      />
    )
  return <ListView t={t} replies={replies} mine={mine} place={place} setPlace={setPlace} flash={flash} setFlash={setFlash} onEdit={startDraft} toSel={toSel} />
}

// ---------------------------------------------------------------- 列表

function ListView(props: {
  t: T
  replies: ReplyConfig
  mine: AiCmd[]
  place: ReplyPlace
  setPlace(p: ReplyPlace): void
  flash: { id: string; seq: number } | null
  setFlash(f: { id: string; seq: number } | null): void
  onEdit(id: string | null, o?: Partial<OpenReplies> & { key?: boolean }): void
  toSel: number
}) {
  const { t, replies, mine, place } = props
  const said = useSaid()
  const [menu, setMenu] = useState<{ kind: 'row'; id: string; at: DOMRect } | { kind: 'pick'; at: DOMRect } | null>(null)
  const owns = replyOwnsOf(mine)

  const item = (id: string) => replyItem(id, owns)
  const name = (id: string) => {
    const it = item(id)
    return it ? (it.mine ? it.name : t(it.name)) : id
  }
  const zn = (z: ReplyZone) => (z === 'on' ? t('排上') : z === 'more' ? t('⋯ 里') : t('不出现'))

  /** 改表，底下「已存 · {hint}」带撤回；改完那一行亮一下 */
  async function change(fn: (r: ReplyConfig) => ReplyConfig, hint: (r: ReplyConfig) => string, flashId: string) {
    const next = fn(replies)
    const undo = await updateReplies(() => next)
    said.saved(hint(next), () => void undo())
    props.setFlash({ id: flashId, seq: Date.now() })
  }

  function onMove(id: string, z: ReplyZone, idx: number) {
    void change(
      (r) => moveReply(r, id, z, idx),
      (r) => (z === 'on' ? t('「{name}」排在第 {n} 颗', { name: name(id), n: r.on.indexOf(id) + 1 }) : t('「{name}」挪到{zone}', { name: name(id), zone: zn(z) })),
      id,
    )
  }
  function move(id: string, z: ReplyZone) {
    setMenu(null)
    void change((r) => moveReply(r, id, z), () => t('「{name}」挪到{zone}', { name: name(id), zone: zn(z) }), id)
  }
  function toggleCk(id: string) {
    if (zoneOfReply(replies, id) === 'off') void change((r) => moveReply(r, id, 'on'), () => t('「{name}」又排上了', { name: name(id) }), id)
    else void change((r) => moveReply(r, id, 'off', 0), () => t('「{name}」不出现了', { name: name(id) }), id)
  }

  /** 删掉：只当快捷回复用的连命令一起删；从我的命令里挑的只是不再当快捷回复，命令留着 */
  async function remove(id: string) {
    const c = mine.find((x) => x.id === id)
    if (!c) return
    const before = cmdConfig()
    const beforeLocal = localAiCmds()
    if (onlyReply(c)) await deleteAiCmd(c)
    else {
      const { reply: _, ...rest } = c
      await saveAiCmd(rest)
    }
    await updateReplies((r) => dropReply(r, id))
    said.saved(onlyReply(c) ? t('已删掉「{name}」', { name: c.name }) : t('「{name}」不当快捷回复了，命令还在', { name: c.name }), () => {
      void updateCmds(() => before)
      void setLocalAiCmds(beforeLocal)
    })
  }

  /** 从我的命令里挑：排在这一排最后；在哪出现默认 AI 对话，命令本来能在 PDF、网页用的也勾上那几处 */
  async function pick(c: AiCmd) {
    setMenu(null)
    const where: ReplyPlace[] = ['chat', ...(c.where.includes('pdf') || c.where.includes('html') ? (['pdf'] as const) : []), ...(c.where.includes('web') ? (['web', 'video'] as const) : [])]
    const undo = await saveReply({ ...c, reply: { where, out: 'here' } }, 'on')
    props.setFlash({ id: c.id, seq: Date.now() })
    said.saved(t('「{name}」排在了这一排最后', { name: c.name }), () => void undo())
  }

  const zoneItems = (z: ReplyZone) => replies[z].flatMap((id) => item(id) ?? [])
  const notPicked = mine.filter((c) => !c.reply)
  const picked = mine.filter((c) => c.reply)
  const v = replyView(replies, mine, place)
  const acts: AbAct[] = [
    { id: 'copy', icon: 'copy', label: t('拷贝'), onClick: () => {} },
    { id: 'insert', icon: 'insert', label: t('插进文档'), onClick: () => {} },
  ]
  const fixedMenu: AbMenuItem[] = menuOf(t, place).map((label, i) => ({ id: 'm' + i, label, onClick: () => {} }))
  const moreNames = [...menuOf(t, place), ...v.more.map((b) => b.label), t('调整这一排…'), t('存进收件箱')]

  return (
    <div className="sb-page rp-page">
      <BasePageHead icon={<Codicon name="reply" size={18} />} title={t('回答下面那排')} desc={t('AI 回答下面那一排：左边的功能按钮固定；右边的快捷回复（点一下替你发一句）能加、改名、改词、排顺序、删')} />
      <div className="sa-grph">{t('这一排现在是这样')}</div>
      <div className="sb-prev rp-prev" data-testid="replies-preview">
        <div className="top">
          <span>{t('每处各配各的')}</span>
          <div className="sb-seg" role="radiogroup" aria-label={t('在哪')}>
            {REPLY_PLACES.map(([p, n]) => (
              <button key={p} type="button" role="radio" aria-checked={place === p} className={place === p ? 'on' : ''} onClick={() => props.setPlace(p)}>
                {t(n, { ctx: '在哪能用' })}
              </button>
            ))}
          </div>
        </div>
        <div className="rp-ans">{t(SAMPLE[place])}</div>
        <div className={'rp-bar' + (place === 'chat' ? '' : ' narrow')} inert>
          <AnswerBar
            acts={acts}
            menu={fixedMenu}
            replies={v.on.map((b) => ({ id: b.id, label: b.label, icon: b.icon === 'ai' ? 'logo' : (b.icon as CodiconName), onClick: () => {} }))}
            moreReplies={v.more.map((b) => ({ id: b.id, label: b.label, onClick: () => {} }))}
            logo={<AiIcon job="chat" size={12} />}
            text={{ more: t('这条回答还能做什么'), moreReplies: t('快捷回复（这一排放不下的）') }}
            on
            className="ans-acts"
            testId="replies-preview-bar"
          />
        </div>
        <div className="why">
          {t('⋯ 里：{names}', { names: moreNames.join(' · ') })}　{t('右栏窄时放不下的快捷回复按表的顺序进 ⋯')}
        </div>
      </div>

      <div className="sa-grph sb-gt">
        {t('功能按钮')}
        <span className="sub">{t('固定在左边，不能删、不能改')}</span>
      </div>
      <div className="sb-tbl rp-fixed" role="list" aria-label={t('功能按钮')} data-row="replyFixed">
        <FixedRow t={t} icon="copy" name={t('拷贝')} note={t('每条回答 · 一直在最左')} />
        <FixedRow t={t} icon="insert" name={t('插进文档')} note={t('每条回答 · 中间没开文档时变淡')} />
        <FixedRow t={t} icon="ellipsis" name="⋯" note={t('里面：插进主对话 · 在笔记里看 · 拷贝为 Markdown · 存进收件箱')} />
      </div>

      <div className="sa-grph sb-gt">
        {t('快捷回复')}
        <span className="sub">{t('点一下替你发一句。按住把手拖着排；去掉勾就不出现')}</span>
        <span className="acts">
          <button type="button" className="sb-btn" onClick={(e) => setMenu({ kind: 'pick', at: e.currentTarget.getBoundingClientRect() })}>
            <Codicon name="bookmark" size={14} />
            {t('从我的命令里挑…')}
          </button>
          <button type="button" className="sb-btn" onClick={() => props.onEdit(null)}>
            <Codicon name="add" size={14} />
            {t('加一颗')}
          </button>
        </span>
      </div>
      <ZoneList
        t={t}
        label={t('快捷回复')}
        dataRow="replyList"
        offZone="off"
        flash={props.flash}
        ckTip={{ on: t('去掉勾：不出现'), off: t('勾上：排上') }}
        zones={ZONES.map((z) => ({
          z,
          title: z === 'on' ? t('排上') : z === 'more' ? t('收进 ⋯') : t('不出现'),
          head: <span className="cnt">{z === 'on' ? t('{n}颗 · 放不下的自动进 ⋯', { n: zoneItems(z).length }) : t('{n}颗', { n: zoneItems(z).length })}</span>,
          empty: z === 'on' ? t('拖到这里') : z === 'more' ? t('拖到这里，点了 ⋯ 才看得到') : t('拖到这里，或去掉勾'),
        }))}
        rows={(z) => zoneItems(z).map((it) => ({ id: it.id, label: it.mine ? it.name : t(it.name), icon: it.icon, mine: it.mine, where: whereText(t, it), key: it.mine ? keyFor(it.id) : null }))}
        onMove={onMove}
        onToggle={toggleCk}
        onMenu={(id, at) => setMenu({ kind: 'row', id, at })}
      />
      <div className="sb-fall">{t('「调整这一排…」「存进收件箱」固定在 ⋯ 最后，不在这张表里。自带的能挪、能收、能藏，字不能改；要改就「复制一份再改」。')}</div>

      <SelList t={t} mine={mine} toSel={props.toSel} />

      {menu?.kind === 'row' && <RowMenu t={t} replies={replies} mine={mine} id={menu.id} at={menu.at} onClose={() => setMenu(null)} onMove={(z) => move(menu.id, z)} onEdit={props.onEdit} onDelete={() => void remove(menu.id)} />}
      {menu?.kind === 'pick' && (
        <Pop at={menu.at} width={420} onClose={() => setMenu(null)} className="sb-pick" label={t('从我的命令里挑')}>
          <div className="ph">{withKeys(t('「存成命令」存下的、还没当快捷回复的。放上以后点一下就把它的规矩当一句话发出去；{k:search}、/ 菜单里照旧叫得到。'))}</div>
          {notPicked.map((c) => (
            <div className="pr" key={c.id}>
              <span className="ico">
                <AiIcon job="chat" size={16} />
              </span>
              <div className="nm">
                <b>{c.name}</b>
                <span>
                  <SayText t={t} say={c.desc} />
                </span>
              </div>
              <button type="button" className="sb-btn" onClick={() => void pick(c)}>
                {t('放上这一排')}
              </button>
            </div>
          ))}
          {picked.map((c) => (
            <div className="pr" key={c.id}>
              <span className="ico">
                <AiIcon job="chat" size={16} />
              </span>
              <div className="nm">
                <b>{c.name}</b>
                <span>
                  <SayText t={t} say={c.desc} />
                </span>
              </div>
              <span className="st">{zoneOfReply(replies, c.id) === 'on' ? t('已排上') : zoneOfReply(replies, c.id) === 'more' ? t('已在 ⋯ 里') : t('已在「不出现」里')}</span>
            </div>
          ))}
          {!mine.length && <div className="ph">{t('还没存过命令：在 AI 对话里调出满意的样子后点「存成命令」')}</div>}
        </Pop>
      )}
    </div>
  )
}

/**
 * 「回答里选中一句」：自己的 AI 命令每条一个勾（默认勾着），勾着的列在 AI 回答里选中一句的小菜单「问这句」下面，
 * 照这里的先后露前 4 条、其余在「更多…」。改了马上存，底下「已存 · 撤回」
 */
function SelList({ t, mine, toSel }: { t: T; mine: AiCmd[]; toSel: number }) {
  const said = useSaid()
  const cfg = useCmds()
  const ref = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (!toSel) return
    ref.current?.scrollIntoView({ block: 'start' })
    setFlash(toSel)
  }, [toSel])
  async function toggle(c: AiCmd) {
    const on = !answerSelOn(cfg.answerSel, c.id)
    const before = await updateCmds((x) => ({ ...x, answerSel: setAnswerSel(x.answerSel, c.id, on) }))
    said.saved(on ? t('「{name}」会出现在回答里选中一句的小菜单', { name: c.name }) : t('「{name}」不出现在回答里选中一句的小菜单了', { name: c.name }), () => void updateCmds((x) => ({ ...x, answerSel: before.answerSel })))
  }
  let n = 0
  return (
    <div ref={ref} className={'rp-selsec' + (flash ? ' sb-flash' : '')} key={flash} data-testid="replies-sel">
      <div className="sa-grph sb-gt">
        {t('回答里选中一句')}
        <span className="sub">{t('AI 回答里选中一句，小菜单「问这句」下面列出勾着的命令；点一条拿那句去跑，答在旁支里')}</span>
      </div>
      {mine.length ? (
        <div className="sb-tbl rp-sel">
          <div className="sb-zone" role="list" aria-label={t('回答里选中一句')}>
            {mine.map((c) => {
              const on = answerSelOn(cfg.answerSel, c.id)
              const shown = on && ++n <= ANSWER_SEL_CAP
              return (
                <div key={c.id} className={'sb-it' + (on ? '' : ' off')} role="listitem" aria-label={c.name}>
                  <span className={'sb-ck' + (on ? ' on' : '')} role="checkbox" aria-checked={on} aria-label={c.name} title={on ? t('去掉勾：不出现') : t('勾上：出现在小菜单')} onClick={() => void toggle(c)}>
                    {on && <Codicon name="check" size={12} />}
                  </span>
                  <span className="sb-ico">
                    <AiIcon job="chat" size={16} />
                  </span>
                  <span className="sb-n">{c.name}</span>
                  <span className="sb-tag mine">{t('我的')}</span>
                  <span className="sb-wh">{on ? (shown ? t('露着') : t('在「更多…」里')) : t('不出现')}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="sb-fall">{t('还没存过命令：在 AI 对话里调出满意的样子后点「存成命令」，或者上面「加一颗」')}</div>
      )}
      {mine.length > 0 && <div className="sb-fall">{t('照存的先后露前 {n} 条，其余在「更多…」里。新存的命令默认勾着。', { n: ANSWER_SEL_CAP })}</div>}
    </div>
  )
}

/** 那句里的空（{这条回答}）写成染色的小块、照界面语言（「从我的命令里挑」第二行） */
function SayText({ t, say }: { t: T; say: string }) {
  const re = new RegExp(`\\{(${REPLY_VARS.flatMap((v) => [v.zh, v.en]).join('|')})\\}`, 'g')
  const parts: ReactNode[] = []
  let last = 0
  for (const m of say.matchAll(re)) {
    parts.push(say.slice(last, m.index))
    const v = REPLY_VARS.find((x) => x.zh === m[1] || x.en === m[1])!
    parts.push(
      <mark key={m.index} className="rp-var">
        {t(v.zh)}
      </mark>,
    )
    last = m.index! + m[0].length
  }
  parts.push(say.slice(last))
  return <>{parts}</>
}

/** 功能按钮那张表的一行：没有把手、没有勾，标「固定」 */
function FixedRow({ t, icon, name, note }: { t: T; icon: CodiconName; name: string; note: string }) {
  return (
    <div className="sb-it rp-fx" role="listitem" aria-label={name}>
      <span className="sb-ico">
        <Codicon name={icon} size={16} />
      </span>
      <span className="sb-n">{name}</span>
      <span className="sb-tag">{t('固定')}</span>
      <span className="sb-wh">{note}</span>
    </div>
  )
}

/** 一行的 ⋯：编辑 / 复制一份再改、设快捷键、挪到哪段、删掉（自带的只能挪、藏、复制一份再改） */
function RowMenu(props: { t: T; replies: ReplyConfig; mine: AiCmd[]; id: string; at: DOMRect; onClose(): void; onMove(z: ReplyZone): void; onEdit(id: string | null, o?: Partial<OpenReplies> & { key?: boolean }): void; onDelete(): void }) {
  const { t, id } = props
  const it = replyItem(id, replyOwnsOf(props.mine))
  if (!it) return null
  const c = props.mine.find((x) => x.id === id)
  const z = zoneOfReply(props.replies, id)
  const label = it.mine ? it.name : t(it.name)
  const k = it.mine ? keyFor(id) : null
  const close = (f: () => void) => () => {
    props.onClose()
    f()
  }
  const copyOf = () => props.onEdit(null, { preset: { name: label.slice(0, replyNameMax()), say: it.mine ? it.say : t(it.say), where: [...it.where] } })
  return (
    <Pop at={props.at} width={220} onClose={props.onClose} label={t('这一颗还能…')}>
      {it.mine && (
        <button type="button" role="menuitem" onClick={close(() => props.onEdit(id))}>
          <Codicon name="edit" size={14} />
          {t('编辑…')}
        </button>
      )}
      <button type="button" role="menuitem" onClick={close(copyOf)}>
        <Codicon name="copy" size={14} />
        {t('复制一份再改…')}
      </button>
      <button type="button" role="menuitem" disabled={!it.mine} onClick={close(() => props.onEdit(id, { key: true }))}>
        <Codicon name="record-keys" size={14} />
        {t('设快捷键…')}
        <span className="r">{k ?? ''}</span>
      </button>
      <div className="ms" />
      {ZONES.filter((x) => x !== z).map((x) => (
        <button key={x} type="button" role="menuitem" onClick={() => props.onMove(x)}>
          <Codicon name={x === 'on' ? 'arrow-right' : x === 'more' ? 'fold-down' : 'eye-closed'} size={14} />
          {x === 'on' ? t('排上') : x === 'more' ? t('收进 ⋯') : t('不出现')}
        </button>
      ))}
      {c && (
        <>
          <div className="ms" />
          <button type="button" role="menuitem" className="red" onClick={close(props.onDelete)}>
            <Codicon name="trash" size={14} />
            {onlyReply(c) ? t('删掉') : t('不当快捷回复了')}
          </button>
        </>
      )}
    </Pop>
  )
}

// ---------------------------------------------------------------- 编辑一颗

interface Draft {
  id: string | null
  name: string
  say: string
  out: ReplyOut
  key: string
  keyMode: KeyMode
  where: ReplyPlace[]
  zone: ReplyZone
  store: 'vault' | 'local'
  /** 一进来就在按新键 */
  rec: boolean
  /** AI 回答里选中一句的小菜单里也列出（命令.json 的 answerSel，新的默认勾着） */
  sel: boolean
}

// 不翻：名字、那句是键（画的地方 t()），那句里的 {v} 换成「这条回答」那个空
const SUGS: readonly (readonly [string, string, string])[] = [
  ['考考我', '考考我', '就{v}出三道选择题考我，我答完再告诉我对错。'], // 不翻
  ['举个生活里的例子', '举个例子', '举一个生活里的例子，讲讲{v}说的事。'], // 不翻
  ['用英文再讲一遍', '英文再讲', '用英文把{v}再讲一遍，句子短一点。'], // 不翻
]

function EditView(props: { t: T; mine: AiCmd[]; draft: Draft; place: ReplyPlace; setDraft(d: Draft): void; onBack(): void; onSaved(id: string, hint: string, undo: () => void): void }) {
  const { t, draft: d } = props
  const [rec, setRec] = useState(d.rec)
  const nameIn = useRef<HTMLInputElement>(null)
  const sayIn = useRef<HTMLTextAreaElement>(null)
  const set = (p: Partial<Draft>) => props.setDraft({ ...d, ...p })
  const ok = !!d.name.trim() && !!d.say.trim() && d.where.length > 0

  useEffect(() => {
    if (!d.id && !d.rec) nameIn.current?.focus()
  }, [])

  // ⌘↵ 存好（按新键时不算）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (rec || e.key !== 'Enter' || !e.metaKey) return
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function insertVar(name: string) {
    const ta = sayIn.current
    if (!ta) return
    const v = `{${name}}`
    const a = ta.selectionStart ?? ta.value.length
    const b = ta.selectionEnd ?? a
    set({ say: (ta.value.slice(0, a) + v + ta.value.slice(b)).slice(0, SAY_MAX) })
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = a + v.length
    })
  }

  async function save() {
    if (!ok) return
    const before = cmdConfig()
    const beforeLocal = localAiCmds()
    const old = d.id ? props.mine.find((x) => x.id === d.id) : undefined
    const name = d.name.trim().slice(0, replyNameMax())
    const say = d.say.trim().slice(0, SAY_MAX)
    const reply = { where: d.where, out: d.out }
    let c: AiCmd
    if (old) {
      // 从我的命令里挑的、那句没动：规矩原样留着（依据、勾掉的那几条不丢），不另写那句
      const keep = !old.prompt && say === sayOf(old)
      const rules = rulesOfPrompt(say)
      c = {
        ...old,
        name,
        store: d.store,
        reply,
        ...(keep ? {} : { prompt: say, rules: rules.length ? rules : [{ t: name }] }),
        ...(onlyReply(old) ? { desc: say.split('\n')[0]!.slice(0, 120) } : {}),
      }
    } else c = newReplyCmd({ name, say, where: d.where, out: d.out, store: d.store })
    await saveAiCmd(c)
    await updateReplies((r) => (zoneOfReply(r, c.id) === d.zone ? r : moveReply(r, c.id, d.zone)))
    if (d.sel !== answerSelOn(cmdConfig().answerSel, c.id)) await updateCmds((cfg) => ({ ...cfg, answerSel: setAnswerSel(cfg.answerSel, c.id, d.sel) }))
    // 键记进命令表：撞了的「换给这一条」（别的那条让出来）或「两个对调」
    if ((d.key || null) !== keyFor(c.id)) {
      const avail = availNow()
      await updateCmds((cfg) => (d.key ? (d.keyMode === 'swap' ? swapKey(cfg, avail, c.id, d.key) : setKey(cfg, avail, c.id, d.key)) : setKey(cfg, avail, c.id, null)))
    }
    const hint = old
      ? t('「{name}」改好了', { name })
      : d.zone === 'on'
        ? t('「{name}」排在了这一排最后', { name })
        : d.zone === 'more'
          ? t('「{name}」收进了 ⋯', { name })
          : t('「{name}」存好了，先不出现', { name })
    props.onSaved(c.id, hint, () => {
      void updateCmds(() => before)
      void setLocalAiCmds(beforeLocal)
    })
  }

  const vars = sampleVars(t, props.place)
  return (
    <div className="sb-page sb-edit rp-page">
      <button type="button" className="sb-back" onClick={props.onBack}>
        <Codicon name="chevron-left" size={14} />
        {t('回答下面那排')}
      </button>
      <BasePageHead icon={<AiIcon job="chat" size={18} />} title={d.id ? d.name || t('改一颗快捷回复') : t('新的一颗快捷回复')} desc={withKeys(t('点一下替你在这段对话里发一句；它也是一条命令，{k:search}、AI 输入框打 / 也叫得到'))} />
      <div className="sb-tbl" role="group" aria-label={t('快捷回复这一颗')}>
        <div className="sb-row">
          <div className="nm">
            <b>{t('名字')}</b>
            <span>{t('回答下面那排就写这几个字；{n} 个字以内', { n: replyNameMax() })}</span>
          </div>
          <div className="rc">
            <input ref={nameIn} className="sb-input" style={{ width: 300 }} value={d.name} maxLength={replyNameMax()} aria-label={t('名字')} placeholder={t('比如：考考我')} onChange={(e) => set({ name: e.currentTarget.value })} />
          </div>
        </div>
        <div className="sb-row col">
          <div className="nm">
            <b>{t('提示词')}</b>
            <span>{t('点了替你发出去的那句话。点下面的词把它放进去')}</span>
          </div>
          <textarea ref={sayIn} className="sb-input" value={d.say} aria-label={t('提示词')} placeholder={t('比如：就{v}出三道选择题考我', { v: answerToken() })} onChange={(e) => set({ say: e.currentTarget.value.slice(0, SAY_MAX) })} />
          <div className="sb-chips">
            {REPLY_VARS.map((v) => (
              <button
                key={v.key}
                type="button"
                className="sb-chip var"
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertVar(tNow(v.zh) === v.zh ? v.zh : v.en)
                }}
              >
                <Codicon name="add" size={13} />
                {t(v.zh)}
              </button>
            ))}
          </div>
          <div className="sb-sug">
            {t('没想好？试试：')}
            {SUGS.map(([link, n, s]) => (
              <a key={link} role="button" tabIndex={0} onClick={() => set({ name: t(n), say: t(s, { v: answerToken() }) })}>
                {t(link)}
              </a>
            ))}
          </div>
          <div className="sb-fall">{t('发在这段对话里，AI 本来就看得到上面的回答；写了 {v} 就专指点的那一条。', { v: answerToken() })}</div>
          <div className="sb-sample" data-testid="replies-sample">
            <b>{t('AI 收到的样子')}</b>
            {t('（拿一条示例回答填好空给你看）')}
            <br />
            <Filled say={d.say} vars={vars} t={t} />
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('在哪答')}</b>
            <span>{d.out === 'here' ? t('接着在这段对话里答，和你自己打字发出去一样；读 PDF 时照样记进笔记') : t('在这条回答上开一条旁支问，主对话不变长')}</span>
          </div>
          <div className="rc">
            <SmallSeg
              label={t('在哪答')}
              value={d.out}
              options={[
                ['here', t('这段对话里')],
                ['side', t('开一条旁支')],
              ]}
              onChange={(v) => set({ out: v })}
            />
          </div>
        </div>
        <KeyRow
          t={t}
          value={d.key}
          mode={d.keyMode}
          rec={rec}
          setRec={setRec}
          self={d.id ?? 'own-new'}
          strict
          desc={withKeys(t('记进命令表；按了就在右栏 AI 对话里发这一句，{k:search} 里也叫得到'))}
          onChange={(key, keyMode) => set({ key, keyMode })}
        />
        <div className="sb-row">
          <div className="nm">
            <b>{t('在哪能用')}</b>
            <span>{t('勾了哪处，哪处能用：前四处在回答下面那排，「回答里选中一句」在选中后的小菜单里；至少勾一处')}</span>
          </div>
          <div className="rc wide">
            <div className="sb-chips nowrap" role="group" aria-label={t('在哪能用')}>
              {REPLY_PLACES.map(([p, n]) => {
                const on = d.where.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    className={'sb-chip' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? d.where.filter((x) => x !== p) : REPLY_PLACES.map(([k]) => k).filter((k) => k === p || d.where.includes(k))
                      set({ where: next.length ? next : [p] })
                    }}
                  >
                    {t(n, { ctx: '在哪能用' })}
                  </button>
                )
              })}
              <button type="button" className={'sb-chip' + (d.sel ? ' on' : '')} aria-pressed={d.sel} title={t('AI 回答里选中一句，小菜单「问这句」下面列出它')} onClick={() => set({ sel: !d.sel })}>
                {t('回答里选中一句')}
              </button>
            </div>
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('放在')}</b>
            <span>{t('排上的一眼看得到，放不下的自动进 ⋯；收进 ⋯ 的点了 ⋯ 才出来')}</span>
          </div>
          <div className="rc">
            <SmallSeg
              label={t('放在')}
              value={d.zone}
              options={[
                ['on', t('排上')],
                ['more', t('收进 ⋯')],
                ['off', t('不出现')],
              ]}
              onChange={(v) => set({ zone: v })}
            />
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('存在哪')}</b>
            <span>{d.store === 'vault' ? t('库里的 .canvas-notes/命令.json，跟 Git 走，换台 Mac 也在') : t('只在这台 Mac 的软件设置里')}</span>
          </div>
          <div className="rc">
            <SmallSeg
              label={t('存在哪')}
              value={d.store}
              options={[
                ['vault', t('存在库里')],
                ['local', t('只在这台 Mac')],
              ]}
              onChange={(v) => set({ store: v })}
            />
          </div>
        </div>
      </div>
      <div className="sb-foot">
        <span className="l">{d.id ? withKeys(t('改了以后这一排、{k:search}、/ 菜单一起变')) : t('存好就排在这一排最后')}</span>
        <button type="button" className="sb-btn ghost" onClick={props.onBack}>
          {t('取消')}
        </button>
        <button type="button" className="sb-btn solid" disabled={!ok} onClick={() => void save()}>
          <Codicon name="check" size={14} />
          {withKeys(t('存好 {k:submit}'))}
        </button>
      </div>
    </div>
  )
}

/** AI 收到的样子：空填好的地方染色（和真发出去时一样用 fillReply 填） */
function Filled(props: { say: string; vars: Record<ReplyVar, string>; t: T }) {
  const { t } = props
  if (!props.say.trim()) return <>{t('（还没写）')}</>
  const re = new RegExp(`\\{(${REPLY_VARS.flatMap((v) => [v.zh, v.en]).join('|')})\\}`, 'g')
  const parts: ReactNode[] = []
  let last = 0
  for (const m of props.say.matchAll(re)) {
    parts.push(props.say.slice(last, m.index))
    const v = fillReply(m[0], props.vars)
    if (v) parts.push(<mark key={m.index}>{v}</mark>)
    last = m.index! + m[0].length
  }
  parts.push(props.say.slice(last))
  return <>{parts}</>
}
