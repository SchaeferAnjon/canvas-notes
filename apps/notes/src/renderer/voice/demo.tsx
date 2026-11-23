/**
 * 测试模式（--cn-e2e）才有的「语音输入试验框」：照费曼回答框（design/feynman/proto.html 的 .inp）搭的一个框，
 * 让端到端测试在费曼那一列做好之前就能真点麦克风（e2e/feynman-voice.spec.ts）。正式界面不挂它。
 * 页面里调 window.cnDictDemo() 打开，window.cnDictDemo(false) 关掉。
 */
import { Codicon } from '@cn/design'
import { useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DictationBar, DictationLive, DictationMic, DictationNote, useDictation } from './dictation'

function Demo() {
  const [value, setValue] = useState('')
  const [sent, setSent] = useState<string[]>([])
  const ref = useRef<HTMLTextAreaElement>(null)
  const d = useDictation({ inputRef: ref, value, onChange: setValue, terms: ['范数', '向量', '三角不等式'] })
  const send = async () => {
    const text = (await d.finish()).trim()
    if (!text) return
    setSent((s) => [...s, text])
    setValue('')
  }
  return (
    <div className="dict-demo" role="dialog" aria-label="语音输入试验框">
      <div className="dict-demo-q">我没学过范数。你用自己的话给我讲讲：它是什么，拿来干嘛？</div>
      {sent.map((s, i) => (
        <div key={i} className="dict-demo-sent" data-testid="dict-sent">
          {s}
        </div>
      ))}
      <div className={`dict-demo-inp${d.active ? ' dict-rec' : ''}`}>
        <DictationBar d={d} />
        <textarea
          ref={ref}
          aria-label="回答"
          placeholder="用自己的话讲：它是什么、拿来干嘛（打字，或点麦克风说）"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) (e.preventDefault(), void send())
          }}
        />
        <DictationLive d={d} />
        <DictationNote d={d} />
        <div className="dict-demo-f">
          <DictationMic d={d} />
          <button type="button" className="dict-demo-ib" aria-label="拍一张手画的图">
            <Codicon name="device-camera" size={14} />
          </button>
          <button type="button" className="dict-demo-ghost">
            填一段示例
          </button>
          <span className="dict-demo-sp" />
          <button type="button" className="dict-demo-send" disabled={!value.trim()} onClick={() => void send()}>
            讲完了
          </button>
        </div>
      </div>
    </div>
  )
}

let root: Root | null = null
let host: HTMLDivElement | null = null

export function installDictDemo() {
  ;(window as unknown as { cnDictDemo: (open?: boolean) => void }).cnDictDemo = (open = true) => {
    if (!open) {
      root?.unmount()
      host?.remove()
      root = null
      host = null
      return
    }
    if (root) return
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<Demo />)
  }
}
