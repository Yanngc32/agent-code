// agent-code broker — relay de acesso remoto multiusuário, roteado por token.
//
// O PC (desktop) DISCA pra cá por WebSocket (/__relay) e se registra com o seu
// token. O celular faz HTTP normal em https://host/...?token=XYZ; o broker acha o
// PC com aquele token e encapsula a request em frames JSON, devolvendo a resposta
// (incluindo SSE em streaming) pro celular. Stateless: o estado é só o mapa
// token→conexão, em memória. Sem DB.
//
// Protocolo (frames JSON):
//   PC→broker:  {type:'hello', token, relayKey?}
//   broker→PC:  {type:'ready'} | {type:'denied'}
//   broker→PC:  {type:'open', rid, method, url, headers}
//   broker→PC:  {type:'data', rid, b64} | {type:'end', rid} | {type:'abort', rid}
//   PC→broker:  {type:'head', rid, status, headers}
//   PC→broker:  {type:'data', rid, b64} | {type:'end', rid} | {type:'error', rid, message}
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

// Cabeçalhos hop-by-hop não devem ser repassados num proxy.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer'
])

function filterHeaders(headers, drop = []) {
  const out = {}
  for (const [k, v] of Object.entries(headers || {})) {
    const lk = k.toLowerCase()
    if (HOP_BY_HOP.has(lk) || drop.includes(lk) || v == null) continue
    out[k] = v
  }
  return out
}

function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}

/**
 * Cria o broker. `relayKey` (opcional): se definido, só aceita PCs que mandem o
 * mesmo valor no `hello` (porta de entrada anti-abuso; o token do app é a auth
 * real). Retorna { server, wss, hosts, listen, close, stats }.
 */
export function createBroker({ relayKey = '' } = {}) {
  /** token -> { ws, reqs: Map(rid -> ServerResponse) } */
  const hosts = new Map()
  let ridSeq = 0

  const server = createServer(handleHttp)
  const wss = new WebSocketServer({ server, path: '/__relay', maxPayload: 64 * 1024 * 1024 })

  wss.on('connection', (ws) => {
    let token = null
    let host = null
    ws.once('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        ws.close()
        return
      }
      if (msg.type !== 'hello' || typeof msg.token !== 'string' || !msg.token) {
        ws.close()
        return
      }
      if (relayKey && msg.relayKey !== relayKey) {
        try {
          ws.send(JSON.stringify({ type: 'denied' }))
        } catch {
          /* ignore */
        }
        ws.close()
        return
      }
      token = msg.token
      // Um PC por token: o registro novo substitui o antigo.
      const prev = hosts.get(token)
      if (prev && prev.ws !== ws) {
        try {
          prev.ws.close()
        } catch {
          /* ignore */
        }
      }
      host = { ws, reqs: new Map() }
      hosts.set(token, host)
      try {
        ws.send(JSON.stringify({ type: 'ready' }))
      } catch {
        /* ignore */
      }
      ws.on('message', (d) => onHostFrame(host, d))
    })
    ws.on('close', () => {
      if (host) {
        if (hosts.get(token) === host) hosts.delete(token)
        for (const res of host.reqs.values()) {
          try {
            if (!res.headersSent) res.writeHead(502)
            res.end()
          } catch {
            /* ignore */
          }
        }
        host.reqs.clear()
      }
    })
  })

  function onHostFrame(host, raw) {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    const res = host.reqs.get(msg.rid)
    if (!res) return
    if (msg.type === 'head') {
      if (!res.headersSent) res.writeHead(msg.status || 200, filterHeaders(msg.headers))
    } else if (msg.type === 'data') {
      try {
        res.write(Buffer.from(msg.b64, 'base64'))
      } catch {
        /* client gone */
      }
    } else if (msg.type === 'end') {
      host.reqs.delete(msg.rid)
      try {
        res.end()
      } catch {
        /* ignore */
      }
    } else if (msg.type === 'error') {
      host.reqs.delete(msg.rid)
      try {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('relay error')
      } catch {
        /* ignore */
      }
    }
  }

  function handleHttp(req, res) {
    const url = new URL(req.url, 'http://x')
    const fromQuery = url.searchParams.get('token')
    const token = fromQuery || readCookie(req, 'relay_token')
    if (!token) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('token ausente')
      return
    }
    const host = hosts.get(token)
    if (!host) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('nenhum PC conectado com esse token')
      return
    }
    const rid = ++ridSeq
    host.reqs.set(rid, res)
    // Lembra o token num cookie p/ sub-requests sem ?token= (fallback do navegador).
    if (fromQuery) {
      res.setHeader('Set-Cookie', `relay_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`)
    }
    const headers = filterHeaders(req.headers, ['host'])
    send(host.ws, { type: 'open', rid, method: req.method, url: req.url, headers })
    req.on('data', (chunk) => send(host.ws, { type: 'data', rid, b64: chunk.toString('base64') }))
    req.on('end', () => send(host.ws, { type: 'end', rid }))
    req.on('error', () => send(host.ws, { type: 'abort', rid }))
    res.on('close', () => {
      if (host.reqs.has(rid)) {
        host.reqs.delete(rid)
        send(host.ws, { type: 'abort', rid })
      }
    })
  }

  function send(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(obj))
      } catch {
        /* ignore */
      }
    }
  }

  // Mantém conexões vivas (Cloudflare/Nginx cortam WS ocioso).
  const ping = setInterval(() => {
    for (const host of hosts.values()) {
      if (host.ws.readyState === host.ws.OPEN) {
        try {
          host.ws.ping()
        } catch {
          /* ignore */
        }
      }
    }
  }, 25_000)
  if (ping.unref) ping.unref()

  return {
    server,
    wss,
    hosts,
    listen: (port, cb) => server.listen(port, cb),
    close: () =>
      new Promise((resolve) => {
        clearInterval(ping)
        for (const host of hosts.values()) {
          try {
            host.ws.close()
          } catch {
            /* ignore */
          }
        }
        wss.close(() => server.close(() => resolve()))
      }),
    stats: () => ({ hosts: hosts.size })
  }
}
