export type WorkspaceType = 'book' | 'classes' | 'notes' | 'project' | 'research';

export interface WorkspaceTypeInfo {
  id: WorkspaceType;
  /** Emoji icon shown in the pill */
  icon: string;
  /** i18n key suffix for label → wt.<id> */
  labelKey: string;
  /** i18n key for the "active skills" hint line → wt.<id>Skills */
  skillsKey: string;
}

export const WORKSPACE_TYPES: WorkspaceTypeInfo[] = [
  {
    id: 'book',
    icon: '📖',
    labelKey: 'wt.book',
    skillsKey: 'wt.bookSkills',
  },
  {
    id: 'classes',
    icon: '🎓',
    labelKey: 'wt.classes',
    skillsKey: 'wt.classesSkills',
  },
  {
    id: 'notes',
    icon: '📝',
    labelKey: 'wt.notes',
    skillsKey: 'wt.notesSkills',
  },
  {
    id: 'project',
    icon: '💼',
    labelKey: 'wt.project',
    skillsKey: 'wt.projectSkills',
  },
  {
    id: 'research',
    icon: '🔬',
    labelKey: 'wt.research',
    skillsKey: 'wt.researchSkills',
  },
];
