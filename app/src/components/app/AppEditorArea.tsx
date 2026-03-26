import { lazy, memo, Suspense, type ComponentProps, type MutableRefObject, type RefObject } from 'react';
import type { Editor as TldrawEditor } from 'tldraw';
import Editor from '../Editor';
import type { EditorHandle } from '../Editor';
import ProseEditor from '../ProseEditor';
import { CanvasErrorBoundary } from '../CanvasErrorBoundary';
import { EditorErrorBoundary } from '../EditorErrorBoundary';
import WorkspaceHome from '../WorkspaceHome';
import type { WebPreviewHandle } from '../WebPreview';
import FindReplaceBar from '../FindReplaceBar';
import AIMarkOverlay from '../AIMarkOverlay';
import TabBar from '../TabBar';
import BacklinksPanel from '../BacklinksPanel';
import type { AIEditMark, AISelectionContext, AppSettings, Workspace } from '../../types';
import type { FileTypeInfo } from '../../utils/fileType';

const CanvasEditor = lazy(() => import('../CanvasEditor'));
const MarkdownPreview = lazy(() => import('../MarkdownPreview'));
const WebPreview = lazy(() => import('../WebPreview'));
const PDFViewer = lazy(() => import('../PDFViewer'));
const MediaViewer = lazy(() => import('../MediaViewer'));
const SpreadsheetViewer = lazy(() => import('../SpreadsheetViewer'));

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
  aiNavIndex: number;
  activeFileMarks: AIEditMark[];
  onAIPrev: () => void;
  onAINext: () => void;
  backlinks: ComponentProps<typeof BacklinksPanel>['backlinks'];
  outlinks: ComponentProps<typeof BacklinksPanel>['outlinks'];
  backlinksLoading: boolean;
  canvasResetKey: number;
  onSlideCountChange: (count: number) => void;
  tsDiagnostics: ComponentProps<typeof Editor>['diagnostics'];
  editorRef: RefObject<EditorHandle | null>;
  editorAreaRef: RefObject<HTMLDivElement | null>;
  webPreviewRef: RefObject<WebPreviewHandle | null>;
  canvasEditorRef: MutableRefObject<TldrawEditor | null>;
  rescanFramesRef: MutableRefObject<(() => void) | null>;
  forceSaveRef: MutableRefObject<(() => void) | null>;
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
  onMarkUserEdited: (id: string) => void;
  onOpenFile: (relPath: string, lineNo?: number) => void | Promise<void>;
  onCreateFirstWorkspaceFile: () => void | Promise<void>;
  onWorkspaceTypeChange: (type: string) => void;
  onOpenAIReview: () => void;
  onSwitchWorkspace: () => void | Promise<void>;
  onActivateSync: () => void;
  onSetHomeVisible: (visible: boolean) => void;
  onSetFileStat: (value: string | null) => void;
  onRecoverCanvas: () => Promise<void>;
  onCanvasEditorReady: (editor: TldrawEditor | null) => void;
  onCanvasPresentModeChange: (presenting: boolean) => void;
  onFileSaved: () => void;
  onFormat?: ComponentProps<typeof Editor>['onFormat'];
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
  aiNavIndex,
  activeFileMarks,
  onAIPrev,
  onAINext,
  backlinks,
  outlinks,
  backlinksLoading,
  canvasResetKey,
  onSlideCountChange,
  tsDiagnostics,
  editorRef,
  editorAreaRef,
  webPreviewRef,
  canvasEditorRef,
  rescanFramesRef,
  forceSaveRef,
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
  onMarkUserEdited,
  onOpenFile,
  onCreateFirstWorkspaceFile,
  onWorkspaceTypeChange,
  onOpenAIReview,
  onSwitchWorkspace,
  onActivateSync,
  onSetHomeVisible,
  onSetFileStat,
  onRecoverCanvas,
  onCanvasEditorReady,
  onCanvasPresentModeChange,
  onFileSaved,
  onFormat,
  onImagePaste,

}: AppEditorAreaProps) {
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

      {activeFile && lockedFiles.has(activeFile) && (
        <div className="copilot-lock-overlay" aria-hidden>
          <span className="copilot-lock-label">writing…</span>
        </div>
      )}

      <FindReplaceBar
        open={findReplaceOpen}
        onClose={() => onSetFindReplaceOpen(false)}
        editorRef={editorRef}
        canvasEditor={canvasEditorRef.current}
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
            ) : fileTypeInfo?.kind === 'spreadsheet' && activeFile ? (
              <SpreadsheetViewer
                absPath={`${workspace.path}/${activeFile}`}
                filename={activeFile}
                onStat={onSetFileStat}
                onSelectionContextChange={onSelectionContextChange}
                aiMarks={activeFileMarks}
                aiHighlight={aiHighlight}
                aiNavIndex={aiNavIndex}
                onAIPrev={onAIPrev}
                onAINext={onAINext}
                onMarkReviewed={onMarkReviewed}
                onMarkRejected={onMarkRejected}
                onMarkUserEdited={onMarkUserEdited}
              />
            ) : (fileTypeInfo?.kind === 'video' || fileTypeInfo?.kind === 'audio' || fileTypeInfo?.kind === 'image') && activeFile ? (
              <MediaViewer
                absPath={`${workspace.path}/${activeFile}`}
                filename={activeFile}
                kind={fileTypeInfo.kind}
                onStat={onSetFileStat}
              />
            ) : fileTypeInfo?.kind === 'canvas' && activeFile ? (
              <CanvasErrorBoundary
                key={`${activeFile}-${canvasResetKey}`}
                workspacePath={workspace.path}
                canvasRelPath={activeFile}
                onRecovered={onRecoverCanvas}
              >
                <CanvasEditor
                  key={`${activeFile}-${canvasResetKey}`}
                  content={content}
                  onChange={onContentChange}
                  workspacePath={workspace.path}
                  onEditorReady={onCanvasEditorReady}
                  onSlideCountChange={onSlideCountChange}
                  presentMode={viewMode === 'preview'}
                  onPresentModeChange={onCanvasPresentModeChange}
                  aiMarks={activeFileMarks}
                  aiHighlight={aiHighlight}
                  aiNavIndex={aiNavIndex}
                  onAIPrev={onAIPrev}
                  onAINext={onAINext}
                  onMarkReviewed={onMarkReviewed}
                  onMarkRejected={onMarkRejected}
                  onMarkUserEdited={onMarkUserEdited}
                  rescanFramesRef={rescanFramesRef}
                  forceSaveRef={forceSaveRef}
                  darkMode={isDarkTheme}
                  onFileSaved={onFileSaved}
                  canvasRelPath={activeFile ?? undefined}
                  onSelectionContextChange={onSelectionContextChange}
                />
              </CanvasErrorBoundary>
            ) : !activeFile && homeVisible ? (
              <WorkspaceHome
                workspace={workspace}
                onOpenFile={onOpenFile}
                onCreateFirstFile={onCreateFirstWorkspaceFile}
                onWorkspaceTypeChange={onWorkspaceTypeChange}
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
                title="Abrir workspace home"
                role="button"
                tabIndex={0}
                onKeyDown={(event) => event.key === 'Enter' && onSetHomeVisible(true)}
              >
                <span className="ws-empty-logo">✦</span>
                <span className="ws-empty-name">cafezin</span>
              </div>
            ) : viewMode === 'preview' && fileTypeInfo?.kind === 'markdown' ? (
              <MarkdownPreview
                content={content}
                onNavigate={onOpenFile}
                currentFilePath={activeFile ?? undefined}
                features={workspace.config.features}
              />
            ) : viewMode === 'preview' && (fileTypeInfo?.kind === 'html' || (fileTypeInfo?.kind === 'code' && fileTypeInfo.supportsPreview)) && activeFile ? (
              <WebPreview
                ref={webPreviewRef}
                content={content}
                absPath={`${workspace.path}/${activeFile}`}
                filename={activeFile}
                isLocked={lockedFiles.has(activeFile)}
              />
            ) : (
              fileTypeInfo?.kind === 'markdown' ? (
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
                language={fileTypeInfo?.language}
                activeFile={activeFile ?? undefined}
                isDark={isDarkTheme}
                isLocked={activeFile ? lockedFiles.has(activeFile) : false}
                onFormat={fileTypeInfo?.kind === 'code' ? onFormat : undefined}
                diagnostics={tsDiagnostics}

              />
              )
            )}
          </Suspense>
        </EditorErrorBoundary>
      </div>

      {aiHighlight && viewMode === 'edit' && activeFileMarks.length > 0 &&
        !['pdf', 'video', 'image', 'canvas', 'spreadsheet'].includes(fileTypeInfo?.kind ?? '') && (
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

