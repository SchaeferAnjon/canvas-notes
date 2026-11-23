/**
 * 语音输入（费曼学习第 2 节，task-yvabi）：边说边出字，接 Soniox 实时接口。
 * preload 暴露成 window.cnVoice，实现在 main/voice/；界面那一半（麦克风按钮、听写条）在 renderer/voice/。
 */

/** 听写停下的原因（界面按它说人话，原话放在 detail） */
export type DictErrorCode =
  /** 设置里没填 Soniox 密钥 */
  | 'no-key'
  /** 系统设置里没给麦克风权限 */
  | 'mic-denied'
  /** 这台 Mac 上找不到麦克风 */
  | 'no-mic'
  /** 连不上 Soniox，或连着连着断了 */
  | 'net'
  /** 密钥不对、过期，或没有实时听写的权限 */
  | 'auth'
  /** Soniox 账户没钱了 */
  | 'quota'
  /** 等 Soniox 回话超时 */
  | 'timeout'
  /** Soniox 那边同时连的太多 */
  | 'busy'
  /** Soniox 那边出错 */
  | 'server'

export type DictStart = { ok: true; id: number } | { ok: false; code: DictErrorCode; detail?: string }

/** 主进程发来的：新定下的字（接在后面）、这会儿还没定的字（整段换掉）、出错、结束 */
export type DictEvent =
  | { id: number; kind: 'text'; final: string; interim: string }
  | { id: number; kind: 'error'; code: DictErrorCode; detail?: string }
  | { id: number; kind: 'end' }

export interface CnVoiceApi {
  /**
   * 开一段听写：查密钥、问麦克风权限、开始连 Soniox（连上之前送来的声音先排着）。
   * terms：这段话可能说到的词（费曼讲的知识点名、导图节点），交给 Soniox 的 context.terms，同音字少听错
   */
  start(opts?: { terms?: string[] }): Promise<DictStart>
  /** 送一段声音：16 kHz、单声道、16 位小端 PCM */
  audio(id: number, pcm: ArrayBuffer): void
  /** 说完了：告诉 Soniox 没声音了，等它把剩下的字定下来（最多等几秒）；回来时最后的字已经发过来了 */
  stop(id: number): Promise<void>
  /** 不要了：马上断开 */
  cancel(id: number): void
  onEvent(cb: (e: DictEvent) => void): () => void
  /** 打开系统设置 › 隐私与安全性 › 麦克风 */
  openMicSettings(): Promise<void>
}
