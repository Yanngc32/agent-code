# Agent Code

Interface desktop (estilo **Claude Desktop**) para o **Claude Code**, com um **navegador embutido controlado pelo agente**. Você conversa com o agente à esquerda e ele pode abrir, navegar e interagir com páginas web num navegador renderizado ao vivo dentro do próprio app, à direita.

Construído com **Electron + React + TypeScript**, usando o **Claude Agent SDK** para o agente e o **Playwright** para o navegador.

---

## Sumário

- [Como iniciar](#como-iniciar)
- [Requisitos](#requisitos)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Histórico de conversas e persistência](#histórico-de-conversas-e-persistência)
- [Permissões de ferramentas](#permissões-de-ferramentas)
- [Notificações e modais](#notificações-e-modais)
- [Navegador embutido](#navegador-embutido)
- [Canais de IPC](#canais-de-ipc)
- [Scripts npm](#scripts-npm)
- [Solução de problemas](#solução-de-problemas)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Como iniciar

No Windows, o jeito recomendado é o **`start.bat`** (dê duplo-clique ou rode pelo terminal):

```bat
start.bat
```

Ele faz tudo automaticamente:

1. Verifica se o **Node.js** está instalado.
2. Instala as dependências (`npm install`) na primeira vez — isso também baixa o **Chromium do Playwright**.
3. Garante que o binário do **Electron** foi baixado (`node_modules/electron/dist/electron.exe`).
4. Inicia o app em modo de desenvolvimento (`npm run dev`).

Se preferir rodar manualmente:

```bash
npm install      # instala deps + baixa o Chromium (postinstall)
npm run dev      # inicia o app (electron-vite dev)
```

---

## Requisitos

- **Node.js 20+** no `PATH`.
- **Windows** para o `start.bat` (o app em si é multiplataforma via Electron, mas o script de inicialização é `.bat`).
- **Claude Code autenticado.** O agente usa o preset `claude_code` do Agent SDK e lê as configurações do usuário em `~/.claude`. É preciso ter o Claude Code autenticado na máquina (variável `ANTHROPIC_API_KEY` **ou** login do Claude Code / assinatura). Sem isso, a sessão do agente inicia mas falha ao responder.
- Conexão com a internet na primeira execução (download do Chromium e do binário do Electron).

---

## Funcionalidades

- **Chat com o agente** com streaming de texto, blocos de raciocínio (*thinking*), cartões de ferramenta expansíveis (entrada/saída de cada tool) e medidor de **tokens e custo** da sessão.
- **Barra de histórico de conversas** à esquerda (estilo Claude Desktop):
  - **Colapsável** (botão de minimizar) — expandida (264px) ou trilha de ícones (56px).
  - Seção **Projetos**: conversas agrupadas pela pasta do projeto (`cwd`), cada projeto expansível com seus chats aninhados e um contador.
  - Seção **Chats**: lista plana das conversas mais recentes.
  - **Nova conversa** (reaproveita a pasta atual) e **novo projeto** (escolhe outra pasta).
  - **Renomear** com **duplo-clique** no item (Enter salva, Esc cancela).
  - **Excluir** com confirmação em modal.
- **Persistência** das conversas (em `localStorage`) — o histórico reabre entre reinícios, junto com o estado de minimizado e a conversa ativa. Conversas antigas **retomam o contexto** do agente via `resume` do SDK.
- **Navegador embutido** controlado pelo agente (Playwright headless transmitido ao app via screencast CDP), com barra de navegação, interação por mouse/teclado e um **seletor de elementos** que envia o elemento clicado para o chat.
- **Permissões de ferramentas**: ferramentas de leitura são aprovadas automaticamente; as demais pedem confirmação num **modal**. Há um interruptor **“Permitir tudo”** que pode ser ligado/desligado a quente.
- **Notificações (toasts)** modernas para sucesso/erro/aviso.
- **Seleção de modelo**: Opus 4.8, Sonnet 4.6, Haiku 4.5.

---

## Arquitetura

O app segue o modelo de três camadas do Electron:

```
┌──────────────────────────────────────────────────────────────┐
│  Renderer (React)  —  src/renderer                            │
│  • App.tsx: estado central (conversas, projeto ativo, tokens) │
│  • Sidebar / ChatPanel / Composer / MessageList / BrowserPanel│
│  • ui/: toasts + modais (UiProvider, PermissionModal)         │
│           │  window.api (contextBridge)                       │
└───────────┼──────────────────────────────────────────────────┘
            │  IPC (canais em src/shared/ipc.ts)
┌───────────┼──────────────────────────────────────────────────┐
│  Preload  —  src/preload/index.ts                            │
│  • expõe window.api de forma segura (contextIsolation)       │
└───────────┼──────────────────────────────────────────────────┘
            │
┌───────────┼──────────────────────────────────────────────────┐
│  Main (Node)  —  src/main                                    │
│  • index.ts: janela + handlers IPC                           │
│  • AgentSession: Claude Agent SDK (stream, permissões, resume)│
│  • BrowserController: Playwright headless + screencast + picker│
│  • browserTools: navegador exposto ao agente como MCP server  │
└──────────────────────────────────────────────────────────────┘
```

Pontos-chave:

- O **processo main** mantém **uma** `AgentSession` por vez e **uma** `BrowserController`. Trocar de conversa reinicia a sessão do agente para a pasta daquela conversa (com `resume` quando há histórico salvo).
- O navegador é entregue ao agente como um **servidor MCP em processo** (`createBrowserMcpServer`), com as ferramentas `browser_navigate`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_get_text`, `browser_evaluate`, `browser_back`, `browser_reload`.
- As mensagens do usuário chegam ao SDK por uma **fila assíncrona** (`AsyncQueue`), consumida pelo `query()` do SDK.
- O `electron.vite.config.ts` mantém o **Agent SDK** e o **Playwright** como dependências externas (não empacotadas), pois iniciam subprocessos/navegadores nativos. O alias `@shared` aponta para `src/shared`.

---

## Estrutura de pastas

```
agent-code/
├─ start.bat                    # inicialização no Windows (Node → deps → Electron → app)
├─ package.json
├─ electron.vite.config.ts      # config do electron-vite (main / preload / renderer)
├─ tsconfig*.json
├─ src/
│  ├─ main/                     # processo principal (Node)
│  │  ├─ index.ts               # cria a janela e registra os handlers IPC
│  │  ├─ agentSession.ts        # sessão do Agent SDK (stream, permissões, resume, bypass)
│  │  ├─ browserController.ts   # Playwright headless + screencast CDP + seletor de elementos
│  │  ├─ browserTools.ts        # navegador exposto ao agente como servidor MCP
│  │  └─ asyncQueue.ts          # fila async que alimenta o SDK com as mensagens do usuário
│  ├─ preload/
│  │  ├─ index.ts               # expõe window.api via contextBridge
│  │  └─ index.d.ts
│  ├─ shared/
│  │  ├─ ipc.ts                 # contrato de tipos + nomes dos canais IPC
│  │  └─ api.ts                 # interface de window.api (AgentCodeApi)
│  └─ renderer/                 # interface (React)
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx            # monta <UiProvider><App/></UiProvider>
│        ├─ App.tsx             # estado central: conversas, projetos, conexão, tokens
│        ├─ types.ts            # tipos da UI (UIMessage, Conversation, TokenTotals)
│        ├─ storage.ts          # carregar/salvar conversas e estado da UI no localStorage
│        ├─ styles.css          # tema (variáveis CSS) + todos os estilos
│        ├─ components/
│        │  ├─ Sidebar.tsx      # barra de histórico (Projetos/Chats, colapsável, renomear/excluir)
│        │  ├─ ChatPanel.tsx    # cabeçalho do chat + medidor de tokens + lista + composer
│        │  ├─ MessageList.tsx  # render das mensagens e cartões de ferramenta
│        │  ├─ Composer.tsx     # caixa de texto (auto-grow), chips e enviar/parar
│        │  └─ BrowserPanel.tsx # canvas do screencast + barra de navegação + seletor
│        └─ ui/
│           ├─ UiProvider.tsx   # contexto useUI(): notify (toasts) + confirm (modal)
│           └─ PermissionModal.tsx # pedido de permissão de ferramenta em modal
└─ out/                         # saída do build (gerado)
```

---

## Histórico de conversas e persistência

Cada conversa é representada pelo tipo `Conversation` (em `src/renderer/src/types.ts`):

```ts
interface Conversation {
  id: string
  title: string          // derivado da 1ª mensagem; editável por duplo-clique
  cwd: string            // pasta do projeto em que o agente roda
  model: string
  sdkSessionId: string | null  // id da sessão do SDK, usado para retomar (resume)
  messages: UIMessage[]
  tokens: { context: number; output: number; cost: number }
  createdAt: number
  updatedAt: number
}
```

- **Agrupamento por projeto:** os projetos da barra são derivados agrupando as conversas pelo `cwd`. Um projeto só aparece se tiver ao menos uma conversa.
- **Persistência local** (`src/renderer/src/storage.ts`), salva com *debounce* para não escrever a cada token do streaming:
  - `agentcode.conversations.v1` — todas as conversas (metadados + transcrição renderizada).
  - `agentcode.ui.v1` — `{ collapsed, activeId }` (estado de minimizado e conversa ativa).
- **Retomada (resume):** ao enviar uma mensagem numa conversa que não está conectada, o app reinicia o agente na pasta dela e passa `resume: sdkSessionId` (quando existe), recarregando o contexto anterior. O Agent SDK guarda o histórico real em `~/.claude/projects`.

---

## Permissões de ferramentas

Toda chamada de ferramenta passa pelo *gate* em `AgentSession.handlePermission`. É **aprovada automaticamente** quando:

- está em **modo “Permitir tudo”** (`bypassAll`); **ou**
- é uma ferramenta **somente leitura**: `Read`, `Glob`, `Grep`, `LS`, `NotebookRead`, `TodoWrite`, `WebFetch`, `WebSearch`; **ou**
- é uma ferramenta do **navegador** (`mcp__browser__*`); **ou**
- já foi marcada como **“sempre permitir”** nesta sessão.

Caso contrário, abre o **modal de permissão** (`PermissionModal`) com as opções **Negar / Permitir uma vez / Sempre permitir**. O interruptor **“Permitir tudo”** na barra superior liga/desliga o bypass a quente — ao ligar, qualquer pedido pendente é aprovado na hora.

---

## Notificações e modais

Toda confirmação e todo feedback transitório usam UI própria (sem `alert`/`confirm` nativos do navegador). Disponível via o hook `useUI()` (em `src/renderer/src/ui/UiProvider.tsx`):

- `notify(tipo, msg)` — **toast** no canto superior-direito, empilhado, com slide-in, que **some sozinho (~4,5s)** com fade-out e pode ser fechado no clique. Três tipos: `sucesso` (verde), `erro` (vermelho), `aviso` (âmbar).
- `confirm(opts)` — abre um **modal** estilizado e resolve uma `Promise<boolean>` (Enter confirma, Esc/clique fora cancela; botão de perigo opcional).

Toasts aparecem em: conversa excluída, erro do agente, conexão bem-sucedida, cancelamento da escolha de pasta e ao ligar/desligar “Permitir tudo”.

---

## Navegador embutido

- **Headless + screencast:** o Chromium roda invisível (`headless: true`) e a página é transmitida ao `<canvas>` do app via **CDP `Page.startScreencast`** (JPEG, viewport 1280×800). Nenhuma janela de navegador aparece no sistema.
- **Interação:** mouse (mover/clicar/scroll) e teclado feitos sobre o canvas são reenviados à página (coordenadas normalizadas).
- **Seletor de elementos:** o botão **Select** liga um *picker* injetado em toda página; clicar num elemento envia seletor/texto/HTML como um **chip** para o composer do chat.
- **Controle pelo agente:** as ferramentas MCP (`browser_*`) deixam o agente navegar, tirar *snapshot* estruturado, capturar screenshot, clicar, digitar, ler texto e avaliar JS — tudo visível ao vivo para o usuário.

---

## Canais de IPC

Definidos em `src/shared/ipc.ts` (constante `Channels`).

**Renderer → Main (invoke):**

| Canal | Função |
|------|--------|
| `app:pick-directory` | abre o seletor de pasta |
| `agent:start` | inicia/reinicia a sessão do agente (`{ cwd, model, skipPermissions, resume }`) |
| `agent:send` | envia uma mensagem do usuário |
| `agent:interrupt` | interrompe o turno atual |
| `agent:set-bypass` | liga/desliga “permitir tudo” |
| `agent:permission-response` | responde a um pedido de permissão |
| `browser:launch` / `navigate` / `back` / `forward` / `reload` | controle do navegador |
| `browser:set-select-mode` / `input` / `close` | seletor, input e fechar |

**Main → Renderer (send):**

| Canal | Payload |
|------|---------|
| `agent:event` | eventos de chat (texto, thinking, tool-use/result, result, error, system) |
| `agent:permission-request` | pedido de permissão de ferramenta |
| `browser:frame` | frame JPEG do screencast |
| `browser:state` | estado do navegador (url, título, launched…) |
| `browser:picked` | elemento capturado pelo seletor |

---

## Scripts npm

| Script | O que faz |
|--------|-----------|
| `npm run dev` | inicia o app em desenvolvimento (`electron-vite dev`) |
| `npm run build` | compila main/preload/renderer para `out/` |
| `npm run start` | pré-visualiza o build (`electron-vite preview`) |
| `npm run typecheck` | checagem de tipos (`tsc` para node e web) |
| `postinstall` | `playwright install chromium` (automático após `npm install`) |

---

## Solução de problemas

- **“Node.js não encontrado”** — instale o Node 20+ de [nodejs.org](https://nodejs.org) e reabra o terminal.
- **Binário do Electron ausente** — o `start.bat` tenta baixar com `node node_modules/electron/install.js`. Rode esse comando manualmente se necessário.
- **Chromium do Playwright** — baixado no `postinstall`. Para forçar: `npx playwright install chromium`.
- **Agente inicia mas não responde** — provável falta de autenticação do Claude Code. Configure `ANTHROPIC_API_KEY` ou faça login do Claude Code.
- **Conversa antiga não retoma o contexto** — o `resume` depende dos arquivos de sessão do SDK em `~/.claude/projects`. Se foram apagados, a transcrição continua visível na barra, mas o contexto do agente recomeça do zero (sem erro).

---

## Limitações conhecidas

- **Uma sessão de agente por vez.** Enviar mensagem em outra conversa reinicia o agente para a pasta dela; um turno em andamento na conversa anterior é encerrado.
- O histórico fica no `localStorage` da máquina (não sincroniza entre dispositivos).
- `browser_evaluate` usa `eval` na página (intencional, para o agente inspecionar/manipular o DOM).
- O `start.bat` cobre o fluxo de Windows; em outros sistemas use os scripts npm diretamente.
