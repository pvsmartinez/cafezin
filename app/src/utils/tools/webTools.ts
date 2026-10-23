/**
 * Web workspace tools: web search, stock image search, and URL fetching.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ToolDefinition, DomainExecutor } from './shared';
import { SK } from '../../services/storageKeys';

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
        'Search for images or icons for research and reference. Choose the service based on what the user needs:\n' +
        '• service="photo" → Pexels: real high-quality stock photos (landscapes, people, objects). No transparency. Requires API key.\n' +
        '• service="icon" → Iconify: 200 000+ SVG icons with transparent background. Perfect for UI icons, game assets, clipart, arrows, symbols, emojis. No API key needed. Return color via the color param.\n' +
        'After getting results, pick the most relevant URL and return it to the user.',
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
];

// ── Executor ─────────────────────────────────────────────────────────────────

export const executeWebTools: DomainExecutor = async (name, args) => {
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
                    return lines.join('\n');
        } catch (e) {
          return `Iconify search failed: ${e}`;
        }
      }

      // ── Pexels (stock photos) ──────────────────────────────────────────
      const pexelsKey = typeof window !== 'undefined'
        ? (window.localStorage.getItem(SK.PEXELS_KEY) ?? '')
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

    default:
      return null;
  }
};
