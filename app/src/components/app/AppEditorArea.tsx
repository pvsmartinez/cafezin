import { lazy, memo, Suspense, useState, type ComponentProps, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import Editor from '../Editor';
import type { EditorHandle } from '../Editor';
import { EditorErrorBoundary } from '../EditorErrorBoundary';
import WorkspaceHome from '../WorkspaceHome';
import FindReplaceBar from '../FindReplaceBar';
import AIMarkOverlay from '../AIMarkOverlay';
import TabBar from '../TabBar';
import BacklinksPanel from '../BacklinksPanel';
import type { AIEditMark, AISelectionContext, AppSettings, Workspace } from '../../types';
import type { FileTypeInfo } from '../../utils/fileType';

const ProseEditor = lazy(() => import('../ProseEditor'));
const MarkdownPreview = lazy(() => import('../MarkdownPreview'));
const PDFViewer = lazy(() => import('../PDFViewer'));
const MediaViewer = lazy(() => import('../MediaViewer'));

type ViewMode = 'edit' | 'preview';

interface AppEditorAreaProps {
  workspace: Workspace;
  aiMarks: AIEditMark[];
  tabs: ComponentProps<typeof TabBar>['tabs'];
  activeTabId: ComponentProps<typeof TabBar>['activeTabId'];
  previewTabId: ComponentProps<typeof TabBar>['previewTabId'];
  dirtyFiles: Set<string>;
  lockedFiles: Set<string>;
  activeFile: string | null;
  fileTypeInfo: FileTypeInfo | null;
  content: string;
  viewMode: ViewMode;
  appSettings: AppSettings;
  isDarkTheme: boolean;
  homeVisible: boolean;
  findReplaceOpen: boolean;
  aiHighlight: boolean;
  activeFileMarks: AIEditMark[];
  backlinks: ComponentProps<typeof BacklinksPanel>['backlinks'];
  outlinks: ComponentProps<typeof BacklinksPanel>['outlinks'];
  backlinksLoading: boolean;
  editorRef: RefObject<EditorHandle | null>;
  editorAreaRef: RefObject<HTMLDivElement | null>;
  onSelectTab: ComponentProps<typeof TabBar>['onSelect'];
  onCloseTab: ComponentProps<typeof TabBar>['onClose'];
  onCloseOthers: ComponentProps<typeof TabBar>['onCloseOthers'];
  onCloseToRight: ComponentProps<typeof TabBar>['onCloseToRight'];
  onCloseAllTabs: () => void;
  onPromoteTab: ComponentProps<typeof TabBar>['onPromoteTab'];
  onReorderTabs: ComponentProps<typeof TabBar>['onReorder'];
  onSetFindReplaceOpen: (open: boolean) => void;
  onContentChange: (next: string) => void;
  onAIRequest: ComponentProps<typeof Editor>['onAIRequest'];
  onSelectionContextChange: (context: AISelectionContext | null) => void;
  onMarkReviewed: (id: string) => void;
  onMarkRejected: (id: string) => void;
  onOpenFile: (relPath: string, lineNo?: number) => void | Promise<void>;
  onCreateFirstWorkspaceFile: () => void | Promise<void>;
  onOpenAIReview: () => void;
  onSwitchWorkspace: () => void | Promise<void>;
  onActivateSync: () => void;
  onSetHomeVisible: (visible: boolean) => void;
  onSetFileStat: (value: string | null) => void;
  onImagePaste: ComponentProps<typeof Editor>['onImagePaste'];
}

export function AppEditorAreaInner({
  workspace,
  aiMarks,
  tabs,
  activeTabId,
  previewTabId,
  dirtyFiles,
  lockedFiles,
  activeFile,
  fileTypeInfo,
  content,
  viewMode,
  appSettings,
  isDarkTheme,
  homeVisible,
  findReplaceOpen,
  aiHighlight,
  activeFileMarks,
  backlinks,
  outlinks,
  backlinksLoading,
  editorRef,
  editorAreaRef,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onCloseToRight,
  onCloseAllTabs,
  onPromoteTab,
  onReorderTabs,
  onSetFindReplaceOpen,
  onContentChange,
  onAIRequest,
  onSelectionContextChange,
  onMarkReviewed,
  onMarkRejected,
  onOpenFile,
  onCreateFirstWorkspaceFile,
  onOpenAIReview,
  onSwitchWorkspace,
  onActivateSync,
  onSetHomeVisible,
  onSetFileStat,
  onImagePaste,
}: AppEditorAreaProps) {
  const { t } = useTranslation();
  const [sourceMode, setSourceMode] = useState(false);
  return (
    <div className="editor-area" ref={editorAreaRef}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        dirtyFiles={dirtyFiles}
        lockedFiles={lockedFiles}
        previewTabId={previewTabId}
        workspacePath={workspace.path}
        onSelect={onSelectTab}
        onClose={onCloseTab}
        onCloseOthers={onCloseOthers}
        onCloseToRight={onCloseToRight}
        onCloseAll={onCloseAllTabs}
        onPromoteTab={onPromoteTab}
        onReorder={onReorderTabs}
      />

      {activeFile && fileTypeInfo?.kind === 'markdown' && viewMode === 'edit' && (
        <div className="writing-mode-switch" role="group" aria-label="Modo de escrita">
          <button className={`app-view-btn ${!sourceMode ? 'active' : ''}`}
            aria-pressed={!sourceMode} onClick={() => setSourceMode(false)}>Escrita</button>
          <button className={`app-view-btn ${sourceMode ? 'active' : ''}`}
            aria-pressed={sourceMode} onClick={() => setSourceMode(true)}>Markdown</button>
        </div>
      )}

      {activeFile && lockedFiles.has(activeFile) && (
        <div className="copilot-lock-overlay" aria-hidden>
          <span className="copilot-lock-label">writing…</span>
        </div>
      )}

      <FindReplaceBar
        open={findReplaceOpen}
        onClose={() => onSetFindReplaceOpen(false)}
        editorRef={editorRef}
        fileKind={fileTypeInfo?.kind ?? null}
      />

      <div key={activeFile ?? ''} className="editor-file-view">
        <EditorErrorBoundary
          activeFile={activeFile}
          onReload={onOpenFile}
          onClose={onCloseTab}
        >
          <Suspense fallback={<div className="canvas-loading">Loading file…</div>}>
            {fileTypeInfo?.kind === 'pdf' && activeFile ? (
              <PDFViewer
                absPath={`${workspace.path}/${activeFile}`}
                filename={activeFile}
                onStat={onSetFileStat}
              />
            ) : (fileTypeInfo?.kind === 'video' || fileTypeInfo?.kind === 'audio' || fileTypeInfo?.kind === 'image') && activeFile ? (
              <MediaViewer
                absPath={`${workspace.path}/${activeFile}`}
                filename={activeFile}
                kind={fileTypeInfo.kind}
                onStat={onSetFileStat}
              />
            ) : !activeFile && homeVisible ? (
              <WorkspaceHome
                workspace={workspace}
                onOpenFile={onOpenFile}
                onCreateFirstFile={onCreateFirstWorkspaceFile}
                aiMarks={aiMarks}
                onOpenAIReview={onOpenAIReview}
                onSwitchWorkspace={onSwitchWorkspace}
                onActivateSync={onActivateSync}
                onClose={() => onSetHomeVisible(false)}
              />
            ) : !activeFile ? (
              <div
                className="ws-empty"
                onClick={() => onSetHomeVisible(true)}
                title={t('appEditorArea.wsEmptyHomeTitle')}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => event.key === 'Enter' && onSetHomeVisible(true)}
              >
                <span className="ws-empty-logo">✦</span>
                <span className="ws-empty-name">cafezin</span>
                <span className="ws-empty-hint">{t('appEditorArea.wsEmptyHint')}</span>
                <span className="ws-empty-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="ws-empty-btn"
                    onClick={() => onSetHomeVisible(true)}
                  >
                    {t('appEditorArea.wsEmptyHomeBtn')}
                  </button>
                  <button
                    type="button"
                    className="ws-empty-btn ws-empty-btn--primary"
                    onClick={() => window.dispatchEvent(new CustomEvent('cafezin:open-ai'))}
                  >
                    ✦ {t('appEditorArea.wsEmptyAskAI')}
                  </button>
                </span>
              </div>
            ) : fileTypeInfo?.kind === 'unsupported' ? (
              <div className="ws-empty ws-empty--unsupported" role="status">
                <span className="ws-empty-logo">✦</span>
                <span className="ws-empty-name">{activeFile}</span>
                <span className="ws-empty-hint">{t('appEditorArea.unsupportedFormatTitle')}</span>
                <span className="ws-empty-hint">{t('appEditorArea.unsupportedFormatHint')}</span>
              </div>
            ) : viewMode === 'preview' && fileTypeInfo?.kind === 'markdown' ? (
              <MarkdownPreview
                content={content}
                onNavigate={onOpenFile}
                currentFilePath={activeFile ?? undefined}
                workspaceFileTree={workspace.fileTree}
                features={workspace.config.features}
              />
            ) : (
              fileTypeInfo?.kind === 'markdown' && !sourceMode ? (
                <ProseEditor
                  key={activeFile ?? 'none'}
                  ref={editorRef}
                  content={content}
                  onChange={onContentChange}
                  onToggleFind={() => onSetFindReplaceOpen(true)}
                  onAIRequest={onAIRequest}
                  onSelectionContextChange={onSelectionContextChange}
                  aiMarks={activeFileMarks.map((mark) => ({ id: mark.id, text: mark.text, revert: mark.revert }))}
                  onAIMarkEdited={onMarkReviewed}
                  fontSize={appSettings.editorFontSize}
                  onImagePaste={onImagePaste}
                  activeFile={activeFile ?? undefined}
                  onNavigate={onOpenFile}
                  workspaceFileTree={workspace.fileTree}
                  isDark={isDarkTheme}
                  isLocked={activeFile ? lockedFiles.has(activeFile) : false}
                />
              ) : (
                <Editor
                  key={activeFile ?? 'none'}
                  ref={editorRef}
                  content={content}
                  onChange={onContentChange}
                  onToggleFind={() => onSetFindReplaceOpen(true)}
                  onAIRequest={onAIRequest}
                  onSelectionContextChange={onSelectionContextChange}
                  aiMarks={activeFileMarks.map((mark) => ({ id: mark.id, text: mark.text, revert: mark.revert }))}
                  onAIMarkEdited={onMarkReviewed}
                  fontSize={appSettings.editorFontSize}
                  onImagePaste={onImagePaste}
                  activeFile={activeFile ?? undefined}
                  isDark={isDarkTheme}
                  isLocked={activeFile ? lockedFiles.has(activeFile) : false}
                />
              )
            )}
          </Suspense>
        </EditorErrorBoundary>
      </div>

      {aiHighlight && viewMode === 'edit' && activeFileMarks.length > 0 &&
        !['pdf', 'video', 'image'].includes(fileTypeInfo?.kind ?? '') && (
        <AIMarkOverlay
          visible={aiHighlight}
          marks={activeFileMarks}
          editorRef={editorRef}
          containerRef={editorAreaRef}
          onReview={onMarkReviewed}
          onReject={onMarkRejected}
        />
      )}

      {fileTypeInfo?.kind === 'markdown' && (
        <BacklinksPanel
          backlinks={backlinks}
          outlinks={outlinks}
          loading={backlinksLoading}
          onOpen={onOpenFile}
        />
      )}
    </div>
  );
}

export const AppEditorArea = memo(AppEditorAreaInner);
