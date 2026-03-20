import type { ComponentProps } from 'react';
import type { Editor as TldrawEditor } from 'tldraw';
import { ArrowCircleUp, X } from '@phosphor-icons/react';
import UpdateModal from '../UpdateModal';
import UpdateReleaseModal from '../UpdateReleaseModal';
import ForceUpdateModal from '../ForceUpdateModal';
import MobilePendingModal from '../MobilePendingModal';
import SettingsModal from '../SettingsModal';
import DesktopOnboardingModal from '../DesktopOnboardingModal';
import ExportModal from '../ExportModal';
import ImageSearchPanel from '../ImageSearchPanel';
import NudgeToast from '../NudgeToast';
import { SK } from '../../services/storageKeys';
import type { NudgePayload } from '../../hooks/useProactiveNudge';
import type { MobilePendingTask } from '../../services/mobilePendingTasks';
import type { AppSettings, Workspace } from '../../types';

const UPDATE_TOAST_DISMISSED_KEY = SK.UPDATE_TOAST_DISMISSED;

type SettingsInitialTab = ComponentProps<typeof SettingsModal>['initialTab'];

export interface AppOverlaysProps {
  projectRoot: string;
  workspace: Workspace;
  showUpdateModal: boolean;
  onCloseUpdateModal: () => void;
  showUpdateReleaseModal: boolean;
  onCloseUpdateReleaseModal: () => void;
  forceUpdateOpen: boolean;
  forceUpdateRequired: string;
  forceUpdateChannel: string;
  onUpdate: () => Promise<void> | void;
  showMobilePending: boolean;
  mobilePendingTasks: MobilePendingTask[];
  onExecutePendingTask: (task: MobilePendingTask) => void;
  onCloseMobilePending: () => void;
  onDeleteMobilePendingTask: (id: string) => void;
  showSettings: boolean;
  appSettings: AppSettings;
  onAppSettingsChange: (settings: AppSettings) => void;
  onWorkspaceChange: (workspace: Workspace) => void;
  onOpenHelp: () => void;
  onContactUs: () => void;
  onCloseSettings: () => void;
  settingsInitialTab?: SettingsInitialTab;
  showDesktopOnboarding: boolean;
  desktopOnboardingSeen: boolean;
  onCloseDesktopOnboarding: () => void;
  exportModalOpen: boolean;
  canvasEditorRef: React.MutableRefObject<TldrawEditor | null>;
  activeFile: string | null;
  onOpenFileForExport: (relPath: string) => Promise<void>;
  onRestoreAfterExport: () => void;
  onCloseExportModal: () => void;
  onOpenAIFromExport: (prompt: string) => void;
  onExportLockStateChange: (state: { title: string; detail?: string; cancelRequested?: boolean } | null) => void;
  imgSearchOpen: boolean;
  onCloseImageSearch: () => void;
  copilotOverlayActive: boolean;
  activeNudge: NudgePayload | null;
  onAskNudge: (prompt: string) => void;
  onDismissNudge: () => void;
  updateToastVersion: string | null;
  setUpdateToastVersion: React.Dispatch<React.SetStateAction<string | null>>;
  onOpenUpdateReleaseModal: () => void;
}

export function AppOverlays({
  projectRoot,
  workspace,
  showUpdateModal,
  onCloseUpdateModal,
  showUpdateReleaseModal,
  onCloseUpdateReleaseModal,
  forceUpdateOpen,
  forceUpdateRequired,
  forceUpdateChannel,
  onUpdate,
  showMobilePending,
  mobilePendingTasks,
  onExecutePendingTask,
  onCloseMobilePending,
  onDeleteMobilePendingTask,
  showSettings,
  appSettings,
  onAppSettingsChange,
  onWorkspaceChange,
  onOpenHelp,
  onContactUs,
  onCloseSettings,
  settingsInitialTab,
  showDesktopOnboarding,
  desktopOnboardingSeen,
  onCloseDesktopOnboarding,
  exportModalOpen,
  canvasEditorRef,
  activeFile,
  onOpenFileForExport,
  onRestoreAfterExport,
  onCloseExportModal,
  onOpenAIFromExport,
  onExportLockStateChange,
  imgSearchOpen,
  onCloseImageSearch,
  copilotOverlayActive,
  activeNudge,
  onAskNudge,
  onDismissNudge,
  updateToastVersion,
  setUpdateToastVersion,
  onOpenUpdateReleaseModal,
}: AppOverlaysProps) {
  return (
    <>
      <UpdateModal
        open={showUpdateModal}
        projectRoot={projectRoot}
        onClose={onCloseUpdateModal}
      />
      <UpdateReleaseModal
        open={showUpdateReleaseModal}
        onClose={onCloseUpdateReleaseModal}
      />
      <ForceUpdateModal
        open={forceUpdateOpen}
        requiredVersion={forceUpdateRequired}
        channel={forceUpdateChannel}
        onUpdate={onUpdate}
      />

      <MobilePendingModal
        open={showMobilePending}
        workspacePath={workspace.path}
        tasks={mobilePendingTasks}
        onExecute={onExecutePendingTask}
        onClose={onCloseMobilePending}
        onTaskDeleted={onDeleteMobilePendingTask}
      />

      <SettingsModal
        open={showSettings}
        appSettings={appSettings}
        workspace={workspace}
        onAppSettingsChange={onAppSettingsChange}
        onWorkspaceChange={onWorkspaceChange}
        onOpenHelp={onOpenHelp}
        onContactUs={onContactUs}
        onClose={onCloseSettings}
        initialTab={settingsInitialTab}
      />

      <DesktopOnboardingModal
        open={showDesktopOnboarding}
        locale={appSettings.locale ?? 'en'}
        firstRun={!desktopOnboardingSeen}
        onClose={onCloseDesktopOnboarding}
      />

      {exportModalOpen && (
        <ExportModal
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
          canvasEditorRef={canvasEditorRef}
          activeCanvasRel={activeFile?.endsWith('.tldr.json') ? activeFile : null}
          onOpenFileForExport={onOpenFileForExport}
          onRestoreAfterExport={onRestoreAfterExport}
          onClose={onCloseExportModal}
          onOpenAI={onOpenAIFromExport}
          onExportLockStateChange={onExportLockStateChange}
        />
      )}

      {imgSearchOpen && (
        <ImageSearchPanel
          workspace={workspace}
          canvasEditorRef={canvasEditorRef}
          onClose={onCloseImageSearch}
        />
      )}

      {copilotOverlayActive && (
        <div className="copilot-tab-overlay" aria-live="polite">
          <span className="copilot-lock-label">Copilot a trabalhar…</span>
        </div>
      )}

      {activeNudge && (
        <NudgeToast
          text={activeNudge.text}
          onAsk={() => onAskNudge(activeNudge.aiPrompt)}
          onDismiss={onDismissNudge}
        />
      )}

      {updateToastVersion && (
        <div className="nudge-toast nudge-toast--update">
          <ArrowCircleUp weight="fill" className="nudge-toast-icon" />
          <span className="nudge-toast-text">
            Versão {updateToastVersion} disponível
          </span>
          <button
            className="nudge-toast-cta"
            onClick={() => {
              setUpdateToastVersion(null);
              onOpenUpdateReleaseModal();
            }}
          >
            Atualizar
          </button>
          <button
            className="nudge-toast-dismiss"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              localStorage.setItem(UPDATE_TOAST_DISMISSED_KEY, `${updateToastVersion}:${today}`);
              setUpdateToastVersion(null);
            }}
            title="Dispensar"
          >
            <X weight="bold" />
          </button>
        </div>
      )}
    </>
  );
}