/**
 * Web and system workspace tools: web search, stock image search,
 * URL fetching, shell command execution, and Vercel deployment.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { emitTerminalEntry } from '../../services/terminalBus';
import { deployToVercel, pollDeployment, resolveVercelToken } from '../../services/publishVercel';
import { writeTextFile, mkdir, exists } from '../../services/fs';
import { safeResolvePath } from './shared';
import type { ToolDefinition, DomainExecutor } from './shared';

// ── Tool definitions ─────────────────────────────────────────────────────────

export const WEB_TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web and return a summary of top results. Use this when the user asks about current events, real-world facts, documentation, or anything not in the workspace. ' +
        'Returns an abstract summary and related topic links.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query, e.g. "TypeScript generics tutorial" or "latest React 19 features".',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_images',
      description:
        'Search for images or icons to place on the canvas. Choose the service based on what the user needs:\n' +
        '• service="photo" → Pexels: real high-quality stock photos (landscapes, people, objects). No transparency. Requires API key.\n' +
        '• service="icon" → Iconify: 200 000+ SVG icons with transparent background. Perfect for UI icons, game assets, clipart, arrows, symbols, emojis. No API key needed. Return color via the color param.\n' +
        'After getting results, pick the most relevant URL and call add_canvas_image to place it on the canvas.',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            enum: ['photo', 'icon'],
            description:
              '"photo" — real stock photos from Pexels (no transparency). ' +
              '"icon" — SVG icons/clipart from Iconify with transparent background (game-icons, noto-emoji, mdi, phosphor, etc.).',
          },
          query: {
            type: 'string',
            description:
              'Keywords to search for. For icons, be specific: "coffee cup", "sword", "leopard", "left arrow". ' +
              'For photos: "mountain landscape", "team meeting", "abstract blue technology".',
          },
          count: {
            type: 'number',
            description: 'Number of results to return (1–10, default 6).',
          },
          color: {
            type: 'string',
            description:
              '(icon only) Fill color for the SVG icon, e.g. "black", "white", "#3b82f6". Defaults to black.',
          },
          size: {
            type: 'number',
            description:
              '(icon only) Pixel size for the rendered SVG (width = height), e.g. 256 or 512. Defaults to 256.',
          },
        },
        required: ['service', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch the content of any web page by URL and return its readable text. ' +
        'Use this after web_search to get the full content of a result page, ' +
        'or to read documentation, articles, or reference material directly from a URL. ' +
        'Strips HTML tags and returns plain text (up to ~16 KB).',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to fetch (https://…).',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell (bash) command in the workspace directory. Use this to create folders, run npm/node/git commands, install packages, scaffold projects, execute scripts, and perform any other terminal operations. ' +
        'Returns stdout, stderr, and the exit code. Commands run with the workspace root as the working directory unless cwd is specified. ' +
        'NEVER use this tool to write, create, or overwrite .tldr.json canvas files — direct writes produce schema mismatches that crash tldraw on load. Use canvas_op to modify canvas content instead. ' +
        'NEVER use this tool to run vercel CLI commands (e.g. vercel deploy, vercel --prod) — for Vercel deployments use the publish_vercel tool instead, which uses the REST API and requires no git commit.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to run, e.g. "npm init -y" or "mkdir -p src/components" or "npm install react".',
          },
          cwd: {
            type: 'string',
            description: 'Optional subdirectory (relative to workspace root) to run the command in. Defaults to the workspace root.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_vercel',
      description:
        'Deploy a folder from this workspace to Vercel and optionally assign a custom domain. ' +
        'IMPORTANT: This tool uses the Vercel REST API directly — no Vercel CLI is needed and no git commit is required. ' +
        'When the user asks to publish or deploy to Vercel, ALWAYS use this tool with action="deploy". ' +
        'NEVER use run_command to call the vercel CLI — the CLI requires committed git history and will fail on uncommitted changes. ' +
        'The Vercel API token is read from localStorage key "cafezin-vercel-token" (global) or the token argument. ' +
        '\n' +
        'Actions:\n' +
        '• setup — scaffold vercel.json and .vercelignore for a project type. Do this BEFORE the first deploy.\n' +
        '• deploy — deploy files to Vercel. If buildCommand is provided, runs the build first then deploys buildOutputDir.\n' +
        '• check — get state of a past deployment by ID.\n' +
        '• assign_domain — link a custom domain to an existing project.\n' +
        '• set_token — save the Vercel API token for future deploys.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['setup', 'deploy', 'check', 'assign_domain', 'set_token'],
            description: 'Operation to perform.',
          },
          projectType: {
            type: 'string',
            enum: ['static', 'spa', 'demos', 'node'],
            description:
              '(setup only) Type of project being deployed:\n' +
              '• static — plain HTML/CSS/JS site (multi-page OK). Enables cleanUrls + trailingSlash:false.\n' +
              '• spa — single-page app (React/Vite/Vue). Adds rewrites so all routes serve index.html.\n' +
              '• demos — subfolder-per-demo structure (same as static but documented purpose).\n' +
              '• node — Node.js API / serverless functions.',
          },
          token: {
            type: 'string',
            description: 'Vercel API token. Optional for deploy/check/assign_domain (falls back to saved token). Required for set_token.',
          },
          projectName: {
            type: 'string',
            description: 'Vercel project name, e.g. "santa-cruz-curso". Required for deploy and assign_domain.',
          },
          deploymentId: {
            type: 'string',
            description: 'Vercel deployment ID returned by a previous deploy call. Required for action="check".',
          },
          sourceDir: {
            type: 'string',
            description: 'Workspace-relative folder to deploy, e.g. "demos" or "dist". Defaults to workspace root. Also used by setup to know where to write vercel.json.',
          },
          buildCommand: {
            type: 'string',
            description:
              '(deploy only) Shell command to run BEFORE deploying, e.g. "npm run build". ' +
              'Runs with the workspace root as cwd. Only needed when the deploy folder is produced by a build step.',
          },
          buildOutputDir: {
            type: 'string',
            description:
              '(deploy only) Workspace-relative folder produced by buildCommand to deploy, e.g. "dist". ' +
              'If buildCommand is set and this is omitted, defaults to "dist".',
          },
          teamId: {
            type: 'string',
            description: 'Vercel team/org ID. Leave empty for personal accounts.',
          },
          production: {
            type: 'boolean',
            description: 'Deploy to production (true, default) or preview (false).',
          },
          domain: {
            type: 'string',
            description: 'Custom domain to assign to the project, e.g. "santacruz.pmatz.com". Used with assign_domain.',
          },
        },
        required: ['action'],
      },
    },
  },
];

// ── Executor ─────────────────────────────────────────────────────────────────

export const executeWebTools: DomainExecutor = async (name, args, ctx) => {
  const { workspacePath } = ctx;

  switch (name) {

    // ── web_search ───────────────────────────────────────────────────────
    case 'web_search': {
      const query = String(args.query ?? '').trim();
      if (!query) return 'Error: query is required.';

      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      try {
        const res = await tauriFetch(ddgUrl, { method: 'GET' });
        if (!res.ok) return `Search API returned ${res.status}. Try rephrasing your query.`;
        const data = await res.json() as {
          AbstractText?: string;
          AbstractURL?: string;
          AbstractSource?: string;
          RelatedTopics?: Array<{
            Text?: string;
            FirstURL?: string;
            Topics?: Array<{ Text?: string; FirstURL?: string }>;
          }>;
          Answer?: string;
          Infobox?: { content?: Array<{ label?: string; value?: unknown }> };
        };

        const lines: string[] = [];

        if (data.Answer) lines.push(`**Answer:** ${data.Answer}`);

        if (data.AbstractText) {
          lines.push(data.AbstractText);
          if (data.AbstractSource && data.AbstractURL) {
            lines.push(`Source: [${data.AbstractSource}](${data.AbstractURL})`);
          }
        }

        const topics: Array<{ Text?: string; FirstURL?: string }> = [];
        for (const t of (data.RelatedTopics ?? [])) {
          if (topics.length >= 8) break;
          if (t.Text) {
            topics.push(t);
          } else if (t.Topics) {
            for (const sub of t.Topics) {
              if (topics.length >= 8) break;
              if (sub.Text) topics.push(sub);
            }
          }
        }
        if (topics.length > 0) {
          if (lines.length > 0) lines.push('');
          lines.push('**Related topics:**');
          for (const t of topics) {
            lines.push(`• ${t.Text ?? ''}${t.FirstURL ? `\n  ${t.FirstURL}` : ''}`);
          }
        }

        if (lines.length === 0) {
          return (
            `No DuckDuckGo summary found for "${query}". ` +
            `Try a more specific query, or suggest the user search at https://duckduckgo.com/?q=${encodeURIComponent(query)}`
          );
        }
        return `**Web search results for "${query}":**\n\n${lines.join('\n')}`;
      } catch (e) {
        return `Web search failed: ${e}. The user may need to allow network access in Tauri capabilities.`;
      }
    }

    // ── search_images ────────────────────────────────────────────────────
    case 'search_images': {
      const query = String(args.query ?? '').trim();
      if (!query) return 'Error: query is required.';
      const service = String(args.service ?? 'photo');

      // ── Iconify (SVG icons, no API key needed) ─────────────────────────
      if (service === 'icon') {
        const count  = Math.min(20, Math.max(1, typeof args.count === 'number' ? args.count : 8));
        const color  = encodeURIComponent(String(args.color ?? 'black'));
        const size   = typeof args.size === 'number' ? args.size : 256;
        const apiUrl = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${count}`;
        try {
          const res = await tauriFetch(apiUrl, { method: 'GET' });
          if (!res.ok) return `Iconify search error: HTTP ${res.status}.`;
          const data = await res.json() as {
            icons: string[];
            total: number;
            collections?: Record<string, { name: string }>;
          };
          if (!data.icons?.length) return `No icons found for "${query}" on Iconify. Try different keywords (e.g. "spoon", "sword", "leopard", "arrow right").`;
          const lines: string[] = [
            `Found ${data.total} icons for "${query}" on Iconify. Top ${data.icons.length}:\n`,
          ];
          for (const icon of data.icons) {
            const [prefix, name] = icon.split(':');
            const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=${color}&width=${size}&height=${size}`;
            lines.push(`**${icon}**\n  SVG: ${svgUrl}`);
          }
          lines.push(`\nColor: ${decodeURIComponent(color)} | Size: ${size}px (transparent background).`);
          lines.push('Call add_canvas_image with any SVG URL above to place on canvas.');
          return lines.join('\n');
        } catch (e) {
          return `Iconify search failed: ${e}`;
        }
      }

      // ── Pexels (stock photos) ──────────────────────────────────────────
      const pexelsKey = typeof window !== 'undefined'
        ? (window.localStorage.getItem('cafezin_pexels_key') ?? '')
        : '';

      if (!pexelsKey) {
        return (
          'No Pexels API key configured. ' +
          'Ask the user to click the "🖼 Images" button in the sidebar, then enter their free API key from pexels.com/api (takes ~30 seconds to get one). ' +
          'Once set, you can search for photos automatically.'
        );
      }

      const count = Math.min(10, Math.max(1, typeof args.count === 'number' ? args.count : 6));
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;

      try {
        const res = await tauriFetch(url, {
          method: 'GET',
          headers: { Authorization: pexelsKey },
        });
        if (!res.ok) return `Pexels API error: HTTP ${res.status}. Check your API key.`;

        const data = await res.json() as {
          total_results: number;
          photos: Array<{
            id: number;
            alt: string;
            photographer: string;
            width: number;
            height: number;
            src: { large: string; medium: string };
          }>;
        };

        if (!data.photos?.length) return `No stock photos found for "${query}". Try different keywords.`;

        const lines: string[] = [
          `Found ${data.total_results.toLocaleString()} photos on Pexels for "${query}". Top ${data.photos.length} results:\n`,
        ];
        for (const p of data.photos) {
          lines.push(
            `**[${p.id}]** ${p.alt || 'Untitled'} — by ${p.photographer}\n` +
            `  Size: ${p.width}×${p.height}px\n` +
            `  URL: ${p.src.large}`
          );
        }
        lines.push('\nTo place an image on the canvas, call add_canvas_image with one of the URLs above.');
        return lines.join('\n');
      } catch (e) {
        return `Pexels search failed: ${e}`;
      }
    }

    // ── fetch_url ────────────────────────────────────────────────────────
    case 'fetch_url': {
      const url = String(args.url ?? '').trim();
      if (!url) return 'Error: url is required.';
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'Error: URL must start with http:// or https://';
      }
      try {
        const res = await tauriFetch(url, {
          method: 'GET',
          headers: { Accept: 'text/html,text/plain,*/*', 'User-Agent': 'Mozilla/5.0' },
        });
        if (!res.ok) return `HTTP ${res.status} from ${url}. The server refused the request.`;
        const raw = await res.text();
        const stripped = raw
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        const CAP = 16_000;
        const result = stripped.length > CAP
          ? stripped.slice(0, CAP) + `\n\n[… truncated after ${CAP} chars. Full page is ${stripped.length} chars.]`
          : stripped;
        return `Content of ${url}:\n\n${result}`;
      } catch (e) {
        return `Error fetching URL: ${e}`;
      }
    }

    // ── run_command ──────────────────────────────────────────────────────
    case 'run_command': {
      if (import.meta.env.VITE_TAURI_MOBILE === 'true') {
        return 'Error: run_command is not available on iOS — shell execution is not supported on mobile devices.';
      }
      const command = String(args.command ?? '').trim();
      if (!command) return 'Error: command is required.';
      // Guard: block commands that WRITE CONTENT to canvas (.tldr.json) files.
      // Direct writes produce invalid tldraw schema that crashes the canvas on load.
      // Canvas content must only be mutated via the canvas_op tool.
      // NOTE: file-system operations that don't write content (rm, mv, cp between
      // canvas files, mkdir, etc.) are intentionally NOT blocked.
      if (command.includes('.tldr.json')) {
        const isShellWrite  = />{1,2}\s*[\w."'/-]*\.tldr\.json/.test(command);
        const isPythonWrite = /json\s*\.\s*dump/.test(command) ||
                              /open\s*\([^)]*\.tldr\.json[^)]*["']\s*w/.test(command) ||
                              /\.write\s*\(/.test(command);
        if (isShellWrite || isPythonWrite) {
          return (
            'Error: .tldr.json canvas files must NOT be written via run_command. ' +
            'Direct writes produce schema mismatches that crash tldraw on load — even a JSON-valid file will fail if keys, version numbers, or record types deviate from the tldraw internal format.\n\n' +
            'To modify canvas content use canvas_op instead:\n' +
            '  {"op":"add_slide","name":"Slide title"}\n' +
            '  {"op":"add_text","text":"Hello","x":100,"y":100,"slide":"<frameId>"}\n' +
            '  {"op":"add_geo","geo":"rectangle","x":100,"y":100,"w":400,"h":200,"slide":"<frameId>"}\n' +
            '  {"op":"update","id":"<shapeId>","text":"New text"}\n' +
            'Call list_canvas_shapes to get current shape IDs and frame IDs.'
          );
        }
      }
      // Guard: block Vercel CLI invocations — use publish_vercel tool instead.
      // The CLI requires committed git history; the publish_vercel REST API does not.
      if (/\bvercel\b/.test(command) && !/vercel\.json/.test(command)) {
        return (
          'Error: do not run the Vercel CLI via run_command. ' +
          'Use the publish_vercel tool with action="deploy" instead — it calls the Vercel REST API directly and does not require a git commit.\n\n' +
          'Example: publish_vercel({ action: "deploy", projectName: "<project>", sourceDir: "<folder>" })'
        );
      }
      const relCwd = String(args.cwd ?? '').trim();
      const absCwd = relCwd ? `${workspacePath}/${relCwd}` : workspacePath;
      try {
        const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
          'shell_run',
          { cmd: command, cwd: absCwd },
        );
        emitTerminalEntry({
          source: 'ai',
          command,
          cwd: absCwd,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exit_code,
          ts: Date.now(),
        });
        const parts: string[] = [`$ ${command}`, `exit code: ${result.exit_code}`];
        if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim()}`);
        if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim()}`);
        return parts.join('\n');
      } catch (e) {
        return `Error running command: ${e}`;
      }
    }

    // ── publish_vercel ────────────────────────────────────────────────────
    case 'publish_vercel': {
      const action = String(args.action ?? 'deploy');

      if (action === 'set_token') {
        const tok = String(args.token ?? '').trim();
        if (!tok) return 'Error: token is required for set_token.';
        localStorage.setItem('cafezin-vercel-token', tok);
        return 'Vercel API token saved. Future deploys in this browser will use it automatically.';
      }

      // ── setup — write vercel.json + .vercelignore ─────────────────────
      if (action === 'setup') {
        const projectType = String(args.projectType ?? 'static');
        const trimmedDir  = String(args.sourceDir ?? '').replace(/^\/+|\/+$/g, '');
        let targetDir: string;
        try {
          targetDir = trimmedDir ? safeResolvePath(workspacePath, trimmedDir) : workspacePath;
        } catch (e) {
          return String(e);
        }
        const relDir = trimmedDir || '.';

        // Build vercel.json content per project type
        let vercelJson: Record<string, unknown>;
        if (projectType === 'spa') {
          vercelJson = {
            rewrites: [{ source: '/(.*)', destination: '/index.html' }],
          };
        } else if (projectType === 'node') {
          vercelJson = {};  // Vercel auto-detects Node; user can extend as needed
        } else {
          // static, demos, or unknown — enable clean URLs
          vercelJson = {
            cleanUrls: true,
            trailingSlash: false,
          };
        }

        const vercelIgnore = [
          '.git',
          'node_modules',
          '.cafezin',
          'target',
          '.DS_Store',
          '*.log',
          '.env',
          '.env.*',
        ].join('\n');

        const vercelJsonPath    = `${targetDir}/vercel.json`;
        const vercelIgnorePath  = `${targetDir}/.vercelignore`;

        const created: string[] = [];
        const skipped: string[] = [];

        // vercel.json — only write if it doesn't exist already
        if (await exists(vercelJsonPath)) {
          skipped.push(`${relDir}/vercel.json (already exists — not overwritten)`);
        } else {
          if (!(await exists(targetDir))) {
            await mkdir(targetDir, { recursive: true });
          }
          await writeTextFile(vercelJsonPath, JSON.stringify(vercelJson, null, 2) + '\n');
          created.push(`${relDir}/vercel.json`);
        }

        // .vercelignore — only write if it doesn't exist
        if (await exists(vercelIgnorePath)) {
          skipped.push(`${relDir}/.vercelignore (already exists — not overwritten)`);
        } else {
          await writeTextFile(vercelIgnorePath, vercelIgnore + '\n');
          created.push(`${relDir}/.vercelignore`);
        }

        const lines: string[] = [`Vercel setup complete (project type: ${projectType}).`];
        if (created.length) lines.push(`Created:\n  • ${created.join('\n  • ')}`);
        if (skipped.length) lines.push(`Skipped:\n  • ${skipped.join('\n  • ')}`);

        lines.push('');
        if (projectType === 'spa') {
          lines.push('vercel.json configured with rewrites → all routes serve index.html (standard for React/Vite SPAs).');
          lines.push('Next step: run your build (e.g. "npm run build"), then call publish_vercel with action="deploy" and sourceDir="dist".');
        } else {
          lines.push('vercel.json configured with cleanUrls=true so /aula1/index.html is accessible as /aula1.');
          lines.push('Next step: call publish_vercel with action="deploy" to publish.');
        }

        return lines.join('\n');
      }

      const token = resolveVercelToken(args.token ? String(args.token) : undefined);
      if (!token) {
        return (
          'No Vercel API token found. ' +
          'Ask the user to provide their token (create one at vercel.com/account/tokens), then call ' +
          'publish_vercel with action="set_token" and token="<their-token>".'
        );
      }

      if (action === 'check') {
        const deploymentId = String(args.deploymentId ?? '').trim();
        if (!deploymentId) return 'Error: deploymentId is required for check.';
        const teamId = args.teamId ? String(args.teamId).trim() : undefined;
        try {
          const poll = await pollDeployment(token, deploymentId, teamId);
          const parts = [`Deployment ${deploymentId}`, `  State: ${poll.state}`];
          if (poll.url)          parts.push(`  URL: ${poll.url}`);
          if (poll.readyAt)      parts.push(`  Ready at: ${poll.readyAt}`);
          if (poll.errorMessage) parts.push(`  Error: ${poll.errorMessage}`);
          if (poll.state === 'TIMEOUT') parts.push('  (still building — check again in a moment)');
          return parts.join('\n');
        } catch (e) {
          return `Error checking deployment: ${e}`;
        }
      }

      const projectName = String(args.projectName ?? '').trim();
      if (!projectName) return 'Error: projectName is required.';
      const teamId = args.teamId ? String(args.teamId).trim() : undefined;

      if (action === 'assign_domain') {
        const domain = String(args.domain ?? '').trim();
        if (!domain) return 'Error: domain is required for assign_domain.';
        const teamParam = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
        try {
          const res = await tauriFetch(
            `https://api.vercel.com/v9/projects/${encodeURIComponent(projectName)}/domains${teamParam}`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: domain }),
            },
          );
          if (!res.ok) {
            let msg = `Vercel API error: ${res.status}`;
            try {
              const body = await res.json() as { error?: { message?: string } };
              if (body?.error?.message) msg += ` — ${body.error.message}`;
            } catch { /* ignore */ }
            return msg;
          }
          const data = await res.json() as { name: string; verified?: boolean };
          const verified = data.verified ? ' (already verified)' : ' (DNS propagation may take a few minutes)';
          return `Domain "${data.name}" added to project "${projectName}"${verified}.\n\nPoint your DNS:\n  CNAME ${domain} → cname.vercel-dns.com\nor for apex domains:\n  A ${domain} → 76.76.21.21`;
        } catch (e) {
          return `Error assigning domain: ${e}`;
        }
      }

      // action === 'deploy'
      const buildCommand    = args.buildCommand    ? String(args.buildCommand).trim()    : '';
      const buildOutputDir  = args.buildOutputDir  ? String(args.buildOutputDir).trim()  : '';

      // Optional build step — run before determining the deploy dir
      if (buildCommand) {
        if (import.meta.env.VITE_TAURI_MOBILE === 'true') {
          return 'Error: buildCommand is not supported on iOS — shell execution is unavailable on mobile.';
        }
        try {
          const buildResult = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
            'shell_run',
            { cmd: buildCommand, cwd: workspacePath },
          );
          emitTerminalEntry({
            source: 'ai',
            command: buildCommand,
            cwd: workspacePath,
            stdout: buildResult.stdout,
            stderr: buildResult.stderr,
            exitCode: buildResult.exit_code,
            ts: Date.now(),
          });
          if (buildResult.exit_code !== 0) {
            return [
              `Build command failed (exit ${buildResult.exit_code}) — deploy aborted.`,
              `$ ${buildCommand}`,
              buildResult.stdout.trim() ? `stdout:\n${buildResult.stdout.trim()}` : '',
              buildResult.stderr.trim() ? `stderr:\n${buildResult.stderr.trim()}` : '',
            ].filter(Boolean).join('\n');
          }
        } catch (e) {
          return `Error running build command: ${e} — deploy aborted.`;
        }
      }

      // Determine deploy source dir: prefer explicit sourceDir, then buildOutputDir fallback
      const rawSourceDir = args.sourceDir
        ? String(args.sourceDir).replace(/^\/+|\/+$/g, '')
        : buildCommand ? (buildOutputDir || 'dist') : '';
      const dirPath = rawSourceDir ? `${workspacePath}/${rawSourceDir}` : workspacePath;
      const production = args.production !== false;

      try {
        const result = await deployToVercel({ token, projectName, teamId, dirPath, production });
        const stateLabel = result.state === 'READY'   ? '✓ READY'
                         : result.state === 'ERROR'   ? '✗ ERROR'
                         : result.state === 'TIMEOUT' ? '⏳ still building (timed out waiting)'
                         : (result.state ?? 'unknown');
        const lines = [
          buildCommand ? `Built with: ${buildCommand}` : '',
          `Deployed "${projectName}" to Vercel — ${stateLabel}`,
          `  URL: ${result.url}`,
          `  Deployment ID: ${result.id}`,
          result.readyAt ? `  Ready at: ${result.readyAt}` : '',
          result.state === 'TIMEOUT'
            ? `  To check when ready: publish_vercel({ action: "check", deploymentId: "${result.id}" })`
            : '',
        ].filter(Boolean);
        if (args.domain) {
          lines.push(`\nTo assign domain "${args.domain}", call publish_vercel with action="assign_domain" and the same projectName.`);
        }
        return lines.join('\n');
      } catch (e) {
        return `Vercel deploy failed: ${e}`;
      }
    }

    default:
      return null;
  }
};
