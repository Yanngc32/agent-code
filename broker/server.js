// Entrypoint do broker. Configuração por env (.env dev / .env-prod na VPS).
import { createBroker } from './src/broker.js'

const PORT = Number(process.env.PORT || 8099)
const RELAY_KEY = process.env.RELAY_KEY || ''

const broker = createBroker({ relayKey: RELAY_KEY })
broker.listen(PORT, () => {
  console.log(`[broker] ouvindo em :${PORT}${RELAY_KEY ? ' (relayKey ligado)' : ''}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[broker] ${sig} — encerrando`)
    broker.close().then(() => process.exit(0))
  })
}
