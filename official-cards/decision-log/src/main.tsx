// Import the SDK first, from the entry module: it starts listening for the
// app's handshake as soon as it loads.
import { connect, type Card } from '@neurosquad/card-sdk'
import { CardProvider } from '@neurosquad/card-sdk/react'
import '@neurosquad/card-sdk/ui.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { LogController } from './controller'
import './styles.css'

// Opened on its own (npm run dev, or dist/index.html in a browser) the card runs
// against the SDK's mock host with a sample log — see src/preview.ts.
// `?preview=1` forces that inside an <iframe> too (a sheet of sizes and states).
const standalone =
  window.parent === window || new URLSearchParams(location.search).get('preview') === '1'
const card: Card = standalone ? await (await import('./preview')).previewCard() : await connect()

const log = new LogController(card)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CardProvider card={card}>
      <App log={log} />
    </CardProvider>
  </StrictMode>
)
await log.start()
if (standalone) (await import('./preview')).afterStart()
