import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { marked } from 'marked';
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
  fetchCopilotModels,
} from '../../services/copilot';
import type { DeviceFlowState } from '../../services/copilot';
import {
  streamChat,
  getActiveProvider,
  isAIConfigured,
  PROVIDER_LABELS,
} from '../../services/aiProvider';
import { DEFAULT_MODEL, FALLBACK_MODELS } from '../../types';
import type { ChatMessage, CopilotModelInfo, ToolActivity, ContentPart } from '../../types';
import { WORKSPACE_TOOLS, buildToolExecutor } from '../../utils/workspaceTools';
import { saveApiSecret } from '../../services/apiSecrets';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Workspace } from '../../types';

marked.setOptions({ gfm: true, breaks: false });

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
const MOBILE_TOOLS = WORKSPACE_TOOLS.filter(
  (t) => !CANVAS_TOOLS.has(t.function.name) && t.function.name !== 'run_command',
);

const MOBILE_SYSTEM_CONTEXT = `\
## Mobile environment constraints
You are running inside the Cafezin iOS app. Keep these limitations in mind:

**What you CAN do:**
- Read, write, patch, rename, delete files in the workspace (markdown, HTML, CSS, JS, JSON, etc.)
- Search across workspace files
- Browse the web and fetch URLs
- Save notes to workspace memory (remember tool)
- Save tasks for desktop execution (save_desktop_task tool)

**What you CANNOT do on mobile:**
- Run shell commands or scripts (no terminal, no npm/node/python/make)
- Edit canvas/tldraw files (slides and diagrams are desktop-only)
- Compile or execute code
- Access external network APIs from within HTML previews (sandbox restricted)
- Push to git requiring SSH keys (HTTPS token auth only)

**When to use save_desktop_task:**
Use it proactively whenever the user asks for something that requires the desktop:
- "run the build", "execute the script", "update the canvas slide", "npm install", etc.
Save a clear task description so the user sees it as a reminder when they open the workspace on their computer.
Do NOT use it for things you can already do here (file edits, writing, web search).`;

// ── Simple markdown renderer for chat bubbles ────────────────────────────────
function MobileMdMessage({ content }: { content: string }) {
  const html = useMemo(() => {
    try { return marked.parse(content) as string; } catch { return content; }
  }, [content]);
  return (
    <div
      className="mb-msg-md-body"
      dangerouslySetInnerHTML={{ __html: html }}
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
    <div className={`mb-tool-chip ${isDone ? (isError ? 'error' : 'done') : 'running'}`}>
      <span className="mb-tool-icon">{icon}</span>
      <span className="mb-tool-label">{label}</span>
      {argHint && <span className="mb-tool-hint">{argHint}</span>}
      <span className="mb-tool-status">
        {!isDone ? <span className="mb-tool-spinner" /> : isError ? <X size={12} /> : <Check size={12} />}
      </span>
    </div>
  );
}

const GROQ_KEY = 'cafezin-groq-key';
function getGroqKey(): string { return localStorage.getItem(GROQ_KEY) ?? ''; }
function saveGroqKey(k: string) { void saveApiSecret(GROQ_KEY, k.trim()); }

interface MobileCopilotProps {
  workspace: Workspace | null;
  /** Relative path of the currently open file — used as context */
  contextFilePath?: string;
  contextFileContent?: string;
  /** Called when agent writes/patches a file so the file tree can refresh */
  onFileWritten?: (path: string) => void;
}

export default function MobileCopilot({
  workspace,
  contextFilePath,
  contextFileContent,
  onFileWritten,
}: MobileCopilotProps) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const [authStatus, setAuthStatus] = useState<'checking' | 'unauthenticated' | 'connecting' | 'authenticated'>(
    () => isAIConfigured() ? 'authenticated' : 'unauthenticated',
  );
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null);

  async function handleSignIn() {
    setAuthStatus('connecting');
    setDeviceFlow(null);
    try {
      await startDeviceFlow(state => setDeviceFlow(state));
      setAuthStatus('authenticated');
      setDeviceFlow(null);
    } catch {
      setAuthStatus('unauthenticated');
      setDeviceFlow(null);
    }
  }

  function handleSignOut() {
    clearOAuthToken();
    setAuthStatus('unauthenticated');
    setMessages([]);
  }

  // ── Models ───────────────────────────────────────────────────────────────
  const [models, setModels] = useState<CopilotModelInfo[]>(FALLBACK_MODELS);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelsLoadedRef = useRef(false);

  useEffect(() => {
    if (authStatus !== 'authenticated' || modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;
    fetchCopilotModels().then(m => setModels(m)).catch(() => {});
  }, [authStatus]);

  // ── Messages ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  /** Live tool activities for the in-flight agent turn */
  const [liveActivities, setLiveActivities] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, liveActivities]);

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
    ];
    if (workspace) {
      systemParts.push(`Workspace: ${workspace.name}.`);
      if (workspace.agentContext) systemParts.push(`\n${workspace.agentContext}`);
    }
    if (contextFilePath && contextFileContent) {
      systemParts.push(
        `\nThe user has "${contextFilePath}" open:\n\`\`\`\n${contextFileContent.slice(0, 20_000)}\n\`\`\``,
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
      const executor = buildToolExecutor(
        workspace.path,
        { current: null }, // no canvas on mobile
        onFileWritten,
      );
      await runCopilotAgent(
        apiMessages,
        MOBILE_TOOLS,
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
  if (authStatus === 'unauthenticated' || authStatus === 'connecting') {
    return (
      <div className="mb-chat">
        <div className="mb-header">
          <span className="mb-header-title">Copilot</span>
        </div>
        <div className="mb-chat-auth">
          {authStatus === 'connecting' && deviceFlow ? (
            <>
              <div className="mb-empty-icon"><Key size={32} weight="light" /></div>
              <div className="mb-chat-auth-title">Sign in to GitHub</div>
              <div className="mb-chat-auth-desc">
                Go to the URL below and enter the code to authorize.
              </div>
              <button
                className="mb-device-flow-url"
                onClick={() => { if (deviceFlow.verificationUri) openUrl(deviceFlow.verificationUri); }}
              >
                {deviceFlow.verificationUri}
              </button>
              <div className="mb-device-flow-code">{deviceFlow.userCode}</div>
              <div className="mb-chat-auth-desc" style={{ fontSize: 12 }}>
                Waiting for authorization…
              </div>
            </>
          ) : (
            <>
              <div className="mb-empty-icon"><Robot size={32} /></div>
              <div className="mb-chat-auth-title">Sign in to use Copilot</div>
              <div className="mb-chat-auth-desc">
                Connect your GitHub Copilot account to start chatting.
              </div>
              <button className="mb-btn" onClick={handleSignIn}>
                Sign in with GitHub
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const activeProvider = getActiveProvider();
  const currentModel = models.find(m => m.id === model) ?? { name: model };

  return (
    <div className="mb-chat">
      {/* Header */}
      <div className="mb-header">
        <span className="mb-header-title">{PROVIDER_LABELS[activeProvider]}</span>
        <button
          className="mb-icon-btn mb-model-btn"
          onClick={() => setShowModelPicker(v => !v)}
          title="Switch model"
        >
          {currentModel.name} ▾
        </button>
        {messages.length > 0 && (
          <button className="mb-icon-btn" onClick={handleClear} title="New chat">
            <X size={14} />
          </button>
        )}
        <button className="mb-icon-btn" onClick={handleSignOut} title="Sign out" style={{ color: 'var(--mb-muted)' }}>
          <SignOut size={14} />
        </button>
      </div>

      {/* Model picker */}
      {showModelPicker && (
        <div className="mb-model-picker">
          {models.map(m => (
            <button
              key={m.id}
              className={`mb-model-option ${m.id === model ? 'active' : ''}`}
              onClick={() => { setModel(m.id); setShowModelPicker(false); }}
            >
              <span className="mb-model-name">{m.name}</span>
              {m.multiplier === 0 && <span className="mb-model-badge free">free</span>}
              {(m.multiplier ?? 1) > 1 && <span className="mb-model-badge premium">{m.multiplier}×</span>}
            </button>
          ))}
        </div>
      )}

      {/* Context pill */}
      {contextFilePath && (
        <div className="mb-context-pill">
          <span className="mb-context-pill-dot" />
          <span>Context: {contextFilePath.split('/').pop()}</span>
          {workspace && (
            <span style={{ marginLeft: 'auto', color: 'var(--mb-accent2)', fontSize: 11 }}>
              agent enabled
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="mb-chat-messages">
        {messages.length === 0 && !streaming && (
          <div className="mb-chat-empty">
            <div className="mb-chat-empty-icon"><Robot size={32} /></div>
            <div className="mb-chat-empty-text">
              {workspace
                ? `I can read, search, and edit files in "${workspace.name}". What would you like to do?`
                : 'Ask anything. Open a workspace on desktop to unlock file editing.'}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          msg.role === 'user' ? (
            <div key={i} className="mb-msg mb-msg-user">
              {contentToString(msg.content)}
            </div>
          ) : (
            <div key={i} className="mb-msg mb-msg-assistant">
              <MobileMdMessage content={contentToString(msg.content)} />
            </div>
          )
        ))}

        {/* Live tool activity chips */}
        {liveActivities.length > 0 && (
          <div className="mb-tool-chips">
            {liveActivities.map((a) => (
              <ToolChip key={a.callId} activity={a} />
            ))}
          </div>
        )}

        {/* Streaming text */}
        {streaming && streamingText && (
          <div className="mb-msg mb-msg-assistant mb-msg-streaming">
            <MobileMdMessage content={streamingText} />
          </div>
        )}
        {streaming && !streamingText && liveActivities.length === 0 && (
          <div style={{ display: 'flex', padding: '4px 8px' }}>
            <div className="mb-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          </div>
        )}

        {error && (
          <div className="mb-chat-error">{error}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Groq key setup */}
      {showGroqSetup && (
        <div className="mb-groq-setup">
          <p>Enter your <a href="https://console.groq.com" style={{ color: 'var(--mb-accent)' }}>Groq API key</a> for voice input:</p>
          <div className="mb-groq-row">
            <input
              className="mb-groq-input"
              type="password"
              placeholder="gsk_..."
              value={groqKeyInput}
              onChange={e => setGroqKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveGroq()}
            />
            <button className="mb-btn" style={{ padding: '8px 14px', fontSize: 13 }} onClick={saveGroq}>Save</button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="mb-chat-input-area">
        <button
          className={`mb-chat-voice ${isRecording ? 'recording' : ''}`}
          onClick={handleVoice}
          title={isRecording ? 'Stop recording' : 'Voice input'}
          disabled={isTranscribing}
        >
          {isTranscribing ? '…' : isRecording ? '⏹' : '🎤'}
        </button>
        <textarea
          ref={textareaRef}
          className="mb-chat-textarea"
          rows={1}
          placeholder="Message Copilot…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
        <button
          className="mb-chat-send"
          onClick={streaming ? handleStop : handleSend}
          disabled={!streaming && !input.trim()}
          style={streaming ? { background: 'var(--mb-danger)' } : undefined}
          title={streaming ? 'Stop' : 'Send'}
        >
          {streaming ? '■' : '↑'}
        </button>
      </div>
    </div>
  );
}

