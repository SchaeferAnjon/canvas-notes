// 公开导出的最后一道检查：dispatch env 里存着的值有没有出现在导出的文件里。画布笔记、画布今日、ParaRead、MeetCaption（以后画布订阅）的
// public-export.mjs 都用这一份，导出和 --check 都跑。只比对，值留在这个进程的内存里：不打印、不写文件、不当命令行参数传给别的程序（ps 看得见）；
// 命中只报 env 的名字和文件路径。
//
// 哪些值拿来比（worthChecking），按顺序，理由：
//   1. 不到 8 个字的不比：AI_VENDOR、DOLT_REMOTE_USER 这类 4 个字的值是普通单词，导出里到处都是
//   2. 只有数字和日期、时间符号的不比：TOKENHUB_EXPIRES 是到期日 YYYY-MM-DD，测试和更新记录里到处是日期；MINIMAX_GROUP_ID 这类纯数字的编号不是凭据
//   3. 名字像凭据的（单词 KEY、SECRET、TOKEN、PASSWORD、PASSWD、PASS、PWD、CREDENTIAL(S)、AUTH）一律比；网址里带「用户:密码@」的也比
//   4. 名字是设置项的（_BUCKET、_MODEL、_HOST、_URL、_ENDPOINT、_REGION、_VENDOR 结尾）不比：桶名、模型名、主机名、网址本来就写在代码和说明里
//      （R2_BUCKET 的值就是一个软件的名字，开发说明里提到它）
//   5. 值是一个普通的小写词（只有小写字母和连字符、不到 16 个字）不比：项目名、软件名这类，开发说明里正好会出现
//   6. 剩下的都比：邮箱、通知频道名、带字母的编号这些不像密钥、但也不该公开的照样查
// 原来 MeetCaption、ParaRead、画布订阅各写一份，规则是 1、2 再单独放过 _BUCKET；这里多放过的只有 4、5 两类公开的名字，原来会比的凭据、邮箱一个不少。
//
// dispatch 命令找不到（CI、别人的机器）时跳过这一项，打一行提示；dispatch 在但出错（退出码不是 0、超时）就停下报错，不当成没有密钥。
import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

export function worthChecking(name, value) {
  if (value.length < 8 || /^[\d\s:./TZ+-]+$/.test(value)) return false
  if (/(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH)(_|$)/.test(name) || /:\/\/[^/\s:@]+:[^/\s@]+@/.test(value)) return true
  if (/_(BUCKET|MODEL|HOST|URL|ENDPOINT|REGION|VENDOR)$/.test(name)) return false
  return !(value.length < 16 && /^[a-z]+(-[a-z]+)*$/.test(value))
}

/** 真的 dispatch env：names() 没有 dispatch 命令时给 null */
export const dispatchEnv = {
  names() {
    const r = spawnSync('dispatch', ['env', 'list', '--json'], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 24 })
    if (r.error?.code === 'ENOENT') return null
    if (r.error || r.status !== 0) throw new Error(`dispatch env list 出错（${r.error?.code ?? `退出码 ${r.status}`}）`)
    return [...new Set(JSON.parse(r.stdout).map((e) => e.name))]
  },
  // 出错时另起一个只带名字和退出码的错误：execFile 原来的错误里有命令的输出
  get: (name) =>
    promisify(execFile)('dispatch', ['env', 'get', name], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 24 }).then(
      (r) => r.stdout.trim(),
      (e) => {
        throw new Error(`dispatch env get ${name} 出错（${e.killed ? '超时' : typeof e.code === 'number' ? `退出码 ${e.code}` : e.code}）`)
      },
    ),
}

/** dir 下不在 .git、node_modules 里的文本文件（前 8000 字节没有 0 字节，同 grep -I），相对路径 */
function textFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== '.git' && e.name !== 'node_modules') walk(p)
      } else if (e.isFile()) out.push(p)
    }
  }
  walk(dir)
  return out
}

/** 查 dir 里有没有 env 存着的值。hits 每条是「dispatch env 的 名字 的值在：文件、文件」，skipped 是没有 dispatch 命令、这一项没查。
 *  env 是 { names(), get(name) }（get 可以给 Promise），测试换成假的 */
export async function envLeaks(dir, env = dispatchEnv, log = console.log) {
  const names = env.names()
  if (names === null) {
    log('没有 dispatch 命令：跳过「dispatch env 里的值」这一项')
    return { hits: [], skipped: true }
  }
  // dispatch env get 一次要 0.5 到 1 秒多（每次起一个 Python），近 90 个一个一个问要 1 到 2 分钟：同时问 8 个
  const values = []
  let next = 0
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++]
      const v = await env.get(name)
      if (worthChecking(name, v)) values.push([name, Buffer.from(v)])
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  const found = new Map()
  for (const f of textFiles(dir)) {
    const buf = fs.readFileSync(f)
    if (buf.subarray(0, 8000).includes(0)) continue
    for (const [name, v] of values) if (buf.includes(v)) found.set(name, [...(found.get(name) ?? []), path.relative(dir, f)])
  }
  const hits = names
    .filter((n) => found.has(n))
    .map((name) => {
      const files = found.get(name)
      return `dispatch env 的 ${name} 的值在：${files.slice(0, 10).join('、')}${files.length > 10 ? ` 等 ${files.length} 个文件` : ''}`
    })
  return { hits, skipped: false }
}
