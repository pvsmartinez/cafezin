const SUPPORTED_TRANSCRIPTION_LANGS = new Set([
  'pt',
  'en',
  'es',
  'fr',
  'de',
  'it',
  'ja',
  'ko',
  'zh',
  'ru',
  'ar',
  'nl',
  'pl',
  'tr',
  'sv',
  'hi',
]);

export const VOICE_LANGUAGE_LABELS: Record<string, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ru: 'Русский',
  ar: 'العربية',
  nl: 'Nederlands',
  pl: 'Polski',
  tr: 'Türkçe',
  sv: 'Svenska',
  hi: 'हिन्दी',
};

export interface ResolveVoiceLanguageOptions {
  overrideLanguage?: string | null;
  workspaceLanguage?: string | null;
  appLocale?: string | null;
  navigatorLanguage?: string | null;
}

export function normalizeVoiceLanguage(raw?: string | null): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value || value === 'auto') return null;

  const short = value.split(/[-_]/)[0];
  if (short === 'pt') return 'pt';
  if (short === 'en') return 'en';
  if (short === 'es') return 'es';
  if (short === 'fr') return 'fr';
  if (short === 'de') return 'de';
  if (short === 'it') return 'it';
  if (short === 'ja') return 'ja';
  if (short === 'ko') return 'ko';
  if (short === 'zh') return 'zh';
  if (short === 'ru') return 'ru';
  if (short === 'ar') return 'ar';
  if (short === 'nl') return 'nl';
  if (short === 'pl') return 'pl';
  if (short === 'tr') return 'tr';
  if (short === 'sv') return 'sv';
  if (short === 'hi') return 'hi';
  return SUPPORTED_TRANSCRIPTION_LANGS.has(value) ? value : null;
}

export function resolveVoiceTranscriptionLanguage({
  overrideLanguage,
  workspaceLanguage,
  appLocale,
  navigatorLanguage,
}: ResolveVoiceLanguageOptions): string {
  return (
    normalizeVoiceLanguage(overrideLanguage) ??
    normalizeVoiceLanguage(workspaceLanguage) ??
    normalizeVoiceLanguage(appLocale) ??
    normalizeVoiceLanguage(navigatorLanguage) ??
    'en'
  );
}

export function getVoiceLanguageLabel(lang: string): string {
  return VOICE_LANGUAGE_LABELS[lang] ?? lang.toUpperCase();
}