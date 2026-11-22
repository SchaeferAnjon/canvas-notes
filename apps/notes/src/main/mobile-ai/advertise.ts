/**
 * 在局域网里报一声「这里有画布笔记的 AI」（Bonjour，_canvasnotes._tcp）：用 macOS 自带的 dns-sd 登记，
 * 交给系统的 mDNSResponder 去答，不自己开 5353 端口、不加依赖。iPad 按 TXT 里的 id（Mac 编号）认是不是配对过的那台。
 *
 * dns-sd 登记的服务跟着 dns-sd 这个进程活着。外面套一层 sh：标准输入是我们这边的管道，我们退出（哪怕是崩了）管道一断，
 * read 就返回，接着 kill 掉 dns-sd，不留一个指着死端口的服务。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { SERVICE_TYPE } from './protocol'

export interface Advert {
  stop(): void
}

export function advertise(name: string, port: number, txt: Record<string, string>): Advert {
  const pairs = Object.entries(txt).map(([k, v]) => `${k}=${v}`)
  const script = 'name=$1; type=$2; port=$3; shift 3; /usr/bin/dns-sd -R "$name" "$type" local "$port" "$@" >/dev/null 2>&1 & pid=$!; read _; kill $pid 2>/dev/null'
  const args = ['-c', script, 'sh', name, SERVICE_TYPE, String(port), ...pairs]
  let child: ChildProcess | null = spawn('/bin/sh', args, { stdio: ['pipe', 'ignore', 'ignore'] })
  child.on('exit', () => (child = null))
  // 管道那头没人读时写会出错（sh 已经退了）：不用管
  child.stdin?.on('error', () => undefined)
  return {
    stop() {
      if (!child) return
      child.stdin?.end()
      child = null
    },
  }
}
