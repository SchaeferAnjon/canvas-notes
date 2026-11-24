/**
 * 2026-11-23 bge-m3 从 ONNX 版换成 GGUF 版（bge.ts），以前下的 ONNX 版留在同一个文件夹里没人用：
 * onnx/model_quantized.onnx 约 570 MB，外加 tokenizer.json 等三个小文件（约 17 MB）。
 * 打开软件后在后台挪进废纸篓（不直接删，用户还能捡回来）。只挪认得出是那一版的：大小和当年钉死的清单一模一样；
 * onnx 文件夹里只有那一个文件才整个文件夹挪，不然只挪那个文件。挪完就没了，下次打开什么也找不到，所以只做一次。
 * GGUF 那份（bge-m3-q8_0.gguf）和 verified.json 不碰。不依赖 Electron：挪的办法由调的人给（测试换成挪进临时文件夹）。
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** ONNX 版的清单（98be1dce 钉死的那一版） */
export const OLD_ONNX = { model: { file: 'onnx/model_quantized.onnx', size: 569694530 }, small: [
  { file: 'tokenizer.json', size: 17082821 },
  { file: 'tokenizer_config.json', size: 1173 },
  { file: 'config.json', size: 770 },
] }

const sizeOf = async (p: string): Promise<number> => {
  try {
    return (await stat(p)).size
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return -1
    throw e
  }
}

/** 挪走了的（相对 dir 的路径）；旧版的大文件不在（或大小不对，不是那一版）就什么也不挪 */
export async function trashOldOnnx(dir: string, toTrash: (abs: string) => Promise<void>): Promise<string[]> {
  if ((await sizeOf(join(dir, OLD_ONNX.model.file))) !== OLD_ONNX.model.size) return []
  const moved: string[] = []
  const onnx = join(dir, 'onnx')
  const inside = await readdir(onnx)
  if (inside.length === 1) {
    await toTrash(onnx)
    moved.push('onnx')
  } else {
    await toTrash(join(dir, OLD_ONNX.model.file))
    moved.push(OLD_ONNX.model.file)
  }
  for (const f of OLD_ONNX.small) {
    if ((await sizeOf(join(dir, f.file))) !== f.size) continue
    await toTrash(join(dir, f.file))
    moved.push(f.file)
  }
  return moved
}
