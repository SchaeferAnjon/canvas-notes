/**
 * 设置 › 读PDF › 划线颜色（ParaRead 联动，设计 20-pararead联动「划线颜色带含义」）：每种一行（点、名字、键），名字能改、能加减。
 * 含义表存在库里 .canvas-notes/划线颜色.json，ParaRead 读同一份。改名时问一次「把已写的 N 处一起改」（只换那几行的名字）；
 * 删一种：已划的那些变成「没分类」（灰色），线不删；「看不懂」写成问题段，不能删。
 */
import { Codicon } from '@cn/design'
import { addKind, CONFUSED, HL_DOT, type HlKind, kindName } from '@cn/format'
import { useEffect, useState } from 'react'
import * as R from '../reading/store'
import { useT } from '../i18n'
import { composing } from '../ime'
import { tv } from '../../shared/i18n'
import { useSaid } from './ui'

export function HlKinds(props: { onNotice(text: string): void }) {
  const t = useT()
  const said = useSaid()
  const kinds = R.useKinds()
  const [draft, setDraft] = useState<Record<string, string>>({})
  /** 改了名、库里已经写了几处：问一次要不要一起改 */
  const [ask, setAsk] = useState<{ key: string; name: string; n: number } | null>(null)
  useEffect(() => void R.loadKinds(true), [])

  const save = async (next: HlKind[], hint: string) => {
    const old = kinds
    try {
      R.setKinds(await window.cnReading.saveHlKinds(next))
      said.saved(hint, () => void window.cnReading.saveHlKinds(old).then(R.setKinds))
    } catch (e) {
      props.onNotice(String((e as Error).message ?? e))
    }
  }
  const rename = async (k: HlKind) => {
    const name = kindName(draft[k.key] ?? k.name)
    setDraft((d) => {
      const { [k.key]: _drop, ...rest } = d
      void _drop
      return rest
    })
    if (!name || name === k.name) return
    await save(
      kinds.map((x) => (x.key === k.key ? { ...x, name } : x)),
      t('「{old}」改叫「{name}」', { old: k.name, name }),
    )
    const n = k.key === CONFUSED ? 0 : await window.cnReading.hlCount(k.key)
    if (n > 0) setAsk({ key: k.key, name, n })
  }

  return (
    <div className="hlk" data-testid="hl-kinds">
      {kinds.map((k, i) => (
        <div key={k.key} className="hlk-row">
          <i className={k.key === CONFUSED ? 'wv' : ''} style={{ ['--hl' as string]: HL_DOT[k.color] }} />
          <input
            aria-label={t('第{n}种颜色的名字', { n: i + 1 })}
            value={draft[k.key] ?? k.name}
            maxLength={12}
            onChange={(e) => setDraft((d) => ({ ...d, [k.key]: e.target.value }))}
            onBlur={() => void rename(k)}
            onKeyDown={(e) => !composing(e) && e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {i < 9 && <kbd>{i + 1}</kbd>}
          {k.key === CONFUSED ? (
            <span className="hlk-note">{t('写成问题段')}</span>
          ) : (
            <button
              className="iconbtn"
              aria-label={t('删掉「{name}」', { name: k.name })}
              data-tip={t('删掉这种：已划的变成没分类，线不删')}
              onClick={() => void save(kinds.filter((x) => x.key !== k.key), t('删了「{name}」：已划的那些变成没分类', { name: k.name }))}
            >
              <Codicon name="close" size={12} />
            </button>
          )}
        </div>
      ))}
      {ask && (
        <div className="hlk-ask" data-testid="hl-rename-ask">
          <span>{t('库里已经写了{n}处，一起改成「{name}」？', { n: ask.n, name: ask.name })}</span>
          <button
            className="btn btn-xs"
            onClick={async () => {
              const a = ask
              setAsk(null)
              try {
                const n = await window.cnReading.hlRename(a.key, a.name)
                said.ok(t('笔记里{n}处一起改成了「{name}」', { n, name: a.name }))
              } catch (e) {
                props.onNotice(String((e as Error).message ?? e))
              }
            }}
          >
            {t('一起改')}
          </button>
          <button className="btn btn-xs" onClick={() => setAsk(null)}>
            {t('不改')}
          </button>
        </div>
      )}
      {kinds.length < 8 && (
        <button className="btn btn-sm hlk-add" onClick={() => void save(addKind(kinds, tv('新的一种')), t('加了一种颜色，名字能改'))}>
          <Codicon name="add" size={14} />
          {t('加一种')}
        </button>
      )}
    </div>
  )
}
