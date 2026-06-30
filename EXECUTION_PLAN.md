# EXECUTION_PLAN — Broker/relay próprio (acesso remoto multiusuário)

## Prompt original (verbatim)
> Mas esse comando eu vou ter que rodar cada vez que eu botar esse sistema numa máquina de
> algum usuário? Não vai dar certo isso não. E eu não posso passar essa senha dessa VPS para
> qualquer usuário não. Se for assim, preciso criar uma rede interna nessa VPS pra poder fazer
> isso. Eu não posso passar nenhuma senha da VPS pro usuário, mas eu posso gerar um token
> permanente.
> (escolha: **Broker próprio (Node na VPS)**)

## Objetivo
Acesso remoto multiusuário **sem senha de VPS**, roteado pelo **token permanente** de cada
instalação. O PC **disca pra fora** (WebSocket) pro broker na VPS; o celular conecta em
`https://agent-code.larchertech.com/?token=XYZ` (sem mudança no celular) e o broker liga os dois
pelo token. Substitui o túnel SSH reverso.

## Arquitetura (resumo)
- **Broker (VPS, Node, Docker, stateless):** HTTP (celular) + WebSocket `/__relay` (PCs) na mesma
  porta (8099). Mapa `token → conexão do PC`. Cada request do celular é encapsulada em frames e
  enviada ao PC certo; resposta (incl. **SSE em streaming**) volta em frames. Roteia por
  `?token=` (com fallback em cookie `relay_token`).
- **Desktop RelayClient:** WS de saída pro broker, registra `{token, relayKey?}`, e para cada
  request relayada faz um `http.request` pro próprio `127.0.0.1:<porta>` (reaproveita 100% o
  `RemoteServer`). Reconecta com backoff. Liga junto com a "Ligar ponte".
- **Token:** novos passam a 16 bytes (resistência a brute force); tokens já salvos continuam.
- **Segurança:** `RELAY_KEY` **opcional** (default vazio = relay aberto, roteado por token). Sem
  segredo no repo; se ativar, guardar no cofre + `.env-prod`.

## Protocolo WS (broker ↔ PC) — frames JSON
- PC→broker: `{type:'hello', token, relayKey?}` → broker `{type:'ready'}` (substitui host antigo do mesmo token).
- broker→PC: `{type:'open', rid, method, url, headers}`, `{type:'data', rid, b64}`, `{type:'end', rid}`, `{type:'abort', rid}`.
- PC→broker: `{type:'head', rid, status, headers}`, `{type:'data', rid, b64}`, `{type:'end', rid}`, `{type:'error', rid, message}`.
- `url` mantém o `?token=` original (o `RemoteServer` autentica por ele).

## Tarefas
- [x] **T1 — Broker base** (`broker/`): server (http+ws), registro por token, roteamento + relay com SSE, cookie fallback. Dockerfile, docker-compose, `.env`/`.env-prod`, `.dockerignore`, README. **Teste de integração real** (http+ws round-trip, incluindo um evento SSE) via o `npm test` do próprio `broker/`.
- [x] **T2 — RelayClient (desktop)** (`src/main/remote/relayClient.ts`): WS de saída, hello, proxy de cada request pro `127.0.0.1:porta`, streaming de volta, abort, reconexão com backoff. Lógica de framing testável.
- [x] **T3 — Wiring no app**: liga/desliga relay junto com a ponte; `RemoteInfo.relayConnected`; bump do token p/ 16 bytes (novos); status no `RemoteModal`. `npm run typecheck`/`test`/`build` verdes.
- [x] **T4 — E2E real (pipe)**: subir broker local + `RemoteServer` + `RelayClient` e validar com `curl` uma request atravessando o broker pelo token + um evento SSE chegando. (Validação de runtime do núcleo — não dá pra dirigir o GUI do Electron daqui.)
- [x] **T5 — Nginx/deploy**: atualizar `scripts/vps-remote-broker.sh` pra proxiar o broker (8099) com **upgrade de WebSocket** (mantendo SSE); instruções de subir o broker no Docker da VPS (remove o túnel SSH).
- [x] **T6 — Docs + cofre**: `ARQUITETURA.md` + `REFERENCIA.md` (broker, relay, fim do túnel SSH); registrar `RELAY_KEY` no cofre **se** for ativado.

## Fluxos a validar (geral)
- Request do celular com token de um PC conectado → chega no `RemoteServer` daquele PC e volta.
- Dois tokens diferentes → cada um cai no seu PC (isolamento).
- Token sem PC conectado → erro claro (503), não vaza pra outro.
- SSE: evento emitido no PC chega em streaming no celular (sem buffer).
- PC cai e reconecta → relay volta sozinho.
