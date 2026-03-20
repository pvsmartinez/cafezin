import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  APP_SHORTCUTS,
  eventToShortcut,
  formatShortcutTokens,
  getShortcutBindings,
  isMacPlatform,
  pruneShortcutOverrides,
  type AppShortcutGroup,
  type AppShortcutId,
} from '../../keyboardShortcuts';
import type { AppSettings } from '../../types';

const GROUP_ORDER: AppShortcutGroup[] = ['files', 'navigation', 'ai', 'app'];

const GROUP_LABELS: Record<AppShortcutGroup, string> = {
  files: 'settings.scGroupFiles',
  navigation: 'settings.scGroupNav',
  ai: 'settings.scGroupAI',
  app: 'settings.scGroupApp',
};

interface EditorShortcutRow {
  binding: string;
  labelKey: string;
  noteKey?: string;
  plain?: boolean;
}

interface EditorShortcutSection {
  titleKey: string;
  rows: EditorShortcutRow[];
}

const EDITOR_SHORTCUT_SECTIONS: EditorShortcutSection[] = [
  {
    titleKey: 'settings.scGroupMarkdownEditor',
    rows: [
      { binding: 'Mod+B', labelKey: 'settings.scBold' },
      { binding: 'Mod+I', labelKey: 'settings.scItalic' },
      { binding: 'Mod+F', labelKey: 'settings.scFindReplace' },
      { binding: 'Mod+K', labelKey: 'settings.scAskCopilot' },
    ],
  },
  {
    titleKey: 'settings.scGroupCodeEditor',
    rows: [
      { binding: 'Mod+F', labelKey: 'settings.scFindReplace' },
      { binding: 'Alt+F', labelKey: 'settings.scFormatCode' },
      { binding: 'Mod+K', labelKey: 'settings.scAskCopilot' },
    ],
  },
  {
    titleKey: 'settings.scGroupCanvasEditor',
    rows: [
      { binding: 'Mod+]', labelKey: 'settings.scBringForward' },
      { binding: 'Mod+Shift+]', labelKey: 'settings.scBringToFront' },
      { binding: 'Mod+[', labelKey: 'settings.scSendBackward' },
      { binding: 'Mod+Shift+[', labelKey: 'settings.scSendToBack' },
      { binding: 'Mod+D', labelKey: 'settings.scDuplicateSelection' },
      { binding: 'Mod+G', labelKey: 'settings.scGroupSelection' },
      { binding: 'Mod+Shift+G', labelKey: 'settings.scUngroupSelection' },
    ],
  },
  {
    titleKey: 'settings.scGroupSpreadsheetEditor',
    rows: [
      { binding: '↑ ↓ ← →', labelKey: 'settings.scSpreadsheetNavigate', plain: true },
      { binding: 'Enter', labelKey: 'settings.scSpreadsheetEditCell' },
      { binding: 'Delete', labelKey: 'settings.scSpreadsheetClearCell' },
      { binding: 'Mod+C', labelKey: 'settings.scSpreadsheetCopy' },
      { binding: 'Mod+V', labelKey: 'settings.scSpreadsheetPaste' },
    ],
  },
  {
    titleKey: 'settings.scGroupSidebarEditor',
    rows: [
      { binding: 'Mod+Click', labelKey: 'settings.scMultiSelect', noteKey: 'settings.scMultiSelectNote', plain: true },
      { binding: 'Double click', labelKey: 'settings.scRenameFile', noteKey: 'settings.scRenameFileNote', plain: true },
    ],
  },
];

export interface ShortcutsTabProps {
  appSettings: AppSettings;
  onAppSettingsChange: (settings: AppSettings) => void;
}

function ShortcutKeys({ binding, mac }: { binding: string; mac: boolean }) {
  const tokens = formatShortcutTokens(binding, mac);
  return (
    <span className="sm-shortcut-keys" aria-label={binding}>
      {tokens.map((token, index) => (
        <kbd key={`${binding}-${index}-${token}`}>{token}</kbd>
      ))}
    </span>
  );
}

function ShortcutSectionRows({ title, rows }: { title: string; rows: React.ReactNode[] }) {
  return (
    <>
      <tr className="sm-shortcuts-group">
        <td colSpan={3}>{title}</td>
      </tr>
      {rows}
    </>
  );
}

export function ShortcutsTab({ appSettings, onAppSettingsChange }: ShortcutsTabProps) {
  const { t } = useTranslation();
  const [recordingId, setRecordingId] = useState<AppShortcutId | null>(null);
  const isMac = useMemo(() => isMacPlatform(), []);
  const shortcutBindings = useMemo(
    () => getShortcutBindings(appSettings.shortcutOverrides),
    [appSettings.shortcutOverrides],
  );

  useEffect(() => {
    if (!recordingId) return;
    const targetId = recordingId;

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      const next = eventToShortcut(event);
      if (!next) return;

      const nextOverrides = pruneShortcutOverrides({
        ...(appSettings.shortcutOverrides ?? {}),
        [targetId]: next,
      });
      onAppSettingsChange({ ...appSettings, shortcutOverrides: nextOverrides });
      setRecordingId(null);
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [appSettings, onAppSettingsChange, recordingId]);

  function handleReset(shortcutId: AppShortcutId) {
    const nextOverrides = { ...(appSettings.shortcutOverrides ?? {}) };
    delete nextOverrides[shortcutId];
    onAppSettingsChange({
      ...appSettings,
      shortcutOverrides: pruneShortcutOverrides(nextOverrides),
    });
    if (recordingId === shortcutId) setRecordingId(null);
  }

  return (
    <div className="sm-section-list">
      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.sectionShortcuts')}</h3>
        <p className="sm-section-desc">{t('settings.shortcutsIntro')}</p>
        <p className="sm-shortcuts-hint">{recordingId ? t('settings.shortcutsPressCombo') : t('settings.shortcutsCustomizeHint')}</p>

        <table className="sm-shortcuts sm-shortcuts--editable">
          <tbody>
            {GROUP_ORDER.map((group) => (
              <ShortcutSectionRows
                key={group}
                title={t(GROUP_LABELS[group])}
                rows={APP_SHORTCUTS
                  .filter((shortcut) => shortcut.group === group)
                  .map((shortcut) => {
                    const currentBinding = shortcutBindings[shortcut.id];
                    const isCustomized = currentBinding !== shortcut.defaultBinding;
                    return (
                      <tr key={shortcut.id}>
                        <td>
                          <div>{t(shortcut.labelKey)}</div>
                          {shortcut.noteKey && <span className="sm-shortcut-note">{t(shortcut.noteKey)}</span>}
                        </td>
                        <td>
                          <ShortcutKeys binding={currentBinding} mac={isMac} />
                          {isCustomized && <span className="sm-shortcut-badge">{t('settings.shortcutsCustom')}</span>}
                        </td>
                        <td className="sm-shortcut-actions-cell">
                          <button
                            className={`sm-secondary-btn sm-shortcut-action-btn ${recordingId === shortcut.id ? 'active' : ''}`}
                            onClick={() => setRecordingId((current) => current === shortcut.id ? null : shortcut.id)}
                          >
                            {recordingId === shortcut.id ? t('settings.shortcutsRecording') : t('settings.shortcutsRecord')}
                          </button>
                          <button
                            className="sm-secondary-btn sm-shortcut-action-btn"
                            onClick={() => handleReset(shortcut.id)}
                            disabled={!isCustomized}
                          >
                            {t('settings.shortcutsReset')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              />
            ))}
          </tbody>
        </table>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.shortcutsEditorSectionTitle')}</h3>
        <p className="sm-section-desc">{t('settings.shortcutsReadonlyHint')}</p>

        <table className="sm-shortcuts sm-shortcuts--readonly">
          <tbody>
            {EDITOR_SHORTCUT_SECTIONS.map((section) => (
              <ShortcutSectionRows
                key={section.titleKey}
                title={t(section.titleKey)}
                rows={section.rows.map((row) => (
                  <tr key={`${section.titleKey}-${row.binding}-${row.labelKey}`}>
                    <td>
                      <div>{t(row.labelKey)}</div>
                      {row.noteKey && <span className="sm-shortcut-note">{t(row.noteKey)}</span>}
                    </td>
                    <td>
                      {row.plain
                        ? <span className="sm-shortcut-plain">{row.binding}</span>
                        : <ShortcutKeys binding={row.binding} mac={isMac} />}
                    </td>
                  </tr>
                ))}
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}