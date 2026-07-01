# EXECUTION_PLAN — Uso da conta (5h/semana) no app + aviso no custo estimado

## Prompt original (verbatim)
> sim eu gostaria de trazer essa informação pro app e deixar visuvel pro usuario, o custo da
> api, deixa visivel mas diz q não é o custo real, é apenas se eu tivesse usando a api direto,
> mas como to pelo plano, o custo nao é real, (fa um texto tipo esse q eu falei só q mais claro)

## Contexto (achado por investigação)
- O SDK (`@anthropic-ai/claude-agent-sdk`) já emite `SDKRateLimitEvent` (`type: 'rate_limit_event'`)
  com `rate_limit_info: SDKRateLimitInfo` — `status`, `rateLimitType` ('five_hour' | 'seven_day' |
  'seven_day_opus' | 'seven_day_sonnet' | 'seven_day_overage_included' | 'overage'), `utilization`
  (0..1), `resetsAt` (epoch ms). Só pra contas por assinatura (claude.ai Pro/Max) — chave de API
  avulsa não recebe.
- `agentSession.ts` tem um `switch (message.type)` sem `case 'rate_limit_event'` — cai no
  `default: break` e é descartado hoje.
- O custo (`tokens.cost`, chip `$` no `ChatPanel`) já existe, vem de `total_cost_usd` do SDK —
  é uma estimativa de preço de API avulsa, não uma cobrança real pra quem usa plano.

## Decisões (perguntei, uma não teve resposta a tempo — segui a recomendada)
- **Onde mostrar o uso 5h/semana:** na **topbar**, sempre visível (é da CONTA, não da conversa
  aberta — diferente da barra de contexto/custo, que são por conversa).
- **Visual:** reaproveitar a linguagem visual da `ContextBar` (barra track+fill, âmbar ≥80%,
  vermelho ≥95%) num componente novo e pequeno, não inline no `App.tsx` (que já é grande).
- **Vários tipos de limite:** o evento manda UM tipo por vez — acumular num mapa
  `Record<rateLimitType, RateLimitStatus>`; renderizar só os que a conta realmente usa (5h e
  semana são os principais; se aparecer `seven_day_opus`/`seven_day_sonnet`/`overage`, mostrar
  também, rotulado).
- **Sem dado (conta por chave de API, ou nenhum evento ainda):** não mostrar nada (não inventar
  barra vazia/0%).

## Tarefas
- [x] **T1 — Tipo compartilhado**: `shared/ipc.ts` — `RateLimitStatus` + nova variante
  `ChatEvent` `{ kind: 'rate-limit'; limits: RateLimitStatus }`.
- [x] **T2 — Main**: `agentSession.ts` trata `case 'rate_limit_event'` e emite o evento novo.
  Teste em `agentSession.test.ts` (mensagem SDK → `ChatEvent` correto).
- [x] **T3 — Estado global + UI**: `App.tsx` ganha `usageLimits` (estado **global**, não por
  conversa — `onEvent` retorna cedo pra esse `kind`, sem passar por `patchConv`/`reduceMessages`);
  novo `UsageBadge.tsx` (renderiza nada se vazio); wire na topbar; CSS reaproveitando o padrão do
  `ContextBar`.
- [x] **T4 — Aviso no custo**: `ChatPanel.tsx` — tooltip do chip `$` deixa claro que é estimativa
  de preço de API avulsa, **não é cobrança real** pra quem está no plano; prefixo `~` no valor
  visível como pista permanente (sem precisar passar o mouse).
- [x] **T5 — Validação**: typecheck + testes (incl. `UsageBadge` e o novo `ChatEvent`) + build.
  Docs (`ARQUITETURA.md`/`REFERENCIA.md`) atualizada.

## Fluxos a validar
- Evento `rate_limit_event` chega → badge aparece na topbar com % e tooltip com horário de reset.
- Trocar de conversa → o badge **não** some/zera (é global).
- Sem nenhum evento ainda (ex.: conta por API key) → topbar não mostra nada quebrado/vazio.
- Chip de custo → tooltip deixa claro que não é cobrança real de quem usa plano.
