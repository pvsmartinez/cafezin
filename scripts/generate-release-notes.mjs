#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));

const version = requiredArg(args, "version");
const previousVersion = requiredArg(args, "previous-version");
const repo = requiredArg(args, "repo");
const outputMd = requiredArg(args, "output-md");
const outputJson = requiredArg(args, "output-json");
const updateJson = requiredArg(args, "update-json");

const envFromPedrin = loadSimpleEnv(
  "/Users/pedromartinez/Dev/pmatz/pedrin/.env",
);
const openAiKey =
  process.env.OPENAI_API_KEY || envFromPedrin.OPENAI_API_KEY || "";
// GitHub Models API (models.inference.ai.azure.com) accepts a regular GitHub PAT
// and provides GPT-4o — used as fallback when no OpenAI key is configured.
const githubToken =
  process.env.GITHUB_TOKEN || envFromPedrin.GITHUB_TOKEN || "";

const fromTag = `v${previousVersion}`;
const hasFromTag = gitTagExists(fromTag);
const range = hasFromTag ? `${fromTag}..HEAD` : "HEAD";

const allCommitLines = gitLines(
  ["log", "--no-merges", "--pretty=format:%s (%h)", range],
  80,
);
// Filter out noisy infra-only commits that tell users nothing
const NOISE_RE =
  /^(chore|ci|build|release|sync|checkpoint|update latest\.json|skip ci|bump version)/i;
const commitLines = allCommitLines.filter((line) => !NOISE_RE.test(line));
const changedFiles = gitLines(["diff", "--name-only", range], 120);
const diffStat = gitText(["diff", "--stat", range]);
// Actual diff content — only source files, truncated to keep the prompt manageable
const diffContent = gitText([
  "diff",
  range,
  "--",
  "app/src",
  "src-tauri/src",
  ":(exclude)*.lock",
  ":(exclude)*.json",
  ":(exclude)dist",
  ":(exclude)node_modules",
]).slice(0, 8000);

const fallback = buildFallbackNotes({
  version,
  previousVersion,
  repo,
  commitLines: allCommitLines,
  changedFiles,
});
const aiNotes =
  openAiKey || githubToken
    ? await generateWithAI({
        openAiKey,
        githubToken,
        version,
        previousVersion,
        repo,
        commitLines,
        changedFiles,
        diffStat,
        diffContent,
      }).catch(() => null)
    : null;
const notes = normalizeNotes(aiNotes || fallback, fallback);

writeFile(outputMd, buildMarkdown({ version, tag: `v${version}`, notes }));
updateReleasesJson(outputJson, { version, tag: `v${version}`, repo, notes });
updateLatestJson(updateJson, notes.summary);

console.log(`Generated release notes for v${version}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? next : "true";
    if (parsed[key] === next) index += 1;
  }
  return parsed;
}

function requiredArg(parsed, key) {
  if (!parsed[key]) {
    throw new Error(`Missing required argument --${key}`);
  }
  return parsed[key];
}

function loadSimpleEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const raw = fs.readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
    const separator = line.indexOf("=");
    if (separator === -1) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[key] = value.replace(/^"|"$/g, "");
  });
  return result;
}

function gitTagExists(tag) {
  try {
    execFileSync(
      "git",
      ["-C", rootDir, "rev-parse", "--verify", "--quiet", tag],
      { stdio: "ignore" },
    );
    return true;
  } catch (_error) {
    return false;
  }
}

function gitLines(command, maxLines) {
  const output = gitText(command);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function gitText(command) {
  try {
    return execFileSync("git", ["-C", rootDir, ...command], {
      encoding: "utf8",
    }).trim();
  } catch (_error) {
    return "";
  }
}

function buildFallbackNotes({
  version,
  previousVersion,
  repo,
  commitLines,
  changedFiles,
}) {
  const highlights = [];
  const seen = new Set();

  commitLines.forEach((line) => {
    const normalized = line.replace(/\s*\([a-f0-9]+\)$/i, "").trim();
    if (!normalized || seen.has(normalized.toLowerCase())) return;
    seen.add(normalized.toLowerCase());
    highlights.push(capitalize(normalized));
  });

  if (changedFiles.length > 0) {
    highlights.push(
      `Updated ${Math.min(changedFiles.length, 12)} changed files across the app and release flow.`,
    );
  }

  return {
    summary: `Release ${version} packages the work shipped since ${previousVersion}, with updates across the app, installers, and release flow.`,
    highlights: highlights.slice(0, 5),
    githubRelease: `https://github.com/${repo}/releases/tag/v${version}`,
  };
}

async function generateWithAI({
  openAiKey,
  githubToken,
  version,
  previousVersion,
  repo,
  commitLines,
  changedFiles,
  diffStat,
  diffContent,
}) {
  // Prefer OpenAI key; fall back to GitHub Models API (also OpenAI-compatible)
  const apiKey = openAiKey || githubToken;
  const apiUrl = openAiKey
    ? "https://api.openai.com/v1/chat/completions"
    : "https://models.inference.ai.azure.com/chat/completions";

  const prompt = [
    `Cafezin ${version} — release notes (previous: ${previousVersion}).`,
    "",
    "Meaningful commit subjects (infrastructure-only commits already removed):",
    commitLines.length
      ? commitLines.map((line) => `- ${line}`).join("\n")
      : "- (none — all commits were infrastructure/chore)",
    "",
    "Changed source files (app/src and src-tauri/src):",
    changedFiles
      .filter((f) => f.startsWith("app/src") || f.startsWith("src-tauri/src"))
      .slice(0, 40)
      .map((line) => `- ${line}`)
      .join("\n") || "- (no source changes detected)",
    "",
    "Diff stat:",
    diffStat || "(none)",
    "",
    "Source diff (app/src and src-tauri/src, first 8000 chars):",
    diffContent || "(none)",
  ].join("\n");

  const systemPrompt = [
    "You write user-facing release notes for Cafezin, a local-first AI writing desktop app (macOS + Windows).",
    "Your audience: writers, educators, and creators who use the app daily.",
    "",
    "Rules:",
    "- Read the diff carefully. Derive highlights from ACTUAL code changes, not from commit message wording.",
    "- Each highlight must describe a concrete user-visible change: a new feature, a fix, a UI improvement.",
    "- Never write vague lines like 'various improvements', 'code cleanup', or 'internal updates'.",
    "- Never mention chore commits, CI, build infra, or version bumps.",
    "- If the diff shows no meaningful user-facing changes, say so honestly in the summary and return 1 highlight.",
    "- summary: 1-2 sentences, plain English, what this release means for the user.",
    "- highlights: 3-5 specific bullet strings, no leading dashes, no markdown.",
    "",
    'Output valid JSON only: { "summary": string, "highlights": string[] }',
  ].join("\n");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `AI request failed with status ${response.status}: ${errText.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from OpenAI");
  }

  const parsed = JSON.parse(content);
  return {
    summary: parsed.summary,
    highlights: parsed.highlights,
    githubRelease: `https://github.com/${repo}/releases/tag/v${version}`,
  };
}

function normalizeNotes(candidate, fallback) {
  const summary =
    typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary.trim()
      : fallback.summary;
  const highlights = Array.isArray(candidate.highlights)
    ? candidate.highlights
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 5)
    : fallback.highlights;

  return {
    summary,
    highlights: highlights.length > 0 ? highlights : fallback.highlights,
    githubRelease: candidate.githubRelease || fallback.githubRelease,
  };
}

function buildMarkdown({ version, tag, notes }) {
  return [
    `# Cafezin ${version}`,
    "",
    notes.summary,
    "",
    "## Highlights",
    "",
    ...notes.highlights.map((item) => `- ${item}`),
    "",
    "## Downloads",
    "",
    "- macOS: https://cafezin.pmatz.com/download/mac",
    "- Windows: https://cafezin.pmatz.com/download/windows",
    "",
    "## Full release",
    "",
    notes.githubRelease ||
      `https://github.com/pvsmartinez/cafezin/releases/tag/${tag}`,
    "",
  ].join("\n");
}

function updateReleasesJson(filePath, { version, tag, repo, notes }) {
  let payload = { releases: [] };
  if (fs.existsSync(filePath)) {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  const releaseEntry = {
    version,
    tag,
    title: `Cafezin ${version}`,
    publishedAt: new Date().toISOString(),
    summary: notes.summary,
    highlights: notes.highlights,
    links: {
      githubRelease:
        notes.githubRelease || `https://github.com/${repo}/releases/tag/${tag}`,
    },
  };

  const existing = Array.isArray(payload.releases) ? payload.releases : [];
  const filtered = existing.filter((entry) => entry.version !== version);
  payload.releases = [releaseEntry, ...filtered].slice(0, 20);
  writeJson(filePath, payload);
}

function updateLatestJson(filePath, summary) {
  const payload = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, "utf8"))
    : {};
  payload.notes = summary;
  writeJson(filePath, payload);
}

function writeJson(filePath, payload) {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
