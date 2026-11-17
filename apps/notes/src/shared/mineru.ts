/**
 * PDF 精读增强（MinerU）：主进程和界面之间的样子。MinerU 不进安装包：
 * 用到 PDF 时先找已有的一份（找到直接用、不提示），找不到才在 PDF 工具条下面出一行提示，用户点「安装」才装。
 * 装了以后 pdf.js 的块先出，MinerU 在后台跑完再换成它的块（表格、公式、图注、准的图框）。
 */

/** 找 MinerU 的结果 */
export type MineruFind =
  /** 能用：mineru-kit 的路径、版本、在哪找到的 */
  | { state: 'ready'; path: string; version: string; from: string }
  /** 哪都没有：可以装（resume：上次装到一半） */
  | { state: 'missing'; resume?: boolean }
  /** 找到了，但用不了（版本不对、缺模型、跑不起来）：不升级、不改别人装的那份，照常用 pdf.js */
  | { state: 'bad'; path: string; reason: string }
  /** 测试实例没指定 CN_MINERU_HOME：不找，也不提示 */
  | { state: 'off' }

export type MineruInstallPhase = 'none' | 'uv' | 'python' | 'packages' | 'models' | 'done' | 'failed'
export interface MineruInstallState {
  phase: MineruInstallPhase
  /** 0 到 100，按四步大致的用时加权 */
  percent: number
  /** 这一步在做什么（或最后一行输出） */
  line: string
  error: string | null
}

export interface MineruStatus {
  /** null：还在找 */
  find: MineruFind | null
  /** 点过「不再提示」 */
  dismissed: boolean
  install: MineruInstallState
}

/** 一份 PDF 的增强识别 */
export interface MineruJob {
  pdf: string
  hash: string
  status: 'queued' | 'running' | 'done' | 'failed'
  /** 当前这一步的百分比（tqdm 给的） */
  percent: number | null
  /** 这一步：认版面、认字、认表格… */
  stage: string
  error?: string
}

export interface CnMineruApi {
  status(): Promise<MineruStatus>
  onStatus(cb: (s: MineruStatus) => void): () => void
  /** 不再提示（设置里能改回来） */
  dismiss(on?: boolean): Promise<void>
  /** 再找一遍（设置里改了路径、装完以后） */
  refind(): Promise<MineruStatus>
  /** 设置里填的 mineru-kit 路径；null 清掉 */
  setPath(path: string | null): Promise<MineruStatus>
  install(): Promise<void>
  stopInstall(): Promise<void>
  /** 打开 PDF 后：有能用的 MinerU 就排进后台识别（已经有结果的直接 done）；没有返回 null。fresh：重试 */
  enhance(pdf: string, pages: number, fresh?: boolean): Promise<MineruJob | null>
  onJob(cb: (j: MineruJob) => void): () => void
  /** 刚装好：开着的 PDF 接着用它识别 */
  onInstalled(cb: () => void): () => void
}

/** 「PDF 精读增强」提示里写的大小和许可证 */
export const MINERU_DOWNLOAD = '约1.3 GB'
export const MINERU_DISK = '约2.2 GB'
export const MINERU_LICENSE_URL = 'https://github.com/opendatalab/MinerU/blob/master/LICENSE.md'

/** tqdm 的步骤名换成中文（不认得的写「识别中」） */
export function stageName(stage: string): string {
  const s = stage.toLowerCase()
  if (/weight|load|model/.test(s)) return '载入模型'
  if (/layout/.test(s)) return '认版面'
  if (/ocr/.test(s)) return '认字'
  if (/table/.test(s)) return '认表格'
  if (/mfr|mfd|formula|equation/.test(s)) return '认公式'
  return '识别中'
}
