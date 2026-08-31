import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ContentPart, CopilotModelInfo, ToolActivity } from "../types";

export interface PiPreflight {
  available: boolean;
  authenticated: boolean;
  executable: string;
  message: string;
}

export interface PiImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface PiEventPayload {
  agentId: string;
  event: Record<string, unknown>;
}

export interface PiRunOptions {
  agentId: string;
  workspacePath: string;
  sessionId: string;
  provider: "openrouter";
  model: string;
  systemPrompt: string;
  message: string;
  images?: PiImage[];
  thinking?: string;
  signal: AbortSignal;
  onChunk: (chunk: string) => void;
  onActivity: (activity: ToolActivity) => void;
  onCommands?: (commands: string[]) => void;
}

export class PiUnavailableError extends Error {
  readonly code = "PI_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "PiUnavailableError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorValue(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (record) {
    return (
      stringValue(record.message) ??
      stringValue(record.error) ??
      stringValue(record.detail) ??
      JSON.stringify(record)
    );
  }
  return "Pi RPC command failed";
}

/** Pure event mapping kept separate so RPC changes can be tested without Tauri. */
export function mapPiEvent(
  event: Record<string, unknown>,
):
  | { kind: "text"; text: string }
  | { kind: "activity"; activity: ToolActivity }
  | { kind: "done" }
  | { kind: "error"; message: string }
  | null {
  const type = stringValue(event.type);
  const assistantEvent = asRecord(event.assistantMessageEvent);
  const assistantType = stringValue(assistantEvent?.type);

  if (type === "message_update" && assistantType === "text_delta") {
    const text =
      stringValue(assistantEvent?.delta) ?? stringValue(assistantEvent?.text);
    return text ? { kind: "text", text } : null;
  }
  if (
    type === "message_update" &&
    (assistantType === "thinking_delta" || assistantType === "reasoning_delta")
  ) {
    const text =
      stringValue(assistantEvent?.delta) ?? stringValue(assistantEvent?.text);
    return text
      ? {
          kind: "activity",
          activity: {
            callId: "__thinking__",
            name: "__thinking__",
            args: {},
            kind: "thinking",
            thinkingText: text,
          },
        }
      : null;
  }

  if (type === "tool_execution_start") {
    const callId =
      stringValue(event.toolCallId) ??
      stringValue(event.callId) ??
      stringValue(event.id) ??
      `pi-tool-${Date.now()}`;
    const name =
      stringValue(event.toolName) ?? stringValue(event.name) ?? "tool";
    const args = asRecord(event.args) ?? asRecord(event.arguments) ?? {};
    return { kind: "activity", activity: { callId, name, args } };
  }
  if (type === "tool_execution_update") {
    const callId =
      stringValue(event.toolCallId) ??
      stringValue(event.callId) ??
      stringValue(event.id);
    if (!callId) return null;
    const update =
      stringValue(event.progress) ??
      stringValue(event.output) ??
      stringValue(event.text);
    return {
      kind: "activity",
      activity: {
        callId,
        name: stringValue(event.toolName) ?? "tool",
        args: {},
        ...(update ? { result: update } : {}),
      },
    };
  }
  if (type === "tool_execution_end") {
    const callId =
      stringValue(event.toolCallId) ??
      stringValue(event.callId) ??
      stringValue(event.id);
    if (!callId) return null;
    const result = stringValue(event.result) ?? stringValue(event.output) ?? "";
    const error = stringValue(event.error);
    return {
      kind: "activity",
      activity: {
        callId,
        name: stringValue(event.toolName) ?? "tool",
        args: {},
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
      },
    };
  }
  if (type === "agent_end" || type === "agent_settled") return { kind: "done" };
  if (type === "process_error" || type === "process_stderr") {
    return {
      kind: "error",
      message:
        stringValue(event.message) ??
        stringValue(event.text) ??
        "Pi process error",
    };
  }
  if (type === "process_exit") {
    return {
      kind: "error",
      message: "Pi process exited before completing the request",
    };
  }
  if (type === "response" && event.success === false) {
    return {
      kind: "error",
      message: errorValue(event.error),
    };
  }
  return null;
}

export function dataUrlToPiImage(dataUrl: string): PiImage | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { type: "image", mimeType: match[1], data: match[2] };
}

export function contentPartsToPiPrompt(content: string | ContentPart[]): {
  message: string;
  images: PiImage[];
} {
  if (typeof content === "string") return { message: content, images: [] };
  const text = content
    .filter(
      (part): part is Extract<ContentPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
  const images = content
    .filter(
      (part): part is Extract<ContentPart, { type: "image_url" }> =>
        part.type === "image_url",
    )
    .map((part) => dataUrlToPiImage(part.image_url.url))
    .filter((image): image is PiImage => image !== null);
  return { message: text, images };
}

export async function preflightPi(): Promise<PiPreflight> {
  try {
    return await invoke<PiPreflight>("pi_preflight");
  } catch (error) {
    throw new PiUnavailableError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function normalizePiModelId(modelId: string): string {
  return modelId.trim().replace(/^openrouter\//i, "");
}

function mapPiModel(value: unknown): CopilotModelInfo | null {
  const model = asRecord(value);
  const id = stringValue(model?.id);
  if (!id) return null;
  const input = model?.input;
  const supportsVision = Array.isArray(input)
    ? input.some((item) => typeof item === "string" && /image|vision/i.test(item))
    : Boolean(model?.supportsVision);
  return {
    id: normalizePiModelId(id),
    name: stringValue(model?.name) ?? id,
    multiplier: 0,
    isPremium: false,
    ...(stringValue(model?.provider) ? { vendor: stringValue(model?.provider) } : {}),
    supportsVision,
    ...(typeof model?.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model?.maxTokens === "number" ? { maxOutputTokens: model.maxTokens } : {}),
  };
}

export async function getPiModels(): Promise<CopilotModelInfo[]> {
  try {
    const raw = await invoke<unknown[]>("pi_get_available_models");
    return raw.map(mapPiModel).filter((model): model is CopilotModelInfo => model !== null);
  } catch (error) {
    throw new PiUnavailableError(error instanceof Error ? error.message : String(error));
  }
}

function sessionDirectory(workspacePath: string): string {
  return `${workspacePath.replace(/[\\/]$/, "")}/.cafezin/pi-sessions`;
}

function rpcId(): string {
  return `cafezin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PendingPiResponse {
  resolve: (event: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PiChannel {
  ready: Promise<UnlistenFn>;
  observers: Set<(event: Record<string, unknown>) => void>;
  pending: Map<string, PendingPiResponse>;
}

const piChannels = new Map<string, PiChannel>();

async function ensurePiChannel(agentId: string): Promise<PiChannel> {
  const existing = piChannels.get(agentId);
  if (existing) {
    await existing.ready;
    return existing;
  }

  const channel: PiChannel = {
    ready: Promise.resolve(() => undefined),
    observers: new Set(),
    pending: new Map(),
  };
  channel.ready = listen<PiEventPayload>("pi:event", ({ payload }) => {
    if (payload.agentId !== agentId) return;
    const event = payload.event;
    const id = stringValue(event.id);
    if (event.type === "response" && id) {
      const pending = channel.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        channel.pending.delete(id);
        if (event.success === false) pending.reject(new Error(errorValue(event.error)));
        else pending.resolve(event);
      }
    }
    if (event.type === "process_exit" || event.type === "process_error") {
      const processError = new PiUnavailableError(
        event.type === "process_error"
          ? stringValue(event.message) ?? "Pi process error"
          : "Pi process exited before completing the request",
      );
      for (const pending of channel.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(processError);
      }
      channel.pending.clear();
    }
    for (const observer of channel.observers) observer(event);
  });
  piChannels.set(agentId, channel);
  try {
    await channel.ready;
    return channel;
  } catch (error) {
    piChannels.delete(agentId);
    throw new PiUnavailableError(error instanceof Error ? error.message : String(error));
  }
}

async function disposePiChannel(agentId: string): Promise<void> {
  const channel = piChannels.get(agentId);
  if (!channel) return;
  piChannels.delete(agentId);
  for (const pending of channel.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new PiUnavailableError("Pi channel closed"));
  }
  channel.pending.clear();
  const unlisten = await channel.ready.catch(() => undefined);
  unlisten?.();
}

async function sendPiCommandAndWait(
  agentId: string,
  command: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const channel = await ensurePiChannel(agentId);
  const id = stringValue(command.id) ?? rpcId();
  const request = { ...command, id };
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (channel.pending.delete(id)) {
        reject(new PiUnavailableError(`Pi RPC timeout waiting for ${String(command.type)}`));
      }
    }, 10_000);
    channel.pending.set(id, { resolve, reject, timeout });
  });
  try {
    await sendPiCommand(agentId, request);
    return await response;
  } catch (error) {
    const pending = channel.pending.get(id);
    if (pending) {
      clearTimeout(pending.timeout);
      channel.pending.delete(id);
    }
    throw error;
  }
}

export async function sendPiCommand(
  agentId: string,
  command: Record<string, unknown>,
): Promise<void> {
  try {
    await ensurePiChannel(agentId);
    await invoke("pi_send", { agent_id: agentId, command });
  } catch (error) {
    throw new PiUnavailableError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runPiAgent(options: PiRunOptions): Promise<void> {
  const channel = await ensurePiChannel(options.agentId);
  let settled = false;
  let resolveRun: (() => void) | undefined;
  let rejectRun: ((error: Error) => void) | undefined;
  const completion = new Promise<void>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });

  const settleError = (error: Error) => {
    if (settled) return;
    settled = true;
    rejectRun?.(error);
  };
  const settleDone = () => {
    if (settled) return;
    settled = true;
    resolveRun?.();
  };

  const observer = (event: Record<string, unknown>) => {
      if (settled || event.type === "response") return;
      const mapped = mapPiEvent(event);
      if (!mapped) return;
      if (mapped.kind === "text") options.onChunk(mapped.text);
      else if (mapped.kind === "activity") options.onActivity(mapped.activity);
      else if (mapped.kind === "done") settleDone();
      else if (mapped.kind === "error") {
        if (event.type === "process_stderr") return;
        const processFailure =
          event.type === "process_error" ||
          event.type === "process_exit";
        settleError(
          processFailure
            ? new PiUnavailableError(mapped.message)
            : new Error(mapped.message),
        );
      }
  };
  channel.observers.add(observer);

  try {

    options.signal.addEventListener(
      "abort",
      () => {
        void sendPiCommand(options.agentId, {
          type: "abort",
          id: rpcId(),
        }).catch(() => undefined);
        settleError(new Error("Aborted"));
      },
      { once: true },
    );

    try {
      await invoke("pi_start", {
        agent_id: options.agentId,
        cwd: options.workspacePath,
        provider: options.provider,
        model: normalizePiModelId(options.model),
        system_prompt: options.systemPrompt,
        session_dir: sessionDirectory(options.workspacePath),
        session_id: options.sessionId,
        thinking: options.thinking,
      });
    } catch (error) {
      throw new PiUnavailableError(
        error instanceof Error ? error.message : String(error),
      );
    }
    await sendPiCommandAndWait(options.agentId, {
      type: "set_model",
      id: rpcId(),
      provider: options.provider,
      modelId: normalizePiModelId(options.model),
    });
    if (options.thinking) {
      await sendPiCommandAndWait(options.agentId, {
        type: "set_thinking_level",
        id: rpcId(),
        level: options.thinking,
      });
    }
    const commandsResponse = await sendPiCommandAndWait(options.agentId, {
      type: "get_commands",
      id: rpcId(),
    });
    const data = asRecord(commandsResponse.data);
    const commands = Array.isArray(data?.commands)
      ? data.commands
          .map((command) => asRecord(command)?.name)
          .filter((name): name is string => typeof name === "string")
      : [];
    options.onCommands?.(commands);
    await sendPiCommandAndWait(options.agentId, {
      type: "prompt",
      id: rpcId(),
      message: options.message,
      ...(options.images && options.images.length > 0
        ? { images: options.images }
        : {}),
      streamingBehavior: "followUp",
    });
    await completion;
  } finally {
    channel.observers.delete(observer);
  }
}

export async function stopPiAgent(agentId: string): Promise<void> {
  try {
    await invoke("pi_stop", { agent_id: agentId });
  } catch {
    // Stopping an already exited process is intentionally idempotent.
  }
  await disposePiChannel(agentId);
}

export async function setPiModel(
  agentId: string,
  provider: string,
  modelId: string,
): Promise<void> {
  await sendPiCommandAndWait(agentId, {
    type: "set_model",
    id: rpcId(),
    provider,
    modelId: normalizePiModelId(modelId),
  });
}

export async function setPiThinkingLevel(
  agentId: string,
  level: string,
): Promise<void> {
  await sendPiCommandAndWait(agentId, {
    type: "set_thinking_level",
    id: rpcId(),
    level,
  });
}

export async function requestPiCommands(agentId: string): Promise<void> {
  await sendPiCommandAndWait(agentId, { type: "get_commands", id: rpcId() });
}

export async function requestPiState(agentId: string): Promise<void> {
  await sendPiCommand(agentId, { type: "get_state", id: rpcId() });
}

export async function requestPiAvailableModels(agentId: string): Promise<void> {
  await sendPiCommand(agentId, { type: "get_available_models", id: rpcId() });
}
