import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {}, ipcMain: {} }))

const { readHome, writeHome } = await import('../src/main/home')
const { Vault } = await import('../src/main/vault')

const root = mkdtempSync(join(tmpdir(), 'cn-home-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('首页设置写盘', () => {
  it('先写临时文件再改名：边写边读永远读到完整的一份，写完不留临时文件', async () => {
    const v = new Vault(root)
    const dir = join(root, '.canvas-notes')
    let reads = 0
    let stop = false
    // 一边一直读，一边连写 30 次：任何一次读到的都要是能解析的 JSON
    const reader = (async () => {
      while (!stop) {
        try {
          JSON.parse(readFileSync(join(dir, '首页.json'), 'utf8'))
          reads++
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        }
        await new Promise((r) => setImmediate(r))
      }
    })()
    for (let i = 0; i < 30; i++) await writeHome(v, { coverY: i })
    stop = true
    await reader
    expect(reads).toBeGreaterThan(0)
    expect((await readHome(v)).coverY).toBe(29)
    expect(readdirSync(dir)).toEqual(['首页.json'])
  })
})
