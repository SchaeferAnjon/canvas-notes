/**
 * 内置插件在主进程这边的接口和运行：每个插件是一个 MainPlugin，主进程按它声明的权限给它一个 PluginHost。
 *
 * 界面调插件：window.cnPlugins.call(id, 方法, ...参数) → 'plugins:call'；网页预加载也走 'plugins:call'，
 * 但只能调注册时写了 page: true 的方法。插件关着时它的方法一律不让调。
 * 开关和设置存在 <userData>/plugins/state.json；插件自己的东西（缓存之类）放 <userData>/plugins/<id>/。
 */
import type { WebContents } from 'electron'
import type { CliId as EngineId } from '@cn/ai-engines/shared'
import type { PageState, PluginInfo, PluginManifest, PluginPermission } from '../../shared/plugins'
import type { Vault } from '../vault'

export interface CallContext {
  /** 谁调的：主窗口的界面，还是右栏某个网页的预加载 */
  from: 'app' | 'page'
  sender: WebContents
}

export type Handler = (ctx: CallContext, ...args: unknown[]) => unknown

/** 本机的 AI 命令行：在不在、登录没有（不真的问），问一次（不给工具） */
export interface CliBackend {
  state(id: EngineId): 'ok' | 'login' | 'missing'
  /** pick：只用这一家时设置里选的模型、想多久（不给：Claude Code 用 Haiku，别家用它自己的默认） */
  ask(id: EngineId, system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void, pick?: { model?: string; effort?: string }): Promise<string>
}

export interface PluginHost<S> {
  readonly id: string
  /** 这个插件自己的文件夹：<userData>/plugins/<id>/ */
  readonly dir: string
  settings(): S
  /** 插件现在开着没有（关掉时插件自己的钩子要放行，比如拦广告）*/
  enabled(): boolean
  /** 注册一个能被调的方法；page: true 时网页预加载也能调（默认只有界面能调） */
  handle(method: string, fn: Handler, opts?: { page?: boolean }): void
  /** 发一个事件给界面（window.cnPlugins.on(id, event, cb) 收） */
  emit(event: string, payload?: unknown): void
  /** 发一个事件给某个网页的预加载 */
  emitToPage(wc: WebContents, event: string, payload?: unknown): void
  /** 打开着的库：要声明「读笔记」或「写笔记」 */
  vault(): Vault
  /** 问一次快模型（不给工具）：要声明「联网」 */
  ai(system: string, prompt: string, signal: AbortSignal, onText?: (delta: string) => void): Promise<string>
  /** 用哪家 AI 答（设置页里显示） */
  aiLabel(): string
  /** 自己挑用哪个本机 AI 命令行（翻译）：要声明「联网」 */
  cli(): CliBackend
  /** 告诉界面库里的文件变了 */
  filesChanged(): void
  /** 退出前要做的（存缓存之类） */
  onQuit(fn: () => void): void
}

export interface MainPlugin<S = Record<string, unknown>> {
  manifest: PluginManifest
  /** 读出来的设置可能是旧的或被手改坏的：一项一项检查，不对的用默认值 */
  normalizeSettings(raw: unknown): S
  setup(host: PluginHost<S>): void
}

/** 主进程给插件的东西 */
export interface HostDeps {
  dir: string
  vault(): Vault | null
  ai(system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void): Promise<string>
  aiLabel(): string
  cli: CliBackend
  sendApp(channel: string, ...args: unknown[]): void
  filesChanged(): void
  onQuit(fn: () => void): void
}

interface State {
  enabled: Record<string, boolean>
  settings: Record<string, unknown>
}

interface Entry {
  plugin: MainPlugin<unknown>
  handlers: Map<string, { fn: Handler; page: boolean }>
}

/** 插件表：开关、设置、方法（不碰 Electron 的 ipc，好单独测） */
export class PluginRegistry {
  private entries = new Map<string, Entry>()
  private state: State

  constructor(
    private deps: HostDeps,
    private store: { read(): unknown; write(s: State): void },
  ) {
    const raw = (store.read() ?? {}) as Partial<State>
    this.state = {
      enabled: raw.enabled && typeof raw.enabled === 'object' ? { ...raw.enabled } : {},
      settings: raw.settings && typeof raw.settings === 'object' ? { ...raw.settings } : {},
    }
  }

  add<S>(plugin: MainPlugin<S>) {
    const id = plugin.manifest.id
    if (this.entries.has(id)) throw new Error(`插件 ${id} 已经有了`)
    const entry: Entry = { plugin: plugin as MainPlugin<unknown>, handlers: new Map() }
    this.entries.set(id, entry)
    const has = (p: PluginPermission) => plugin.manifest.permissions.includes(p)
    const deps = this.deps
    const host: PluginHost<S> = {
      id,
      dir: `${deps.dir}/${id}`,
      settings: () => this.settingsOf(id) as S,
      enabled: () => this.enabled(id),
      handle(method, fn, opts) {
        entry.handlers.set(method, { fn, page: !!opts?.page })
      },
      emit: (event, payload) => deps.sendApp('plugins:event', id, event, payload),
      emitToPage(wc, event, payload) {
        if (!wc.isDestroyed()) wc.send('plugins:page-event', id, event, payload)
      },
      vault() {
        if (!has('notes:read') && !has('notes:write')) throw new Error(`插件「${plugin.manifest.name}」没有声明读写笔记的权限`)
        const v = deps.vault()
        if (!v) throw new Error('还没有打开库')
        return v
      },
      ai(system, prompt, signal, onText = () => {}) {
        if (!has('net')) return Promise.reject(new Error(`插件「${plugin.manifest.name}」没有声明联网的权限`))
        return deps.ai(system, prompt, signal, onText)
      },
      aiLabel: () => deps.aiLabel(),
      cli() {
        if (!has('net')) throw new Error(`插件「${plugin.manifest.name}」没有声明联网的权限`)
        return deps.cli
      },
      filesChanged: () => deps.filesChanged(),
      onQuit: (fn) => deps.onQuit(fn),
    }
    plugin.setup(host)
  }

  private settingsOf(id: string): unknown {
    return this.entries.get(id)!.plugin.normalizeSettings(this.state.settings[id])
  }

  enabled(id: string): boolean {
    return this.entries.has(id) && this.state.enabled[id] !== false
  }

  list(): PluginInfo[] {
    return [...this.entries.values()].map(({ plugin }) => ({
      ...plugin.manifest,
      enabled: this.enabled(plugin.manifest.id),
      settings: this.settingsOf(plugin.manifest.id) as Record<string, unknown>,
    }))
  }

  pageState(): PageState {
    return Object.fromEntries(this.list().map((p) => [p.id, { enabled: p.enabled, settings: p.settings }]))
  }

  setEnabled(id: string, on: boolean): PluginInfo[] {
    this.need(id)
    this.state.enabled[id] = on
    this.store.write(this.state)
    return this.list()
  }

  setSettings(id: string, patch: Record<string, unknown>): PluginInfo[] {
    const e = this.need(id)
    const cur = this.settingsOf(id) as Record<string, unknown>
    this.state.settings[id] = e.plugin.normalizeSettings({ ...cur, ...patch })
    this.store.write(this.state)
    return this.list()
  }

  async call(ctx: CallContext, id: string, method: string, args: unknown[]): Promise<unknown> {
    const e = this.need(id)
    const h = e.handlers.get(method)
    if (!h) throw new Error(`插件「${e.plugin.manifest.name}」没有 ${method}`)
    if (ctx.from === 'page' && !h.page) throw new Error('网页里不能调这个')
    if (!this.enabled(id)) throw new Error(`插件「${e.plugin.manifest.name}」关着，先在插件面板里打开`)
    return h.fn(ctx, ...args)
  }

  private need(id: string): Entry {
    const e = typeof id === 'string' ? this.entries.get(id) : undefined
    if (!e) throw new Error('没有这个插件')
    return e
  }
}
