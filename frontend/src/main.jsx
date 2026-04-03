import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import {
  clearMlServiceUrlOverride,
  getMlServiceUrl,
  setMlServiceUrlOverride,
  syncMlServiceUrlOverrideFromLocation,
} from './utils/mlService.js'

syncMlServiceUrlOverrideFromLocation()

window.__AIPROCTOR_ML__ = {
  get: getMlServiceUrl,
  set: setMlServiceUrlOverride,
  clear: clearMlServiceUrlOverride,
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
