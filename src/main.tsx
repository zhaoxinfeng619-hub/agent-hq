import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { world } from './data/world'
import './styles/ui.css'

// 对外调试句柄：控制台里 __hq.world 可以直接看/改世界状态，接真实数据时也用得上
;(window as unknown as { __hq: { world: typeof world } }).__hq = { world }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
