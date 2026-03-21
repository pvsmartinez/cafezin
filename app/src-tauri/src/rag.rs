use serde::Serialize;

const RAG_DB_FILE: &str = "rag.db";
const RAG_SCHEMA_VERSION: &str = "1";
const RAG_MODEL_NAME: &str = "AllMiniLML6V2";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagBuildSummary {
    pub available: bool,
    pub model: &'static str,
    pub schema_version: &'static str,
    pub built_at: Option<String>,
    pub files_indexed: usize,
    pub chunks_indexed: usize,
    pub files_scanned: usize,
    pub files_updated: usize,
    pub files_removed: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchHit {
    pub path: String,
    pub size: u64,
    pub outline: String,
    pub chunk_type: String,
    pub title: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub snippet: String,
    pub semantic_score: f32,
    pub lexical_score: f32,
    pub combined_score: f32,
    pub supporting_matches: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResult {
    pub available: bool,
    pub model: &'static str,
    pub built_at: Option<String>,
    pub files_indexed: usize,
    pub chunks_indexed: usize,
    pub hits: Vec<RagSearchHit>,
}

#[cfg(not(target_os = "ios"))]
mod imp {
    use super::{RagBuildSummary, RagSearchHit, RagSearchResult, RAG_DB_FILE, RAG_MODEL_NAME, RAG_SCHEMA_VERSION};
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    use rusqlite::{params, Connection, OptionalExtension};
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    const CONFIG_DIR: &str = ".cafezin";
    const MAX_INDEX_FILES: usize = 800;
    const MAX_FILE_BYTES: u64 = 300_000;
    const MAX_CHARS_PER_CHUNK: usize = 1_800;
    const MIN_CHARS_PER_CHUNK: usize = 220;
    const WINDOW_LINES: usize = 120;
    const SEARCH_CANDIDATE_LIMIT: usize = 48;
    const CHUNK_SNIPPET_CHARS: usize = 260;

    static EMBEDDING_MODEL: OnceLock<Result<Mutex<TextEmbedding>, String>> = OnceLock::new();

    #[derive(Debug, Clone)]
    struct ChunkRecord {
        chunk_index: usize,
        chunk_type: String,
        title: Option<String>,
        start_line: usize,
        end_line: usize,
        text: String,
    }

    #[derive(Debug, Clone)]
    struct ChunkCandidate {
        path: String,
        size: u64,
        outline: String,
        chunk_type: String,
        title: Option<String>,
        start_line: usize,
        end_line: usize,
        text: String,
        semantic_score: f32,
        lexical_score: f32,
        combined_score: f32,
    }

    fn current_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    fn rag_db_path(workspace_path: &str) -> PathBuf {
        Path::new(workspace_path).join(CONFIG_DIR).join(RAG_DB_FILE)
    }

    fn ensure_config_dir(workspace_path: &str) -> Result<(), String> {
        fs::create_dir_all(Path::new(workspace_path).join(CONFIG_DIR)).map_err(|e| e.to_string())
    }

    fn open_db(workspace_path: &str) -> Result<Connection, String> {
        ensure_config_dir(workspace_path)?;
        let db_path = rag_db_path(workspace_path);
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS files (
              path TEXT PRIMARY KEY,
              size INTEGER NOT NULL,
              mtime INTEGER NOT NULL,
              outline TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chunks (
              id TEXT PRIMARY KEY,
              file_path TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              chunk_type TEXT NOT NULL,
              title TEXT,
              start_line INTEGER NOT NULL,
              end_line INTEGER NOT NULL,
              text TEXT NOT NULL,
              embedding BLOB NOT NULL,
              FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![RAG_SCHEMA_VERSION],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('model', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![RAG_MODEL_NAME],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn)
    }

    fn is_skipped_name(name: &str) -> bool {
        name.starts_with('.')
            || matches!(name, "node_modules" | ".git" | ".cafezin" | "target" | ".DS_Store")
    }

    fn is_indexable_file(name: &str) -> bool {
        if name.ends_with(".tldr.json") {
            return false;
        }
        matches!(
            name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str(),
            "md" | "mdx" | "txt" | "ts" | "tsx" | "js" | "jsx" | "py" | "sql" | "sh" | "json"
                | "toml" | "yaml" | "yml" | "css" | "html" | "rs" | "env"
        )
    }

    fn collect_indexable_files(workspace_path: &str) -> Result<Vec<(String, PathBuf)>, String> {
        fn walk(root: &Path, rel_prefix: &str, out: &mut Vec<(String, PathBuf)>) -> Result<(), String> {
            let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if is_skipped_name(&name) {
                    continue;
                }
                let path = entry.path();
                let rel = if rel_prefix.is_empty() {
                    name.to_string()
                } else {
                    format!("{rel_prefix}/{name}")
                };
                if path.is_dir() {
                    walk(&path, &rel, out)?;
                } else if path.is_file() && is_indexable_file(&name) {
                    out.push((rel, path));
                }
            }
            Ok(())
        }

        let mut files = Vec::new();
        walk(Path::new(workspace_path), "", &mut files)?;
        files.sort_by(|a, b| a.0.cmp(&b.0));
        if files.len() > MAX_INDEX_FILES {
            files.truncate(MAX_INDEX_FILES);
        }
        Ok(files)
    }

    fn word_count(text: &str) -> usize {
        text.split_whitespace().filter(|token| !token.trim().is_empty()).count()
    }

    fn extract_outline(rel_path: &str, text: &str) -> String {
        let ext = rel_path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
        let mut lines = Vec::new();

        if matches!(ext.as_str(), "md" | "mdx") {
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("### ") || trimmed.starts_with("## ") || trimmed.starts_with("# ") {
                    lines.push(format!("  {}", trimmed));
                }
            }
            lines.push(format!("  ({} words)", word_count(text)));
        } else if matches!(ext.as_str(), "ts" | "tsx" | "js" | "jsx" | "rs") {
            let mut exports = Vec::new();
            for line in text.lines() {
                let trimmed = line.trim();
                if let Some(name) = extract_symbol_name(trimmed, &ext) {
                    exports.push(name);
                }
            }
            exports.sort();
            exports.dedup();
            if exports.is_empty() {
                lines.push("  (no exports detected)".to_string());
            } else {
                lines.push(format!("  exports: {}", exports.join(", ")));
            }
        } else if ext == "py" {
            let mut defs = Vec::new();
            for line in text.lines() {
                let trimmed = line.trim_start();
                if let Some(rest) = trimmed.strip_prefix("def ") {
                    defs.push(format!("def {}", rest.split('(').next().unwrap_or_default().trim()));
                } else if let Some(rest) = trimmed.strip_prefix("class ") {
                    defs.push(format!("class {}", rest.split(['(', ':']).next().unwrap_or_default().trim()));
                }
            }
            if !defs.is_empty() {
                lines.push(format!("  {}", defs.join(", ")));
            }
        } else if ext == "sql" {
            let upper = text.to_ascii_uppercase();
            for keyword in ["CREATE TABLE", "CREATE FUNCTION", "CREATE VIEW", "ALTER TABLE"] {
                if upper.contains(keyword) {
                    lines.push(format!("  contains: {keyword}"));
                }
            }
        } else if matches!(ext.as_str(), "json" | "toml" | "yaml" | "yml") {
            let mut keys = Vec::new();
            for line in text.lines() {
                let trimmed = line.trim();
                if let Some((left, _)) = trimmed.split_once(':').or_else(|| trimmed.split_once('=')) {
                    let key = left.trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace());
                    if !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) {
                        keys.push(key.to_string());
                    }
                }
                if keys.len() >= 8 {
                    break;
                }
            }
            if !keys.is_empty() {
                lines.push(format!("  keys: {}", keys.join(", ")));
            }
        }

        lines.join("\n")
    }

    fn finalize_chunk(
        chunk_type: &str,
        title: Option<String>,
        start_line: usize,
        end_line: usize,
        lines: &[String],
        out: &mut Vec<ChunkRecord>,
    ) {
        let text = lines.join("\n").trim().to_string();
        if text.is_empty() {
            return;
        }
        if text.chars().count() <= MAX_CHARS_PER_CHUNK {
            out.push(ChunkRecord {
                chunk_index: out.len(),
                chunk_type: chunk_type.to_string(),
                title,
                start_line,
                end_line,
                text,
            });
            return;
        }

        let mut window_start = start_line;
        let mut current_lines: Vec<String> = Vec::new();
        let mut current_chars = 0usize;
        for (offset, line) in lines.iter().enumerate() {
            let next_len = current_chars + line.len() + 1;
            if !current_lines.is_empty() && next_len > MAX_CHARS_PER_CHUNK {
                out.push(ChunkRecord {
                    chunk_index: out.len(),
                    chunk_type: chunk_type.to_string(),
                    title: title.clone(),
                    start_line: window_start,
                    end_line: start_line + offset - 1,
                    text: current_lines.join("\n").trim().to_string(),
                });
                current_lines.clear();
                current_chars = 0;
                window_start = start_line + offset;
            }
            current_chars += line.len() + 1;
            current_lines.push(line.clone());
        }
        if !current_lines.is_empty() {
            out.push(ChunkRecord {
                chunk_index: out.len(),
                chunk_type: chunk_type.to_string(),
                title,
                start_line: window_start,
                end_line,
                text: current_lines.join("\n").trim().to_string(),
            });
        }
    }

    fn chunk_markdown(text: &str) -> Vec<ChunkRecord> {
        let lines: Vec<String> = text.lines().map(|line| line.to_string()).collect();
        let mut chunks = Vec::new();
        let mut section_title: Option<String> = None;
        let mut section_start = 1usize;
        let mut section_lines: Vec<String> = Vec::new();
        let mut saw_heading = false;

        for (idx, line) in lines.iter().enumerate() {
            let line_no = idx + 1;
            let trimmed = line.trim();
            let is_heading = trimmed.starts_with("# ") || trimmed.starts_with("## ") || trimmed.starts_with("### ");
            if is_heading {
                saw_heading = true;
                if !section_lines.is_empty() {
                    finalize_chunk(
                        "heading",
                        section_title.clone(),
                        section_start,
                        line_no.saturating_sub(1),
                        &section_lines,
                        &mut chunks,
                    );
                    section_lines.clear();
                }
                section_title = Some(trimmed.trim_start_matches('#').trim().to_string());
                section_start = line_no;
            }
            section_lines.push(line.clone());
        }

        if !section_lines.is_empty() {
            finalize_chunk("heading", section_title, section_start, lines.len().max(1), &section_lines, &mut chunks);
        }

        if saw_heading && !chunks.is_empty() {
            return chunks;
        }
        chunk_by_windows(&lines, "section", Some("Document".to_string()))
    }

    fn extract_symbol_name(trimmed: &str, ext: &str) -> Option<String> {
        let tokenized = trimmed.replace('{', " ").replace('(', " ").replace(':', " ");
        let parts: Vec<&str> = tokenized.split_whitespace().collect();
        match ext {
            "ts" | "tsx" | "js" | "jsx" | "rs" => {
                for (idx, part) in parts.iter().enumerate() {
                    if matches!(*part, "function" | "class" | "const" | "let" | "var" | "type" | "interface" | "enum") {
                        return parts.get(idx + 1).map(|s| s.trim_matches(|c: char| c == '<' || c == '=' || c == ',').to_string());
                    }
                }
                None
            }
            "py" => {
                if let Some(rest) = trimmed.strip_prefix("def ") {
                    return Some(rest.split('(').next().unwrap_or_default().trim().to_string());
                }
                if let Some(rest) = trimmed.strip_prefix("class ") {
                    return Some(rest.split(['(', ':']).next().unwrap_or_default().trim().to_string());
                }
                None
            }
            "sql" => {
                let upper = trimmed.to_ascii_uppercase();
                if upper.starts_with("CREATE ") || upper.starts_with("ALTER TABLE ") {
                    return Some(trimmed.split_whitespace().take(3).collect::<Vec<_>>().join(" "));
                }
                None
            }
            _ => None,
        }
    }

    fn chunk_code(text: &str, ext: &str) -> Vec<ChunkRecord> {
        let lines: Vec<String> = text.lines().map(|line| line.to_string()).collect();
        let mut chunks = Vec::new();
        let mut symbol_title: Option<String> = None;
        let mut symbol_start = 1usize;
        let mut symbol_lines: Vec<String> = Vec::new();
        let mut saw_symbol = false;

        for (idx, line) in lines.iter().enumerate() {
            let line_no = idx + 1;
            let trimmed = line.trim_start();
            let top_level = line == trimmed;
            let symbol = if top_level { extract_symbol_name(trimmed, ext) } else { None };
            if let Some(name) = symbol {
                saw_symbol = true;
                if !symbol_lines.is_empty() {
                    finalize_chunk(
                        "symbol",
                        symbol_title.clone(),
                        symbol_start,
                        line_no.saturating_sub(1),
                        &symbol_lines,
                        &mut chunks,
                    );
                    symbol_lines.clear();
                }
                symbol_title = Some(name);
                symbol_start = line_no;
            }
            symbol_lines.push(line.clone());
        }

        if !symbol_lines.is_empty() {
            finalize_chunk("symbol", symbol_title, symbol_start, lines.len().max(1), &symbol_lines, &mut chunks);
        }

        if saw_symbol && !chunks.is_empty() {
            return chunks;
        }
        chunk_by_windows(&lines, "code-window", None)
    }

    fn chunk_text(text: &str) -> Vec<ChunkRecord> {
        let lines: Vec<String> = text.lines().map(|line| line.to_string()).collect();
        let mut paragraphs: Vec<(usize, usize, Vec<String>)> = Vec::new();
        let mut current_start = 1usize;
        let mut current_lines: Vec<String> = Vec::new();
        for (idx, line) in lines.iter().enumerate() {
            let line_no = idx + 1;
            if line.trim().is_empty() {
                if !current_lines.is_empty() {
                    paragraphs.push((current_start, line_no.saturating_sub(1), std::mem::take(&mut current_lines)));
                }
                current_start = line_no + 1;
                continue;
            }
            if current_lines.is_empty() {
                current_start = line_no;
            }
            current_lines.push(line.clone());
        }
        if !current_lines.is_empty() {
            paragraphs.push((current_start, lines.len().max(1), current_lines));
        }

        let mut chunks = Vec::new();
        let mut bucket_lines: Vec<String> = Vec::new();
        let mut bucket_start = 1usize;
        let mut bucket_end = 1usize;
        let mut bucket_chars = 0usize;
        for (start, end, paragraph_lines) in paragraphs {
            let paragraph_text = paragraph_lines.join("\n");
            let paragraph_chars = paragraph_text.chars().count();
            if bucket_lines.is_empty() {
                bucket_start = start;
            }
            if !bucket_lines.is_empty() && bucket_chars >= MIN_CHARS_PER_CHUNK && bucket_chars + paragraph_chars > MAX_CHARS_PER_CHUNK {
                finalize_chunk("paragraph", None, bucket_start, bucket_end, &bucket_lines, &mut chunks);
                bucket_lines.clear();
                bucket_chars = 0;
                bucket_start = start;
            }
            bucket_end = end;
            bucket_chars += paragraph_chars + 2;
            bucket_lines.extend(paragraph_lines);
            bucket_lines.push(String::new());
        }
        if !bucket_lines.is_empty() {
            while matches!(bucket_lines.last(), Some(last) if last.is_empty()) {
                bucket_lines.pop();
            }
            finalize_chunk("paragraph", None, bucket_start, bucket_end, &bucket_lines, &mut chunks);
        }

        if chunks.is_empty() {
            return chunk_by_windows(&lines, "text-window", None);
        }
        chunks
    }

    fn chunk_by_windows(lines: &[String], chunk_type: &str, title: Option<String>) -> Vec<ChunkRecord> {
        let mut chunks = Vec::new();
        let mut start = 0usize;
        while start < lines.len() {
            let end = usize::min(start + WINDOW_LINES, lines.len());
            finalize_chunk(
                chunk_type,
                title.clone(),
                start + 1,
                end.max(start + 1),
                &lines[start..end],
                &mut chunks,
            );
            start = end;
        }
        chunks
    }

    fn chunk_file(rel_path: &str, text: &str) -> Vec<ChunkRecord> {
        let ext = rel_path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
        if matches!(ext.as_str(), "md" | "mdx") {
            return chunk_markdown(text);
        }
        if matches!(ext.as_str(), "ts" | "tsx" | "js" | "jsx" | "py" | "sql" | "rs") {
            return chunk_code(text, &ext);
        }
        chunk_text(text)
    }

    fn embedding_model() -> Result<&'static Mutex<TextEmbedding>, String> {
        let model = EMBEDDING_MODEL.get_or_init(|| {
            TextEmbedding::try_new(
                InitOptions::new(EmbeddingModel::AllMiniLML6V2).with_show_download_progress(false),
            )
            .map(Mutex::new)
            .map_err(|e| format!("Failed to initialize FastEmbed model: {e}"))
        });
        match model {
            Ok(model) => Ok(model),
            Err(err) => Err(err.clone()),
        }
    }

    fn embed_passages(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let inputs: Vec<String> = texts.iter().map(|text| format!("passage: {text}")).collect();
        let guard = embedding_model()?;
        let mut model = guard.lock().map_err(|_| "FastEmbed model lock poisoned".to_string())?;
        model.embed(inputs, None).map_err(|e| format!("Failed to embed passages: {e}"))
    }

    fn embed_query(text: &str) -> Result<Vec<f32>, String> {
        let guard = embedding_model()?;
        let mut model = guard.lock().map_err(|_| "FastEmbed model lock poisoned".to_string())?;
        let embeddings = model
            .embed(vec![format!("query: {text}")], None)
            .map_err(|e| format!("Failed to embed query: {e}"))?;
        embeddings.into_iter().next().ok_or_else(|| "Empty embedding result".to_string())
    }

    fn encode_embedding(values: &[f32]) -> Vec<u8> {
        let mut out = Vec::with_capacity(values.len() * 4);
        for value in values {
            out.extend_from_slice(&value.to_le_bytes());
        }
        out
    }

    fn decode_embedding(blob: &[u8]) -> Option<Vec<f32>> {
        if blob.len() % 4 != 0 {
            return None;
        }
        let mut out = Vec::with_capacity(blob.len() / 4);
        for chunk in blob.chunks_exact(4) {
            out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        Some(out)
    }

    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        let mut dot = 0.0f32;
        let mut norm_a = 0.0f32;
        let mut norm_b = 0.0f32;
        for (left, right) in a.iter().zip(b.iter()) {
            dot += left * right;
            norm_a += left * left;
            norm_b += right * right;
        }
        if norm_a <= f32::EPSILON || norm_b <= f32::EPSILON {
            return 0.0;
        }
        dot / (norm_a.sqrt() * norm_b.sqrt())
    }

    fn tokenize_query(query: &str) -> Vec<String> {
        query
            .to_ascii_lowercase()
            .split(|c: char| c.is_whitespace() || matches!(c, '/' | '\\' | '_' | '-' | '.' | ',' | ':' | ';' | '(' | ')' | '[' | ']'))
            .filter(|token| token.len() > 1)
            .map(|token| token.to_string())
            .collect()
    }

    fn lexical_score(path: &str, outline: &str, title: Option<&str>, text: &str, query: &str, tokens: &[String]) -> f32 {
        let path = path.to_ascii_lowercase();
        let outline = outline.to_ascii_lowercase();
        let title = title.unwrap_or_default().to_ascii_lowercase();
        let text = text.to_ascii_lowercase();
        let phrase = query.to_ascii_lowercase();
        let mut score = 0.0f32;

        if !phrase.is_empty() {
            if path.contains(&phrase) {
                score += 2.0;
            }
            if title.contains(&phrase) {
                score += 2.0;
            }
            if outline.contains(&phrase) {
                score += 1.5;
            }
            if text.contains(&phrase) {
                score += 1.2;
            }
        }

        for token in tokens {
            if path.contains(token) {
                score += 1.4;
            }
            if title.contains(token) {
                score += 1.2;
            }
            if outline.contains(token) {
                score += 1.0;
            }
            if text.contains(token) {
                score += 0.7;
            }
        }

        score
    }

    fn normalize_snippet(text: &str) -> String {
        let squashed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if squashed.chars().count() <= CHUNK_SNIPPET_CHARS {
            return squashed;
        }
        let trimmed: String = squashed.chars().take(CHUNK_SNIPPET_CHARS).collect();
        format!("{}…", trimmed.trim_end())
    }

    fn db_counts(conn: &Connection) -> Result<(usize, usize), String> {
        let files: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        Ok((files.max(0) as usize, chunks.max(0) as usize))
    }

    fn db_built_at(conn: &Connection) -> Option<String> {
        conn.query_row(
            "SELECT value FROM meta WHERE key = 'built_at'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    }

    fn sync_index(conn: &mut Connection, workspace_path: &str) -> Result<RagBuildSummary, String> {
        let files = collect_indexable_files(workspace_path)?;
        let existing_rows: Vec<(String, u64, i64)> = {
            let mut stmt = conn
                .prepare("SELECT path, size, mtime FROM files")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64, row.get::<_, i64>(2)?)))
                .map_err(|e| e.to_string())?;
            let mut collected = Vec::new();
            for row in rows {
                collected.push(row.map_err(|e| e.to_string())?);
            }
            collected
        };
        let existing_map: HashMap<String, (u64, i64)> = existing_rows.into_iter().map(|row| (row.0, (row.1, row.2))).collect();
        let scanned_paths: HashSet<String> = files.iter().map(|(rel, _)| rel.clone()).collect();
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let mut files_updated = 0usize;
        let mut files_removed = 0usize;

        for path in existing_map.keys() {
            if !scanned_paths.contains(path) {
                tx.execute("DELETE FROM files WHERE path = ?1", params![path]).map_err(|e| e.to_string())?;
                files_removed += 1;
            }
        }

        for (rel_path, abs_path) in files.iter() {
            let metadata = match fs::metadata(abs_path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
                continue;
            }

            let size = metadata.len();
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|ts| ts.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);

            if let Some((old_size, old_mtime)) = existing_map.get(rel_path) {
                if *old_size == size && *old_mtime == mtime {
                    continue;
                }
            }

            let text = match fs::read_to_string(abs_path) {
                Ok(text) => text,
                Err(_) => continue,
            };
            let outline = extract_outline(rel_path, &text);
            let mut chunks = chunk_file(rel_path, &text);
            chunks.retain(|chunk| !chunk.text.trim().is_empty());
            if chunks.is_empty() {
                let fallback_text = if text.trim().is_empty() {
                    format!("Empty file: {rel_path}")
                } else {
                    text.chars().take(MAX_CHARS_PER_CHUNK).collect()
                };
                chunks.push(ChunkRecord {
                    chunk_index: 0,
                    chunk_type: "file".to_string(),
                    title: None,
                    start_line: 1,
                    end_line: text.lines().count().max(1),
                    text: fallback_text,
                });
            }

            let chunk_texts: Vec<String> = chunks.iter().map(|chunk| chunk.text.clone()).collect();
            let embeddings = embed_passages(&chunk_texts)?;

            tx.execute(
                "INSERT INTO files(path, size, mtime, outline, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(path) DO UPDATE SET
                   size = excluded.size,
                   mtime = excluded.mtime,
                   outline = excluded.outline,
                   updated_at = excluded.updated_at",
                params![rel_path, size as i64, mtime, outline, current_millis()],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM chunks WHERE file_path = ?1", params![rel_path]).map_err(|e| e.to_string())?;
            for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
                let chunk_id = format!("{rel_path}::{}", chunk.chunk_index);
                tx.execute(
                    "INSERT INTO chunks(id, file_path, chunk_index, chunk_type, title, start_line, end_line, text, embedding)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        chunk_id,
                        rel_path,
                        chunk.chunk_index as i64,
                        &chunk.chunk_type,
                        chunk.title.as_deref(),
                        chunk.start_line as i64,
                        chunk.end_line as i64,
                        &chunk.text,
                        encode_embedding(embedding),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            files_updated += 1;
        }

        let built_at = current_millis().to_string();
        tx.execute(
            "INSERT INTO meta(key, value) VALUES('built_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![built_at],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        let (files_indexed, chunks_indexed) = db_counts(conn)?;
        Ok(RagBuildSummary {
            available: true,
            model: RAG_MODEL_NAME,
            schema_version: RAG_SCHEMA_VERSION,
            built_at: db_built_at(conn),
            files_indexed,
            chunks_indexed,
            files_scanned: files.len(),
            files_updated,
            files_removed,
        })
    }

    pub fn rebuild_index(workspace_path: &str) -> Result<RagBuildSummary, String> {
        let mut conn = open_db(workspace_path)?;
        sync_index(&mut conn, workspace_path)
    }

    pub fn search_workspace(
        workspace_path: &str,
        query: &str,
        limit: usize,
        active_file: Option<&str>,
        recent_files: &[String],
    ) -> Result<RagSearchResult, String> {
        let mut conn = open_db(workspace_path)?;
        let build_summary = sync_index(&mut conn, workspace_path)?;
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(RagSearchResult {
                available: true,
                model: RAG_MODEL_NAME,
                built_at: build_summary.built_at.clone(),
                files_indexed: build_summary.files_indexed,
                chunks_indexed: build_summary.chunks_indexed,
                hits: Vec::new(),
            });
        }

        let query_embedding = embed_query(trimmed)?;
        let tokens = tokenize_query(trimmed);
        let mut stmt = conn
            .prepare(
                "SELECT c.file_path, f.size, f.outline, c.chunk_type, c.title, c.start_line, c.end_line, c.text, c.embedding
                 FROM chunks c
                 JOIN files f ON f.path = c.file_path",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)? as usize,
                    row.get::<_, i64>(6)? as usize,
                    row.get::<_, String>(7)?,
                    row.get::<_, Vec<u8>>(8)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut candidates = Vec::new();
        for row in rows {
            let (path, size, outline, chunk_type, title, start_line, end_line, text, blob) =
                row.map_err(|e| e.to_string())?;
            let Some(embedding) = decode_embedding(&blob) else {
                continue;
            };
            let semantic_score = cosine_similarity(&query_embedding, &embedding).max(0.0);
            let lexical = lexical_score(&path, &outline, title.as_deref(), &text, trimmed, &tokens);
            if semantic_score < 0.10 && lexical <= 0.0 {
                continue;
            }
            let lexical_norm = if tokens.is_empty() {
                0.0
            } else {
                (lexical / ((tokens.len() as f32 * 4.0) + 2.0)).min(1.0)
            };
            let mut combined = semantic_score * 0.72 + lexical_norm * 0.28;
            if active_file.is_some_and(|active| active == path) {
                combined += 0.08;
            }
            if let Some(idx) = recent_files.iter().position(|candidate| candidate == &path) {
                combined += (0.05f32 - (idx as f32 * 0.006)).max(0.0);
            }
            candidates.push(ChunkCandidate {
                path,
                size,
                outline,
                chunk_type,
                title,
                start_line,
                end_line,
                text,
                semantic_score,
                lexical_score: lexical_norm,
                combined_score: combined,
            });
        }

        candidates.sort_by(|left, right| {
            right
                .combined_score
                .partial_cmp(&left.combined_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        candidates.truncate(SEARCH_CANDIDATE_LIMIT);

        let mut best_by_file: HashMap<String, RagSearchHit> = HashMap::new();
        for candidate in candidates {
            let entry = best_by_file.entry(candidate.path.clone()).or_insert_with(|| RagSearchHit {
                path: candidate.path.clone(),
                size: candidate.size,
                outline: candidate.outline.clone(),
                chunk_type: candidate.chunk_type.clone(),
                title: candidate.title.clone(),
                start_line: candidate.start_line,
                end_line: candidate.end_line,
                snippet: normalize_snippet(&candidate.text),
                semantic_score: candidate.semantic_score,
                lexical_score: candidate.lexical_score,
                combined_score: candidate.combined_score,
                supporting_matches: 1,
            });
            if candidate.combined_score > entry.combined_score {
                entry.chunk_type = candidate.chunk_type.clone();
                entry.title = candidate.title.clone();
                entry.start_line = candidate.start_line;
                entry.end_line = candidate.end_line;
                entry.snippet = normalize_snippet(&candidate.text);
                entry.semantic_score = candidate.semantic_score;
                entry.lexical_score = candidate.lexical_score;
                entry.combined_score = candidate.combined_score;
            } else {
                entry.supporting_matches += 1;
                entry.semantic_score = entry.semantic_score.max(candidate.semantic_score);
                entry.lexical_score = entry.lexical_score.max(candidate.lexical_score);
            }
        }

        let mut hits: Vec<RagSearchHit> = best_by_file.into_values().collect();
        hits.sort_by(|left, right| {
            right
                .combined_score
                .partial_cmp(&left.combined_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        hits.truncate(limit.max(1));

        Ok(RagSearchResult {
            available: true,
            model: RAG_MODEL_NAME,
            built_at: build_summary.built_at,
            files_indexed: build_summary.files_indexed,
            chunks_indexed: build_summary.chunks_indexed,
            hits,
        })
    }
}

#[cfg(not(target_os = "ios"))]
pub fn rebuild_index(workspace_path: &str) -> Result<RagBuildSummary, String> {
    imp::rebuild_index(workspace_path)
}

#[cfg(not(target_os = "ios"))]
pub fn search_workspace(
    workspace_path: &str,
    query: &str,
    limit: usize,
    active_file: Option<&str>,
    recent_files: &[String],
) -> Result<RagSearchResult, String> {
    imp::search_workspace(workspace_path, query, limit, active_file, recent_files)
}

#[cfg(target_os = "ios")]
pub fn rebuild_index(_workspace_path: &str) -> Result<RagBuildSummary, String> {
    Err("RAG indexing is not available on iOS builds yet".to_string())
}

#[cfg(target_os = "ios")]
pub fn search_workspace(
    _workspace_path: &str,
    _query: &str,
    _limit: usize,
    _active_file: Option<&str>,
    _recent_files: &[String],
) -> Result<RagSearchResult, String> {
    Err("RAG search is not available on iOS builds yet".to_string())
}
