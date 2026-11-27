import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './components/theme/ThemeProvider'
import { applyUiAppearance, loadUiAppearance } from './utils/uiAppearance'

// 首帧之前就把字体/字号/行高落到 CSS 变量，避免启动时闪一下默认字体
applyUiAppearance(loadUiAppearance())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
