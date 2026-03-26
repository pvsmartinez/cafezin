import type { WorkspaceType } from './workspaceTypes';

export interface WorkspaceRoutine {
  id: string;
  /** Short label shown on the pill */
  label: string;
  /** Full prompt sent to the agent when clicked */
  prompt: string;
}

const ROUTINES: Record<WorkspaceType, WorkspaceRoutine[]> = {
  book: [
    {
      id: 'book-review',
      label: 'Revisar capítulo',
      prompt: 'Revise o arquivo aberto atualmente. Avalie coesão, clareza e ritmo narrativo. Dê sugestões concretas de melhoria.',
    },
    {
      id: 'book-reader-opinions',
      label: 'Opiniões de leitores',
      prompt: 'Leia o arquivo aberto e dê opiniões em perspectivas de pelo menos 3 tipos de leitor diferentes (casual, crítico literário, fã do gênero).',
    },
    {
      id: 'book-research',
      label: 'Pesquisar contexto',
      prompt: 'Com base no arquivo aberto, identifique lacunas que precisam de pesquisa e me ajude a buscar informações relevantes para enriquecer o texto.',
    },
  ],
  classes: [
    {
      id: 'classes-lesson-plan',
      label: 'Criar plano de aula',
      prompt: 'Com base no conteúdo deste workspace, crie um plano de aula completo com objetivos, atividades e avaliação.',
    },
    {
      id: 'classes-slides',
      label: 'Gerar slides',
      prompt: 'Transforme o conteúdo do arquivo aberto em uma apresentação de slides clara e didática, com tópicos-chave e exemplos.',
    },
    {
      id: 'classes-exercises',
      label: 'Criar exercícios',
      prompt: 'Crie exercícios práticos e questões de revisão baseados no conteúdo do arquivo aberto, adequados para o público-alvo.',
    },
  ],
  notes: [
    {
      id: 'notes-summarize',
      label: 'Resumir notas',
      prompt: 'Leia as notas deste workspace e crie um resumo organizado por tópicos, destacando os pontos mais importantes.',
    },
    {
      id: 'notes-links',
      label: 'Conectar ideias',
      prompt: 'Analise as notas abertas e identifique conexões, padrões e relações entre os tópicos. Sugira como organizá-los melhor.',
    },
    {
      id: 'notes-action-items',
      label: 'Extrair tarefas',
      prompt: 'Leia as notas e extraia todas as ações, decisões pendentes e próximos passos mencionados. Liste de forma clara e priorizada.',
    },
  ],
  project: [
    {
      id: 'project-docs',
      label: 'Documentar decisão',
      prompt: 'Me ajude a documentar uma decisão técnica ou de produto importante para este projeto, com contexto, alternativas consideradas e justificativa.',
    },
    {
      id: 'project-review',
      label: 'Revisar documentação',
      prompt: 'Revise a documentação do arquivo aberto e aponte o que está incompleto, confuso ou desatualizado.',
    },
    {
      id: 'project-tasks',
      label: 'Planejar próximos passos',
      prompt: 'Com base no contexto deste workspace, quais são os próximos passos mais importantes? Monte um plano de ação claro e priorizado.',
    },
  ],
  research: [
    {
      id: 'research-synthesize',
      label: 'Sintetizar fontes',
      prompt: 'Leia as notas e materiais abertos e faça uma síntese das principais ideias, identificando consensos, contradições e lacunas.',
    },
    {
      id: 'research-argument',
      label: 'Estruturar argumento',
      prompt: 'Me ajude a estruturar um argumento sólido com base nas fontes e anotações deste workspace. Organize premissas, evidências e conclusão.',
    },
    {
      id: 'research-questions',
      label: 'Perguntas de pesquisa',
      prompt: 'Com base no material disponível neste workspace, quais perguntas de pesquisa ainda estão em aberto? Sugira caminhos para investigá-las.',
    },
  ],
};

/** Default routines shown when no workspace type is set */
const DEFAULT_ROUTINES: WorkspaceRoutine[] = [
  {
    id: 'default-review',
    label: 'Revisar arquivo',
    prompt: 'Revise o arquivo aberto e dê sugestões de melhoria.',
  },
  {
    id: 'default-summarize',
    label: 'Resumir',
    prompt: 'Faça um resumo claro e objetivo do arquivo aberto.',
  },
  {
    id: 'default-brainstorm',
    label: 'Brainstorm',
    prompt: 'Com base no conteúdo deste workspace, sugira novas ideias e direções para explorar.',
  },
];

export function getRoutinesForWorkspaceType(type?: string): WorkspaceRoutine[] {
  if (type && type in ROUTINES) {
    return ROUTINES[type as WorkspaceType];
  }
  return DEFAULT_ROUTINES;
}
