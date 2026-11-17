/**
 * 跑 MinerU、uv 用到的几件小事：整组杀进程、Python 环境里可执行文件的位置、量文件夹多大、读 tqdm 进度。
 * 来自 ParaRead（同一作者，src/main/platform.ts、src/main/mineru.ts），在此以 GPL-3.0-or-later 提供；画布笔记只做 Mac，去掉了 Windows 分支。
 */
import { type ChildProcess, execFile } from 'node:child_process'
import { join } from 'node:path'

/** 子进程连同它起的进程一起停：子进程是 detached 起的、自成一组，杀整组 */
export function killTree(child: ChildProcess, sig: NodeJS.Signals = 'SIGKILL'): void {
  if (!child.pid || child.exitCode !== null) return
  try {
    process.kill(-child.pid, sig)
  } catch {
    child.kill(sig)
  }
}

/** Python 虚拟环境里的可执行文件 */
export const venvExe = (venv: string, name: string): string => join(venv, 'bin', name)

/** 文件夹多大（KB）：装的时候按下载目录长到多大算进度；没有这个文件夹是 0 */
export function dirKb(dir: string): Promise<number> {
  return new Promise((res) => execFile('/usr/bin/du', ['-sk', dir], { timeout: 10_000 }, (_e, out) => res(Number(String(out).split(/\s/)[0]) || 0)))
}

/** tqdm 进度条写在 stderr，用 \r 刷新，比如「OCR-det:  53%|█████▎    | 8/15 [00:01<00:01]」。取最后一个 */
export function parseTqdm(chunk: string): { stage: string; percent: number } | null {
  const re = /([A-Za-z][\w\- ]{0,40}?):\s*(\d{1,3})%\|/g
  let m: RegExpExecArray | null
  let last: { stage: string; percent: number } | null = null
  while ((m = re.exec(chunk))) last = { stage: m[1]!.trim(), percent: Math.min(100, Number(m[2])) }
  return last
}

/** 输出的最后一行：按 \r 和 \n 切，去掉空行、颜色码和 pdfium 的噪声 */
export function lastLogLine(chunk: string): string {
  const lines = chunk
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('Explicitly closing'))
  return lines.length ? lines[lines.length - 1]!.slice(0, 300) : ''
}
