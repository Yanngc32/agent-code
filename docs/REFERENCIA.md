# Referência de arquivos — Agent Code

Inventário completo do projeto: **cada arquivo versionado** e sua responsabilidade. Para o funcionamento interno, veja [ARQUITETURA.md](ARQUITETURA.md).

## Sumário

- [Raiz do projeto](#raiz-do-projeto)
- [build/ — ícone](#build--ícone)
- [scripts/](#scripts)
- [src/main — processo principal](#srcmain--processo-principal)
- [src/preload — ponte](#srcpreload--ponte)
- [src/shared — contrato compartilhado](#srcshared--contrato-compartilhado)
- [src/renderer — interface](#srcrenderer--interface)
- [Tipos de dados](#tipos-de-dados)

---

## Raiz do projeto

| Arquivo | Responsabilidade |
|---------|------------------|
| `start.bat` | Inicialização no Windows: verifica o Node, instala dependências na primeira vez (baixa o Chromium do Playwright), garante o binário do Electron e roda `npm run dev`. |
| `package.json` | Metadados, **scripts** (`dev`, `build`, `start`, `icon`, `postinstall`, `typecheck`, `test`) e dependências. Runtime: `@anthropic-ai/claude-agent-sdk`, `playwright`, `zod`. Dev: Electron, electron-vite, React 19, TypeScript, Vite, Vitest, jsdom, Testing Library. |
| `package-lock.json` | Lockfile de dependências (gerado). |
| `electron.vite.config.ts` | Config do **electron-vite**: alvos main/preload (com `externalizeDepsPlugin`) e renderer (plugin React + alias `@shared`). |
| `vitest.config.ts` | Config dos testes: ambiente `jsdom`, `globals`, alias `@shared`, plugin React; inclui `src/**/*.test.{ts,tsx}`. |
| `tsconfig.json` | Apenas *project references* para `tsconfig.node.json` e `tsconfig.web.json`. |
| `tsconfig.node.json` | TS do lado Node (`src/main`, `src/preload`, `src/shared`, config). `strict`, `moduleResolution: Bundler`, `types: ["node"]`, alias `@shared/*`. |
| `tsconfig.web.json` | TS do renderer (`src/renderer` + `src/shared`). Igual ao node, com `lib: DOM` e `jsx: react-jsx`. |
| `.gitignore` | Ignora `node_modules/`, `out/`, `dist/`, `.vite/`, logs, `.env*`, `*.tsbuildinfo`, ferramentas locais (`.claude/`, `.mcp.json`, `CLAUDE.md`) e o arquivo solto `{}`. |
| `.gitattributes` | `* text=auto` (normalização de fim de linha). |
| `README.md` | Documentação principal (uso, requisitos, funcionalidades, scripts). |
| `docs/ARQUITETURA.md` | Arquitetura detalhada. |
| `docs/REFERENCIA.md` | Este arquivo. |

---

## build/ — ícone

| Arquivo | Responsabilidade |
|---------|------------------|
| `build/icon.svg` | **Arte-fonte** do ícone (faísca coral `#d97757` sobre quadrado escuro arredondado, com brilho radial). Editável. |
| `build/icon.png` | Ícone 512×512 gerado a partir do SVG (usado como ícone da janela fora do Windows). |
| `build/icon.ico` | Ícone 256×256 para Windows (ICO contendo um PNG). Usado pelo `BrowserWindow`. |

Regenere ambos com `npm run icon` após editar o SVG.

---

## scripts/

| Arquivo | Responsabilidade |
|---------|------------------|
| `scripts/make-icon.mjs` | Usa o **Playwright** (Chromium já instalado) para rasterizar `build/icon.svg` em `icon.png` (512) e `icon.ico` (256). Renderiza o SVG numa página com fundo transparente e tira screenshot (`omitBackground`); monta o `.ico` empacotando o PNG 256 num cabeçalho ICO de uma imagem. |

---

## src/main — processo principal

| Arquivo | Responsabilidade |
|---------|------------------|
| `index.ts` | Cria o `BrowserWindow` (tamanho, ícone, title bar oculta + overlay, CSP via HTML), abre links externos no navegador do sistema e **registra todos os handlers IPC** (incl. `app:pick-file`, `browser:set-active`, `browser:dispose`). Mantém `mainWindow`, `session` e um **`Map<convId, BrowserController>`** + `activeConvId` (um navegador por conversa; só o ativo transmite ao painel). |
| `agentSession.ts` | Encapsula uma conversa com o **Agent SDK**: monta as `Options` (`resume`, `executable: 'node'`, `includePartialMessages`, `settingSources`, system prompt `claude_code` + `BROWSER_HINT`, MCP do navegador, `canUseTool`), itera o stream e traduz cada `SDKMessage` em `ChatEvent`. `send(text, images?)` envia string ou **array de blocos** (imagens base64 + texto). Contém o **gate de permissão** (`handlePermission`, `resolvePermission`, `setBypass`) — todos os `allow` devolvem `updatedInput`. Conjunto `READ_ONLY` de ferramentas auto-aprovadas. |
| `agentSession.test.ts` | Testes (Vitest) do fluxo de permissão: auto-aprova leitura com `updatedInput`; pede no chat para `Bash`; resolve `allow`/`deny`; bypass não pede; ligar bypass resolve pendências. |
| `asyncQueue.ts` | `AsyncQueue<T>` — `AsyncIterable` push-based que alimenta o `query()` do SDK com as mensagens do usuário (pull sob demanda). |
| `browserController.ts` | Encapsula o Chromium do Playwright: launch headless, **screencast CDP** (frames JPEG), `emitState`, **`refreshView`** (re-emite estado + empurra um frame ao reexibir o painel), *picker* de elementos injetado (`PICKER_SCRIPT` + `__agentPick`), reenvio de input do canvas (coordenadas normalizadas) e os métodos usados pelas ferramentas do agente (`navigate`, `snapshot`, `screenshot`, `clickSelector`, `typeText`, `getText`, `evaluate`, `back`, `reload`). |
| `browserTools.ts` | `createBrowserMcpServer(browser)` — expõe o `BrowserController` ao agente como **servidor MCP em processo** (`createSdkMcpServer` + `tool` + esquemas `zod`): `browser_navigate`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_get_text`, `browser_evaluate`, `browser_back`, `browser_reload`. |

---

## src/preload — ponte

| Arquivo | Responsabilidade |
|---------|------------------|
| `index.ts` | Implementa o objeto `api: AgentCodeApi` (mapeando cada método para `ipcRenderer.invoke`/`on`) e o expõe como `window.api` via `contextBridge`. Helper `on()` retorna a função de *unsubscribe*. |
| `index.d.ts` | Declara `Window.api: AgentCodeApi` para o TypeScript. |

---

## src/shared — contrato compartilhado

Importável pelos três processos (somente tipos + constantes).

| Arquivo | Responsabilidade |
|---------|------------------|
| `ipc.ts` | **Fonte única** dos tipos do IPC e dos nomes de canais (`Channels`): `ChatEvent`, `PermissionRequest`/`Response`, `BrowserFrame`/`State`/`Input`, `PickedElement`, `ImageAttachment`, `TokenUsage`, `StartAgentOptions` (com `convId` e `resume`). Canais novos: `pickFile`, `browserSetActive`, `browserDispose`. |
| `api.ts` | Interface `AgentCodeApi` — a forma exata de `window.api` (incl. `pickFile`, `setActiveBrowser`, `disposeBrowser`). |

---

## src/renderer — interface

| Arquivo | Responsabilidade |
|---------|------------------|
| `index.html` | HTML raiz, `<div id="root">`, carrega `src/main.tsx` e define a **Content-Security-Policy**. |
| `src/main.tsx` | Ponto de entrada do React: monta `<UiProvider><App/></UiProvider>` em `StrictMode` e importa `styles.css`. |
| `src/App.tsx` | **Estado central**: lista de `Conversation`, `activeId`, `collapsed`, `browserMinimized`, conexão do agente (`connectedId` + refs), `busy`, `skipPerms`, permissão, *chips*, estado do navegador. Deriva projetos (por `cwd`) e recentes; roteia eventos do agente para a conversa conectada (`reduceMessages`); cria/seleciona/renomeia/exclui conversas (descartando o navegador da conversa em `disposeBrowser`); sincroniza o navegador ativo (`setActiveBrowser`) ao trocar de conversa; conecta o agente (com `convId` + `resume`); envia mensagens; dispara toasts; renderiza topbar + `Sidebar` + `ChatPanel` + `BrowserPanel` + `PermissionModal`. |
| `src/types.ts` | Tipos da UI: `UserMessage`, `UIMessage`, `TokenTotals`, `Conversation`, e a constante `DEFAULT_TITLE`. |
| `src/storage.ts` | Carrega/salva conversas e estado da UI no `localStorage` (`agentcode.conversations.v1`, `agentcode.ui.v1` = `{ collapsed, activeId, browserMinimized }`), tolerante a erros/cota. Descarta o campo `images` (data URLs) ao persistir para não estourar a cota. |
| `src/env.d.ts` | Tipos do ambiente: `Window.api` e o namespace global `JSX` (React 19). |
| `src/styles.css` | Tema (variáveis CSS: `--bg`, `--accent` coral, `--ok`/`--err`/`--warn`, etc.) e **todos** os estilos: topbar, sidebar (expandida/colapsada), chat, cartões de ferramenta, composer, navegador, toasts, modais e animações. |

### src/renderer/src/components

| Arquivo | Responsabilidade |
|---------|------------------|
| `Sidebar.tsx` | Barra de histórico: cabeçalho com marca + botão minimizar; "Nova conversa"; seção **Projetos** (agrupados, expansíveis, com contador) e **Chats** (recentes); trilha de ícones quando colapsada. `ConvRow` é um componente de **nível de módulo** (estável entre renders); a edição é identificada **por linha** (`editing.key`) — não por `id` — porque a mesma conversa aparece em duas seções. Renomear por duplo-clique; excluir via `useUI().confirm` + toast. |
| `Sidebar.test.tsx` | Testes do renomear: a conversa aparece 2×; duplo-clique abre **um** campo; Enter chama `onRename`; Esc cancela. |
| `ChatPanel.tsx` | Cabeçalho "Chat" + medidor de tokens/custo; estado vazio; `MessageList` (com `key={convId}` para resetar a janela ao trocar de conversa); `Composer`. Recebe `hasActive` (habilita o composer) e `projects` (menu `@`). |
| `MessageList.tsx` | Renderiza as mensagens com **janela** (`PAGE`=40; carrega +40 ao rolar ao topo, ancorando o scroll — estilo Gemini). Bolhas de usuário/assistente (incl. **miniaturas de imagens** anexadas), narração discreta vs. resposta final, *thinking*, nota de sistema, erros, e o `ToolCard` (`describeTool`): skill destacada em acento, **`+N`/`−N`** verde/vermelho em edições, nome de arquivo, badge de status (erro em vermelho). Cards não comprimem (`flex-shrink: 0`). Auto-scroll ao fim só quando o usuário já está perto do fim. |
| `Composer.tsx` | Caixa de texto com auto-crescimento (até 8 linhas), *chips* de elementos da página, **botão `@`** (referenciar arquivo/pasta/projeto → insere `@<caminho>`; o agente resolve com `Read`/`Glob`/`LS`), **anexo de imagens** (botão 🖼, colar ou arrastar → `ImageAttachment[]` base64 com miniaturas) e botão **enviar** (↑) / **parar** (■). Enter envia, Shift+Enter quebra linha. |
| `BrowserPanel.tsx` | Painel do navegador: desenha os frames do screencast num `<canvas>`, barra de navegação (**minimizar**/voltar/avançar/recarregar/URL/Go), botão **Select** (seletor de elementos) e barra de status. **Minimizado** vira uma faixa fina com botão de restaurar. Reenvia mouse/scroll/teclado do canvas para a página. |

### src/renderer/src/ui

| Arquivo | Responsabilidade |
|---------|------------------|
| `UiProvider.tsx` | Provider + hook `useUI()` com `notify` (toasts auto-dispensáveis, 3 tipos) e `confirm` (modal que resolve `Promise<boolean>`). Contém `ToastItem` e `ConfirmDialog`. Valor do contexto memoizado. |
| `PermissionModal.tsx` | Pedido de permissão de ferramenta como modal (Negar / Permitir uma vez / Sempre permitir); Esc nega. |

---

## Tipos de dados

Principais formas (ver `src/shared/ipc.ts` e `src/renderer/src/types.ts`):

```ts
// Evento normalizado de chat (main → renderer)
type ChatEvent =
  | { kind: 'system'; sessionId: string; model: string; cwd: string; tools: string[] }
  | { kind: 'assistant-text'; id: string; text: string; final: boolean }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool-use'; id: string; name: string; input: unknown; parentToolUseId: string | null }
  | { kind: 'tool-result'; id: string; toolUseId: string; isError: boolean; text: string }
  | { kind: 'result'; id: string; isError: boolean; text: string; durationMs: number; costUsd?: number; usage?: TokenUsage }
  | { kind: 'status'; id: string; text: string }
  | { kind: 'error'; id: string; text: string }

interface StartAgentOptions { convId: string; cwd: string; model?: string; skipPermissions?: boolean; resume?: string }
interface PermissionRequest { id: string; toolName: string; input: Record<string, unknown> }
interface PermissionResponse { id: string; behavior: 'allow' | 'deny'; always?: boolean; message?: string }

interface BrowserState { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; launched: boolean }
interface BrowserFrame { data: string; width: number; height: number }   // data = JPEG base64
type BrowserInput =
  | { type: 'move'; nx: number; ny: number }
  | { type: 'click'; nx: number; ny: number; button: 'left' | 'right' | 'middle' }
  | { type: 'wheel'; nx: number; ny: number; dx: number; dy: number }
  | { type: 'key'; key: string; text?: string }
interface PickedElement { selector: string; tagName: string; id: string; classes: string; text: string; html: string; url: string }
interface ImageAttachment { mediaType: string; data: string }   // data = base64 sem prefixo

// UI (renderer)
type UIMessage = (ChatEvent | { kind: 'user'; id: string; text: string }) & {
  result?: { isError: boolean; text: string }
  answer?: boolean
}
interface Conversation {
  id: string; title: string; cwd: string; model: string
  sdkSessionId: string | null
  messages: UIMessage[]
  tokens: { context: number; output: number; cost: number }
  createdAt: number; updatedAt: number
}
```

A tabela completa de canais IPC (direção, handler e payload) está em [ARQUITETURA.md](ARQUITETURA.md#contrato-de-ipc).
