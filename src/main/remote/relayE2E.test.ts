import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { get as httpGet, request as httpRequest } from 'node:http'
import { AddressInfo } from 'node:net'
// @ts-expect-error — JS puro do projeto irmão broker/ (sem tipos)
import { createBroker } from '../../../broker/src/broker.js'
import { RemoteServer } from './remoteServer'
import { RelayClient } from './relayClient'
import type { RemoteConversation } from '../../shared/ipc'

// E2E REAL do pipe: celular(HTTP) → broker → relay(WS) → RemoteServer real → volta.
// Exercita o caminho de produção (rotas e auth reais do RemoteServer), não um stub.

const inbound: Array<{ convId: string; text: string }> = []
const bridge = new RemoteServer({
  onInbound: (convId, text) => inbound.push({ convId, text }),
  apkPath: () => 'C:/nonexistent/agent-remote.apk',
  wwwDir: () => 'C:/nonexistent/www'
})

let broker: ReturnType<typeof createBroker>
let brokerPort = 0
let relay: RelayClient
let token = ''

beforeAll(async () => {
  const info = await bridge.start()
  token = info.token
  const conv: RemoteConversation = {
    id: 'c1',
    title: 'Conversa',
    cwd: '/proj',
    busy: false,
    connected: true,
    updatedAt: 2,
    messages: []
  }
  bridge.setState({ conversations: [conv] })

  broker = createBroker({})
  await new Promise<void>((r) => broker.listen(0, r))
  brokerPort = (broker.server.address() as AddressInfo).port

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('relay não conectou')), 4000)
    relay = new RelayClient({
      brokerUrl: `ws://127.0.0.1:${brokerPort}/__relay`,
      getToken: () => bridge.info().token,
      getPort: () => bridge.info().port,
      onStatus: (c) => {
        if (c) {
          clearTimeout(t)
          resolve()
        }
      }
    })
    relay.start()
  })
})

afterAll(async () => {
  relay.stop()
  await broker.close()
  await bridge.stop()
})

function get(path: string): Promise<{ status: number; body: string; ctype?: string }> {
  return new Promise((resolve, reject) => {
    httpGet(`http://127.0.0.1:${brokerPort}${path}`, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, ctype: res.headers['content-type'] }))
    }).on('error', reject)
  })
}

describe('E2E — celular → broker → relay → RemoteServer real', () => {
  it('/api/state com o token do PC volta a conversa real', async () => {
    const r = await get(`/api/state?token=${token}`)
    expect(r.status).toBe(200)
    const j = JSON.parse(r.body)
    expect(j.conversations.map((c: { id: string }) => c.id)).toContain('c1')
  })

  it('/api/state com token de PC inexistente → 503 (não vaza)', async () => {
    const r = await get('/api/state?token=ffffffffffffffffffffffffffffffff')
    expect(r.status).toBe(503)
  })

  it('auth real do RemoteServer: roteado por cookie mas SEM ?token na url → 401', async () => {
    // Broker roteia pelo cookie relay_token; a url repassada não tem ?token=, então
    // o RemoteServer barra (auth real preservada ponta-a-ponta).
    const r = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpGet(
        {
          host: '127.0.0.1',
          port: brokerPort,
          path: '/api/state',
          headers: { cookie: `relay_token=${token}` }
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
        }
      )
      req.on('error', reject)
    })
    expect(r.status).toBe(401)
  })

  it('POST /api/send atravessa o pipe e chega no onInbound (comando do celular)', async () => {
    const r = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest(
        `http://127.0.0.1:${brokerPort}/api/send?token=${token}`,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          res.resume()
          res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
        }
      )
      req.on('error', reject)
      req.end(JSON.stringify({ convId: 'c1', text: 'rode os testes' }))
    })
    expect(r.status).toBe(200)
    expect(inbound).toContainEqual({ convId: 'c1', text: 'rode os testes' })
  })

  it('/api/events: stream SSE atravessa o broker (handshake do bridge)', async () => {
    const r = await new Promise<{ status: number; chunk: string; ctype?: string }>((resolve, reject) => {
      const req = httpGet(`http://127.0.0.1:${brokerPort}/api/events?token=${token}`, (res) => {
        res.on('data', (d) => {
          resolve({ status: res.statusCode ?? 0, chunk: d.toString(), ctype: res.headers['content-type'] })
          req.destroy()
        })
      })
      req.on('error', () => {})
      setTimeout(() => reject(new Error('sse timeout')), 3000)
    })
    expect(r.status).toBe(200)
    expect(r.ctype).toContain('text/event-stream')
    expect(r.chunk).toContain('retry:') // o RemoteServer manda "retry: 3000" ao abrir o SSE
  })
})
