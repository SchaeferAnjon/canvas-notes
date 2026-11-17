/**
 * 这台 Mac 上 git 没有署名时（新 Mac 常见，全局和库里都没设），软件给库设的署名：
 * 名字用 macOS 的用户全名（id -F），邮箱「<用户名>@<电脑名>.local」（电脑名是 系统设置 › 通用 › 共享 里的本地主机名）。
 * 设置 › Git和同步 能改（只改这个库）。
 */
import { execFile } from 'node:child_process'
import { hostname, userInfo } from 'node:os'

/** 跑一条系统命令拿一行输出；没有这条命令、超时、出错都是 null（这几条只是用来猜名字） */
function line(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((r) => execFile(cmd, args, { timeout: 3000 }, (err, out) => r(err ? null : out.trim() || null)))
}

export async function macIdentity(): Promise<{ name: string; email: string }> {
  const user = userInfo().username
  const [full, local] = await Promise.all([line('/usr/bin/id', ['-F']), line('/usr/sbin/scutil', ['--get', 'LocalHostName'])])
  const host = (local ?? hostname().replace(/\.local$/i, '')).replace(/[^A-Za-z0-9-]/g, '-') || 'mac'
  return { name: full ?? user, email: `${user}@${host}.local` }
}
