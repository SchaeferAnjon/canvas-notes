// iPhone / iPad 用这台 Mac 的 AI（task-wwqf0）：Mac 这头记着的（MobileStore）存了再读回来一样，钥匙落盘前加密，文件只有自己能读。
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { MobileStore } from '../src/main/mobile-ai/store'

/** 假的加密：前面加个记号、整串反过来（看得出加密过、解得回来） */
const cipher = { encrypt: (s: string) => Buffer.from('ENC:' + [...s].reverse().join('')), decrypt: (b: Buffer) => [...b.toString().slice(4)].reverse().join('') }

test('开没开、编号和钥匙、配对过的设备、端口：存了再读回来一样；私钥和设备钥匙不明文落盘，文件 0600；测试实例只放内存', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-mstore-'))
  const file = join(dir, 'state.json')
  try {
    const a = new MobileStore(file, cipher)
    a.setEnabled(true)
    const me = a.identity()
    a.setPort(51234)
    a.add({ id: 'dev1', name: '一飞冲天', kind: 'iPad', secret: Buffer.alloc(32, 9), pairedAt: 1000 })
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(me.keys.priv)
    expect(raw).not.toContain(Buffer.alloc(32, 9).toString('base64'))
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const b = new MobileStore(file, cipher)
    expect(b.enabled()).toBe(true)
    expect(b.identity()).toEqual(me)
    expect(b.lastPort()).toBe(51234)
    expect(b.device('dev1')).toMatchObject({ name: '一飞冲天', kind: 'iPad', pairedAt: 1000 })
    expect(b.device('dev1')!.secret.equals(Buffer.alloc(32, 9))).toBe(true)
    b.remove('dev1')
    expect(new MobileStore(file, cipher).devices()).toEqual([])
    const m = new MobileStore(null, null)
    m.setEnabled(true)
    expect(m.enabled()).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
