# Design — Skill-gated tool domains (tools modulares sob demanda)

**Data:** 2026-08-01
**Status:** Aprovado pelo usuário (núcleo + domínios, loop por-rodada, persistência por sessão)
**Escopo:** Cafezin app — `app/` (loops de agente Copilot + SDK)

## Problema

O agente envia o toolset completo (~29–39 tools, ~11–16k tokens) em **todo** request,
mesmo quando a tarefa é só escrita. `read_skill` já carrega conteúdo sob demanda, mas as
tools de domínio (canvas, web, export, memory, tasks) vão junto em todos os rounds.

## Objetivo

Tools modulares inseridas sob demanda: o **modelo decide** quando ativar um domínio
(chamando `read_skill('canvas')` etc.), e as tools daquele domínio entram no payload das
próximas rodadas. Economia de ~60–85% do custo fixo por rodada.

## Decisões de design (aprovadas)

1. **Modelo decide via skill (multi-round)** — `read_skill(name)` ativa o domínio.
2. **Loop por-rodada unificado** — todos os providers (cafezin + OpenAI/Anthropic/Groq/Google/custom) usam o mesmo loop manual por-rodada (como o Copilot já é).
3. **Núcleo mínimo + task tracking** (~15 tools sempre presentes).
4. **Erro com dica de ativação** — tool de domínio chamada sem ativação retorna mensagem orientando `read_skill('x')`.
5. **Ativação persiste por sessão** — domínio ativado continua ativo nos próximos turnos da mesma sessão.

## Arquitetura

### 1. Registro `toolDomains.ts` (novo)

Fonte única com o núcleo e os domínios:

```ts
CORE_TOOLS = [
  'list_workspace_files', 'outline_workspace', 'search_workspace_index',
  'read_workspace_file', 'read_multiple_files', 'write_workspace_file',
  'patch_workspace_file', 'search_workspace', 'multi_patch',
  'duplicate_file', 'create_folder',
  'ask_user', 'read_skill', 'create_task', 'update_task_step', 'list_tasks',
]

TOOL_DOMAINS = [
  { skill:'canvas',      tools:['list_canvas_shapes','canvas_op','canvas_screenshot','screenshot_preview','add_canvas_image'] },
  { skill:'spreadsheet', tools:['read_spreadsheet','write_spreadsheet'] },
  { skill:'export',      tools:['export_workspace','configure_export_targets','publish_vercel'] },
  { skill:'memory',      tools:['remember','manage_memory'] },
  { skill:'html',        tools:['web_search','search_images','fetch_url','screenshot_preview'] },
  { skill:'code',        tools:['run_command'] },
]
```

- Núcleo e domínios são **disjuntos** (validação em teste).
- `read_skill` existente continua retornando conteúdo; a descrição da tool passa a citar
  quais tools cada skill ativa (ex: `canvas → list_canvas_shapes, canvas_op, ...`).
- MCP tools (`mcp__*`) ficam **fora** do sistema de domínios: entram sempre que conectadas
  (decisão: são poucas e explícitas do usuário; revisitar depois se inflarem).

### 2. Montagem do toolset

Nova função `assembleActiveTools(allTools, activeDomains)`:

```
1. getWorkspaceTools()          → tools permitidas por capability (fluxo existente)
2. filterToolsByIntent(...)     → gating por intenção (fluxo existente, path SDK já tem)
3. assembleActiveTools(...)     → NOVO: mantém CORE_TOOLS + tools dos activeDomains;
                                  remove tools de domínios não ativados
```

A ordem garante que os gates existentes continuam valendo (capability > intent > domain).

### 3. Loop por-rodada unificado (`runProviderAgent` reescrito)

- Trocar `streamText({ tools, stopWhen })` por loop manual:
  - a cada round: `streamText({ tools: toolsDoRound, maxSteps: 1, prepareStep (compressão/visão) })`
  - coletar `tool_calls` + `text` (streaming real preservado via `onChunk`)
  - executar via executor (paralelismo por dependência mantido, como no Copilot)
  - **detectar `read_skill(name)` nos tool calls** → registrar domínio no estado da sessão
  - próximo round re-monta `tools` com os domínios ativos
- Limite de rounds: manter 40 (alinhado com o cap atual do SDK e o novo MAX_ROUNDS do Copilot).
- Compressão/visão/thinking/erros: preservar as implementações existentes (prepareStep atual
  já faz compressão + injeção de visão; mantido).

### 4. Loop Copilot (`streaming.ts`)

Já é por-rodada com `filterToolsByIntent` por round. Adicionar:
- detecção de `read_skill` nos tool calls → activeDomains da sessão
- `assembleActiveTools` no lugar do filtro puro

### 5. Executor — dica de ativação

Wrapper no executor (`buildToolExecutor` ou no loop): se a tool chamada pertence a um domínio
não ativado, retornar:
`Domínio "<skill>" não ativado. Chame read_skill("<skill>") para habilitar as tools de <domain>.`

### 6. Persistência por sessão

- Estado vive no próprio `toolDomains.ts` (single source): `Map<sessionId, Set<domainId>>` em memória,
  com funções exportadas:
  - `activateDomainForSession(sessionId, skillName)` — valida skill → insere domínio
  - `getActiveDomains(sessionId): Set<string>` — usado na montagem
  - `resetSessionDomains(sessionId)` — chamado quando uma sessão nova começa
- Vida: sessão (o mesmo `sessionId` que o Copilot loop já usa).
- Sessão nova = domínios resetados (zero ativos).

## Erros e edge cases

- Tool de domínio sem ativação → dica (nunca erro fatal; o loop continua).
- Modelo chama `read_skill` com skill inexistente → mensagem de skill válida (comportamento atual mantido).
- Domínio ativado mas capability não permite (ex: canvas em workspace sem canvas) → `getWorkspaceTools` já removeu; o registro de domínio fica inofensivo.
- MCP tools nunca são removidas por domínios.

## Testes

1. `toolDomains.test.ts`: núcleo∩domínios = ∅; skill→tools resolve; assembleActiveTools mantém core + ativos, remove inativos.
2. `runProviderAgent` (mock): rodada 1 sem canvas → `canvas_op` ausente no request; modelo chama `read_skill('canvas')`; rodada 2 → `canvas_op` presente.
3. Executor: tool desativada retorna a dica.
4. `toolIntents` existente: continua passando (gating por intenção intacto).

## Impacto estimado

- Request de escrita pura: ~39 tools/~11–16k tokens → **16 tools/~7–8k tokens** por rodada.
- Com canvas ativo: ~20 tools (~9–10k tokens).
- Ganho cumulativo por sessão longa: substancial (custo fixo por round é o maior item).

## Fora de escopo

- Não tocar em `ai-proxy` (edge fn) — pass-through de tools já implementado.
- Não adicionar novas skills/domínios além dos listados (html/code reutilizam skills existentes).
- Não persistir domínios em disco permanente.
