import '@cn/design/tokens.css'
import '@cn/design/themes.css'
import '@cn/design/ui.css'
import '@cn/design/notes.css'
import './app.css'
import './frame.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
