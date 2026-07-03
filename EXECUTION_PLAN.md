# EXECUTION_PLAN — Vision Relay (vision_fallback_router) + correção de context windows

## Prompt original do usuário (verbatim)

> Você deve implementar um sistema de Vision Relay.
>
> Objetivo:
> Quando o usuário enviar imagem para um modelo que NÃO suporta visão (ex: GLM, DeepSeek, etc), o
> sistema deve automaticamente interceptar essa imagem e redirecionar para um modelo multimodal
> compatível.
>
> Fluxo obrigatório:
> Detectar se a mensagem contém imagem.
> Se conter imagem:
> Enviar a imagem para um modelo multimodal de alta qualidade
> Esse modelo deve analisar a imagem e retornar uma descrição técnica estruturada.
>
> Formato da extração:
> Texto visível (OCR completo) / Erros encontrados / Elementos de interface (botões, inputs,
> tabelas, labels) / Layout visual / Contexto técnico / Logs ou stack traces / Componentes
> relevantes / Possíveis problemas identificados
>
> Após isso: transformar a resposta em contexto textual, formato [VISUAL_CONTEXT]{resultado}
> [/VISUAL_CONTEXT], injetar esse bloco no prompt original do modelo principal.
>
> Regras: nunca enviar imagem para modelos sem suporte visual; roteamento automático; usuário não
> percebe a troca; modelo principal responde; modelo visual só interpreta. Sem imagem → fluxo normal.
>
> Nome interno: vision_fallback_router
>
> Outra coisa: verificar a janela de contexto real dos modelos (alguns estão com valor errado —
> tem que ser a janela real do modelo).

## Achados da pesquisa (WebSearch, antes de codar)

- Claude (Opus 4.8/Sonnet 5/Fable 5 = 1M, Haiku 4.5 = 200K): já estava **correto** no código.
- Ollama Cloud — 2 valores errados:
  - `deepseek-v4-pro:cloud`: código tinha `128_000`, real é **1_000_000** (1M, MoE 1.6T/49B ativos).
  - `glm-5.2:cloud`: código tinha `200_000`, real é **~1_000_000** (GLM-5.2 estende a janela de
    ~200K da família 5.1 pra ~976K/1M).
  - `qwen3-coder:480b-cloud` (256K) e `gpt-oss:120b/20b-cloud` (128K) já batiam com o real.
- **Achado extra não pedido explicitamente, mas relevante pro Vision Relay:** `kimi-k2.7-code:cloud`
  **JÁ suporta visão nativamente** (encoder MoonViT, aceita imagem/vídeo) — não deve entrar no
  fallback, senão a gente "rebaixaria" um modelo que já vê imagem sozinho. Os outros 5 modelos
  Ollama da lista (qwen3-coder, gpt-oss×2, deepseek-v4-pro, glm-5.2) são texto-only → precisam do
  relay.

## Tarefas

- [x] Tarefa 1 — Corrigir `CONTEXT_LIMITS` + mapear suporte a visão (`src/shared/ipc.ts`):
  - `deepseek-v4-pro:cloud` → `1_000_000`; `glm-5.2:cloud` → `1_000_000`.
  - Nova função `modelSupportsVision(model)`: Claude sempre `true`; Ollama só `true` para
    `kimi-k2.7-code:cloud` (lista `OLLAMA_VISION_MODELS`), demais `false`.
  - Fluxos a validar: typecheck; `contextLimitFor`/`modelSupportsVision` cobertos por teste unitário.
- [x] Tarefa 2 — Módulo `src/main/visionRelay.ts` (`vision_fallback_router`):
  - `describeImages(images, userText)`: dispara um `query()` **avulso** (não a sessão principal),
    modelo multimodal fixo (`claude-sonnet-5`), `tools: []` (só análise, sem ferramentas),
    `maxTurns: 1`, prompt estruturado nos campos pedidos (OCR, erros, elementos de UI, layout,
    contexto técnico, logs/stack traces, componentes, possíveis problemas). Devolve o texto puro
    da análise (sem o wrapper `[VISUAL_CONTEXT]`, isso é responsabilidade de quem injeta).
  - `buildVisualContextBlock(analysis)`: envolve em `[VISUAL_CONTEXT]\n...\n[/VISUAL_CONTEXT]`.
  - Fluxos a validar: teste unitário mocka `query` do SDK e confere prompt/parsing da resposta.
- [x] Tarefa 3 — Interceptar em `AgentSession.send` (`src/main/agentSession.ts`):
  - `send` vira `async`; se `images?.length` e `!modelSupportsVision(this.opts.model)`: chama
    `describeImages`, monta `mensagem original\n\nContexto visual extraído:\n[VISUAL_CONTEXT]...`
    e envia **só texto** (sem os blocos de imagem) pra fila. Falha na análise → aviso curto
    embutido no texto (não trava o envio) — transparente, sem toast especial.
  - Ajustar o `await` em `index.ts` (`agent:send`).
  - Fluxos a validar: typecheck/testes (`agentSession.test.ts` cobre: modelo sem visão + imagem →
    intercepta e chama o relay; modelo com visão (Claude/Kimi) + imagem → segue direto sem relay;
    sem imagem → fluxo idêntico ao atual).
- [x] Tarefa 4 — Validação de runtime + docs:
  - `npm run typecheck && npm test && npm run build` — verdes.
  - Boot real do app (Playwright `_electron`, perfil de verdade) sem erro de import/wiring.
  - **Live E2E com Ollama de verdade abortado por segurança:** exigiria isolar um perfil (HOME
    fake) — mas isso **crasha o Electron no Windows** (só funciona com o perfil de usuário real
    reconhecido pelo SO). Rodar contra o perfil real exigiria fechar o app do PC — e esse app É o
    processo que está executando esta própria sessão (agent-code editando a si mesmo). Matá-lo no
    meio da tarefa sem garantia de reabertura automática é um risco desproporcional pro ganho.
    Decisão do usuário: manter a validação por testes automatizados (cobrem os 5 ramos de decisão
    do roteamento) em vez do teste ao vivo.
  - Atualizar `docs/ARQUITETURA.md`/`REFERENCIA.md`.
