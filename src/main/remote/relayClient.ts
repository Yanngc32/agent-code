// RelayClient — liga o PC ao broker (VPS) por um WebSocket DE SAÍDA, para o
// controle remoto funcionar fora da LAN sem abrir porta nem usar senha de VPS.
//
// O PC disca pro broker e se registra com o seu token. O broker manda, por frames,
// as requests do celular; o RelayClient as repassa ao RemoteServer LOCAL
// (127.0.0.1:porta) — reaproveitando 100% a lógica/auth existente — e devolve a
// resposta (incl. SSE em streaming) em frames. Reconecta sozinho com backoff.
import WebSocket from 'ws'
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from 'node:http'

export interface RelayClientDeps {
  /** URL do broker, ex.: wss://agent-code.larchertech.com/__relay */
  brokerUrl: string
  /** Chave opcional p/ autorizar o uso do broker (o token é a auth real). */
  relayKey?: string
  /** Token fixo desta instalação (o mesmo que o RemoteServer exige). */
  getToken: () => string
  /** Porta do RemoteServer local (pode variar por fallback). */
  getPort: () => number
  /** Notifica mudança de status (conectado ao broker?). */
  onStatus?: (connected: boolean) => void
}

interface OpenFrame {
  type: 'open'
  rid: number
  method: string
  url: string
  headers: Record<string, string>
}

export class RelayClient {
  private ws: WebSocket | null = null
  private stopped = true
  private connected = false
  private backoff = 1000
  private timer: ReturnType<typeof setTimeout> | null = null
  /** rid -> request HTTP local em andamento. */
  private reqs = new Map<number, ClientRequest>()

  constructor(private readonly deps: RelayClientDeps) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.backoff = 1000
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.abortAll()
    this.setConnected(false)
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  private setConnected(v: boolean): void {
    if (this.connected !== v) {
      this.connected = v
      this.deps.onStatus?.(v)
    }
  }

  private abortAll(): void {
    for (const req of this.reqs.values()) {
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
    }
    this.reqs.clear()
  }

  private connect(): void {
    if (this.stopped) return
    const token = this.deps.getToken()
    if (!token) {
      this.scheduleReconnect()
      return
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(this.deps.brokerUrl)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.on('open', () => {
      this.sendTo(ws, { type: 'hello', token, relayKey: this.deps.relayKey || undefined })
    })
    ws.on('message', (raw: WebSocket.RawData) => this.onFrame(ws, raw.toString()))
    ws.on('error', () => {
      /* o 'close' cuida da reconexão */
    })
    ws.on('close', () => {
      this.abortAll()
      this.setConnected(false)
      if (this.ws === ws) this.ws = null
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, 30_000)
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, delay)
  }

  private onFrame(ws: WebSocket, raw: string): void {
    let msg: { type?: string; rid?: number; b64?: string; method?: string; url?: string; headers?: Record<string, string> }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    switch (msg.type) {
      case 'ready':
        this.backoff = 1000
        this.setConnected(true)
        return
      case 'denied':
        // relayKey errado — não adianta martelar; para até reiniciar a ponte.
        this.stop()
        return
      case 'open':
        this.openLocal(ws, msg as OpenFrame)
        return
      case 'data': {
        const req = this.reqs.get(msg.rid as number)
        if (req && msg.b64 != null) req.write(Buffer.from(msg.b64, 'base64'))
        return
      }
      case 'end': {
        const req = this.reqs.get(msg.rid as number)
        if (req) req.end()
        return
      }
      case 'abort': {
        const req = this.reqs.get(msg.rid as number)
        if (req) {
          try {
            req.destroy()
          } catch {
            /* ignore */
          }
          this.reqs.delete(msg.rid as number)
        }
        return
      }
      default:
        return
    }
  }

  private openLocal(ws: WebSocket, msg: OpenFrame): void {
    const port = this.deps.getPort()
    const headers: Record<string, string> = { ...msg.headers, host: `127.0.0.1:${port}` }
    const req = httpRequest(
      { host: '127.0.0.1', port, method: msg.method, path: msg.url, headers },
      (res) => {
        this.sendTo(ws, { type: 'head', rid: msg.rid, status: res.statusCode ?? 502, headers: res.headers as IncomingHttpHeaders })
        res.on('data', (chunk: Buffer) => this.sendTo(ws, { type: 'data', rid: msg.rid, b64: chunk.toString('base64') }))
        res.on('end', () => {
          this.reqs.delete(msg.rid)
          this.sendTo(ws, { type: 'end', rid: msg.rid })
        })
        res.on('error', () => {
          this.reqs.delete(msg.rid)
          this.sendTo(ws, { type: 'error', rid: msg.rid, message: 'res error' })
        })
      }
    )
    req.on('error', (e: Error) => {
      this.reqs.delete(msg.rid)
      this.sendTo(ws, { type: 'error', rid: msg.rid, message: e.message })
    })
    this.reqs.set(msg.rid, req)
    // O corpo (se houver) chega via frames 'data'/'end'. Para GET, o broker manda
    // 'end' logo em seguida, finalizando a request.
  }

  private sendTo(ws: WebSocket, obj: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(obj))
      } catch {
        /* ignore */
      }
    }
  }
}
