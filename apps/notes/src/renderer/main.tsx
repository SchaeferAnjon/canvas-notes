import '@cn/design/tokens.css'
import '@cn/design/themes.css'
import '@cn/design/ui.css'
import '@cn/design/notes.css'
import './app.css'
import './frame.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { NoteDoc } from './note-doc'
import { noteLeavers } from './shell/TabActs'

// 退出软件、关主窗口前主进程叫它：停手不到 0.8 秒、还没自动保存的字先写到磁盘（这一步等写完才回）；
// 再和关标签一样，写了标题没回车的按标题改名（不然下次打开标题和文件名对不上，再也不跟）。字先存，改名慢了也不丢字。
// 回给主进程写不进去的那几篇（字另存了），退出时照实记，不当「存完」
;(window as unknown as { cnSaveAll: () => Promise<string[]> }).cnSaveAll = async () => {
  await NoteDoc.saveAll()
  await Promise.all([...noteLeavers.values()].map((leave) => leave()))
  return [...NoteDoc.failing].map((d) => d.path)
}

createRoot(document.getElementById('root')!).render(<App />)
