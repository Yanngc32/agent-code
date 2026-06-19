# Arquitetura — Agent Code

Este documento descreve **como o app funciona por dentro**. Para a referência arquivo por arquivo, veja [REFERENCIA.md](REFERENCIA.md). Para uso/instalação, veja o [README](../README.md).

## Como rodar

A forma padrão de iniciar o projeto é executar o **`start.bat`** na raiz da pasta (duplo-clique no Windows). Ele verifica o Node, instala as dependências na primeira vez (incluindo o Chromium do Playwright), garante o binário do Electron e então roda `npm run dev`. Não é preciso rodar `npm install`/`npm run dev` à mão — o `start.bat` cuida de tudo.

## Sumário

- [Como rodar](#como-rodar)
- [Modelo de processos e segurança](#modelo-de-processos-e-segurança)
- [Sequência de inicialização](#sequência-de-inicialização)
- [Ciclo de vida da sessão do agente](#ciclo-de-vida-da-sessão-do-agente)
- [Tradução de mensagens do SDK em eventos de UI](#tradução-de-mensagens-do-sdk-em-eventos-de-ui)
- [Permissões de ferramentas](#permissões-de-ferramentas)
- [Conversas, projetos e persistência](#conversas-projetos-e-persistência)
- [Interface do chat (cards, janela, referências)](#interface-do-chat-cards-janela-referências)
- [Navegador embutido](#navegador-embutido)
- [Contrato de IPC](#contrato-de-ipc)
- [Notificações e modais](#notificações-e-modais)
- [Build, tipos e ferramentas](#build-tipos-e-ferramentas)
- [Fluxo ponta a ponta de uma mensagem](#fluxo-ponta-a-ponta-de-uma-mensagem)

---

## Modelo de processos e segurança

Três camadas do Electron, com a renderer isolada do Node:

- **Main** (`src/main`, Node): dona da janela, da sessão do agente e do navegador. É o único processo com acesso ao sistema, ao Agent SDK e ao Playwright.
- **Preload** (`src/preload`): ponte segura. Com `contextIsolation: true`, expõe um objeto `window.api` tipado via `contextBridge`, sem vazar o `ipcRenderer` cru para a página.
- **Renderer** (`src/renderer`, React): a interface. Só fala com o main através de `window.api`.

Garantias de segurança:

- `contextIsolation: true` e `sandbox: false` (necessário para o preload usar `ipcRenderer`).
- **Content-Security-Policy** no `index.html`: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'` — só permite recursos próprios + imagens `data:` (os frames JPEG do navegador).
- Links externos (`window.open`/target=_blank) são interceptados em `setWindowOpenHandler` e abertos no navegador padrão do sistema (`shell.openExternal`), nunca dentro do app.

A janela usa `titleBarStyle: 'hidden'` com `titleBarOverlay` (controles do Windows à direita, altura 52). O ícone vem de `build/icon.ico` (Windows) ou `build/icon.png`.

---

## Sequência de inicialização

`src/main/index.ts`:

1. `app.whenReady()` → `registerIpc()` registra **todos** os handlers `ipcMain.handle(...)`.
2. `createWindow()` cria o `BrowserWindow` (1500×950, mínimo 1000×640, `backgroundColor #1f1e1d`, ícone, title bar oculta com overlay).
3. Em dev, carrega `process.env.ELECTRON_RENDERER_URL`; em produção, `out/renderer/index.html`.
4. A `BrowserController` é criada de forma **preguiçosa** (`getBrowser()`), só quando o navegador é realmente necessário.
5. A `AgentSession` é criada a cada `agent:start` (a anterior é descartada com `dispose()`).

No encerramento (`window-all-closed`): fecha o navegador e descarta a sessão; sai do app (exceto no macOS).

---

## Ciclo de vida da sessão do agente

`src/main/agentSession.ts` encapsula uma conversa com o Agent SDK.

**Entrada de mensagens** — uma `AsyncQueue<SDKUserMessage>` (`src/main/asyncQueue.ts`) é passada como `prompt` para o `query()` do SDK. O SDK consome a fila como um `AsyncIterable`; `send(text)` empurra uma mensagem na fila quando o usuário envia algo.

**`start()`** monta as `Options` do SDK e itera o stream:

```ts
const options: Options = {
  cwd,
  model,
  ...(resume ? { resume } : {}),         // retoma uma sessão anterior
  executable: 'node',                    // roda o CLI sob o Node do sistema, não o Electron
  includePartialMessages: true,          // habilita streaming token a token
  permissionMode: 'default',
  settingSources: ['user', 'project', 'local'],   // lê ~/.claude e .claude do projeto
  systemPrompt: { type: 'preset', preset: 'claude_code', append: BROWSER_HINT },
  mcpServers: { browser: createBrowserMcpServer(browser) },
  canUseTool: (toolName, input) => this.handlePermission(toolName, input)
}
this.q = query({ prompt: this.input, options })
for await (const message of this.q) this.handleMessage(message)
```

- `BROWSER_HINT` é um texto anexado ao system prompt explicando que o agente tem as ferramentas `browser_*` e que a página é renderizada ao vivo para o usuário.
- `executable: 'node'` evita que o binário do Electron seja usado como runtime do CLI embutido.
- **Interromper:** `interrupt()` chama `q.interrupt()` (ignora erro se não houver turno ativo).
- **Encerrar:** `dispose()` fecha a fila de entrada (encerra o loop do SDK).

---

## Tradução de mensagens do SDK em eventos de UI

`handleMessage` converte cada `SDKMessage` em um `ChatEvent` normalizado (definido em `src/shared/ipc.ts`) e o emite ao renderer pelo canal `agent:event`:

| Mensagem do SDK | Vira `ChatEvent` |
|-----------------|------------------|
| `system` (subtype `init`) | `{ kind: 'system', sessionId, model, cwd, tools }` |
| `stream_event` → `message_start` | inicia o buffer de texto ao vivo (`liveId`/`liveText`) |
| `stream_event` → `content_block_delta` (`text_delta`) | `{ kind: 'assistant-text', id, text, final: false }` (incremental) |
| `assistant` → bloco `text` | `{ kind: 'assistant-text', ..., final: true }` |
| `assistant` → bloco `thinking` | `{ kind: 'thinking', id, text }` |
| `assistant` → bloco `tool_use` | `{ kind: 'tool-use', id, name, input }` |
| `user` → bloco `tool_result` | `{ kind: 'tool-result', toolUseId, isError, text }` |
| `result` | `{ kind: 'result', isError, text, durationMs, costUsd, usage }` |
| erro no loop | `{ kind: 'error', text }` |

O `sessionId` do evento `system` é capturado pelo renderer e guardado em `Conversation.sdkSessionId` para permitir o `resume` depois. O texto de `result` não é renderizado (duplica a resposta final); ele só serve para marcar a última fala do assistente como "resposta" e atualizar o medidor de tokens/custo.

---

## Permissões de ferramentas

O gate é `canUseTool` → `AgentSession.handlePermission(toolName, input)`.

**Aprovação automática** (retorna na hora) quando:

- `bypassAll` está ligado ("Permitir tudo"); ou
- `toolName` está no conjunto `READ_ONLY` = `Read, Glob, Grep, LS, NotebookRead, TodoWrite, WebFetch, WebSearch`; ou
- `toolName` começa com `mcp__browser__` (ferramentas do navegador); ou
- `toolName` já está em `approvedTools` ("sempre permitir" desta sessão).

**Senão**, registra a pendência e pede ao usuário:

```ts
const id = nextId()
this.askPermission({ id, toolName, input })   // → canal agent:permission-request → modal
return new Promise((resolve) => this.pendingPermissions.set(id, { toolName, input, resolve }))
```

O renderer mostra o `PermissionModal`; a resposta volta por `agent:permission-response` → `resolvePermission(res)`, que resolve a Promise pendente.

### `updatedInput` é obrigatório no `allow`

> Este é o detalhe que causou o bug do "erro de validação interno".

O SDK repassa o retorno do `canUseTool` direto para o CLI embutido, que executa a ferramenta usando o `updatedInput` recebido. Se o `allow` **não devolver** o input, a ferramenta roda com input vazio e falha na própria validação de schema (`Bash` sem `command`, `Write` sem `content`, …). Ferramentas de leitura não quebravam porque são pré-aprovadas pelo CLI e **nem chegam** ao nosso gate.

Por isso **todos** os caminhos de aprovação devolvem o input:

```ts
// auto-aprovação
return Promise.resolve({ behavior: 'allow', updatedInput: input })
// aprovação pelo usuário (resolvePermission)
pending.resolve({ behavior: 'allow', updatedInput: pending.input })
// "permitir tudo" ligado ao vivo (setBypass) resolve as pendências
pending.resolve({ behavior: 'allow', updatedInput: pending.input })
```

A negação retorna `{ behavior: 'deny', message }`.

### "Permitir tudo" a quente

`setBypass(on)` alterna `bypassAll` durante a sessão. Ao **ligar**, resolve imediatamente todas as permissões pendentes (com `updatedInput`). É acionado por:

- `skipPermissions` ao iniciar a sessão (checkbox marcado no momento de conectar), ou
- o canal `agent:set-bypass` quando o usuário marca/desmarca o interruptor com a sessão já conectada.

Comportamento garantido (e coberto por testes em `agentSession.test.ts`):

- Sem permissão e sem bypass → **pergunta no chat** (modal).
- Com "Permitir tudo" → **não pergunta nada** e libera tudo.
- Todo `allow` devolve o `input` original.

---

## Conversas, projetos e persistência

O estado central vive em `src/renderer/src/App.tsx`.

**Modelo** — uma lista de `Conversation` (ver [REFERENCIA.md](REFERENCIA.md#tipos-de-dados)) e um `activeId`. Os **projetos** da barra são derivados (memoizados) agrupando as conversas por `cwd`; os **recentes** são as 15 conversas mais recentes por `updatedAt`.

**Conexão por conversa** — só existe **uma** sessão de agente no main. O renderer guarda qual conversa está conectada (`connectedId`) e usa *refs* (`connectedRef`, `activeIdRef`, etc.) para que o listener de eventos (registrado uma vez) e os handlers assíncronos sempre vejam o valor atual. Ao enviar uma mensagem numa conversa não conectada, `connect()` chama `agent:start` com o `cwd`, `model`, `skipPermissions` e o `resume` daquela conversa.

**Roteamento de eventos** — `onEvent` direciona cada `ChatEvent` para a conversa **conectada** (não a ativa), de modo que respostas continuem indo para a conversa certa mesmo se o usuário trocar de visão. `reduceMessages` é um reducer puro que:

- atualiza o texto ao vivo do assistente (mesmo `id`),
- anexa o `result` a um `tool-use` existente,
- marca a última fala como "resposta" no `result`,
- e dedup­lica a nota de "sessão pronta".

**Persistência** (`src/renderer/src/storage.ts`):

- `agentcode.conversations.v1` — todas as conversas; salvo com **debounce de 400ms** (o streaming muda o estado muitas vezes por segundo).
- `agentcode.ui.v1` — `{ collapsed, activeId, browserMinimized }`.
- Um *flag* `hydrated` evita sobrescrever o storage antes de carregar.

---

## Interface do chat (cards, janela, referências)

`src/renderer/src/components/MessageList.tsx` e `Composer.tsx` concentram a apresentação do chat.

**Cards de ferramenta/skill** (`ToolCard` + `describeTool`) — cada `tool_use` vira um card compacto que **encolhe para o tamanho do conteúdo** (`align-self: flex-start`) e **nunca é espremido verticalmente** na coluna rolável (`flex-shrink: 0`). `describeTool` deriva um rótulo no estilo Claude Code:

- **Skill** → mostra o nome real da skill (de `input.skill`), com destaque em cor de acento e fonte em tamanho normal para não se perder no meio do texto.
- **Edit/Write/MultiEdit/NotebookEdit** → nome do arquivo + contadores **`+N`** (verde) / **`−N`** (vermelho) de linhas, calculados de `new_string`/`old_string`/`content`.
- **Read** → nome do arquivo; demais ferramentas → nome limpo (sem o prefixo `mcp__…`).

O badge de status é `running…`/`done`/`error` (erro em vermelho). O corpo expansível mostra `input` e `result`.

**Renderização em janela** — conversas longas só renderizam as últimas `PAGE` (40) mensagens. Ao rolar perto do topo (`scrollTop < 80`) e havendo mais antigas, `visible` cresce em +`PAGE` e a posição do scroll é **ancorada** num `useLayoutEffect` (ajusta `scrollTop` pela diferença de altura) para a vista não saltar — estilo Gemini. O auto-scroll para o fim só ocorre na primeira pintura e quando o usuário já está perto do fim (`atBottom`). A janela é **resetada por conversa** via `key={convId}` no `MessageList`.

**Referências `@`** (`Composer.tsx`) — um botão `@` ao lado do campo abre um menu para referenciar **arquivo** (`app:pick-file`), **pasta** (`app:pick-directory`) ou **outro projeto do histórico** (lista derivada em `App`). A escolha insere `@<caminho>` no cursor; **não há leitura própria de arquivos** — o agente resolve a referência com as ferramentas nativas (`Read`/`Glob`/`LS`, auto-aprovadas).

**Minimizar o navegador** — `BrowserPanel` aceita `minimized`/`onToggleMinimize`; minimizado, colapsa para uma faixa fina com botão de restaurar e o chat ocupa a largura toda. O estado persiste em `agentcode.ui.v1`.

---

## Navegador embutido

`src/main/browserController.ts` encapsula um Chromium do Playwright.

**Um navegador por conversa** — o main mantém um `Map<convId, BrowserController>` e um `activeConvId` (a conversa cujo navegador o painel mostra no momento). `getBrowser(convId)` cria sob demanda; os *callbacks* (`onFrame`/`onState`/`onPicked`) só repassam ao renderer quando `convId === activeConvId`, então navegadores de conversas em segundo plano seguem vivos sem pintar por cima do que o usuário vê. Ao trocar de conversa, o renderer manda `browser:set-active`; o main faz `refreshView()` (re-emite o estado e empurra um frame via screenshot, pois o screencast só envia frames em mudança) ou, se aquela conversa não tem navegador, envia o estado vazio. Deletar a conversa dispara `browser:dispose` (fecha e remove do `Map`). A sessão do agente recebe `getBrowser(opts.convId)`, então as ferramentas `browser_*` agem no navegador da própria conversa.

- **Headless + screencast:** `chromium.launch({ headless: true })`, contexto com viewport 1280×800. A página é transmitida por **CDP `Page.startScreencast`** (JPEG, qualidade 60); cada frame vira `{ data, width, height }` enviado por `browser:frame`. Os frames são confirmados com `screencastFrameAck`.
- **Estado:** `emitState()` envia `browser:state` (`url`, `title`, `loading`, `canGoBack/Forward`, `launched`) em navegações e `load`.
- **Seletor de elementos (picker):** um *init script* (`PICKER_SCRIPT`) é injetado em toda página. Quando `window.__agentSelectMode` está ligado, ele desenha um realce no hover e, ao clicar, chama `window.__agentPick` (exposta via `exposeFunction`) com seletor/tag/id/classes/texto/HTML; isso vira `browser:picked` → vira um *chip* no composer.
- **Entrada do usuário:** `forwardInput` recebe eventos do canvas com coordenadas **normalizadas** (0–1) e os reaplica na página (mouse via Playwright; *wheel* via CDP `Input.dispatchMouseEvent`; teclado por `type`/`press`).
- **Ferramentas do agente:** métodos `navigate`, `snapshot` (digest estruturado: título, url, texto, elementos interativos), `screenshot` (PNG base64), `clickSelector`, `typeText`, `getText`, `evaluate`, `back`, `reload`.

`src/main/browserTools.ts` empacota esses métodos como um **servidor MCP em processo** (`createSdkMcpServer`), expondo as ferramentas `browser_navigate`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_get_text`, `browser_evaluate`, `browser_back`, `browser_reload` (esquemas validados com `zod`).

---

## Contrato de IPC

Nomes em `src/shared/ipc.ts` (`Channels`). Tipos da API em `src/shared/api.ts`; ponte no preload.

### Renderer → Main (`ipcRenderer.invoke` / `ipcMain.handle`)

| Constante | Canal | Handler (main) | Payload |
|-----------|-------|----------------|---------|
| `pickDirectory` | `app:pick-directory` | abre `dialog.showOpenDialog` (pasta) | — → `string \| null` |
| `pickFile` | `app:pick-file` | abre `dialog.showOpenDialog` (arquivo) | — → `string \| null` |
| `agentStart` | `agent:start` | descarta a sessão e cria nova (usa `getBrowser(convId)`) | `StartAgentOptions` `{ convId, cwd, model?, skipPermissions?, resume? }` |
| `agentSend` | `agent:send` | `session.send(text)` | `string` |
| `agentInterrupt` | `agent:interrupt` | `session.interrupt()` | — |
| `agentSetBypass` | `agent:set-bypass` | `session.setBypass(on)` | `boolean` |
| `agentPermissionResponse` | `agent:permission-response` | `session.resolvePermission(res)` | `PermissionResponse` |
| `browserLaunch` | `browser:launch` | `browser.ensureLaunched()` | — |
| `browserNavigate` | `browser:navigate` | `browser.navigate(url)` | `string` → `string` |
| `browserBack` / `browserForward` / `browserReload` | `browser:back` / `:forward` / `:reload` | navegação | — |
| `browserSetSelectMode` | `browser:set-select-mode` | `browser.setSelectMode(on)` | `boolean` |
| `browserInput` | `browser:input` | `browser.forwardInput(ev)` (navegador ativo) | `BrowserInput` |
| `browserClose` | `browser:close` | `browser.close()` (navegador ativo) | — |
| `browserSetActive` | `browser:set-active` | define `activeConvId` e repinta o painel (`refreshView`) | `string \| null` |
| `browserDispose` | `browser:dispose` | fecha e remove o navegador da conversa | `string` |

> Os controles manuais do painel (`launch`/`navigate`/`back`/`forward`/`reload`/`set-select-mode`/`input`/`close`) agem sempre no navegador da **conversa ativa** (`activeConvId`).

### Main → Renderer (`webContents.send` / `ipcRenderer.on`)

| Constante | Canal | Payload |
|-----------|-------|---------|
| `agentEvent` | `agent:event` | `ChatEvent` |
| `agentPermissionRequest` | `agent:permission-request` | `PermissionRequest` `{ id, toolName, input }` |
| `browserFrame` | `browser:frame` | `BrowserFrame` `{ data, width, height }` |
| `browserStateChanged` | `browser:state` | `BrowserState` |
| `browserPicked` | `browser:picked` | `PickedElement` |

---

## Notificações e modais

`src/renderer/src/ui/UiProvider.tsx` provê o contexto `useUI()` com:

- **`notify(tipo, msg)`** — adiciona um toast ao array de estado. Cada `ToastItem` se auto-remove após `TOAST_MS` (4500ms): marca `leaving` (animação de saída ~280ms) e então chama `onClose`. Fecha também no clique. Três tipos com cor: `sucesso`/`erro`/`aviso`.
- **`confirm(opts)`** — guarda `{ opts, resolve }` no estado e renderiza o `ConfirmDialog`; o clique resolve a `Promise<boolean>`. `Enter` confirma, `Esc`/clique no overlay cancela; `danger: true` deixa o botão de confirmar vermelho.

O valor do contexto é memoizado (`useMemo`) para os consumidores não re-renderizarem a cada toast. O `App` é envolvido pelo `UiProvider` em `main.tsx`, então qualquer componente (incl. `Sidebar`) usa `useUI()`.

`PermissionModal` reusa o mesmo visual de modal para o pedido de permissão do agente, com 3 ações (Negar / Permitir uma vez / Sempre permitir).

---

## Build, tipos e ferramentas

- **electron-vite** (`electron.vite.config.ts`): três alvos. Main e preload usam `externalizeDepsPlugin()` para **não empacotar** o Agent SDK nem o Playwright (eles abrem subprocessos/navegadores nativos). A renderer usa o plugin do React e o alias `@shared → src/shared`.
- **TypeScript** com *project references* (`tsconfig.json` → `tsconfig.node.json` + `tsconfig.web.json`). `node` cobre `src/main`, `src/preload`, `src/shared`; `web` cobre `src/renderer` + `src/shared` (com `lib: DOM`, `jsx: react-jsx`). Ambos `strict`, `moduleResolution: Bundler`, alias `@shared/*`.
- **Vitest** (`vitest.config.ts`): ambiente `jsdom`, `globals`, alias `@shared`, plugin do React; inclui `src/**/*.test.{ts,tsx}`.
- **Ícone** (`scripts/make-icon.mjs`): usa o Playwright para renderizar `build/icon.svg` e salvar `icon.png` (512) e `icon.ico` (256, ICO de uma imagem PNG). Rodar com `npm run icon`.

---

## Fluxo ponta a ponta de uma mensagem

1. Usuário digita no `Composer` e envia → `App.sendMessage(text)`.
2. Se houver *chips* (elementos selecionados na página), eles são anexados ao texto.
3. Se a conversa ativa não está conectada, `connect()` dispara `agent:start` (com `resume` se houver) → o main cria uma `AgentSession` e começa o loop do SDK.
4. A mensagem do usuário é adicionada à conversa (e vira o título, se ainda for o padrão) e enviada por `agent:send` → entra na `AsyncQueue`.
5. O SDK processa: emite `system` (init, captura `sessionId`), textos em streaming, `thinking`, `tool_use`.
6. Cada `tool_use` passa pelo gate de permissão: auto-aprovado (com `updatedInput`) ou pede no modal.
7. Ferramentas `browser_*` dirigem o Chromium; os frames aparecem ao vivo no `BrowserPanel`.
8. `tool_result` e a resposta final chegam como `ChatEvent`; o `MessageList` renderiza os cartões e a resposta; o medidor de tokens/custo é atualizado pelo `result`.
9. Tudo é persistido (debounce) no `localStorage` e reaparece no próximo início.
