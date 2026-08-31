import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import {
  contentPartsToPiPrompt,
  dataUrlToPiImage,
  mapPiEvent,
  normalizePiModelId,
  preflightPi,
} from "../services/piClient";

describe("Pi RPC event mapping", () => {
  it("maps streamed assistant text deltas", () => {
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Olá" },
      }),
    ).toEqual({ kind: "text", text: "Olá" });
  });

  it("maps tool lifecycle events and preserves the call id", () => {
    const start = mapPiEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "cap.md" },
    });
    const end = mapPiEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: "content",
    });
    expect(start).toMatchObject({
      kind: "activity",
      activity: { callId: "call-1", name: "read", args: { path: "cap.md" } },
    });
    expect(end).toMatchObject({
      kind: "activity",
      activity: { callId: "call-1", result: "content" },
    });
  });

  it("turns data URLs into Pi image content without retaining the prefix", () => {
    expect(dataUrlToPiImage("data:image/png;base64,Zm9v")).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "Zm9v",
    });
    expect(
      contentPartsToPiPrompt([
        { type: "text", text: "descreva" },
        {
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,YmFy" },
        },
      ]),
    ).toEqual({
      message: "descreva",
      images: [{ type: "image", mimeType: "image/jpeg", data: "YmFy" }],
    });
  });

  it("recognizes the end of a Pi turn and RPC failures", () => {
    expect(mapPiEvent({ type: "agent_end" })).toEqual({ kind: "done" });
    expect(mapPiEvent({ type: "process_exit" })).toMatchObject({ kind: "error" });
    expect(
      mapPiEvent({
        type: "response",
        success: false,
        error: { message: "sem credencial" },
      }),
    ).toEqual({ kind: "error", message: "sem credencial" });
    expect(
      mapPiEvent({ type: "response", success: false, error: "quota excedida" }),
    ).toEqual({ kind: "error", message: "quota excedida" });
  });

  it("normalizes provider-prefixed model IDs for Pi RPC", () => {
    expect(normalizePiModelId("openrouter/z-ai/glm-5")).toBe("z-ai/glm-5");
    expect(normalizePiModelId("z-ai/glm-5")).toBe("z-ai/glm-5");
  });

  it("uses Pi auth readiness without receiving credentials", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      authenticated: true,
      executable: "/opt/homebrew/bin/pi",
      message: "OpenRouter autenticado no Pi",
    });
    await expect(preflightPi()).resolves.toMatchObject({ authenticated: true });
    expect(invoke).toHaveBeenCalledWith("pi_preflight");
  });
});
