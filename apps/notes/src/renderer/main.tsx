// 界面语言最先设好：第一帧就是对的语言
import './i18n'
import '@cn/design/tokens.css'
import '@cn/design/themes.css'
import '@cn/design/ui.css'
import '@cn/design/notes.css'
import './app.css'
import './frame.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { NoteDoc } from './note-doc'
import type { StrandedNote } from '../shared/api'
import { noteLeavers } from './shell/TabActs'
import { flushSaves as flushReading } from './reading/store'
import { WindowGuard } from './crash/Guard'
import { installTestCrash, watchGlobalErrors } from './crash/report'
import { installCiteClicks } from './cite'

// 退出软件、关主窗口前主进程叫它：停手不到 0.8 秒、还没自动保存的字先写到磁盘（这一步等写完才回）；
// 读 PDF 的对话记录（存盘等 300 毫秒）也马上存掉，答完马上退出也是整条回答、旁支也在；
// 再和关标签一样，写了标题没回车的按标题改名（不然下次打开标题和文件名对不上，再也不跟）。字先存，改名慢了也不丢字。
// 回给主进程：哪都写不进去、字只在内存里的那几篇（退出、关窗口前要用户确认，不当「存完」）；原文件写不进去、字在另存那篇的（照实记另存到哪）
;(window as unknown as { cnSaveAll: () => Promise<{ stranded: StrandedNote[]; rescued: string[] }> }).cnSaveAll = async () => {
  await Promise.all([NoteDoc.saveAll(), flushReading(true)])
  await Promise.all([...noteLeavers.values()].map((leave) => leave()))
  return {
    stranded: [...NoteDoc.failing].map((d) => ({ path: d.path, stash: d.stash })),
    rescued: [...NoteDoc.open].flatMap((d) => (d.rescuedFrom ? [`${d.rescuedFrom} → ${d.path}`] : [])),
  }
}

// 出错兜底（task-pyb39）：没接住的异常记进日志；整个窗口包一层，渲染里抛错显示出错页，不白屏
watchGlobalErrors()
installTestCrash()
// AI 回答里的引用（task-3e53q）：点了出预览卡、⌘点打开，哪里画的回答都一样
installCiteClicks()
createRoot(document.getElementById('root')!).render(
  <WindowGuard>
    <App />
  </WindowGuard>,
)
