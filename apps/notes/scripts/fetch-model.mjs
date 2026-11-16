// 按意思搜用的本机小模型：multilingual-e5-small（MIT，intfloat 训练，Xenova 转成 ONNX 并量化成 int8），
// 下载到 apps/notes/resources/models/multilingual-e5-small/（不进 git），打包时 extraResources 带进安装包。
// 钉死版本和 sha256：同一个提交号、同一份文件，换了就报错。已经下好且校验对的不再下。
//   node apps/notes/scripts/fetch-model.mjs
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const REPO = 'Xenova/multilingual-e5-small'
const REV = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
const FILES = {
  'onnx/model_quantized.onnx': 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
  'tokenizer.json': '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  'tokenizer_config.json': null,
  'config.json': null,
}

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'models', 'multilingual-e5-small')

const sha256 = (p) =>
  new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(p)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej)
  })

for (const [file, want] of Object.entries(FILES)) {
  const out = join(dest, file)
  if (existsSync(out) && (!want || (await sha256(out)) === want)) continue
  mkdirSync(dirname(out), { recursive: true })
  const url = `https://huggingface.co/${REPO}/resolve/${REV}/${file}`
  process.stdout.write(`下载 ${file} … `)
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`${url} 回了 ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out + '.part'))
  if (want) {
    const got = await sha256(out + '.part')
    if (got !== want) {
      rmSync(out + '.part')
      throw new Error(`${file} 的 sha256 不对：${got}`)
    }
  }
  renameSync(out + '.part', out)
  console.log('好了')
}
console.log(`模型在 ${dest}`)
