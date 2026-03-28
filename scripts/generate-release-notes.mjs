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

const fromTag = `v${previousVersion}`;
const hasFromTag = gitTagExists(fromTag);
const range = hasFromTag ? `${fromTag}..HEAD` : "HEAD";

const commitLines = gitLines(
  ["log", "--no-merges", "--pretty=format:%s (%h)", range],
  60,
);
const changedFiles = gitLines(["diff", "--name-only", range], 120);
const diffStat = gitText(["diff", "--stat", range]);

const fallback = buildFallbackNotes({
  version,
  previousVersion,
  repo,
  commitLines,
  changedFiles,
});
const aiNotes = openAiKey
  ? await generateWithOpenAI({
      openAiKey,
      version,
      previousVersion,
      repo,
      commitLines,
      changedFiles,
      diffStat,
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

async function generateWithOpenAI({
  openAiKey,
  version,
  previousVersion,
  repo,
  commitLines,
  changedFiles,
  diffStat,
}) {
  const prompt = [
    "You are writing concise product-facing release notes for Cafezin.",
    "Return strict JSON with keys: summary (string), highlights (array of 3 to 5 strings).",
    "Do not mention internal implementation details unless they directly matter to users.",
    `New version: ${version}`,
    `Previous version: ${previousVersion}`,
    `Repository: ${repo}`,
    "",
    "Recent commit subjects:",
    commitLines.length
      ? commitLines.map((line) => `- ${line}`).join("\n")
      : "- No commit subjects available",
    "",
    "Changed files:",
    changedFiles.length
      ? changedFiles.map((line) => `- ${line}`).join("\n")
      : "- No changed files available",
    "",
    "Diff stat:",
    diffStat || "No diff stat available",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Write compact, credible software release notes. Output valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
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
