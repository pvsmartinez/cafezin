import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './i18n/en.json';
import ptBR from './i18n/pt-BR.json';

export function setupI18n(locale?: 'en' | 'pt-BR') {
  const lng = locale ?? (navigator.language.startsWith('pt') ? 'pt-BR' : 'en');

  if (i18n.isInitialized) {
    void i18n.changeLanguage(lng);
    return;
  }

  void i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      'pt-BR': { translation: ptBR },
    },
    interpolation: { escapeValue: false },
    // Inline resources — init synchronously so i18n is ready on first render
    initImmediate: false,
    react: { useSuspense: false },
  });
}

export default i18n;
