/**
 * 退出慢（大库提速）：窗口关了、字存好提交好以后，进程还要拖整整 10 秒才没。
 * 原因在 Chromium：收尾时它在 IO 线程上等网络进程自己退（content/browser/browser_process_io_thread.cc，
 * kMaxSecondsToWaitForNetworkProcess = 10，为了让网络进程把 cookie 和缓存写完）。网络进程要收到「该退了」才退，
 * 机器忙的时候这个消息常常没送到，网络进程一直闲着（sample 看是在等消息），等满 10 秒才被杀。
 * 和库大小无关：一篇的库、负载 100 以上，十次里七八次 10.1 秒；闲的机器上 40 毫秒。
 *
 * 做法：退出前自己把两个会话的 cookie 写盘（flushCookies）；will-quit 时起一个小 sh（killNetworkLater），
 * 过 NET_GRACE_MS 主进程还活着，就把这个软件的网络进程 SIGKILL，之后每 0.2 秒再看一次（Chromium 看网络进程没了会马上重起一个）。
 * 主进程退得快了，Chromium 来不及收拾的子进程（重起的网络进程、负载下还忙着的网页进程）成了孤儿，还攥着启动它的人的输出管道
 * （测试里 Playwright 的 app.close() 一直等不到头），也白占着 CPU。所以主进程没了以后，再扫 1 秒孤儿（父进程是 1）一并杀掉。
 * 认进程看命令行里的 --user-data-dir（一个设置目录只开得了一个软件），不会碰到别的软件、也不会碰到紧接着又开的那一份（它的子进程父进程不是 1）。
 * Chromium 自己等满 10 秒以后也是直接杀，这里只是把 10 秒缩到 1 秒上下，cookie 已经先写过。
 */
import { app, session } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

/** 网络进程给多久自己退 */
export const NET_GRACE_MS = 800
/** 最多盯多久 */
export const NET_WATCH_MS = 20_000
/** 网络进程的命令行里带这个（Chromium 的 utility 进程按子类型区分；还带 --user-data-dir=设置目录） */
export const NET_MARK = '--utility-sub-type=network.mojom.NetworkService'

/** 默认会话和 partitions 里各个会话的 cookie 写盘；最多等 ms */
export async function flushCookies(partitions: string[], ms = 1500): Promise<'写完' | '超时'> {
  const all = Promise.all([session.defaultSession, ...partitions.map((p) => session.fromPartition(p))].map((s) => s.cookies.flushStore())).then(() => '写完' as const)
  let timer: NodeJS.Timeout | undefined
  const r = await Promise.race([all, new Promise<'超时'>((res) => (timer = setTimeout(() => res('超时'), ms)))])
  clearTimeout(timer)
  return r
}

const reEscape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 过 delayMs 毫秒 parent 还活着，就把这个软件的网络进程（命令行带 mark 和 --user-data-dir=userData；父进程是 parent 或已经是孤儿）SIGKILL，
 * 之后每 0.2 秒再看一次；parent 没了以后扫 1 秒孤儿（命令行带 --type= 和这个设置目录、父进程是 1 的 Chromium 子进程）；最多看 watchMs。
 * 起一个脱离的 sh（主进程退了它照样跑），返回它。认法写在环境变量里，sh 自己的命令行里没有，不会把自己认成网络进程
 */
export function killNetworkLater(parent: number, userData: string, delayMs = NET_GRACE_MS, watchMs = NET_WATCH_MS, mark = NET_MARK, log = ''): ChildProcess {
  if (!Number.isInteger(parent) || parent <= 1) throw new Error(`进程号不对：${parent}`)
  if (!userData.startsWith('/')) throw new Error(`设置目录不对：${userData}`)
  const script = [
    'sleep "$DELAY"',
    // 测试模式记下自己做了什么（退得慢时 e2e 报出来：网络进程什么时候杀的、主进程什么时候没的）
    'say() { [ -n "$LOG" ] && /bin/echo "$(/bin/date +%s) $*" >> "$LOG"; }',
    'say 醒了',
    'left=5; n=0',
    'while [ $n -lt "$TRIES" ]; do',
    '  if /bin/kill -0 "$MAIN" 2>/dev/null; then',
    // 主进程还在：它名下的网络进程（和已经成了孤儿的）杀掉
    '    for p in $(/usr/bin/pgrep -f -- "$NET"); do',
    '      pp=$(/bin/ps -o ppid= -p "$p" | tr -d " ")',
    '      if [ "$p" != "$$" ] && { [ "$pp" = "$MAIN" ] || [ "$pp" = 1 ]; }; then /bin/kill -9 "$p"; say 杀网络进程 "$p"; fi',
    '    done',
    '  else',
    // 主进程没了：它留下的孤儿（网络进程、忙着的网页进程……）扫 1 秒
    '    for p in $(/usr/bin/pgrep -f -- "$ANY"); do',
    '      pp=$(/bin/ps -o ppid= -p "$p" | tr -d " ")',
    '      if [ "$p" != "$$" ] && [ "$pp" = 1 ]; then /bin/kill -9 "$p"; say 杀孤儿 "$p"; fi',
    '    done',
    '    [ $left = 5 ] && say 主进程没了',
    '    left=$((left-1)); [ $left -le 0 ] && exit 0',
    '  fi',
    '  sleep 0.2; n=$((n+1))',
    'done',
    'exit 0',
  ].join('\n')
  const ud = `--user-data-dir=${reEscape(userData)}( |$)`
  const env = {
    PATH: '/usr/bin:/bin',
    MAIN: String(parent),
    DELAY: (delayMs / 1000).toFixed(3),
    TRIES: String(Math.max(1, Math.ceil((watchMs - delayMs) / 200))),
    NET: `${reEscape(mark)}.*${ud}`,
    ANY: `--type=.*${ud}`,
    LOG: log,
  }
  const sh = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore', env })
  sh.unref()
  return sh
}

/** will-quit 时叫：起小 sh 盯着网络进程；返回记进 quit.log 的那句（没有网络进程是 null） */
export function capNetworkWait(): string | null {
  const net = app.getAppMetrics().find((m) => m.serviceName === 'network.mojom.NetworkService')
  if (!net) return null
  const ud = app.getPath('userData')
  killNetworkLater(process.pid, ud, NET_GRACE_MS, NET_WATCH_MS, NET_MARK, process.env.CN_E2E === '1' ? join(ud, 'quit-sh.log') : '')
  return `盯着网络进程 ${net.pid}（${NET_GRACE_MS} 毫秒后主进程还在就杀）`
}
