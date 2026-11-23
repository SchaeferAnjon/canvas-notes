/**
 * 语音输入的录音：麦克风 → 16 kHz 单声道 → 每 0.1 秒一段 16 位 PCM（pcm-worklet.js），连音量一起交给调用方。
 * 找不到麦克风、被拒绝时抛 MicError，界面按 code 说人话。
 */
// 不能内联成 data:（主窗口的 CSP script-src 只认 'self'），要单独一个文件
import workletUrl from './pcm-worklet.js?url&no-inline'

export class MicError extends Error {
  constructor(
    public code: 'mic-denied' | 'no-mic',
    detail: string,
  ) {
    super(detail)
  }
}

export interface Capture {
  /** 停：把最后不满 0.1 秒的也送出去，再关麦克风 */
  stop(): Promise<void>
}

export async function startCapture(onPcm: (pcm: ArrayBuffer, level: number) => void): Promise<Capture> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch (e) {
    const name = (e as DOMException).name
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('mic-denied', `${name}: ${(e as Error).message}`)
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') throw new MicError('no-mic', `${name}: ${(e as Error).message}`)
    throw e
  }
  const ctx = new AudioContext({ sampleRate: 16000 })
  try {
    await ctx.audioWorklet.addModule(workletUrl)
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    throw e
  }
  const src = ctx.createMediaStreamSource(stream)
  // 输出一直是静音：接到 destination 只为了让它一直在跑
  const node = new AudioWorkletNode(ctx, 'cn-pcm16', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
  let flushed: (() => void) | null = null
  node.port.onmessage = (e: MessageEvent<{ pcm?: ArrayBuffer; level?: number; flushed?: boolean }>) => {
    if (e.data.pcm) onPcm(e.data.pcm, e.data.level ?? 0)
    if (e.data.flushed) flushed?.()
  }
  src.connect(node)
  node.connect(ctx.destination)
  return {
    async stop() {
      await new Promise<void>((r) => {
        flushed = r
        node.port.postMessage('flush')
        // 音频线程停了（窗口在后台被挂起之类）也不卡住：最多等半秒
        setTimeout(r, 500)
      })
      src.disconnect()
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      await ctx.close()
    },
  }
}
