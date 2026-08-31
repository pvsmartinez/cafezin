# Pi local assistant bridge

On desktop, Cafezin uses Pi as the primary assistant transport with OpenRouter.
The process runs with the workspace as its current directory and stores sessions
in `.cafezin/pi-sessions`. A legacy provider remains only as an explicit
compatibility fallback when Pi/auth is unavailable or a native Cafezin feature
has not yet been ported; the provider shown in the desktop panel is therefore
`Pi · OpenRouter`, regardless of the legacy setting.

## Runtime contract

Rust owns one child process per `agentId`:

- `pi_preflight` checks that the `pi` executable can start and that Pi's
  OpenRouter credential is ready (`pi auth check --provider openrouter --json
  --no-refresh`).
- `pi_start` launches `pi --mode rpc`; the system prompt is written to a
  short-lived mode-0600 file inside the canonical session directory and passed
  as `--append-system-prompt <path>`, then removed when the process exits.
  Credentials stay in Pi's own auth store (`~/.pi/agent/auth.json`).
- `pi_send` writes one validated JSON object plus `\n` to stdin.
- `pi_stop` terminates the process and is idempotent.
- stdout JSONL is emitted as `pi:event` with `{ agentId, event }`.

The frontend sends `set_model` (always with provider `openrouter` and an
unprefixed model ID), `set_thinking_level`, `get_commands`, and `prompt`
commands. `message_update` text deltas and tool lifecycle events are
mapped to the existing Cafezin `MessageItem` stream, so visual history remains
unchanged. Image data URLs are converted to Pi's `{ type, data, mimeType }`
content format.

## Fallback boundary

Pi is the default desktop transport for every provider selection, using the
selected model through OpenRouter when Pi is authenticated. Mobile builds use
the legacy provider path. If Pi/auth is missing or cannot start, the request
falls back to the existing provider agent. The legacy path remains required for Cafezin
native tools that Pi does not know about: risk-gated file writes through live
buffers, AI marks, tldraw/canvas operations, MCP, tasks, memory, export and
Vercel publishing.

Pi's native file tools operate on disk. A future bridge must add dirty-buffer
conflict checks and AI-mark recording before Pi can claim full authoring parity.

## Local setup

Install Pi and authenticate OpenRouter in Pi's own auth store (`pi auth login
openrouter`). The desktop preflight uses `pi auth check --provider openrouter
--json --no-refresh`; it does not print credentials. A packaged desktop build still needs an
explicit Pi/Node runtime decision; this bridge currently resolves system Pi at
`/opt/homebrew/bin/pi`, `/usr/local/bin/pi`, `/usr/bin/pi`, then `PATH`.
