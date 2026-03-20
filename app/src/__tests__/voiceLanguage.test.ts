import { describe, expect, it } from 'vitest';

import {
  normalizeVoiceLanguage,
  resolveVoiceTranscriptionLanguage,
} from '../utils/voiceLanguage';

describe('voice language resolution', () => {
  it('uses manual override before workspace and app settings', () => {
    expect(resolveVoiceTranscriptionLanguage({
      overrideLanguage: 'en',
      workspaceLanguage: 'pt-BR',
      appLocale: 'pt-BR',
      navigatorLanguage: 'pt-BR',
    })).toBe('en');
  });

  it('falls back to workspace language when override is auto', () => {
    expect(resolveVoiceTranscriptionLanguage({
      overrideLanguage: 'auto',
      workspaceLanguage: 'pt-BR',
      appLocale: 'en',
      navigatorLanguage: 'en-US',
    })).toBe('pt');
  });

  it('falls back to app locale and navigator language', () => {
    expect(resolveVoiceTranscriptionLanguage({
      workspaceLanguage: undefined,
      appLocale: 'en',
      navigatorLanguage: 'pt-BR',
    })).toBe('en');

    expect(resolveVoiceTranscriptionLanguage({
      workspaceLanguage: undefined,
      appLocale: undefined,
      navigatorLanguage: 'pt-BR',
    })).toBe('pt');
  });

  it('normalizes BCP-47 tags and unknown values', () => {
    expect(normalizeVoiceLanguage('en-US')).toBe('en');
    expect(normalizeVoiceLanguage('pt-BR')).toBe('pt');
    expect(normalizeVoiceLanguage('auto')).toBeNull();
    expect(normalizeVoiceLanguage('klingon')).toBeNull();
  });
});