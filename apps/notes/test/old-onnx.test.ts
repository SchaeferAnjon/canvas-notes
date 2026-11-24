// 换成 GGUF 以后留下的 ONNX 版 bge-m3（约 570 MB）挪进废纸篓：只挪认得出是那一版的，GGUF 和别的不碰（大库提速）
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { OLD_ONNX, trashOldOnnx } from '../src/main/search/old-onnx'

let dir: string
let trashed: string[]
const toTrash = async (abs: string) => {
  trashed.push(abs.slice(dir.length + 1))
  rmSync(abs, { recursive: true })
}
/** 一个这么大的文件（稀疏文件，不真占盘） */
const sized = (rel: string, size: number) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true })
  const fd = openSync(join(dir, rel), 'w')
  ftruncateSync(fd, size)
  closeSync(fd)
}
const gguf = () => sized('bge-m3-q8_0.gguf', 1000)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-onnx-'))
  trashed = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('旧版整份都在：onnx 文件夹和三个小文件挪走，GGUF 和 verified.json 留着；再跑一次什么也不挪', async () => {
  gguf()
  writeFileSync(join(dir, 'verified.json'), '{}')
  sized(OLD_ONNX.model.file, OLD_ONNX.model.size)
  for (const f of OLD_ONNX.small) sized(f.file, f.size)
  expect(await trashOldOnnx(dir, toTrash)).toEqual(['onnx', 'tokenizer.json', 'tokenizer_config.json', 'config.json'])
  expect(trashed).toEqual(['onnx', 'tokenizer.json', 'tokenizer_config.json', 'config.json'])
  expect(readdirSync(dir).sort()).toEqual(['bge-m3-q8_0.gguf', 'verified.json'])
  expect(await trashOldOnnx(dir, toTrash)).toEqual([])
})

it('onnx 文件夹里还有别的：只挪那个大文件', async () => {
  sized(OLD_ONNX.model.file, OLD_ONNX.model.size)
  sized('onnx/别的.onnx', 10)
  expect(await trashOldOnnx(dir, toTrash)).toEqual([OLD_ONNX.model.file])
  expect(existsSync(join(dir, 'onnx', '别的.onnx'))).toBe(true)
})

it('大小对不上（不是那一版）或没有：一个都不挪', async () => {
  gguf()
  sized(OLD_ONNX.model.file, OLD_ONNX.model.size - 1)
  for (const f of OLD_ONNX.small) sized(f.file, f.size)
  expect(await trashOldOnnx(dir, toTrash)).toEqual([])
  rmSync(join(dir, 'onnx'), { recursive: true })
  expect(await trashOldOnnx(dir, toTrash)).toEqual([])
  expect(await trashOldOnnx(join(dir, '没有这个文件夹'), toTrash)).toEqual([])
  expect(trashed).toEqual([])
})

it('小文件大小对不上的留着', async () => {
  sized(OLD_ONNX.model.file, OLD_ONNX.model.size)
  sized('tokenizer.json', 5)
  expect(await trashOldOnnx(dir, toTrash)).toEqual(['onnx'])
  expect(existsSync(join(dir, 'tokenizer.json'))).toBe(true)
})
