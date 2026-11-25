/**
 * Mac 这一头记着的（task-wwqf0）：开没开、这台 Mac 的编号和长期钥匙、配对过的设备、上次用的端口。
 * 存在软件设置目录 mobile-ai/state.json；私钥和每台设备的钥匙加密后才落盘（Electron safeStorage，加密钥匙在这台 Mac 的钥匙串里，
 * 和翻译 API 的 Key 同一个做法，见 @cn/ai-engines 的 keys.ts）。不进库、不进 Git。
 *
 * 为什么 Mac 这头不放 iCloud 钥匙串：查过（2026-11-22），Developer ID 签名的软件要用数据保护钥匙串（iCloud 同步的项都在这里）
 * 得有带「钥匙串共享」的 provisioning profile 和 keychain-access-groups 权限，Electron 也没有读写同步项的接口（要另写原生模块）；
 * 现在发的包只有 Developer ID 签名、不带 profile，本机自己打的包是临时签名，都用不了。所以 Mac 只存本机，
 * iPhone / iPad 那头存进 iCloud 钥匙串（同一个 Apple 账号的 iPad 和 iPhone 配一次都能用）。
 * 加密由外面给（测试实例 file、cipher 为 null：只放内存，不碰真的钥匙串）；这个文件不碰 Electron。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { b64u, type KeyPair, newKeyPair } from './protocol'
import type { Device } from './server'
import { atomicWriteSync } from '@cn/atomic'

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

interface Saved {
  v: 1
  on: boolean
  id: string
  pub: string
  /** 私钥（加密后 base64） */
  priv: string
  port: number | null
  devices: { id: string; name: string; kind: string; secret: string; pairedAt: number; lastSeen: number | null; noFull?: boolean }[]
}

export class MobileStore {
  private file: string | null
  private cipher: Cipher | null
  private on = false
  private me: { id: string; keys: KeyPair } | null = null
  private port: number | null = null
  private list: Device[] = []
  private savedSeen = 0

  /** file 或 cipher 为 null：只放内存（端到端测试） */
  constructor(file: string | null, cipher: Cipher | null) {
    this.file = file
    this.cipher = cipher
    if (!file || !cipher) return
    let raw: Saved
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as Saved
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    this.on = raw.on === true
    this.port = typeof raw.port === 'number' ? raw.port : null
    if (typeof raw.id === 'string' && typeof raw.pub === 'string' && typeof raw.priv === 'string') {
      this.me = { id: raw.id, keys: { pub: raw.pub, priv: cipher.decrypt(Buffer.from(raw.priv, 'base64')) } }
    }
    for (const d of raw.devices ?? []) {
      if (typeof d?.id !== 'string' || typeof d.secret !== 'string') continue
      this.list.push({ id: d.id, name: String(d.name ?? ''), kind: String(d.kind ?? ''), secret: Buffer.from(cipher.decrypt(Buffer.from(d.secret, 'base64')), 'base64'), pairedAt: Number(d.pairedAt) || 0, ...(d.lastSeen ? { lastSeen: d.lastSeen } : {}), ...(d.noFull === true ? { noFull: true } : {}) })
    }
  }

  enabled(): boolean {
    return this.on
  }

  setEnabled(on: boolean) {
    this.on = on
    this.save()
  }

  /** 这台 Mac 的编号和长期钥匙：第一次用时生成，之后一直是这一对（换了的话配对过的设备都得重配） */
  identity(): { id: string; keys: KeyPair } {
    if (!this.me) {
      this.me = { id: b64u(randomBytes(9)), keys: newKeyPair() }
      this.save()
    }
    return this.me
  }

  lastPort(): number | null {
    return this.port
  }

  setPort(p: number) {
    if (this.port === p) return
    this.port = p
    this.save()
  }

  devices(): Device[] {
    return this.list
  }

  device(id: string): Device | undefined {
    return this.list.find((d) => d.id === id)
  }

  add(d: Device) {
    this.list = [...this.list.filter((x) => x.id !== d.id), d]
    this.save()
  }

  /** 手机全能模式：这台设备能不能用（设置里那颗开关） */
  setFull(id: string, on: boolean) {
    const d = this.device(id)
    if (!d) return
    if (on) delete d.noFull
    else d.noFull = true
    this.save()
  }

  remove(id: string) {
    this.list = this.list.filter((d) => d.id !== id)
    this.save()
  }

  /** 最后一次来问的时间：一分钟最多落一次盘 */
  seen(id: string, at: number) {
    const d = this.device(id)
    if (!d) return
    d.lastSeen = at
    if (at - this.savedSeen > 60_000) {
      this.savedSeen = at
      this.save()
    }
  }

  private save() {
    if (!this.file || !this.cipher) return
    const enc = (s: string) => this.cipher!.encrypt(s).toString('base64')
    const me = this.identity()
    const out: Saved = {
      v: 1,
      on: this.on,
      id: me.id,
      pub: me.keys.pub,
      priv: enc(me.keys.priv),
      port: this.port,
      devices: this.list.map((d) => ({ id: d.id, name: d.name, kind: d.kind, secret: enc(d.secret.toString('base64')), pairedAt: d.pairedAt, lastSeen: d.lastSeen ?? null, ...(d.noFull ? { noFull: true } : {}) })),
    }
    mkdirSync(dirname(this.file), { recursive: true })
    atomicWriteSync(this.file, JSON.stringify(out), { mode: 0o600 })
  }
}
