use serde::Serialize;

const RAG_MODEL_NAME: &str = "AllMiniLML6V2";
const RAG_SCHEMA_VERSION: &str = "2";

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

pub fn rebuild_index(_workspace_path: &str) -> Result<RagBuildSummary, String> {
    Ok(RagBuildSummary {
        available: false,
        model: RAG_MODEL_NAME,
        schema_version: RAG_SCHEMA_VERSION,
        built_at: None,
        files_indexed: 0,
        chunks_indexed: 0,
        files_scanned: 0,
        files_updated: 0,
        files_removed: 0,
    })
}

pub fn search_workspace(
    _workspace_path: &str,
    _query: &str,
    _limit: usize,
    _active_file: Option<&str>,
    _recent_files: &[String],
) -> Result<RagSearchResult, String> {
    Ok(RagSearchResult {
        available: false,
        model: RAG_MODEL_NAME,
        built_at: None,
        files_indexed: 0,
        chunks_indexed: 0,
        hits: Vec::new(),
    })
}

pub fn release_resources() -> Result<(), String> {
    Ok(())
}
