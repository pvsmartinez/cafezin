import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FileText, PencilSimple, Wrench, FolderOpen, MagnifyingGlass,
  ArrowsLeftRight, Trash, Stack, CheckCircle, Globe, Link,
  Image, FloppyDisk, Package, GearSix, Flag, Camera, Desktop,
  Lightning, X, Check, Key, Robot, SignOut,
} from '@phosphor-icons/react';
import {
  runCopilotAgent,
  startDeviceFlow,
  clearOAuthToken,
  getStoredOAuthToken,
  fetchCopilotModels,
  filterChatCompletionsCompatibleModels,
  resolveCopilotModelForChatCompletions,
} from '../../services/copilot';
import type { DeviceFlowState } from '../../services/copilot';
import { COPILOT_MODELS_CHANGED_EVENT } from '../../services/copilot/constants';
import {
  streamChat,
  getActiveProvider,
  isAIConfigured,
  PROVIDER_LABELS,
  PROVIDER_SHORT_LABELS,
  setCustomEndpoint,
  getCustomEndpoint,
  getCustomModelId,
  type AIProviderType,
} from '../../services/aiProvider';
import { DEFAULT_MODEL, FALLBACK_MODELS } from '../../types';
import type { ChatMessage, CopilotModelInfo, ToolActivity, ContentPart } from '../../types';
import { getWorkspaceTools, buildToolExecutor } from '../../utils/workspaceTools';
import { saveApiSecret } from '../../services/apiSecrets';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Workspace } from '../../types';
import { AIMarkdownText } from '../ai/AIMarkdownText';
import { ManagedAIQuotaModal } from '../ai/ManagedAIQuotaModal';
import { useAccountState } from '../../hooks/useAccountState';
import { getGroqLangPreference } from '../../hooks/useVoiceInput';
import { resolveVoiceTranscriptionLanguage } from '../../utils/voiceLanguage';
import {
  buildAgentGuidanceDigest,
  summarizeWorkspaceFiles,
  truncateDocumentContext,
} from '../../utils/agentPromptContext';

const contentToString = (content: string | ContentPart[]): string =>
  typeof content === 'string'
    ? content
    : content
        .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');

// Strip canvas + shell tools — neither is available on mobile
const CANVAS_TOOLS = new Set([
  'list_canvas_shapes', 'canvas_op', 'canvas_screenshot', 'add_canvas_image',
]);
const MOBILE_SYSTEM_CONTEXT = `\
## Mobile environment constraints
You are running inside the Cafezin iOS app. Keep these limitations in mind:

**What you CAN do:**
- Read, write, patch, rename, delete files in the workspace (markdown, HTML, CSS, JS, JSON, etc.)
- Search across workspace files
- Browse the web and fetch URLs
- Save notes to workspace memory (remember tool)
- Save tasks for desktop execution (save_desktop_task tool)
- Export workspace as **PDF** (markdown → PDF, pure JS) or **ZIP** — call export_workspace
- After exporting, tell the user to open the file in the Files tab (it will be in the outputDir folder)

**What you CANNOT do on mobile:**
- Run shell commands or scripts (no terminal, no npm/node/python/make)
- Edit canvas/tldraw files (slides and diagrams are desktop-only)
- Export as canvas-png, canvas-pdf, custom script, or git-publish (all require shell/canvas)
- Compile or execute code
- Access external network APIs from within HTML previews (sandbox restricted)
- Push to git requiring SSH keys (HTTPS token auth only)

**When to use save_desktop_task:**
Use it proactively whenever the user asks for something that requires the desktop:
- "run the build", "execute the script", "update the canvas slide", "npm install", etc.
Save a clear task description so the user sees it as a reminder when they open the workspace on their computer.
Do NOT use it for things you can already do here (file edits, writing, web search).`;

const MOBILE_SEARCH_CONTEXT = `\
## Search and discovery rules
When looking for a file, feature, or fact in the workspace, do not stop after one literal search.

- Start broad with search_workspace_index or outline_workspace to locate likely files by headings, exports, keys, and structure.
- Then use search_workspace with multiple reformulations: synonyms, abbreviations, singular/plural, Portuguese/English variants, and implementation terms.
- Use regex proactively when wording may vary, for example /auth|login|session/i or /agent|copilot|assistant/i.
- If the user describes something semantically, infer likely terms and search for those instead of waiting for exact wording.
- Only say you could not find something after both structural discovery and multiple targeted searches fail.`;

// ── Simple markdown renderer for chat bubbles ────────────────────────────────
function MobileMdMessage({
  content,
  workspace,
  onOpenFileReference,
}: {
  content: string;
  workspace: Workspace | null;
  onOpenFileReference?: (relPath: string, lineNo?: number) => void | Promise<void>;
}) {
  return (
    <AIMarkdownText
      content={content}
      workspace={workspace}
      onOpenFileReference={onOpenFileReference}
    />
  );
}

// ── Tool activity chip ────────────────────────────────────────────────────────
const S = 14; // default icon size for tool chips
const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_workspace_file:      <FileText      size={S} />,
  write_workspace_file:     <PencilSimple  size={S} />,
  patch_workspace_file:     <Wrench        size={S} />,
  list_workspace_files:     <FolderOpen    size={S} />,
  search_workspace:         <MagnifyingGlass size={S} />,
  rename_workspace_file:    <ArrowsLeftRight size={S} />,
  delete_workspace_file:    <Trash         size={S} />,
  scaffold_workspace:       <Stack         size={S} />,
  check_file:               <CheckCircle   size={S} />,
  web_search:               <Globe         size={S} />,
  fetch_url:                <Link          size={S} />,
  search_images:            <Image         size={S} />,
  remember:                 <FloppyDisk    size={S} />,
  export_workspace:         <Package       size={S} />,
  configure_export_targets: <GearSix       size={S} />,
  mark_for_review:          <Flag          size={S} />,
  screenshot_preview:       <Camera        size={S} />,
  save_desktop_task:        <Desktop       size={S} />,
};

function ToolChip({ activity }: { activity: ToolActivity }) {
  const icon = TOOL_ICONS[activity.name] ?? <Lightning size={S} />;
  const label = activity.name.replace(/_/g, ' ');
  const isDone = activity.result !== undefined || activity.error !== undefined;
  const isError = !!activity.error;

  const args = activity.args ?? {};
  let argHint = '';
  if (args.path)    argHint = String(args.path).split('/').pop() ?? '';
  else if (args.query)   argHint = String(args.query).slice(0, 28);
  else if (args.content) argHint = String(args.content).slice(0, 28);
  else if (args.url)     argHint = String(args.url).replace(/^https?:\/\//, '').slice(0, 28);

  return (
    <div className={`flex items-center gap-1.5 bg-surface-2 border rounded-[20px] py-[5px] px-[10px] pl-2 text-xs max-w-[260px] overflow-hidden
      ${!isDone ? 'border-[rgba(var(--accent-rgb),0.3)] text-app-text' : isError ? 'border-[rgba(var(--red-rgb),0.4)] text-danger' : 'opacity-60 border-app-border text-muted'}`}>
      <span className="text-[13px] shrink-0">{icon}</span>
      <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink-0">{label}</span>
      {argHint && <span className="text-muted whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0 italic">{argHint}</span>}
      <span className="text-xs shrink-0 ml-auto">
        {!isDone
          ? <span className="inline-block w-[10px] h-[10px] border-[1.5px] border-[rgba(var(--accent-rgb),0.3)] border-t-accent rounded-full animate-mb-spin align-middle" />
          : isError ? <X size={12} /> : <Check size={12} />}
      </span>
    </div>
  );
}

const GROQ_KEY = 'cafezin-groq-key';
function getGroqKey(): string { return localStorage.getItem(GROQ_KEY) ?? ''; }
function saveGroqKey(k: string) { void saveApiSecret(GROQ_KEY, k.trim()); }

// ── BYOK helpers ─────────────────────────────────────────────────────────────
const BYOK_KEY_MAP: Record<Exclude<AIProviderType, 'copilot' | 'cafezin' | 'custom'>, string> = {
  openai:    'cafezin-openai-key',
  anthropic: 'cafezin-anthropic-key',
  groq:      'cafezin-groq-key',
  google:    'cafezin-google-key',
};

const PROVIDER_KEY_URLS: Record<Exclude<AIProviderType, 'copilot' | 'cafezin' | 'custom'>, string> = {
  openai:    'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/account/keys',
  groq:      'https://console.groq.com/keys',
  google:    'https://aistudio.google.com/app/apikey',
};

const PROVIDER_KEY_PLACEHOLDERS: Record<Exclude<AIProviderType, 'copilot' | 'cafezin' | 'custom'>, string> = {
  openai:    'sk-...',
  anthropic: 'sk-ant-...',
  groq:      'gsk_...',
  google:    'AIza...',
};

interface MobileCopilotProps {
  workspace: Workspace | null;
  /** Relative path of the currently open file — used as context */
  contextFilePath?: string;
  contextFileContent?: string;
  secretsSynced?: number;
  /** Called when agent writes/patches a file so the file tree can refresh */
  onFileWritten?: (path: string) => void;
  onOpenFileReference?: (relPath: string, lineNo?: number) => void | Promise<void>;
  /** Open the Settings sheet (used to direct user to change AI provider) */
  onOpenSettings?: () => void;
}

export default function MobileCopilot({
  workspace,
  contextFilePath,
  contextFileContent,
  onFileWritten,
  secretsSynced,
  onOpenFileReference,
  onOpenSettings,
}: MobileCopilotProps) {
  const copilotOAuthClientId = workspace?.config.githubOAuth?.clientId?.trim() || undefined;
  const premiumUrl = navigator.language.startsWith('pt')
    ? 'https://cafezin.pmatz.com/br/premium'
    : 'https://cafezin.pmatz.com/premium';
  const activeProvider = getActiveProvider();
  const mobileTools = useMemo(
    () => getWorkspaceTools(workspace, workspace?.config.exportConfig).filter(
      (t) => !CANVAS_TOOLS.has(t.function.name) && t.function.name !== 'run_command',
    ),
    [workspace],
  );

  // ── Auth ─────────────────────────────────────────────────────────────────
  const { account, loading: accountLoading, refresh: refreshAccount } = useAccountState();
  const [authStatus, setAuthStatus] = useState<'checking' | 'unauthenticated' | 'connecting' | 'authenticated'>('checking');
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [customEndpointInput, setCustomEndpointInput] = useState(() => getCustomEndpoint());
  const [customModelInput, setCustomModelInput] = useState(() => getCustomModelId());

  useEffect(() => {
    const provider = getActiveProvider();
    if (provider !== 'copilot') {
      setAuthStatus(isAIConfigured() ? 'authenticated' : 'unauthenticated');
      return;
    }
    setAuthStatus(getStoredOAuthToken(copilotOAuthClientId) ? 'authenticated' : 'unauthenticated');
  }, [copilotOAuthClientId, secretsSynced]);

  async function handleSignIn() {
    setAuthError(null);
    setAuthStatus('connecting');
    setDeviceFlow(null);
    try {
      await startDeviceFlow(copilotOAuthClientId ?? '', state => setDeviceFlow(state));
      setAuthStatus('authenticated');
      setDeviceFlow(null);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
      setAuthStatus('unauthenticated');
      setDeviceFlow(null);
    }
  }

  function handleSignOut() {
    const provider = getActiveProvider();
    if (provider === 'copilot') {
      clearOAuthToken(copilotOAuthClientId);
    } else if (provider === 'custom') {
      setCustomEndpoint('');
      localStorage.removeItem('cafezin-ai-model-custom');
      void saveApiSecret('cafezin-custom-key', '');
      setCustomEndpointInput('');
      setCustomModelInput('');
    } else {
      void saveApiSecret(BYOK_KEY_MAP[provider as keyof typeof BYOK_KEY_MAP], '');
    }
    setKeyInput('');
    setAuthStatus('unauthenticated');
    setMessages([]);
  }

  function handleSaveKey() {
    const provider = getActiveProvider();
    if (provider === 'custom') {
      setCustomEndpoint(customEndpointInput.trim());
      if (customModelInput.trim()) localStorage.setItem('cafezin-ai-model-custom', customModelInput.trim());
      if (keyInput.trim()) void saveApiSecret('cafezin-custom-key', keyInput.trim());
    } else if (provider !== 'copilot') {
      void saveApiSecret(BYOK_KEY_MAP[provider as keyof typeof BYOK_KEY_MAP], keyInput.trim());
    }
    setAuthStatus('authenticated');
  }

  // ── Models ───────────────────────────────────────────────────────────────
  const [models, setModels] = useState<CopilotModelInfo[]>(FALLBACK_MODELS);
  const [model, setModel] = useState(() => resolveCopilotModelForChatCompletions(DEFAULT_MODEL, FALLBACK_MODELS));
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelsLoadedRef = useRef(false);

  useEffect(() => {
    if (authStatus !== 'authenticated' || modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;
    fetchCopilotModels(copilotOAuthClientId).then(m => {
      setModels(m);
      setModel((current) => resolveCopilotModelForChatCompletions(current, m));
    }).catch(() => {});
  }, [authStatus, copilotOAuthClientId]);

  useEffect(() => {
    function handleCopilotModelsChanged() {
      setModels((current) => {
        const next = filterChatCompletionsCompatibleModels(current);
        setModel((currentModel) => resolveCopilotModelForChatCompletions(currentModel, next));
        return next;
      });
      modelsLoadedRef.current = false;
    }
    window.addEventListener(COPILOT_MODELS_CHANGED_EVENT, handleCopilotModelsChanged);
    return () => window.removeEventListener(COPILOT_MODELS_CHANGED_EVENT, handleCopilotModelsChanged);
  }, []);

  // ── Messages ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  /** Live tool activities for the in-flight agent turn */
  const [liveActivities, setLiveActivities] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showManagedQuotaModal, setShowManagedQuotaModal] = useState(false);
  const [input, setInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, liveActivities]);

  useEffect(() => {
    if (activeProvider === 'cafezin' && error?.includes('Cota mensal da Cafezin IA esgotada')) {
      setShowManagedQuotaModal(true);
    }
  }, [activeProvider, error]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [input]);

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleClear() {
    if (streaming) handleStop();
    setMessages([]);
    setStreamingText('');
    setLiveActivities([]);
    setError(null);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);
    setLiveActivities([]);

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // Build system prompt with workspace + file context
    const systemParts: string[] = [
      'You are a helpful coding and writing assistant. Keep answers concise and clear.',
      MOBILE_SYSTEM_CONTEXT,
      MOBILE_SEARCH_CONTEXT,
    ];
    if (workspace) {
      systemParts.push(`Workspace: ${workspace.name}.`);
      const workspaceSummary = summarizeWorkspaceFiles(workspace.fileTree, {
        activeFile: contextFilePath,
        recentFiles: workspace.config.recentFiles,
        maxFiles: 8,
      });
      if (workspaceSummary) systemParts.push(`\n${workspaceSummary}`);

      const workspaceGuidance = buildAgentGuidanceDigest(
        workspace.agentInstructionSources ?? workspace.agentContext,
        2400,
      );
      if (workspaceGuidance) systemParts.push(`\nWorkspace guidance:\n${workspaceGuidance}`);
    }
    if (contextFilePath && contextFileContent) {
      systemParts.push(
        `\nThe user has "${contextFilePath}" open:\n\`\`\`\n${truncateDocumentContext(contextFileContent, contextFilePath, 12_000)}\n\`\`\``,
      );
    }

    const systemPrompt: ChatMessage = { role: 'system', content: systemParts.join('\n') };
    const apiMessages: ChatMessage[] = [systemPrompt, ...newMessages];

    const abort = new AbortController();
    abortRef.current = abort;
    setStreaming(true);
    setStreamingText('');

    let accumulated = '';

    const onChunk = (chunk: string) => {
      accumulated += chunk;
      setStreamingText(accumulated);
    };

    const onDone = () => {
      if (accumulated) {
        setMessages(prev => [...prev, { role: 'assistant', content: accumulated }]);
      }
      setStreamingText('');
      setLiveActivities([]);
      setStreaming(false);
      abortRef.current = null;
    };

    const onError = (err: Error) => {
      if (accumulated) {
        setMessages(prev => [...prev, { role: 'assistant', content: accumulated }]);
      }
      setStreamingText('');
      setLiveActivities([]);
      setStreaming(false);
      setError(err.message);
      abortRef.current = null;
    };

    if (workspace) {
      // Full agent loop with workspace tools (canvas + shell blocked on mobile)
      const executor = buildToolExecutor({
        workspacePath: workspace.path,
        canvasEditor: { current: null }, // no canvas on mobile
        isMobile: true,
        onFileWritten,
      });
      await runCopilotAgent(
        apiMessages,
        mobileTools,
        executor,
        onChunk,
        (activity: ToolActivity) => {
          setLiveActivities(prev => {
            const idx = prev.findIndex(a => a.callId === activity.callId);
            if (idx >= 0) { const next = [...prev]; next[idx] = activity; return next; }
            return [...prev, activity];
          });
        },
        onDone,
        onError,
        model,
        workspace.path,
        undefined,
        abort.signal,
        undefined,
        copilotOAuthClientId,
      );
    } else {
      // No workspace — plain streaming chat (supports all providers)
      await streamChat(apiMessages, onChunk, onDone, onError, model, abort.signal);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [groqKey, setGroqKey] = useState(() => getGroqKey());
  const [showGroqSetup, setShowGroqSetup] = useState(false);
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg') ? 'audio/ogg' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setIsRecording(false);
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const ab = await blob.arrayBuffer();
        const uint8 = new Uint8Array(ab);
        // Chunked btoa to avoid call-stack overflow on large audio files
        const CHUNK = 8192;
        let binary = '';
        for (let i = 0; i < uint8.length; i += CHUNK) {
          binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
        }
        const audioBase64 = btoa(binary);
        setIsTranscribing(true);
        try {
          const transcript = await invoke<string>('transcribe_audio', {
            audioBase64,
            mimeType,
            apiKey: groqKey,
            language: resolveVoiceTranscriptionLanguage({
              overrideLanguage: getGroqLangPreference(),
              workspaceLanguage: workspace?.config.preferredLanguage,
              navigatorLanguage: navigator.language,
            }),
          });
          setInput(prev => prev ? `${prev} ${transcript}` : transcript);
        } catch (err) {
          setError(`Voice transcription failed: ${err}`);
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setError(`Microphone access denied: ${err}`);
    }
  }, [groqKey]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  function handleVoice() {
    if (!groqKey) { setShowGroqSetup(v => !v); return; }
    if (isRecording) stopRecording();
    else startRecording();
  }

  function saveGroq() {
    saveGroqKey(groqKeyInput);
    setGroqKey(groqKeyInput);
    setShowGroqSetup(false);
  }

  // ── Auth screen ──────────────────────────────────────────────────────────
  // Premium gate: block AI for free/unauthenticated accounts before provider auth.
  if (!accountLoading && !account.canUseAI) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3 pb-[10px] border-b border-app-border bg-surface shrink-0">
          <span className="flex-1 text-[17px] font-semibold truncate">{PROVIDER_LABELS[getActiveProvider()]}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          <div className="opacity-40 text-muted" style={{ fontSize: 32 }}>&#9733;</div>
          <div className="text-lg font-semibold">
            {account.authenticated ? 'Recurso do plano Basic ou superior' : 'IA disponível no plano Basic'}
          </div>
          <div className="text-sm text-muted max-w-[260px] leading-[1.5]">
            {account.authenticated
              ? 'Faça upgrade para Basic ou superior para liberar a IA no app.'
              : 'Crie sua conta e assine um plano Basic, Standard ou Pro para usar IA no Cafezin.'}
          </div>
          <a
            href={premiumUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary"
            style={{ textDecoration: 'none' }}
          >
            Ver planos ↗
          </a>
          <button
            className="text-sm text-muted"
            onClick={() => void refreshAccount()}
            disabled={accountLoading}
          >
            {accountLoading ? 'Verificando…' : 'Já assinei — atualizar'}
          </button>
        </div>
      </div>
    );
  }
  if (authStatus === 'unauthenticated' || authStatus === 'connecting') {
    const provider = getActiveProvider();

    // BYOK providers: show inline key / endpoint entry instead of GitHub OAuth
    if (provider !== 'copilot') {
      const isByok = provider !== 'custom';
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-3 pb-[10px] border-b border-app-border bg-surface shrink-0">
            <span className="flex-1 text-[17px] font-semibold truncate">{PROVIDER_LABELS[provider]}</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
            <div className="opacity-40 text-muted"><Key size={32} weight="light" /></div>
            {isByok ? (
              <>
                <div className="text-lg font-semibold">Enter your {PROVIDER_LABELS[provider]} key</div>
                <div className="text-sm text-muted max-w-[260px] leading-[1.5]">
                  Your key is encrypted and synced across devices.{' '}
                  <button
                    className="text-accent underline bg-transparent border-0 cursor-pointer text-sm p-0"
                    onClick={() => openUrl(PROVIDER_KEY_URLS[provider as keyof typeof PROVIDER_KEY_URLS])}
                  >
                    Get a key ↗
                  </button>
                </div>
                <input
                  className="w-full bg-surface-2 border border-app-border rounded-lg px-[10px] py-2 text-app-text text-sm outline-none"
                  type="password"
                  placeholder={PROVIDER_KEY_PLACEHOLDERS[provider as keyof typeof PROVIDER_KEY_PLACEHOLDERS]}
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
                />
              </>
            ) : (
              <>
                <div className="text-lg font-semibold">Configure local / custom AI</div>
                <div className="text-sm text-muted max-w-[260px] leading-[1.5]">
                  Enter the URL of your OpenAI-compatible server (Ollama, LM Studio, OpenRouter…)
                </div>
                <input
                  className="w-full bg-surface-2 border border-app-border rounded-lg px-[10px] py-2 text-app-text text-sm outline-none"
                  type="url"
                  placeholder="http://192.168.1.x:11434/v1"
                  value={customEndpointInput}
                  onChange={e => setCustomEndpointInput(e.target.value)}
                />
                <input
                  className="w-full bg-surface-2 border border-app-border rounded-lg px-[10px] py-2 text-app-text text-sm outline-none"
                  type="text"
                  placeholder="Model ID (e.g. llama3.2)"
                  value={customModelInput}
                  onChange={e => setCustomModelInput(e.target.value)}
                />
                <input
                  className="w-full bg-surface-2 border border-app-border rounded-lg px-[10px] py-2 text-app-text text-sm outline-none"
                  type="password"
                  placeholder="API key (optional)"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                />
              </>
            )}
            <button
              className="btn-primary w-full"
              onClick={handleSaveKey}
              disabled={provider === 'custom'
                ? !customEndpointInput.trim() || !customModelInput.trim()
                : !keyInput.trim()}
            >
              Save &amp; continue
            </button>
            {onOpenSettings && (
              <button className="text-sm text-muted" onClick={onOpenSettings}>
                Change AI provider in Settings
              </button>
            )}
          </div>
        </div>
      );
    }

    // Copilot: GitHub OAuth device flow
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3 pb-[10px] border-b border-app-border bg-surface shrink-0">
          <span className="flex-1 text-[17px] font-semibold truncate">GitHub Copilot</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          {authStatus === 'connecting' && deviceFlow ? (
            <>
              <div className="opacity-40 text-muted"><Key size={32} weight="light" /></div>
              <div className="text-lg font-semibold">Sign in to GitHub</div>
              <div className="text-sm text-muted max-w-[260px] leading-[1.5]">
                Go to the URL below and enter the code to authorize.
              </div>
              <button
                className="text-sm text-muted underline cursor-pointer device-flow-url"
                onClick={() => { if (deviceFlow.verificationUri) openUrl(deviceFlow.verificationUri); }}
              >
                {deviceFlow.verificationUri}
              </button>
              <div className="text-[28px] font-bold tracking-[4px] font-mono text-accent bg-surface-2 border border-app-border rounded-[10px] px-5 py-3 device-flow-code">
                {deviceFlow.userCode}
              </div>
              <div className="text-xs text-muted">Waiting for authorization…</div>
            </>
          ) : (
            <>
              <div className="opacity-40 text-muted"><Robot size={32} /></div>
              <div className="text-lg font-semibold">Sign in to use Copilot</div>
              <div className="text-sm text-muted max-w-[260px] leading-[1.5]">
                Connect your GitHub Copilot account to start chatting.
              </div>
              {authError && (
                <div className="text-sm text-danger max-w-[280px] leading-[1.5]">
                  {authError}
                </div>
              )}
              <button className="btn-primary" onClick={handleSignIn}>
                Sign in with GitHub
              </button>
              {onOpenSettings && (
                <button className="text-sm text-muted" onClick={onOpenSettings}>
                  Use a different AI provider
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const currentModel = models.find(m => m.id === model) ?? { name: model };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-[10px] border-b border-app-border bg-surface shrink-0">
        <span className="flex-1 text-[17px] font-semibold truncate">{PROVIDER_LABELS[activeProvider]}</span>
        <button
          className="icon-btn text-xs px-[10px] py-1 rounded-lg bg-surface-2 text-muted"
          onClick={() => setShowModelPicker(v => !v)}
          title="Switch model"
        >
          {currentModel.name} ▾
        </button>
        {messages.length > 0 && (
          <button className="icon-btn" onClick={handleClear} title="New chat">
            <X size={14} />
          </button>
        )}
        <button className="icon-btn text-muted" onClick={handleSignOut} title="Sign out">
          <SignOut size={14} />
        </button>
      </div>

      {/* Model picker */}
      {showModelPicker && (
        <div className="bg-surface border border-app-border rounded-[10px] mx-3 py-1 z-20 max-h-[220px] overflow-y-auto shrink-0">
          {models.map(m => (
            <button
              key={m.id}
              className={`mb-tap flex items-center w-full px-4 py-[9px] bg-transparent border-0 text-left cursor-pointer text-app-text text-sm gap-2 ${m.id === model ? 'bg-[rgba(var(--accent-rgb),0.12)]' : ''}`}
              onClick={() => {
                setModel(resolveCopilotModelForChatCompletions(m.id, models));
                setShowModelPicker(false);
              }}
            >
              <span className="flex-1">{m.name}</span>
              {m.multiplier === 0 && <span className="text-[11px] px-1.5 py-px rounded font-semibold text-success bg-[rgba(var(--accent-rgb),0.1)]">free</span>}
              {(m.multiplier ?? 1) > 1 && <span className="text-[11px] px-1.5 py-px rounded font-semibold text-muted bg-[rgba(var(--accent-rgb),0.06)]">{m.multiplier}×</span>}
            </button>
          ))}
        </div>
      )}

      {/* Context pill */}
      {contextFilePath && (
        <div className="flex items-center gap-1.5 text-xs text-muted bg-surface-2 border-b border-app-border px-3 py-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
          <span>Context: {contextFilePath.split('/').pop()}</span>
          {workspace && (
            <span className="ml-auto text-[11px] text-accent">agent enabled</span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-touch px-3 pt-3 pb-2 flex flex-col gap-2">
        {messages.length === 0 && !streaming && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3.5 px-6 py-10 text-center">
            <div className="text-[40px] opacity-25"><Robot size={32} /></div>
            <div className="text-sm text-muted max-w-[280px] leading-[1.55]">
              {workspace
                ? `I can read, search, and edit files in "${workspace.name}". What would you like to do?`
                : 'Ask anything. Open a workspace on desktop to unlock file editing.'}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          msg.role === 'user' ? (
            <div key={i} className="max-w-[86%] px-[13px] py-[10px] rounded-2xl text-sm leading-[1.5] break-words self-end bg-accent text-[var(--text-on-emphasis)] rounded-br-[4px]">
              {contentToString(msg.content)}
            </div>
          ) : (
            <div key={i} className="max-w-[86%] px-[13px] py-[10px] rounded-2xl text-sm leading-[1.5] break-words self-start bg-surface-2 text-app-text rounded-bl-[4px]">
              <MobileMdMessage
                content={contentToString(msg.content)}
                workspace={workspace}
                onOpenFileReference={onOpenFileReference}
              />
            </div>
          )
        ))}

        {/* Live tool activity chips */}
        {liveActivities.length > 0 && (
          <div className="flex flex-col gap-1 pb-1 self-start max-w-full">
            {liveActivities.map((a) => (
              <ToolChip key={a.callId} activity={a} />
            ))}
          </div>
        )}

        {/* Streaming text */}
        {streaming && streamingText && (
          <div className="max-w-[86%] px-[13px] py-[10px] rounded-2xl text-sm leading-[1.5] break-words self-start bg-surface-2 text-app-text rounded-bl-[4px] msg-streaming">
            <MobileMdMessage
              content={streamingText}
              workspace={workspace}
              onOpenFileReference={onOpenFileReference}
            />
          </div>
        )}
        {streaming && !streamingText && liveActivities.length === 0 && (
          <div className="flex px-2 py-1">
            <div className="spinner w-5 h-5" />
          </div>
        )}

        {error && (
          <div className="chat-error bg-[rgba(var(--red-rgb),0.15)] border border-[rgba(var(--red-rgb),0.3)] text-danger rounded-[10px] px-[13px] py-[10px] text-[13px] mx-3">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Groq key setup */}
      {showGroqSetup && (
        <div className="bg-surface border-t border-app-border px-3 pt-3 flex flex-col gap-2" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
          <p className="m-0 text-[13px] text-muted">
            Enter your <a href="https://console.groq.com" className="text-accent">Groq API key</a> for voice input:
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-surface-2 border border-app-border rounded-lg px-[10px] py-2 text-app-text text-sm outline-none"
              type="password"
              placeholder="gsk_..."
              value={groqKeyInput}
              onChange={e => setGroqKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveGroq()}
            />
            <button className="btn-primary px-[14px] py-2 text-[13px]" onClick={saveGroq}>Save</button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 px-3 pt-2 flex items-end gap-2 bg-surface border-t border-app-border" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}>
        <button
          className={`w-[38px] h-[38px] border rounded-full text-lg flex items-center justify-center shrink-0 cursor-pointer transition-[background,color] duration-150 ${isRecording ? 'bg-[rgba(var(--red-rgb),0.2)] text-danger border-danger animate-mb-pulse' : 'bg-surface-2 border-app-border text-muted'}`}
          onClick={handleVoice}
          title={isRecording ? 'Stop recording' : 'Voice input'}
          disabled={isTranscribing}
        >
          {isTranscribing ? '…' : isRecording ? '⏹' : '🎤'}
        </button>
        <textarea
          ref={textareaRef}
          className="flex-1 bg-surface-2 border border-app-border rounded-xl px-3 py-[10px] text-app-text text-[15px] font-[inherit] resize-none outline-none leading-[1.4] max-h-[140px] overflow-y-auto placeholder:text-muted"
          rows={1}
          placeholder={`Message ${PROVIDER_SHORT_LABELS[activeProvider]}…`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
        <button
          className="w-[38px] h-[38px] border-0 rounded-full text-lg flex items-center justify-center shrink-0 cursor-pointer transition-opacity text-[var(--text-on-emphasis)] disabled:opacity-35 active:opacity-65"
          style={{ background: streaming ? 'var(--red)' : 'var(--accent)' }}
          onClick={streaming ? handleStop : handleSend}
          disabled={!streaming && !input.trim()}
          title={streaming ? 'Stop' : 'Send'}
        >
          {streaming ? '■' : '↑'}
        </button>
      </div>

      <ManagedAIQuotaModal
        open={showManagedQuotaModal}
        message={error}
        onClose={() => setShowManagedQuotaModal(false)}
        onUpgrade={() => {
          setShowManagedQuotaModal(false);
          openUrl(premiumUrl).catch(() => window.open(premiumUrl, '_blank'));
        }}
        onChooseProvider={() => {
          setShowManagedQuotaModal(false);
          onOpenSettings?.();
        }}
      />
    </div>
  );
}
