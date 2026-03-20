import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../../types';

const FONT_OPTIONS = [
  { label: 'Pequena (13px)', value: 13 },
  { label: 'Média (14px)', value: 14 },
  { label: 'Grande (15px)', value: 15 },
  { label: 'Extra grande (16px)', value: 16 },
];

const AUTOSAVE_OPTIONS = [
  { label: 'Rápido (500ms)', value: 500 },
  { label: 'Normal (1s)', value: 1000 },
  { label: 'Lento (2s)', value: 2000 },
  { label: 'Manual (desligado)', value: 0 },
];

export interface GeneralTabProps {
  appSettings: AppSettings;
  onAppSettingsChange: (s: AppSettings) => void;
  globalVercelToken: string;
  onGlobalVercelTokenChange: (v: string) => void;
  vercelTokenSaved: boolean;
  onSaveVercelToken: () => void;
  onOpenHelp: () => void;
  onContactUs: () => void;
}

export function GeneralTab({
  appSettings,
  onAppSettingsChange,
  globalVercelToken,
  onGlobalVercelTokenChange,
  vercelTokenSaved,
  onSaveVercelToken,
  onOpenHelp,
  onContactUs,
}: GeneralTabProps) {
  const { t } = useTranslation();

  function setApp<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onAppSettingsChange({ ...appSettings, [key]: value });
  }

  const autosaveLabels: Record<number, string> = {
    500:  t('settings.autosaveFast'),
    1000: t('settings.autosaveNormal'),
    2000: t('settings.autosaveSlow'),
    0:    t('settings.autosaveManual'),
  };

  return (
    <div className="sm-section-list">

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.sectionAppearance')}</h3>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.themeLabel')}</span>
            <span className="sm-row-desc">{t('settings.themeDesc')}</span>
          </div>
          <div className="sm-theme-toggle">
            <button
              className={`sm-theme-btn ${appSettings.theme === 'system' ? 'active' : ''}`}
              onClick={() => setApp('theme', 'system')}
            >
              {t('settings.themeSystem')}
            </button>
            <button
              className={`sm-theme-btn ${appSettings.theme === 'dark' ? 'active' : ''}`}
              onClick={() => setApp('theme', 'dark')}
            >
              {t('settings.themeDark')}
            </button>
            <button
              className={`sm-theme-btn ${appSettings.theme === 'light' ? 'active' : ''}`}
              onClick={() => setApp('theme', 'light')}
            >
              {t('settings.themeLight')}
            </button>
          </div>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.fontSizeLabel')}</span>
            <span className="sm-row-desc">{t('settings.fontSizeDesc')}</span>
          </div>
          <select
            className="sm-select"
            value={appSettings.editorFontSize}
            onChange={(e) => setApp('editorFontSize', Number(e.target.value))}
          >
            {FONT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.sectionEditor')}</h3>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.autosaveLabel')}</span>
            <span className="sm-row-desc">{t('settings.autosaveDesc')}</span>
          </div>
          <select
            className="sm-select"
            value={appSettings.autosaveDelay}
            onChange={(e) => setApp('autosaveDelay', Number(e.target.value))}
          >
            {AUTOSAVE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{autosaveLabels[o.value] ?? o.label}</option>
            ))}
          </select>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.wordCountLabel')}</span>
            <span className="sm-row-desc">{t('settings.wordCountDesc')}</span>
          </div>
          <label className="sm-toggle">
            <input
              type="checkbox"
              checked={appSettings.showWordCount}
              onChange={(e) => setApp('showWordCount', e.target.checked)}
            />
            <span className="sm-toggle-track" />
          </label>
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.sectionLayout')}</h3>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.sidebarOpenLabel')}</span>
            <span className="sm-row-desc">{t('settings.sidebarOpenDesc')}</span>
          </div>
          <label className="sm-toggle">
            <input
              type="checkbox"
              checked={appSettings.sidebarOpenDefault}
              onChange={(e) => setApp('sidebarOpenDefault', e.target.checked)}
            />
            <span className="sm-toggle-track" />
          </label>
        </div>
        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.formatOnSaveLabel')}</span>
            <span className="sm-row-desc">{t('settings.formatOnSaveDesc')}</span>
          </div>
          <label className="sm-toggle">
            <input
              type="checkbox"
              checked={appSettings.formatOnSave ?? true}
              onChange={(e) => setApp('formatOnSave', e.target.checked)}
            />
            <span className="sm-toggle-track" />
          </label>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.terminalLabel')}</span>
            <span className="sm-row-desc">{t('settings.terminalDesc')}</span>
          </div>
          <label className="sm-toggle">
            <input
              type="checkbox"
              checked={appSettings.showTerminal ?? false}
              onChange={(e) => setApp('showTerminal', e.target.checked)}
            />
            <span className="sm-toggle-track" />
          </label>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.languageLabel')}</span>
            <span className="sm-row-desc">{t('settings.languageDesc')}</span>
          </div>
          <select
            className="sm-select"
            value={appSettings.locale ?? 'en'}
            onChange={(e) => setApp('locale', e.target.value as 'en' | 'pt-BR')}
          >
            <option value="en">{t('settings.langEn')}</option>
            <option value="pt-BR">{t('settings.langPtBR')}</option>
          </select>
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.sectionAPIKeys')}</h3>
        <p className="sm-section-desc">
          {t('settings.apiKeysDesc')}
        </p>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.vercelTokenLabel')}
            <span className="sm-row-desc"> — <a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">vercel.com/account/tokens</a></span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="sm-input"
              type="password"
              value={globalVercelToken}
              onChange={(e) => onGlobalVercelTokenChange(e.target.value)}
              placeholder="token_..."
              style={{ flex: 1 }}
            />
            <button
              className={`sm-save-btn ${vercelTokenSaved ? 'saved' : ''}`}
              onClick={onSaveVercelToken}
            >
              {vercelTokenSaved ? t('settings.saved') : t('settings.save')}
            </button>
          </div>
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.sectionShortcuts')}</h3>
        <table className="sm-shortcuts">
          <tbody>
            <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupFiles')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>S</kbd></td><td>{t('settings.scSave')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>W</kbd></td><td>{t('settings.scCloseTab')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>⇧</kbd><kbd>R</kbd></td><td>{t('settings.scReload')}</td></tr>
            <tr><td><kbd>⌃</kbd><kbd>Tab</kbd></td><td>{t('settings.scNextTab')}</td></tr>
            <tr><td><kbd>⌃</kbd><kbd>⇧</kbd><kbd>Tab</kbd></td><td>{t('settings.scPrevTab')}</td></tr>
            <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupNav')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>F</kbd></td><td>{t('settings.scFindReplace')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd></td><td>{t('settings.scProjectSearch')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd></td><td>{t('settings.scTogglePreview')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>B</kbd></td><td>{t('settings.scToggleSidebar')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>J</kbd></td><td>{t('settings.scToggleTerminal')}</td></tr>
            <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupAI')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>K</kbd></td><td>{t('settings.scOpenCopilot')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>K</kbd> <span className="sm-shortcut-note">{t('settings.scWithSelection')}</span></td><td>{t('settings.scAskCopilot')}</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>{t('settings.scCloseCopilot')}</td></tr>
            <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupApp')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>,</kbd></td><td>{t('settings.scOpenSettings')}</td></tr>
            <tr><td><kbd>⌘</kbd><kbd>Click</kbd> <span className="sm-shortcut-note">{t('settings.scMultiSelectNote')}</span></td><td>{t('settings.scMultiSelect')}</td></tr>
            <tr><td><kbd>Duplo clique</kbd> <span className="sm-shortcut-note">{t('settings.scRenameFileNote')}</span></td><td>{t('settings.scRenameFile')}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.sectionHelp')}</h3>
        <p className="sm-section-desc">{t('settings.helpDesc')}</p>
        <div className="sm-support-actions">
          <button className="sm-secondary-btn" onClick={onOpenHelp}>
            {t('settings.helpTourBtn')}
          </button>
          <button className="sm-secondary-btn" onClick={onContactUs}>
            {t('settings.contactUsBtn')}
          </button>
        </div>
      </section>

    </div>
  );
}
