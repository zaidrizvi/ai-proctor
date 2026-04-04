import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import {
  clearMlServiceUrlOverride,
  getMlServiceResolution,
  getMlServiceUrl,
  setMlServiceUrlOverride,
  syncMlServiceUrlOverrideFromLocation,
} from './utils/mlService.js'
import { ensureMlServiceReady, getMlDebugHistory } from './utils/mlClient.js'

syncMlServiceUrlOverrideFromLocation()

window.__AIPROCTOR_ML__ = {
  get: getMlServiceUrl,
  resolve: getMlServiceResolution,
  set: setMlServiceUrlOverride,
  clear: clearMlServiceUrlOverride,
  health: () => ensureMlServiceReady({ force: true }),
  logs: getMlDebugHistory,
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
