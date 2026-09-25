// Import the SDK first, from the entry module: it starts listening for the
// app's handshake as soon as it loads.
import { connect, type Card } from '@neurosquad/card-sdk'
import { CardProvider } from '@neurosquad/card-sdk/react'
import '@neurosquad/card-sdk/ui.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RouterController } from './controller'
import './styles.css'

// Opened on its own (npm run dev, or dist/index.html in a browser) the card runs
// against the SDK's mock host with simulated peers — see src/preview.ts.
// `?preview=1` forces that inside an <iframe> too (a sheet of sizes and states).
const params = new URLSearchParams(location.search)
const standalone = window.parent === window || params.get('preview') === '1'
const card: Card = standalone ? await (await import('./preview')).previewCard() : await connect()

const router = new RouterController(card)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CardProvider card={card}>
      <App router={router} initialTab={standalone && params.get('tab') === 'inspector' ? 'inspector' : 'rules'}
        initialEdit={(standalone && params.get('edit')) || undefined}
        openNewest={standalone && params.get('open') === '1'}
      />
    </CardProvider>
  </StrictMode>
)
await router.start()
if (standalone) (await import('./preview')).afterStart(router)
