/**
 * 设置 › AI「iPhone 和 iPad」那一节和主进程（main/mobile-ai/）之间传的东西（task-wwqf0）。
 */

export interface MobileAiDevice {
  id: string
  /** 配对时那台设备报的名字（「一飞冲天」） */
  name: string
  /** iPad / iPhone */
  kind: string
  pairedAt: number
  /** 最后一次来问的时间；没问过是 null */
  lastSeen: number | null
  /** 手机全能模式：这台设备能不能用（设置里每台一颗开关，默认能） */
  full: boolean
}

/** 正在等手机点头的一步（Mac 右栏显示）：哪台设备、「等你点头：删掉《甲》」 */
export interface MobileAiWaiting {
  device: string
  kind: string
  label: string
}

/**
 * 手机请这台 Mac 打开全能模式、还没人点的（Mac 窗口底下一句，两分钟没点收起）：why 是挡在哪一道
 * （device 这台在设置里关了：「允许」打开这台的开关；engine AI 对话选的不是本机命令行：「去换」打开设置 › AI 那一行）
 */
export interface MobileAiWant {
  /** 设备编号 */
  id: string
  device: string
  kind: string
  why: 'device' | 'engine'
  /** AI 对话现在用的那家（engine 那种写进那一句） */
  engine: string
  at: number
}

export interface MobileAiState {
  /** 开关：让 iPhone / iPad 用这台 Mac 的 AI（默认关） */
  on: boolean
  /** 开着却起不来时的原因（端口被占、没有网） */
  error: string | null
  /** 这台 Mac 在 iPad 上显示的名字 */
  macName: string
  /**
   * 现在这个配对码：二维码里的链接、画好的二维码（SVG path，viewBox 是 0 0 side side）、什么时候作废；
   * 没开、刚用掉（配好一台）时是 null
   */
  pair: { link: string; qr: { d: string; side: number }; expires: number } | null
  devices: MobileAiDevice[]
  /** 开着时在听的端口 */
  port: number | null
}

export interface CnMobileAiApi {
  state(): Promise<MobileAiState>
  set(on: boolean): Promise<MobileAiState>
  /** 换一个配对码（过期了、再配一台） */
  newCode(): Promise<MobileAiState>
  unpair(id: string): Promise<MobileAiState>
  /** 手机全能模式：这台设备能不能用 */
  setFull(id: string, on: boolean): Promise<MobileAiState>
  /** 正在等手机点头的那几步 */
  waiting(): Promise<MobileAiWaiting[]>
  onWaiting(cb: (w: MobileAiWaiting[]) => void): () => void
  /** 手机请打开全能模式、还没人点的 */
  wants(): Promise<MobileAiWant[]>
  onWants(cb: (w: MobileAiWant[]) => void): () => void
  /** 那一句点了「允许」（ok，device 那种打开这台的开关）或「不要」 */
  grant(id: string, ok: boolean): Promise<MobileAiState>
  /** 配好了一台、有设备来问过：设置页跟着换 */
  onChanged(cb: (s: MobileAiState) => void): () => void
}
