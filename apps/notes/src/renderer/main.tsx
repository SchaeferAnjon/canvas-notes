import '@cn/design/tokens.css'
import '@cn/design/themes.css'
import '@cn/design/ui.css'
import '@cn/design/notes.css'
import './app.css'
import './frame.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { NoteDoc } from './note-doc'

// 退出软件前主进程叫它：停手不到 0.8 秒、还没自动保存的字先写到磁盘，再提交、再退出
;(window as unknown as { cnSaveAll: () => Promise<void> }).cnSaveAll = () => NoteDoc.saveAll()

createRoot(document.getElementById('root')!).render(<App />)
