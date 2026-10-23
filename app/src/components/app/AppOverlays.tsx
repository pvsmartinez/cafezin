import { lazy, Suspense, memo } from 'react';
import { ArrowCircleUp, X } from '@phosphor-icons/react';
import UpdateModal from '../UpdateModal';
import UpdateReleaseModal from '../UpdateReleaseModal';
import ForceUpdateModal from '../ForceUpdateModal';
import NudgeToast from '../NudgeToast';
import FeedbackNudge from '../FeedbackNudge';
import { SK } from '../../services/storageKeys';
import type { NudgePayload } from '../../hooks/useProactiveNudge';
import type { AppSettings, Workspace } from '../../types';

const UPDATE_TOAST_DISMISSED_KEY = SK.UPDATE_TOAST_DISMISSED;

const SettingsModal = lazy(() => import('../SettingsModal'));
const DesktopOnboardingModal = lazy(() => import('../DesktopOnboardingModal'));
const ExportModal = lazy(() => import('../ExportModal'));

type SettingsInitialTab = 'general' | 'shortcuts' | 'ai' | 'workspace' | 'agent' | 'mcp' | 'sync' | 'account' | undefined;

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
  onCloseExportModal: () => void;
  onOpenAIFromExport: (prompt: string) => void;
  activeNudge: NudgePayload | null;
  onAskNudge: (prompt: string) => void;
  onDismissNudge: () => void;
  updateToastVersion: string | null;
  setUpdateToastVersion: React.Dispatch<React.SetStateAction<string | null>>;
  onOpenUpdateReleaseModal: () => void;
  showFeedbackNudge: boolean;
  onDismissFeedbackNudge: () => void;
}

const AppOverlaysInner = function AppOverlays({
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
  onCloseExportModal,
  onOpenAIFromExport,
  activeNudge,
  onAskNudge,
  onDismissNudge,
  updateToastVersion,
  setUpdateToastVersion,
  onOpenUpdateReleaseModal,
  showFeedbackNudge,
  onDismissFeedbackNudge,
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

      {showSettings && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {showDesktopOnboarding && (
        <Suspense fallback={null}>
          <DesktopOnboardingModal
            open={showDesktopOnboarding}
            locale={appSettings.locale ?? 'en'}
            firstRun={!desktopOnboardingSeen}
            onClose={onCloseDesktopOnboarding}
          />
        </Suspense>
      )}

      {exportModalOpen && (
        <Suspense fallback={null}>
          <ExportModal
            workspace={workspace}
            onWorkspaceChange={onWorkspaceChange}
            onClose={onCloseExportModal}
            onOpenAI={onOpenAIFromExport}
          />
        </Suspense>
      )}

      {activeNudge && (
        <NudgeToast
          text={activeNudge.text}
          onAsk={() => onAskNudge(activeNudge.aiPrompt)}
          onDismiss={onDismissNudge}
        />
      )}

      {showFeedbackNudge && !activeNudge && !showDesktopOnboarding && (
        <FeedbackNudge
          onOpenFeedback={onContactUs}
          onDismiss={onDismissFeedbackNudge}
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

export const AppOverlays = memo(AppOverlaysInner);
