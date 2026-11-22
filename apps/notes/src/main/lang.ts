/**
 * 界面语言和库语言的主进程这一半（task-zojmg，英文版设计稿第 1、4、5 节）。
 *
 * 界面语言：设置 › 一般 › 语言（settings.json 的 lang：system / zh / en），默认跟随系统（macOS 首选语言第一项：中文用简体中文，别的用 English）。
 * - 第一次打开（还没有 settings.json）记成「跟随系统」；已经在用的（有 settings.json、没记过语言）记成简体中文，升级不会突然变英文。
 * - 改了当场换：界面重画、菜单栏和菜单栏图标的菜单重建。系统自带的几处（编辑菜单、拼写、打开文件的对话框）启动时定，
 *   下次打开才换：启动时把语言交给浏览器内核（--lang），打好的包还写进本软件的 AppleLanguages。
 * - 测试：CN_LANG=en|zh 开局用这种（设置里一改就听设置的）；测试模式里「系统语言」是 CN_SYS_LANG（默认 zh-CN），不看这台 Mac。
 *
 * 库语言：建库时照当时的界面语言定，英文的记在库里的 .canvas-notes/库.json（跟着 Git 走）；没记的当中文（已有的库）。
 * 英文库的分类文件夹用英文名，软件写进文件的字（AI 讲解头这些）也用英文；之后切界面语言不动库。
 */
import { app, BrowserWindow, ipcMain, systemPreferences } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as git from '@cn/git'
import { isLangSetting, type Lang, LANG_NAMES, langOfLocale, type LangSetting, resolveLang, setUiLang, setVaultLang, t, tv, uiLang, vaultLang } from '../shared/i18n'
import type { LangInfo } from '../shared/i18n/api'
import '../shared/i18n/file-words'
import { E2E } from './test-mode'

/** 库里记库语言的文件（藏起来的配置文件名不跟语言换，设计稿第 4 节） */
export const VAULT_LANG_FILE = '.canvas-notes/库.json' // 不翻：库里的文件名

/**
 * 「语言」先藏着（2026-11-22 调度定：第一批跟 0.5.1 一起发，五批都翻完以前英文界面还会中英混着）：
 * false 时设置里没有「语言」那一行、设置搜索和 ⌘K 里也找不到，软件一律中文，不往 settings.json 记语言、不写 AppleLanguages。
 * 开发、测试时用环境变量打开：CN_LANG_SWITCH=1（和放出来以后一样），CN_LANG=en|zh（开局用这种，也算打开）。五批翻完把它改成 true
 */
export const LANG_SWITCH = false

interface Store {
  read(): object
  patch(p: object): void
}

let setting: LangSetting = 'system'
/** CN_LANG：测试开局用的语言，设置里改了就不再听它 */
let forced: Lang | null = null
let hour12 = false
let rebuild: () => void = () => undefined
/** 这一次打开能不能切语言（LANG_SWITCH，或开发、测试的环境变量） */
let available = false

/** 系统的首选语言（「跟随系统」用它） */
function systemLocale(): string {
  if (E2E) return process.env.CN_SYS_LANG || 'zh-CN'
  // 打好的包里写了本软件的 AppleLanguages（设置里选了中文或 English）：系统接口读到的是这一项，真正的系统语言要读全局那份
  if (app.isPackaged && setting !== 'system') {
    try {
      const out = execFileSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 2000 })
      const first = /"?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?/.exec(out.replace(/[()\s,]+/g, ' ').trim())?.[1]
      if (first) return first
    } catch (e) {
      console.error('读系统语言失败，用软件自己的', e)
    }
  }
  return app.getPreferredSystemLanguages()[0] ?? 'en'
}

/** 英文界面里钟点用不用 12 小时制：系统里明说了 24 / 12 小时制就照它，没说照地区（德国地区 24 小时，美国 12 小时） */
function systemHour12(): boolean {
  if (E2E) return process.env.CN_HOUR12 === '1'
  try {
    if (systemPreferences.getUserDefault('AppleICUForce24HourTime', 'boolean')) return false
    if (systemPreferences.getUserDefault('AppleICUForce12HourTime', 'boolean')) return true
    const region = /@rg=([a-z]{2})/i.exec(String(systemPreferences.getUserDefault('AppleLocale', 'string') ?? ''))?.[1]
    const loc = region ? `en-${region.toUpperCase()}` : app.getSystemLocale?.() || 'en-US'
    return new Intl.DateTimeFormat(loc, { hour: 'numeric' }).resolvedOptions().hour12 ?? false
  } catch (e) {
    console.error('读 12 / 24 小时制失败，用 24 小时制', e)
    return false
  }
}

/** 系统语言（藏着的时候用不上，不去读） */
const systemLang = (): Lang => (available ? langOfLocale(systemLocale()) : 'zh')
const effective = (): Lang => (!available ? 'zh' : (forced ?? resolveLang(setting, systemLang())))

export function langInfo(): LangInfo {
  const system = systemLang()
  return { lang: uiLang(), setting, system, systemName: LANG_NAMES[system], hour12, vault: vaultLang(), forced: !!forced, available }
}

/**
 * 启动时（app ready 之前）：读设置定界面语言，交给浏览器内核。userData 要先设好。
 * 界面一打开就同步要语言（预加载里 lang:get），所以这一项也在这里挂上
 */
export function startLang() {
  const file = join(app.getPath('userData'), 'settings.json')
  let stored: { lang?: unknown } | null = null
  let broken = false
  if (existsSync(file)) {
    // 坏了的 settings.json 交给读设置那一处（改名 .broken、记日志、按空的打开，task-pyb39），这里不能先抛错把启动卡死
    try {
      stored = JSON.parse(readFileSync(file, 'utf8')) as { lang?: unknown }
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e
      broken = true
    }
  }
  // 没记过：第一次打开跟随系统；已经在用（有设置文件，坏了也算）的照旧中文
  setting = isLangSetting(stored?.lang) ? stored.lang : stored || broken ? 'zh' : 'system'
  const env = process.env.CN_LANG
  forced = env === 'en' || env === 'zh' ? env : null
  available = LANG_SWITCH || process.env.CN_LANG_SWITCH === '1' || !!forced
  hour12 = systemHour12()
  const lang = effective()
  setUiLang(lang, { hour12 })
  app.commandLine.appendSwitch('lang', lang === 'en' ? 'en-US' : 'zh-CN')
  ipcMain.on('lang:get', (e) => (e.returnValue = langInfo()))
}

/** 本软件的 AppleLanguages：只在打好的包里写（开发版、测试是 Electron 自己的设置，所有开发中的 Electron 软件共用，不碰） */
function writeAppleLanguages() {
  if (!app.isPackaged || E2E) return
  if (setting === 'system') systemPreferences.removeUserDefault('AppleLanguages')
  else systemPreferences.setUserDefault('AppleLanguages', 'array', [setting === 'en' ? 'en' : 'zh-Hans'])
}

/**
 * 菜单栏的菜单：每一项的字照「菜单栏::原句」翻（macOS 菜单栏每个词首字母大写，和界面里同一句的写法不同）。
 * 系统的那几项（role，不带字的）不动：它们的字是 Electron、macOS 给的
 */
export function menuIn(items: Electron.MenuItemConstructorOptions[]): Electron.MenuItemConstructorOptions[] {
  return items.map((it) => ({
    ...it,
    ...(it.label ? { label: t(it.label, { ctx: '菜单栏' }) } : {}),
    ...(Array.isArray(it.submenu) ? { submenu: menuIn(it.submenu) } : {}),
  }))
}

function broadcast() {
  const info = langInfo()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lang:changed', info)
}

/** app ready 之后：记下第一次定的语言，接设置里的改动；rebuildMenus 重建菜单栏和菜单栏图标的菜单 */
export function setupLang(o: { settings: Store; rebuildMenus(): void }) {
  rebuild = o.rebuildMenus
  // 藏着的时候什么都不记：放出来以后，这段时间装上的照「已经在用的照旧中文」算
  if (available && !isLangSetting((o.settings.read() as { lang?: unknown }).lang)) o.settings.patch({ lang: setting })
  if (available) writeAppleLanguages()
  ipcMain.handle('lang:set', (_e, v: unknown) => {
    if (!available || !isLangSetting(v)) throw new Error(t('语言参数不对'))
    setting = v
    forced = null
    o.settings.patch({ lang: v })
    writeAppleLanguages()
    apply()
    return langInfo()
  })
}

/** 换了设置：界面语言变了就重建菜单；不管变没变都告诉各个窗口（设置里那一行要更新） */
function apply() {
  const lang = effective()
  if (lang !== uiLang()) {
    setUiLang(lang, { hour12 })
    rebuild()
  }
  broadcast()
}

// ---------- 库语言 ----------

export function readVaultLang(root: string): Lang {
  try {
    const v = (JSON.parse(readFileSync(join(root, VAULT_LANG_FILE), 'utf8')) as { 语言?: unknown }).语言
    return v === 'en' ? 'en' : 'zh'
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'zh'
    // 手改坏了、合并冲突：当中文（已有的库），照实记一句
    console.error('库语言读不出来，当中文', e)
    return 'zh'
  }
}

/** 库里除了 .git 这类藏起来的，什么都没有 */
const emptyVault = (root: string) => readdirSync(root).every((n) => n.startsWith('.'))

/**
 * 打开库时：定这个库的语言。新建的库（刚 git init、或是空文件夹）照现在的界面语言，英文的记进 库.json 单独提交一次；
 * 别的照库里记的，没记的当中文
 */
export async function settleVaultLang(root: string, fresh: boolean): Promise<Lang> {
  let lang = readVaultLang(root)
  if (lang === 'zh' && !existsSync(join(root, VAULT_LANG_FILE)) && (fresh || emptyVault(root)) && uiLang() === 'en') {
    lang = 'en'
    mkdirSync(join(root, '.canvas-notes'), { recursive: true })
    writeFileSync(join(root, VAULT_LANG_FILE), JSON.stringify({ 语言: 'en' }, null, 2) + '\n')
    setVaultLang('en')
    await git.commitPaths(root, [VAULT_LANG_FILE], tv('库语言：{name}', { name: LANG_NAMES.en })).catch((e) => console.error('库语言没提交上，下次自动提交带上', e))
  }
  setVaultLang(lang)
  broadcast()
  return lang
}
