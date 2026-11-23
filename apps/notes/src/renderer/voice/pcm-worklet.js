// 语音输入：麦克风的声音（AudioContext 已经是 16 kHz）攒够 0.1 秒转成 16 位整数送出去，顺带这 0.1 秒的音量（均方根）。
// 收到 'flush' 把攒着的不满 0.1 秒的也送出去，再回一条 { flushed: true }。
class Pcm16 extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Int16Array(1600)
    this.n = 0
    this.sum = 0
    this.port.onmessage = (e) => {
      if (e.data !== 'flush') return
      this.emit()
      this.port.postMessage({ flushed: true })
    }
  }
  emit() {
    if (!this.n) return
    const pcm = this.buf.slice(0, this.n).buffer
    this.port.postMessage({ pcm, level: Math.sqrt(this.sum / this.n) }, [pcm])
    this.n = 0
    this.sum = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const v = Math.max(-1, Math.min(1, ch[i]))
        this.sum += v * v
        this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
        if (this.n === this.buf.length) this.emit()
      }
    }
    return true
  }
}
registerProcessor('cn-pcm16', Pcm16)
