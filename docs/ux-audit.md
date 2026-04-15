# Cafezin — UX Audit completo

> Auditoria baseada em leitura de código + dados de funil (Abril 2026)
> 7.798 cliques em anúncios → 22 instalações → 13 launches → 0 pagantes

---

## Personas

### Persona 1 — Maria, educadora (Brasil, Windows, tráfego pago)

- **Perfil:** Professora de 35 anos, PC Windows, usa Word/Google Docs, nunca usou Markdown
- **Motivação:** "Quero organizar minhas aulas e criar materiais com IA"
- **Chega via:** Anúncio Google "ferramenta de IA para educadores"
- **Red flags:** Não sabe o que é workspace/pasta de projeto, espera algo como Google Docs

### Persona 2 — Lucas, escritor independente (Brasil, Mac)

- **Perfil:** 28 anos, usa Obsidian/Notion, tem noção de Markdown, nem sempre paga por tools
- **Motivação:** "Quero um editor focado com IA que entende meu projeto inteiro"
- **Chega via:** Busca orgânica, indicação de comunidade
- **Red flags:** Vai comparar com Obsidian e Notion antes de decidir, é crítico de UX

### Persona 3 — Carlos, desenvolvedor / criador de conteúdo técnico (global, Mac)

- **Perfil:** Dev de 32 anos, cria documentação, README, artigos; sabe o que é BYOK
- **Motivação:** "Quero workspace que integra código + escrita + IA com meu Copilot"
- **Chega via:** Product Hunt, GitHub, boca-a-boca
- **Red flags:** Vai configurar tudo certo mas quer ver valor rápido antes de pagar

---

## Fluxo completo — todas as telas

```
[Splash]
   ↓ (automático, ~1.5s)
[WorkspacePicker]
   ├── Se tem workspaces recentes → lista + botão "Abrir pasta"
   └── Se é novo usuário:
          ├── Concept box (📁 Pasta = workspace + ✨ IA é opcional)
          ├── [Abrir pasta] → file picker do OS → carrega workspace
          └── [Nova pasta] → digita nome → file picker do OS → cria pasta → carrega
                                                                           ↓
[WorkspaceHome] ← tela HOME da pasta (se nenhum arquivo aberto antes)
   ├── Saudação + nome da pasta + caminho
   ├── Seletor de tipo (📖 Livro / 🎓 Aulas / 📝 Notas / 💼 Projeto / 🔬 Pesquisa)
   ├── Auto-abre getting-started.md se pasta nova
   ├── Banner "pasta sem sync" (sem git)
   └── Stats (última edição, total de arquivos)
                ↓ (ao abrir qualquer arquivo)
[Editor principal]
   ├── AppHeader: sidebar toggle | nome arquivo | AI toggle | view mode toggle
   ├── Sidebar (lazy): árvore de arquivos, criação/rename/delete
   ├── TabBar: abas abertas, dirty indicator (•)
   ├── Editor area:
   │     ├── Markdown (.md/.mdx) → ProseEditor (CodeMirror)
   │     ├── Canvas (.tldr.json) → tldraw
   │     ├── HTML/web → WebPreview
   │     ├── PDF → PDFViewer
   │     ├── Imagens → MediaViewer
   │     ├── Spreadsheet (.xlsx/.csv) → SpreadsheetViewer
   │     ├── DOCX → DocxInfoPanel
   │     ├── PPTX → PptxInfoPanel
   │     └── RTF → RtfViewer
   ├── BottomPanel: status bar (palavras, linhas, encoding)
   └── [Cmd+K] → AIPanel (painel lateral direito)
                  ├── Se sem conta/plano → PremiumGate (paywall)
                  ├── Se GitHub Copilot selecionado sem auth → AIAuthScreen
                  └── AgentSession: chat com contexto do workspace

[DesktopOnboardingModal] ← aparece automaticamente no PRIMEIRO uso (floating over editor)
   Slide 1: O que é o Cafezin
   Slide 2: IA (contexto real do projeto)
   Slide 3: Atalhos
   Slide 4: Casos de uso
   Slide 5: Mobile companion
   → Fechar → volta ao editor (SEM abrir Settings — já corrigido)

[SettingsModal] — Cmd+,
   Tabs: General | Shortcuts | AI | Workspace | Agent | MCP | Sync | Account
```

---

## Análise por persona

---

### Persona 1 — Maria (Windows, nova usuária, tráfego pago)

#### O que ela vê

| #   | Tela                        | O que acontece                                                                    | Sentimento                                  |
| --- | --------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Splash                      | Logo escuro, nome "Cafezin"                                                       | "Ok, carregando..."                         |
| 2   | WorkspacePicker             | Tela preta/escura, 2 botões: "Abrir pasta" e "Nova pasta", concept box explicando | "Que é pasta? Preciso criar uma?"           |
| 3   | File picker do OS           | Diálogo nativo do Windows para escolher onde salvar                               | "Não sei onde colocar isso"                 |
| 4   | WorkspaceHome               | Tela de boas-vindas, saudação, seletor de tipo, abre getting-started.md           | "Ah, tem conteúdo! Mas o que faço agora?"   |
| 5   | getting-started.md aberto   | Markdown cru renderizado no editor                                                | "Parece um bloco de notas, não Google Docs" |
| 6   | Onboarding modal (5 slides) | Slides de apresentação flutuando                                                  | "Fechei o Word para isso?"                  |
| 7   | Editor vazio                | Cursor piscando, barra de atalhos invisível                                       | "Como chamo a IA?"                          |
| 8   | Cmd+K → PremiumGate         | "Libere a IA com o plano Basic"                                                   | **Abandona o app**                          |

#### Problemas críticos para Maria

1. **Não entende "pasta"** — o conceito de apontar para uma pasta do computador é estranho para quem usa Google Docs (arquivos na nuvem)
2. **getting-started.md é intimidador** — Markdown nu sem tutorialização ativa parece código
3. **Paywall imediato** — o primeiro toque na IA leva direto ao paywall sem nenhum "taste"
4. **Nenhuma ação clara** — o editor abre vazio sem um CTA óbvio

---

### Persona 2 — Lucas (Mac, escritor, orgânico)

#### O que ele vê

| #   | Tela                  | O que acontece                                                         | Sentimento                                         |
| --- | --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | WorkspacePicker       | Reconhece o padrão, clica "Abrir pasta", aponta para pasta do Obsidian | "Elegante, gostei"                                 |
| 2   | WorkspaceHome         | Vê arquivos, saudação, tipo padrão sem seleção                         | "Legal, mas por que está em branco o tipo?"        |
| 3   | Editor                | Abre um .md, prosa renderiza bem, syntax highlight ok                  | "Bom, editor limpo"                                |
| 4   | Cmd+K → PremiumGate   | "Libere a IA com o plano Basic"                                        | "Quanto custa? Não vi opção de trial"              |
| 5   | Vai até settings → AI | Vê lista de providers: OpenAI, Claude, Groq, GitHub Copilot, Ollama    | "Ah, BYOK. Deixa eu colocar minha chave do OpenAI" |
| 6   | Coloca chave → Cmd+K  | PremiumGate ainda bloqueia                                             | "Ué, configurei mas não funciona?"                 |
| 7   | Vai para Account tab  | Tem que criar conta + pagar                                            | **Churn: "Nem testei, já precisa de conta"**       |

#### Problemas críticos para Lucas

1. **PremiumGate bloqueia antes de BYOK funcionar** — usuário configura chave própria mas ainda cai no paywall
2. **Nenhum trial gratuito** — sem taste of value antes de pagar
3. **A lógica "BYOK + plano pago" é confusa** — se uso minha chave, por que pago ao Cafezin?

---

### Persona 3 — Carlos (Mac/Windows, dev, Product Hunt)

#### O que ele vê

| #   | Tela                       | O que acontece                                               | Sentimento                        |
| --- | -------------------------- | ------------------------------------------------------------ | --------------------------------- |
| 1   | WorkspacePicker            | Aponta para pasta de projeto com código + README             | "Tudo bem até agora"              |
| 2   | Editor                     | Abre README.md, renderiza bem, vê .ts e .json na sidebar     | "Bom, entende código também"      |
| 3   | Cmd+K (tem GitHub Copilot) | AIAuthScreen: "Sign in with GitHub"                          | "Ok, faz sentido"                 |
| 4   | Auth GitHub Copilot        | Device flow: vai para github.com/login/device, insere código | "Seguro, gostei"                  |
| 5   | AIPanel ativo              | Chat com contexto do workspace                               | "Isso é o Cursor mas local?"      |
| 6   | Pergunta sobre o projeto   | IA responde com contexto real dos arquivos                   | "MUITO BOM"                       |
| 7   | Tenta exportar para PDF    | ExportModal → requer pandoc instalado                        | "Ah, precisa instalar pandoc?"    |
| 8   | Sync tab em Settings       | Requer criar repo no GitHub                                  | "Hmm, só GitHub? Sem sync local?" |

#### Problemas para Carlos

1. **Exportação requer instalação manual de pandoc** — fricção técnica não documentada
2. **Sync só via GitHub** — não é óbvio que o sync = git

---

## Resumo de problemas por impacto

### 🔴 Crítico (causa churn imediato)

**P1 — PremiumGate não tem trial gratuito**

- Toda persona bate no paywall no primeiro Cmd+K
- Não há nenhuma mensagem de trial, demo ou "primeiro uso grátis"
- Ficheiro: `AIPanel.tsx` → `PremiumGate` → `isTrialUsed()` existe mas não é aproveitado visualmente
- **Fix:** Liberar N mensagens grátis (atual: `isTrialUsed` já existe no código — apenas não está sendo exposto na UI)

**P2 — getting-started.md não guia o usuário**

- Conteúdo atual: tabela de atalhos + explicação de workspace
- Usuário novo precisa de: CTA, "escreva aqui", "depois pressione Cmd+K"
- **Fix:** Reescrever como documento de boas-vindas interativo com instrução clara

---

### 🟡 Sério (causa confusão/abandono no dia 1)

**P3 — WorkspacePicker: "Abrir pasta" como primeiro passo é estranho**

- Para Maria (Windows): o conceito de "apontar para uma pasta" não existe no mundo Google Docs
- Conceito box existe mas está abaixo dos botões, não antes
- **Fix:** Para usuários novos (nenhuma pasta recente), mostrar conceito box em destaque ANTES dos botões, com call-to-action "Criar minha primeira pasta de trabalho" como ação principal

**P4 — Seletor de tipo de workspace (WorkspaceHome) não tem estado default**

- Usuário vê 5 cards (Livro, Aulas, Notas, Projeto, Pesquisa) sem nenhum selecionado
- Parece uma escolha obrigatória mas não é clara
- **Fix:** Highlight "Notas" como default visual ("mais usado para começar") ou selecionar automaticamente baseado no nome da pasta

**P5 — Banner "pasta sem sync" aparece cedo demais**

- `wh-local-banner` com CloudSlash aparece imediatamente para toda pasta nova
- Para o usuário novo, isso significa "tem algo errado" antes de qualquer coisa
- **Fix:** Esconder nas primeiras 3 sessões ou até o usuário abrir o app N vezes

**P6 — IA precisa de conta + plano mesmo com BYOK**

- Confunde usuários tech-savvy que esperam que "trazer minha chave" = usar de graça
- A lógica existe (plataforma + chave separados) mas não é explicada
- **Fix:** No PremiumGate, adicionar frase clara: "Sua chave de API paga os tokens. O plano Basic (R$X/mês) paga pelo Cafezin."

---

### 🟢 Melhoria de qualidade (impacta NPS mas não causa churn direto)

**P7 — Onboarding modal aparece sobre o editor, não sobre tela de boas-vindas**

- O modal de 5 slides flutua sobre o editor que está vazio/com getting-started.md
- Seria mais limpo aparecer sobre a WorkspaceHome (estado mais "vazio")

**P8 — Exportação requer pandoc (sem aviso antecipado)**

- ExportModal descobre que pandoc não está instalado na hora do export
- **Fix:** Detectar pandoc na tela de Settings/Workspace e mostrar status

**P9 — iOS/Android companion não tem caminho fácil**

- Slide 5 do onboarding menciona o mobile, mas não há link direto para App Store/Play Store
- **Fix:** Adicionar botão "Baixar app mobile" no slide 5

**P10 — Splash é um dead end de 1.5s**

- Não comunica nada enquanto carrega
- **Fix:** Adicionar tagline de valor ou progress indicator suave

---

## Mapa de prioridade de fixes

| Prioridade | Fix                                                               | Esforço | Impacto      |
| ---------- | ----------------------------------------------------------------- | ------- | ------------ |
| 🔴 1       | Liberar trial gratuito (N=5 mensagens)                            | Médio   | Persona 1, 2 |
| 🔴 2       | Reescrever getting-started.md como guia de ação                   | Baixo   | Persona 1, 2 |
| 🟡 3       | WorkspacePicker: novo usuário vê concept box em destaque primeiro | Baixo   | Persona 1    |
| 🟡 4       | Explicar BYOK vs plano no PremiumGate                             | Baixo   | Persona 2, 3 |
| 🟡 5       | WorkspaceHome: tipo default "Notas" ou auto-seleção por nome      | Baixo   | Persona 1, 2 |
| 🟡 6       | Esconder banner de sync nas primeiras sessões                     | Baixo   | Persona 1    |
| 🟢 7       | Link para App Store no slide 5 do onboarding                      | Baixo   | Todos        |
| 🟢 8       | Detectar pandoc e mostrar status em Settings                      | Médio   | Persona 3    |

---

## What's actually working (não mexer)

- **Editor Markdown** — limpo, rápido, preview funciona
- **Sidebar** — ícones por tipo de arquivo, criação inline, rename funcional
- **AIPanel com GitHub Copilot** — fluxo de auth elegante (device flow), contexto real funciona
- **WorkspacePicker conceito box** — já existe, só precisa de posicionamento melhor
- **TabBar** — dirty indicator (•) é sutil e eficaz
- **WorkspaceHome saudação** — "Bom dia, [nome-da-pasta]" cria warmth
- **tldraw canvas** — diferencial real para quem usa

---

## Próximos passos sugeridos (em ordem)

1. Reescrever `getting-started.md` para ser um documento de ação (não documentação)
2. Liberar trial de 5 mensagens no AIPanel antes do paywall
3. Ajustar WorkspacePicker: para usuário sem workspaces recentes, concept box vem primeiro
4. Esconder banner de sync nas primeiras 3 aberturas
5. Adicionar link App Store/Play no slide 5 do onboarding
