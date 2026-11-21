/**
 * 设置 › Git和同步（方向 A）：提交（署名、自动提交、历史里藏起软件自己的设置文件）、同步（远程地址、自动同步、
 * 打开库时先拉一次、退出前推一次、两边都改了同一篇怎么办）、不进Git的（库里的 .gitignore）、备份（每天一份 git bundle）。
 * 一页只有一颗黑色主按钮：远程地址存前是「保存」，存后是「现在同步」。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { AUTO_COMMIT_CHOICES } from '../../shared/appearance'
import { AUTO_SYNC_CHOICES, autoSyncLabel, type SyncPrefs } from '../../shared/prefs'
import { when } from '../../shared/when'
import { setHideInternal, useHideInternal } from '../history-hide'
import { Toggle, type SettingsProps } from '../Settings'
import { errText } from '../settings-ai'
import { Group, Lnk, Row, Sel, useSaid } from './ui'

/** 下次同步的时间：只写钟点（15:50） */
export const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

const commitLabel = (m: number) => (m === 0 ? '关' : m < 60 ? `每${m}分钟` : '每小时')

export function GitPage(props: SettingsProps) {
  const said = useSaid()
  const hide = useHideInternal()
  const sync = props.settings.sync
  const [plan, setPlan] = useState<{ lastSync: number | null; nextSync: number | null; syncError: { at: number; text: string } | null; hasRemote: boolean } | null>(null)
  const readState = () => window.cn.gitState().then((g) => setPlan({ lastSync: g.lastSync, nextSync: g.nextSync, syncError: g.syncError, hasRemote: g.hasRemote }))
  useEffect(() => {
    void readState()
  }, [sync.autoMinutes])
  const setSync = <K extends keyof SyncPrefs>(k: K, v: SyncPrefs[K], hint: string) => {
    const old = sync[k]
    if (old === v) return
    void props.onChange({ sync: { [k]: v } }).then(() => readState())
    said.saved(hint, () => void props.onChange({ sync: { [k]: old } }).then(() => readState()))
  }
  const min = props.settings.autoCommitMinutes
  return (
    <>
      <Group title="提交">
        <IdentityRow />
        <Row id="autoCommit">
          <Sel
            label="自动提交"
            value={min}
            options={AUTO_COMMIT_CHOICES.map((m) => [m, commitLabel(m)] as const)}
            onChange={(v) => {
              void props.onChange({ autoCommitMinutes: v }).then(props.onGitChanged)
              said.saved(v === 0 ? '不再自动提交；退出前照样提交' : `${commitLabel(v)}自动提交一次`, () => void props.onChange({ autoCommitMinutes: min }).then(props.onGitChanged))
            }}
          />
        </Row>
        <Row id="hideInternal">
          <Toggle
            on={hide}
            label="历史里藏起软件自己的设置文件"
            onChange={(v) => {
              setHideInternal(v)
              said.saved(v ? '历史里不列左栏、首页、置顶这些设置的改动；历史头上「⋯」是同一个开关' : '历史里也列出软件自己的设置文件', () => setHideInternal(!v))
            }}
          />
        </Row>
      </Group>
      <Group title="同步">
        <RemoteRow {...props} onSynced={() => void readState()} />
        <Row
          id="autoSync"
          desc={
            sync.autoMinutes === 0
              ? undefined
              : `同步 = 先提交，再拉，再推；${autoSyncLabel(sync.autoMinutes)}一次${plan?.nextSync ? `，下次 ${hhmm(plan.nextSync)}` : ''}${plan && !plan.hasRemote ? '（还没填远程地址，填好才同步）' : ''}`
          }
        >
          <Sel
            label="自动同步"
            value={sync.autoMinutes}
            options={AUTO_SYNC_CHOICES.map((m) => [m, autoSyncLabel(m)] as const)}
            onChange={(v) => setSync('autoMinutes', v, v === 0 ? '只在你点「同步」时联网' : `${autoSyncLabel(v).replace('每', '每隔')}同步一次 · 底栏「同步」旁会写下次的时间`)}
          />
        </Row>
        <Row id="pullOpen">
          <Toggle on={sync.pullOnOpen} label="打开库时先拉一次" onChange={(v) => setSync('pullOnOpen', v, v ? '下次打开这个库时先拉一次' : '打开库时不再先拉')} />
        </Row>
        <Row id="pushQuit">
          <Toggle on={sync.pushOnQuit} label="退出前推一次" onChange={(v) => setSync('pushOnQuit', v, v ? '退出前推一次，没网时照常退出' : '退出时不再推')} />
        </Row>
        <Row id="conflict" info />
      </Group>
      <Group title="不进Git的">
        <IgnoreRow />
      </Group>
      <Group title="备份">
        <BackupRow {...props} />
      </Group>
      <p className="sa-note">同步 = 先提交，再拉，再推。没设远程时，Git历史只在这台Mac上。</p>
    </>
  )
}

/**
 * 提交署名：每次提交记进历史的名字和邮箱。这台 Mac 上 git 没设时，打开库时软件按系统用户给这个库设了一个（main/git-identity.ts）；
 * 这里看得到、能改（只改这个库的 .git/config）
 */
function IdentityRow() {
  const said = useSaid()
  const [id, setId] = useState<{ name: string; email: string; local: boolean } | null | undefined>(undefined)
  const [draft, setDraft] = useState<{ name: string; email: string } | null>(null)
  /** 存不进去的原因（邮箱格式不对……）：写在框下面 */
  const [bad, setBad] = useState('')
  useEffect(() => void window.cn.gitIdentity().then(setId), [])
  async function save() {
    if (!draft) return
    try {
      setId(await window.cn.setGitIdentity(draft.name, draft.email))
      setDraft(null)
      setBad('')
      said.say('提交署名改好了，以后的提交用它')
    } catch (err) {
      setBad(errText(err))
    }
  }
  const cancel = () => (setDraft(null), setBad(''))
  const where = id === undefined ? '' : id?.local ? '写在这个库里，只用在这个库' : id ? '用的是这台Mac上Git的全局设置；改了只改这个库' : '填上后写在这个库里，只用在这个库'
  if (draft)
    return (
      <Row id="gitId" full desc={where} more={bad ? <div className="sa-kwarn" role="alert">{bad}</div> : undefined}>
        <form
          className="sa-inline"
          aria-label="改提交署名"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          onKeyDown={(e) => {
            // Esc 只收起这一行（第 5 轮：以前整个设置关掉，填的字丢了）
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
            cancel()
          }}
        >
          <input className="sa-fld id-name" aria-label="署名的名字" placeholder="名字" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          <input className="sa-fld" aria-label="署名的邮箱" aria-invalid={!!bad || undefined} placeholder="邮箱" value={draft.email} onChange={(e) => (setDraft({ ...draft, email: e.target.value }), setBad(''))} />
          <button className="sa-btn primary" type="submit" disabled={!draft.name.trim() || !draft.email.trim()}>
            保存
          </button>
          <button className="sa-btn ghost" type="button" onClick={cancel}>
            取消
          </button>
        </form>
      </Row>
    )
  return (
    <Row
      id="gitId"
      desc={
        <span data-testid="git-identity">
          {id === undefined ? (
            '正在读…'
          ) : id ? (
            <>
              {id.name} · {id.email} · {where}
            </>
          ) : (
            <>
              <i className="dot warn" />
              还没有，提交会失败 · {where}
            </>
          )}
        </span>
      }
    >
      <button className="sa-btn" type="button" disabled={id === undefined} onClick={() => setDraft({ name: id?.name ?? '', email: id?.email ?? '' })}>
        改
      </button>
    </Row>
  )
}

/** 远程地址：整行宽的框，存前「保存」、存后「现在同步」（这一页唯一的黑色主按钮）；框下面一句说存没存、上次同步怎样 */
function RemoteRow(props: SettingsProps & { onSynced(): void }) {
  const said = useSaid()
  const [remote, setRemote] = useState('')
  const typed = useRef(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<{ at: number; text: string } | null>(null)
  const readState = () =>
    window.cn.gitState().then((g) => {
      setLastSync(g.lastSync)
      setSyncError(g.syncError)
    })
  useEffect(() => {
    void window.cn.gitRemote().then((r) => {
      // 读回来之前已经在框里打了字：不拿读到的盖掉
      if (!typed.current) setRemote(r?.url ?? '')
      setSaved(r?.url ?? null)
    })
    void readState()
  }, [])
  const dirty = !!remote.trim() && remote.trim() !== saved
  async function save() {
    try {
      const r = await window.cn.setGitRemote(remote)
      setSaved(r?.url ?? null)
      said.say('远程地址存好了')
      props.onGitChanged()
    } catch (err) {
      said.say(errText(err))
    }
  }
  // 离开这一页（换到别的设置页、关上设置）时，填了没存的地址自动存
  const latest = useRef({ remote, dirty })
  latest.current = { remote, dirty }
  useEffect(
    () => () => {
      const { remote: url, dirty: unsaved } = latest.current
      if (!unsaved) return
      void window.cn.setGitRemote(url).then(
        () => (props.onNotice('远程地址存好了'), props.onGitChanged()),
        (err: unknown) => props.onNotice(errText(err)),
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const state = dirty ? (
    <>
      <i className="dot warn" />
      地址还没保存：按 <kbd>↵</kbd> 或点「保存」 · 离开这一页时也会自动存
    </>
  ) : saved && syncError ? (
    <>
      <i className="dot warn" />
      上次同步没成功（{when(syncError.at, { time: true })}）：{syncError.text}
    </>
  ) : saved ? (
    <>
      <i className="dot ok" />
      地址存好了 · {lastSync ? `上次同步${when(lastSync, { time: true })}` : '还没同步过：点「现在同步」推上去'}
    </>
  ) : (
    '还没有远程仓库：先填地址，再同步'
  )
  return (
    <Row id="remote" full desc={<span data-testid="git-remote-state">{state}</span>}>
      <form
        className="sa-inline"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) void save()
        }}
      >
        <input className="sa-fld mono" aria-label="远程地址" placeholder="比如git@github.com:你/笔记.git" value={remote} onChange={(e) => ((typed.current = true), setRemote(e.target.value))} />
        {saved && !dirty ? (
          <button
            type="button"
            className="sa-btn primary"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true)
              try {
                await props.onSync()
                await readState()
                props.onSynced()
              } finally {
                setSyncing(false)
              }
            }}
          >
            <Codicon name="sync" size={14} className={syncing ? 'spin' : undefined} />
            {syncing ? '正在同步' : '现在同步'}
          </button>
        ) : (
          <button type="submit" className="sa-btn primary" disabled={!dirty}>
            <Codicon name="save" size={14} />
            保存
          </button>
        )}
      </form>
    </Row>
  )
}

/** 不进Git的文件：库里的 .gitignore（每行一个规则），「编辑…」在这一行里改，存了算一次提交 */
function IgnoreRow() {
  const said = useSaid()
  const [text, setText] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => void window.cn.gitIgnore().then(setText), [])
  const rules = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const desc =
    text === null ? '正在读…' : rules.length ? `${rules.slice(0, 3).join('、')}${rules.length > 3 ? ` 等${rules.length}条` : ''} · 写在库里的 .gitignore；已经进了Git的照旧` : '还没有：库里的文件都进Git；写在库里的 .gitignore'
  if (draft !== null)
    return (
      <Row id="ignore" full desc="一行一条，比如 *.mp4、大文件夹/；已经进了Git的照旧留着">
        <form
          className="sa-inline"
          onSubmit={(e) => {
            e.preventDefault()
            void window.cn.setGitIgnore(draft).then(
              () => {
                setText(draft)
                setDraft(null)
                said.say('已存 · 不进Git的文件：.gitignore 改好了，提交了一次')
              },
              (err: unknown) => said.say(errText(err)),
            )
          }}
        >
          <textarea className="sa-fld mono" aria-label="不进Git的文件" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <button type="submit" className="sa-btn">
            保存
          </button>
          <button type="button" className="sa-btn ghost" onClick={() => setDraft(null)}>
            取消
          </button>
        </form>
      </Row>
    )
  return (
    <Row id="ignore" desc={desc}>
      <button type="button" className="sa-btn" disabled={text === null} onClick={() => setDraft(text ?? '')}>
        编辑…
      </button>
    </Row>
  )
}

/** 每天备份一份到：iCloud云盘或自己选的文件夹（外接盘），整个库的历史打成一个文件 */
function BackupRow(props: SettingsProps) {
  const said = useSaid()
  const s = props.settings.sync
  const [st, setSt] = useState<{ at: number | null; file: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void window.cn.backupState().then(setSt), [s.backup, s.backupDir])
  async function now() {
    setBusy(true)
    try {
      setSt(await window.cn.backupNow())
    } finally {
      setBusy(false)
    }
  }
  const value = s.backup
  const label = (v: SyncPrefs['backup']) => (v === 'off' ? '不备份' : v === 'icloud' ? 'iCloud云盘' : s.backupDir ? `${s.backupDir.split('/').pop()}（选的文件夹）` : '选文件夹…')
  // 「现在备一份」放在说明后面（不放在下拉旁边，右边那一列只有下拉）
  const desc =
    value === 'off' ? undefined : (
      <span data-testid="backup-state">
        {st?.error ? (
          <>
            <i className="dot warn" />
            上次没备成：{st.error}
          </>
        ) : busy ? (
          '正在备份…'
        ) : st?.at ? (
          `上次备份 · ${when(st.at, { time: true })} · ${st.file?.replace(/^\/Users\/[^/]+/, '~') ?? ''}`
        ) : (
          '还没备过'
        )}
        {!busy && <Lnk onClick={() => void now()}>现在备一份</Lnk>}
      </span>
    )
  return (
    <Row id="backup" desc={desc}>
      <Sel
        label="每天备份一份到"
        value={value === 'folder' ? 'folder' : value}
        options={[
          ['off', '不备份'],
          ['icloud', 'iCloud云盘'],
          ['folder', label('folder')],
        ]}
        onChange={async (v) => {
          const old = { backup: s.backup, backupDir: s.backupDir }
          if (v === 'folder') {
            // 选文件夹：系统选文件夹的框，取消了就照旧
            const dir = await window.cn.pickBackupDir()
            if (!dir) return
            await props.onChange({ sync: { backup: 'folder', backupDir: dir } })
          } else await props.onChange({ sync: { backup: v } })
          if (v !== 'off') void now()
          said.saved(v === 'off' ? '不再另存备份' : `每天备份一份到「${v === 'folder' ? '选的文件夹' : 'iCloud云盘'}」；现在先备一份`, () => void props.onChange({ sync: old }))
        }}
      />
    </Row>
  )
}
