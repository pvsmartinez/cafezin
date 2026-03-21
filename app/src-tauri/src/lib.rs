#[cfg(not(any(feature = "mas", target_os = "ios")))]
use std::collections::HashMap;
#[cfg(not(any(feature = "mas", target_os = "ios")))]
use std::fs::{self, File};
#[cfg(not(any(feature = "mas", target_os = "ios")))]
use std::path::PathBuf;
#[cfg(not(any(feature = "mas", target_os = "ios")))]
use std::process::Command;
#[cfg(not(any(feature = "mas", target_os = "ios")))]
use std::sync::Mutex;
// Stdio is only needed by update_app which is desktop-only
#[cfg(not(target_os = "ios"))]
use std::process::Stdio;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;
#[cfg(not(any(feature = "mas", target_os = "ios")))]
use tauri::State;
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::io::AsyncBufReadExt;

mod rag;

#[cfg(not(any(feature = "mas", target_os = "ios")))]
#[derive(Default)]
struct ShellProcessRegistry {
    processes: Mutex<HashMap<String, ManagedShellProcess>>,
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
struct ManagedShellProcess {
    child: std::process::Child,
    stdout_path: PathBuf,
    stderr_path: PathBuf,
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
fn ensure_shell_cwd_allowed(cwd: &str) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() || !cwd.starts_with(&home) {
        return Err(format!("shell_run: cwd must be within $HOME (rejected: {cwd})"));
    }
    Ok(())
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
fn cap_shell_output(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    if s.chars().count() > 8_000 {
        format!("{}\n\n[… output truncated]", s.chars().take(8_000).collect::<String>())
    } else {
        s.to_string()
    }
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
fn cap_text_output(text: String) -> String {
    if text.chars().count() > 8_000 {
        format!("{}\n\n[… output truncated]", text.chars().take(8_000).collect::<String>())
    } else {
        text
    }
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
fn shell_process_output_paths(id: &str) -> (PathBuf, PathBuf) {
    let base = std::env::temp_dir();
    (
        base.join(format!("cafezin-shell-{id}.out.log")),
        base.join(format!("cafezin-shell-{id}.err.log")),
    )
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
fn build_shell_process_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let salt = format!("{:?}", std::thread::current().id());
    format!("{millis}-{}", salt.replace(['(', ')', ' '], ""))
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
fn shell_program() -> String {
    let shell = std::env::var("SHELL").unwrap_or_default();
    match shell.as_str() {
        s if s.ends_with("/bash") || s.ends_with("/zsh") || s.ends_with("/sh") => s.to_string(),
        _ => "/bin/bash".to_string(),
    }
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
fn build_shell_command(cmd: &str, cwd: &str) -> Command {
    let mut command = Command::new(shell_program());
    command.args(["-lc", cmd]).current_dir(cwd);
    command
}


/// Opens the webview DevTools inspector (debug builds only).
#[tauri::command]
fn open_devtools(webview_window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    webview_window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = webview_window; // no-op in release builds
}

// ── shell_run ─────────────────────────────────────────────────────────────────
// CLI variant: desktop dev builds (local, PC, Linux)
#[cfg(not(any(feature = "mas", target_os = "ios")))]
#[tauri::command]
fn shell_run(cmd: String, cwd: String) -> Result<serde_json::Value, String> {
    ensure_shell_cwd_allowed(&cwd)?;
    let output = build_shell_command(&cmd, &cwd)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "stdout":    cap_shell_output(&output.stdout),
        "stderr":    cap_shell_output(&output.stderr),
        "exit_code": output.status.code().unwrap_or(-1),
    }))
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
#[tauri::command]
fn shell_run_start(
    cmd: String,
    cwd: String,
    registry: State<'_, ShellProcessRegistry>,
) -> Result<serde_json::Value, String> {
    ensure_shell_cwd_allowed(&cwd)?;

    let id = build_shell_process_id();
    let (stdout_path, stderr_path) = shell_process_output_paths(&id);
    let stdout_file = File::create(&stdout_path).map_err(|e| e.to_string())?;
    let stderr_file = File::create(&stderr_path).map_err(|e| e.to_string())?;

    let child = build_shell_command(&cmd, &cwd)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|e| e.to_string())?;

    registry
        .processes
        .lock()
        .map_err(|_| "shell_run_start: process registry lock poisoned".to_string())?
        .insert(
            id.clone(),
            ManagedShellProcess {
                child,
                stdout_path,
                stderr_path,
            },
        );

    Ok(serde_json::json!({ "id": id }))
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
#[tauri::command]
fn shell_run_status(
    id: String,
    registry: State<'_, ShellProcessRegistry>,
) -> Result<serde_json::Value, String> {
    let (running, exit_code, stdout_path, stderr_path, remove_after) = {
        let mut guard = registry
            .processes
            .lock()
            .map_err(|_| "shell_run_status: process registry lock poisoned".to_string())?;
        let process = guard
            .get_mut(&id)
            .ok_or_else(|| format!("shell_run_status: process not found ({id})"))?;
        let status = process.child.try_wait().map_err(|e| e.to_string())?;
        let running = status.is_none();
        let exit_code = status.and_then(|s| s.code()).unwrap_or(-1);
        let stdout_path = process.stdout_path.clone();
        let stderr_path = process.stderr_path.clone();
        if !running {
            let _ = guard.remove(&id);
        }
        (running, exit_code, stdout_path, stderr_path, !running)
    };

    let stdout = fs::read_to_string(&stdout_path).unwrap_or_default();
    let stderr = fs::read_to_string(&stderr_path).unwrap_or_default();

    if remove_after {
        let _ = fs::remove_file(&stdout_path);
        let _ = fs::remove_file(&stderr_path);
    }

    Ok(serde_json::json!({
        "running": running,
        "stdout": cap_text_output(stdout),
        "stderr": cap_text_output(stderr),
        "exit_code": if running { serde_json::Value::Null } else { serde_json::json!(exit_code) }
    }))
}

#[cfg(not(any(feature = "mas", target_os = "ios")))]
#[tauri::command]
fn shell_run_kill(
    id: String,
    registry: State<'_, ShellProcessRegistry>,
) -> Result<serde_json::Value, String> {
    let removed = {
        let mut guard = registry
            .processes
            .lock()
            .map_err(|_| "shell_run_kill: process registry lock poisoned".to_string())?;
        guard.remove(&id)
    };

    let mut process = removed.ok_or_else(|| format!("shell_run_kill: process not found ({id})"))?;
    let _ = process.child.kill();
    let _ = process.child.wait();
    let stdout = fs::read_to_string(&process.stdout_path).unwrap_or_default();
    let stderr = fs::read_to_string(&process.stderr_path).unwrap_or_default();
    let _ = fs::remove_file(&process.stdout_path);
    let _ = fs::remove_file(&process.stderr_path);

    Ok(serde_json::json!({
        "killed": true,
        "stdout": cap_text_output(stdout),
        "stderr": cap_text_output(stderr),
    }))
}

// Store/sandbox variant: App Sandbox and iOS do not allow arbitrary shell execution
#[cfg(any(feature = "mas", target_os = "ios"))]
#[tauri::command]
fn shell_run(_cmd: String, _cwd: String) -> Result<serde_json::Value, String> {
    Err("shell_run is not available in App Store / iOS builds".into())
}

#[cfg(any(feature = "mas", target_os = "ios"))]
#[tauri::command]
fn shell_run_start(_cmd: String, _cwd: String) -> Result<serde_json::Value, String> {
    Err("shell_run_start is not available in App Store / iOS builds".into())
}

#[cfg(any(feature = "mas", target_os = "ios"))]
#[tauri::command]
fn shell_run_status(_id: String) -> Result<serde_json::Value, String> {
    Err("shell_run_status is not available in App Store / iOS builds".into())
}

#[cfg(any(feature = "mas", target_os = "ios"))]
#[tauri::command]
fn shell_run_kill(_id: String) -> Result<serde_json::Value, String> {
    Err("shell_run_kill is not available in App Store / iOS builds".into())
}

// ── git_cli — CLI/shell variant (dev builds, Linux, Windows) ─────────────────
// Compiled only for non-MAS, non-iOS targets. Uses the system `git` binary.
#[cfg(not(any(feature = "mas", target_os = "ios")))]
mod git_cli {
    use std::path::Path;
    use std::process::Command;

    pub fn git_init(path: String) -> Result<String, String> {
        if Path::new(&path).join(".git").exists() {
            return Ok("already_initialized".into());
        }
        let output = Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&path)
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() { Ok("initialized".into()) }
        else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
    }

    pub fn git_diff(path: String) -> Result<serde_json::Value, String> {
        const DIFF_MAX_BYTES: usize = 100_000; // 100 KB cap — prevents UI freeze on large projects

        let status_out = Command::new("git")
            .args(["status", "--short"])
            .current_dir(&path)
            .output()
            .map_err(|e| e.to_string())?;
        let files: Vec<String> = String::from_utf8_lossy(&status_out.stdout)
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.to_string())
            .collect();
        let diff_out = Command::new("git")
            .args(["diff", "HEAD"])
            .current_dir(&path)
            .output()
            .map_err(|e| e.to_string())?;
        let (diff, diff_truncated) = if diff_out.status.success() {
            let raw = diff_out.stdout;
            if raw.len() > DIFF_MAX_BYTES {
                // Truncate at a UTF-8 char boundary
                let s = String::from_utf8_lossy(&raw[..DIFF_MAX_BYTES]).into_owned();
                (s, true)
            } else {
                (String::from_utf8_lossy(&raw).into_owned(), false)
            }
        } else {
            (String::new(), false)
        };
        Ok(serde_json::json!({ "files": files, "diff": diff, "diff_truncated": diff_truncated }))
    }

    pub fn git_sync(path: String, message: String, _token: Option<String>) -> Result<String, String> {
        let run_out = |args: &[&str]| -> Result<String, String> {
            let out = Command::new("git").args(args).current_dir(&path)
                .output().map_err(|e| e.to_string())?;
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).to_string())
            }
        };

        // Stage + commit local changes first
        run_out(&["add", "-A"])?;
        let _ = Command::new("git")
            .args(["commit", "-m", &message, "--allow-empty"])
            .current_dir(&path).output();

        // Fetch remote changes (best-effort — skip if no remote or no network)
        if run_out(&["fetch", "origin"]).is_ok() {
            // How many commits remote HEAD has that we're missing
            let branch = run_out(&["rev-parse", "--abbrev-ref", "HEAD"])
                .unwrap_or_else(|_| "main".to_string());
            let branch = branch.trim().to_string();
            let remote_ref = format!("origin/{branch}");

            if let Ok(behind_str) = run_out(&["rev-list", "--count",
                                              &format!("HEAD..{remote_ref}")]) {
                let behind: u32 = behind_str.trim().parse().unwrap_or(0);
                if behind > 0 {
                    // Pull with rebase to incorporate the remote commits cleanly
                    if let Err(e) = run_out(&["pull", "--rebase", "origin", &branch]) {
                        // Abort partial rebase so the repo stays clean
                        let _ = run_out(&["rebase", "--abort"]);
                        return Err(format!(
                            "MERGE_CONFLICT: Remote branch '{}' has {} commit(s) that conflict \
                             with your local changes. Pull and resolve conflicts manually before \
                             syncing.\n{}",
                            branch, behind, e
                        ));
                    }
                }
            }
        }

        // Push only if a remote exists. Surface push errors instead of silently
        // succeeding so first-time publish flows can fail clearly.
        if run_out(&["remote", "get-url", "origin"]).is_ok() {
            run_out(&["push", "origin", "HEAD"])?;
        }
        Ok("synced".into())
    }

    pub fn git_get_remote(path: String) -> Result<String, String> {
        let out = Command::new("git")
            .args(["remote", "get-url", "origin"])
            .current_dir(&path).output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else { Err("no remote".into()) }
    }

    pub fn git_set_remote(path: String, url: String) -> Result<String, String> {
        // Try "add" first; fall back to "set-url" if origin already exists.
        let add = Command::new("git")
            .args(["remote", "add", "origin", &url])
            .current_dir(&path).output()
            .map_err(|e| e.to_string())?;
        if add.status.success() {
            return Ok("added".into());
        }
        let set = Command::new("git")
            .args(["remote", "set-url", "origin", &url])
            .current_dir(&path).output()
            .map_err(|e| e.to_string())?;
        if set.status.success() { Ok("updated".into()) }
        else { Err(String::from_utf8_lossy(&set.stderr).to_string()) }
    }

    pub fn git_clone(url: String, path: String, _token: Option<String>, branch: Option<String>) -> Result<String, String> {
        if std::path::Path::new(&path).join(".git").exists() {
            return Ok("already_cloned".into());
        }
        let mut args = vec!["clone"];
        // Temporary storage so the borrow lives long enough
        let branch_arg;
        if let Some(ref b) = branch {
            args.push("--branch");
            branch_arg = b.as_str();
            args.push(branch_arg);
        }
        args.push(&url);
        args.push(&path);
        let out = Command::new("git")
            .args(&args)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() { Ok("cloned".into()) }
        else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
    }

    pub fn git_pull(path: String, _token: Option<String>) -> Result<String, String> {
        let out = Command::new("git")
            .args(["pull", "--ff-only"])
            .current_dir(&path)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() { Ok("pulled".into()) }
        else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
    }

    pub fn git_checkout_file(path: String, file: String) -> Result<String, String> {
        let out = Command::new("git")
            .args(["checkout", "--", &file])
            .current_dir(&path).output()
            .map_err(|e| e.to_string())?;
        if out.status.success() { Ok("reverted".into()) }
        else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
    }

    pub fn git_checkout_branch(path: String, branch: String, token: Option<String>) -> Result<String, String> {
        // Fetch the latest from origin (so the branch exists locally if it's new)
        let _ = Command::new("git")
            .args(["fetch", "origin", &branch])
            .current_dir(&path)
            .output();
        // Checkout and reset to origin/<branch>
        let out = Command::new("git")
            .args(["checkout", "-B", &branch, &format!("origin/{branch}")])
            .current_dir(&path)
            .output()
            .map_err(|e| e.to_string())?;
        let _ = token; // token unused in CLI variant (credential helper handles auth)
        if out.status.success() { Ok("switched".into()) }
        else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
    }
}

// ── git_native — libgit2 variant (MAS / iOS sandbox) ─────────────────────────
// Compiled only when feature = "mas" OR target_os = "ios".
// Uses libgit2 (vendored) — no external `git` binary required.
#[cfg(any(feature = "mas", target_os = "ios"))]
mod git_native {
    use git2::{build::CheckoutBuilder, IndexAddOption, PushOptions,
               RemoteCallbacks, Repository, RepositoryInitOptions, Signature};

    /// Strip any embedded credentials from an HTTPS URL, returning a clean URL.
    /// The token is supplied ONLY via the RemoteCallbacks credential callback,
    /// never embedded in the URL. Reason: when credentials are embedded in the
    /// URL, libgit2 uses them directly. If GitHub returns 403 (auth attempted
    /// but denied), libgit2 stops — it does NOT fall back to the credential
    /// callback. But when the URL is clean, GitHub returns 401, libgit2 invokes
    /// the callback, we provide the correct credentials, and the retry succeeds.
    fn clean_url(url: &str) -> String {
        if let Some(rest) = url.strip_prefix("https://") {
            let host_path = if let Some(at_pos) = rest.find('@') {
                &rest[at_pos + 1..]
            } else {
                rest
            };
            return format!("https://{}", host_path);
        }
        url.to_string()
    }

    /// Keep inject_token as an alias for clean_url — the token is intentionally
    /// NOT embedded in the URL (see clean_url doc). Only the callback carries it.
    fn inject_token(url: &str, _token: &str) -> String {
        clean_url(url)
    }

    /// Build RemoteCallbacks that supply the OAuth token when libgit2 asks for
    /// credentials (called after the server returns 401 on a clean-URL request).
    ///
    /// GitHub accepts: username = anything non-empty, password = token.
    /// We use "x-oauth-basic" as the username — the conventional value for
    /// GitHub OAuth token auth over HTTPS. The token goes in the password.
    fn token_callbacks(token: String) -> RemoteCallbacks<'static> {
        let mut cb = RemoteCallbacks::new();
        let tok = token.clone();
        let mut tried_userpass = false;
        cb.credentials(move |url, username, allowed| {
            eprintln!("[git2 cred] url={url} username={username:?} allowed={allowed:?}");
            if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
                if tried_userpass {
                    eprintln!("[git2 cred] USER_PASS already tried, bailing");
                    return Err(git2::Error::from_str("auth failed after retry"));
                }
                tried_userpass = true;
                // username=x-oauth-basic, password=token — standard GitHub OAuth HTTPS auth
                eprintln!("[git2 cred] providing x-oauth-basic:TOKEN credentials");
                return git2::Cred::userpass_plaintext("x-oauth-basic", &tok);
            }
            // For DEFAULT (Kerberos/GSSAPI) — do not consume tried_userpass
            git2::Cred::default()
        });
        cb.certificate_check(|_cert, _valid| Ok(git2::CertificateCheckStatus::CertificateOk));
        cb
    }

    /// Convert SSH remote URL to HTTPS so PAT auth works on iOS (no SSH agent).
    /// git@github.com:user/repo.git  →  https://github.com/user/repo.git
    fn normalize_url(url: &str) -> String {
        if let Some(rest) = url.strip_prefix("git@") {
            if let Some(colon_pos) = rest.find(':') {
                let host = &rest[..colon_pos];
                let path = &rest[colon_pos + 1..];
                return format!("https://{}/{}", host, path);
            }
        }
        url.to_string()
    }

    /// Ensure the stored "origin" remote URL is HTTPS.
    /// Called before every network operation so SSH remotes are transparently
    /// upgraded to HTTPS (which works with PAT tokens on iOS).
    fn ensure_https_remote(repo: &Repository) {
        let orig = repo
            .find_remote("origin")
            .ok()
            .and_then(|r| r.url().map(String::from))
            .unwrap_or_default();
        let normed = normalize_url(&orig);
        if normed != orig && !normed.is_empty() {
            let _ = repo.remote_delete("origin");
            let _ = repo.remote("origin", &normed);
        }
    }

    pub fn git_init(path: String) -> Result<String, String> {
        if std::path::Path::new(&path).join(".git").exists() {
            return Ok("already_initialized".into());
        }
        let mut opts = RepositoryInitOptions::new();
        opts.initial_head("main");
        Repository::init_opts(&path, &opts).map_err(|e| e.to_string())?;
        Ok("initialized".into())
    }

    pub fn git_diff(path: String) -> Result<serde_json::Value, String> {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;

        let statuses = repo.statuses(None).map_err(|e| e.to_string())?;
        let files: Vec<String> = statuses
            .iter()
            .filter(|e| !e.status().is_empty() && e.status() != git2::Status::CURRENT)
            .filter_map(|e| {
                let s = e.status();
                let flag = if s.contains(git2::Status::WT_NEW)
                             || s.contains(git2::Status::INDEX_NEW)
                {
                    "?? "
                } else if s.contains(git2::Status::INDEX_MODIFIED)
                           || s.contains(git2::Status::WT_MODIFIED)
                {
                    " M "
                } else if s.contains(git2::Status::INDEX_DELETED)
                           || s.contains(git2::Status::WT_DELETED)
                {
                    " D "
                } else {
                    "   "
                };
                Some(format!("{}{}", flag, e.path().unwrap_or("")))
            })
            .collect();

        // Unified diff vs HEAD
        const DIFF_MAX_BYTES: usize = 100_000; // 100 KB cap — prevents UI freeze on large projects
        let mut diff_truncated = false;
        let diff_text = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| c.tree().ok())
            .and_then(|tree| {
                repo.diff_tree_to_workdir_with_index(Some(&tree), None).ok()
            })
            .map(|d| {
                let mut out = String::new();
                let _ = d.print(git2::DiffFormat::Patch, |_, _, line| {
                    if out.len() >= DIFF_MAX_BYTES {
                        diff_truncated = true;
                        return false; // stop iteration
                    }
                    let origin = line.origin();
                    // Include all patch lines; B = Binary (skip)
                    if origin != 'B' {
                        out.push(origin);
                        out.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
                    }
                    true
                });
                out
            })
            .unwrap_or_default();

        Ok(serde_json::json!({ "files": files, "diff": diff_text, "diff_truncated": diff_truncated }))
    }

    pub fn git_sync(path: String, message: String, token: Option<String>) -> Result<String, String> {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;

        // Normalize SSH → HTTPS so PAT auth works; updates .git/config permanently
        ensure_https_remote(&repo);

        // Stage all changes
        let mut index = repo.index().map_err(|e| e.to_string())?;
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .map_err(|e| e.to_string())?;
        index.write().map_err(|e| e.to_string())?;

        // Commit
        let tree_id = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Cafezin", "cafezin@local"))
            .map_err(|e| e.to_string())?;
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
            .map_err(|e| e.to_string())?;

        // ── Conflict detection: fetch + merge analysis before pushing ────────
        // Fetch remote HEAD to discover divergence before pushing. If the remote
        // has new commits we don't have (ANALYSIS_NORMAL), return a clear error
        // instead of letting the push silently fail or corrupt history.
        // If we're behind but can fast-forward (ANALYSIS_FASTFORWARD), advance
        // our local ref first so the subsequent push succeeds cleanly.
        let branch_for_fetch = repo
            .head().ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| "main".to_string());

        // Only run if a remote exists
        if let Ok(mut fetch_remote) = repo.find_remote("origin") {
            let fetch_callbacks = if let Some(ref tok) = token {
                token_callbacks(tok.clone())
            } else {
                let mut cb = RemoteCallbacks::new();
                cb.certificate_check(|_cert, _valid| Ok(git2::CertificateCheckStatus::CertificateOk));
                cb
            };
            let mut fetch_opts = git2::FetchOptions::new();
            fetch_opts.remote_callbacks(fetch_callbacks);
            let refspec = format!(
                "refs/heads/{0}:refs/remotes/origin/{0}",
                branch_for_fetch
            );
            // Fetch is best-effort; ignore errors (offline / no remote)
            let _ = fetch_remote.fetch(&[&refspec], Some(&mut fetch_opts), None);
            drop(fetch_remote);

            // Analyse how our HEAD relates to the fetched remote ref
            let remote_ref_name = format!("refs/remotes/origin/{branch_for_fetch}");
            if let Ok(annotated) = repo
                .find_reference(&remote_ref_name)
                .and_then(|r| repo.reference_to_annotated_commit(&r))
            {
                if let Ok((analysis, _)) = repo.merge_analysis(&[&annotated]) {
                    if analysis.contains(git2::MergeAnalysis::ANALYSIS_NORMAL) {
                        // Diverged — cannot push without a merge
                        return Err(format!(
                            "MERGE_CONFLICT: Remote branch '{}' has commits that diverge from \
                             your local history. Pull and resolve conflicts before syncing.",
                            branch_for_fetch
                        ));
                    } else if analysis.contains(git2::MergeAnalysis::ANALYSIS_FASTFORWARD) {
                        // We're behind — fast-forward local ref to remote HEAD
                        let oid = annotated.id();
                        let local_ref_name = format!("refs/heads/{branch_for_fetch}");
                        if let Ok(mut local_ref) = repo.find_reference(&local_ref_name) {
                            let msg = format!("fast-forward to {}", &oid.to_string()[..8]);
                            let _ = local_ref.set_target(oid, &msg);
                            let _ = repo.set_head(&local_ref_name);
                            let _ = repo.checkout_head(
                                Some(CheckoutBuilder::default().force()),
                            );
                        }
                    }
                    // ANALYSIS_UPTODATE: nothing to pull, proceed to push
                }
            }
        }

        // Push: inject token into URL + provide credential callback fallback.
        if let Ok(origin_remote) = repo.find_remote("origin") {
            let origin_url = origin_remote.url().unwrap_or("").to_string();
            drop(origin_remote);
            let push_url = {
                let normed = normalize_url(&origin_url);
                if let Some(ref tok) = token { inject_token(&normed, tok) } else { normed }
            };
            let _ = repo.remote_set_url("origin", &push_url);
            let mut push_error: Option<String> = None;
            if let Ok(mut remote) = repo.find_remote("origin") {
                let callbacks = if let Some(tok) = token {
                    token_callbacks(tok)
                } else {
                    let mut cb = RemoteCallbacks::new();
                    cb.certificate_check(|_cert, _valid| Ok(git2::CertificateCheckStatus::CertificateOk));
                    cb
                };
                let mut push_opts = PushOptions::new();
                push_opts.remote_callbacks(callbacks);
                let branch = repo
                    .head()
                    .ok()
                    .and_then(|h| h.shorthand().map(|s| s.to_string()))
                    .unwrap_or_else(|| "main".to_string());
                let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
                drop(remote);
                // Re-open remote to avoid borrow conflict after set_url
                if let Ok(mut r2) = repo.find_remote("origin") {
                    if let Err(err) = r2.push(&[&refspec], Some(&mut push_opts)) {
                        push_error = Some(err.to_string());
                    }
                }
            }
            // Restore clean URL after push
            let clean = normalize_url(&origin_url);
            let _ = repo.remote_set_url("origin", &clean);
            if let Some(err) = push_error {
                return Err(err);
            }
        }

        Ok("synced".into())
    }

    pub fn git_get_remote(path: String) -> Result<String, String> {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;
        let remote = repo
            .find_remote("origin")
            .map_err(|_| "no remote".to_string())?;
        Ok(remote.url().unwrap_or("").to_string())
    }

    pub fn git_set_remote(path: String, url: String) -> Result<String, String> {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;
        // Delete then re-add so the call is always idempotent.
        let _ = repo.remote_delete("origin");
        repo.remote("origin", &url).map_err(|e| e.to_string())?;
        Ok("set".into())
    }

    pub fn git_clone(url: String, path: String, token: Option<String>, branch: Option<String>) -> Result<String, String> {
        eprintln!("[git_clone] url_in={url:?} path={path:?} branch={branch:?} has_token={}", token.is_some());
        if let Some(ref tok) = token {
            let preview = if tok.len() >= 8 { &tok[..8] } else { tok.as_str() };
            eprintln!("[git_clone] token_prefix={preview}... len={}", tok.len());
        }
        // Idempotent: if the destination is already a valid git repo, skip the clone.
        if std::path::Path::new(&path).join(".git").exists() {
            eprintln!("[git_clone] already_cloned — .git exists");
            return Ok("already_cloned".into());
        }
        // If the directory exists but has NO .git, remove it so libgit2 can clone fresh.
        if std::path::Path::new(&path).exists() {
            eprintln!("[git_clone] removing stale dir before clone");
            std::fs::remove_dir_all(&path).map_err(|e| format!("pre-clone cleanup failed: {}", e))?;
        }
        // Normalize SSH → HTTPS, embed token in URL, and also supply a credential
        // callback — in case libgit2 1.7.x strips the embedded credentials and then
        // invokes the callback as a fallback (documented security behaviour).
        let normalized = normalize_url(&url);
        eprintln!("[git_clone] normalized_url={normalized:?}");
        let auth_url = if let Some(ref tok) = token {
            inject_token(&normalized, tok)
        } else {
            normalized.clone()
        };
        // Log auth URL with token redacted
        let redacted = if token.is_some() {
            auth_url.replacen(|c: char| c != '/' && c != ':' && c != '@' && c != '.', "*", 0) // keep shape
                .split(':').next().unwrap_or(&auth_url).to_string() + ":***@..."
        } else {
            auth_url.clone()
        };
        eprintln!("[git_clone] auth_url_scheme={redacted}");
        let callbacks = if let Some(tok) = token {
            token_callbacks(tok)
        } else {
            let mut cb = RemoteCallbacks::new();
            cb.certificate_check(|_cert, _valid| Ok(git2::CertificateCheckStatus::CertificateOk));
            cb
        };
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_opts);
        if let Some(ref b) = branch {
            if !b.is_empty() {
                builder.branch(b);
            }
        }
        eprintln!("[git_clone] starting libgit2 clone...");
        match builder.clone(&auth_url, std::path::Path::new(&path)) {
            Ok(_) => {
                eprintln!("[git_clone] SUCCESS");
                Ok("cloned".into())
            }
            Err(e) => {
                eprintln!("[git_clone] FAILED code={:?} class={:?} msg={}", e.code(), e.class(), e.message());
                Err(e.to_string())
            }
        }
    }

    pub fn git_pull(path: String, token: Option<String>) -> Result<String, String> {
        eprintln!("[git_pull] path={path:?} has_token={}", token.is_some());
        if let Some(ref tok) = token {
            let preview = if tok.len() >= 8 { &tok[..8] } else { tok.as_str() };
            eprintln!("[git_pull] token_prefix={preview}... len={}", tok.len());
        }
        let repo = match Repository::open(&path) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[git_pull] FAILED open repo: {}", e);
                return Err(format!("Repositório não encontrado: {}", e));
            }
        };

        // Normalize SSH → HTTPS so PAT auth works; updates .git/config permanently
        ensure_https_remote(&repo);

        // Guard: detached HEAD or unborn branch (empty repo) — nothing to pull
        let head = match repo.head() {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[git_pull] no HEAD (empty/unborn repo — needs re-clone): {}", e);
                return Err("no_commits".into());
            }
        };
        if !head.is_branch() {
            return Err("HEAD is detached — resolve on desktop".into());
        }
        let branch_name = head.shorthand().unwrap_or("main").to_string();
        eprintln!("[git_pull] branch={branch_name}");

        // Get origin URL, normalize SSH→HTTPS, inject token into URL, and also
        // provide a credential callback fallback (for libgit2 1.7.x which may strip
        // embedded credentials and invoke the callback instead).
        // Temporarily set the token URL so refs/remotes/origin/* get updated; restore
        // the clean URL afterwards so no token leaks into .git/config.
        let origin_url = repo
            .find_remote("origin")
            .ok()
            .and_then(|r| r.url().map(String::from))
            .unwrap_or_default();
        eprintln!("[git_pull] origin_url_raw={origin_url:?}");
        let clean_url = normalize_url(&origin_url);
        eprintln!("[git_pull] clean_url={clean_url:?}");
        let auth_url = if let Some(ref tok) = token {
            inject_token(&clean_url, tok)
        } else {
            eprintln!("[git_pull] WARNING: no token provided — fetch will likely fail for private repos");
            clean_url.clone()
        };
        let _ = repo.remote_set_url("origin", &auth_url);
        let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
        let callbacks = if let Some(tok) = token {
            token_callbacks(tok)
        } else {
            let mut cb = RemoteCallbacks::new();
            cb.certificate_check(|_cert, _valid| Ok(git2::CertificateCheckStatus::CertificateOk));
            cb
        };
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        eprintln!("[git_pull] starting fetch branch={branch_name}...");
        let fetch_result = remote.fetch(&[branch_name.as_str()], Some(&mut fetch_opts), None);
        drop(remote);
        // Always restore the clean URL (no token in .git/config)
        let _ = repo.remote_set_url("origin", &clean_url);
        match &fetch_result {
            Ok(_) => eprintln!("[git_pull] fetch OK"),
            Err(e) => eprintln!("[git_pull] fetch FAILED code={:?} class={:?} msg={}", e.code(), e.class(), e.message()),
        }
        fetch_result.map_err(|e| e.to_string())?;

        let remote_ref = format!("refs/remotes/origin/{branch_name}");
        let remote_oid = repo.find_reference(&remote_ref)
            .map_err(|e| e.to_string())?
            .target()
            .ok_or_else(|| "remote ref has no target".to_string())?;
        let fetch_commit = repo.find_annotated_commit(remote_oid).map_err(|e| e.to_string())?;

        let (analysis, _) = repo.merge_analysis(&[&fetch_commit]).map_err(|e| e.to_string())?;
        if analysis.is_up_to_date() {
            return Ok("up_to_date".into());
        }
        if analysis.is_fast_forward() {
            let refname = format!("refs/heads/{branch_name}");
            let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
            reference.set_target(fetch_commit.id(), "Fast-forward pull").map_err(|e| e.to_string())?;
            repo.set_head(&refname).map_err(|e| e.to_string())?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
                .map_err(|e| e.to_string())?;
            return Ok("pulled".into());
        }
        Err("Cannot fast-forward — resolve conflicts no desktop".into())
    }

    pub fn git_checkout_file(path: String, file: String) -> Result<String, String> {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;
        let mut checkout = CheckoutBuilder::new();
        checkout.force().path(&file);
        repo.checkout_head(Some(&mut checkout)).map_err(|e| e.to_string())?;
        Ok("reverted".into())
    }

    pub fn git_checkout_branch(path: String, branch: String, token: Option<String>) -> Result<String, String> {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;

        // Normalize SSH → HTTPS, inject token (temp URL + restore) + callback fallback.
        ensure_https_remote(&repo);
        let origin_url = repo
            .find_remote("origin")
            .ok()
            .and_then(|r| r.url().map(String::from))
            .unwrap_or_default();
        let clean_url = normalize_url(&origin_url);
        let auth_url = if let Some(ref tok) = token {
            inject_token(&clean_url, tok)
        } else {
            clean_url.clone()
        };
        let _ = repo.remote_set_url("origin", &auth_url);
        let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
        let callbacks = if let Some(tok) = token {
            token_callbacks(tok)
        } else {
            let mut cb = RemoteCallbacks::new();
            cb.certificate_check(|_cert, _valid| Ok(git2::CertificateCheckStatus::CertificateOk));
            cb
        };
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        // best-effort fetch — branch may already be present
        let fetch_result = remote.fetch(&[branch.as_str()], Some(&mut fetch_opts), None);
        drop(remote);
        let _ = repo.remote_set_url("origin", &clean_url);
        let _ = fetch_result; // best-effort

        // Find the remote tracking commit
        let remote_ref = format!("refs/remotes/origin/{branch}");
        let remote_oid = repo.find_reference(&remote_ref)
            .map_err(|e| e.to_string())?
            .target()
            .ok_or_else(|| "remote ref has no target".to_string())?;
        let target_commit = repo.find_commit(remote_oid).map_err(|e| e.to_string())?;

        // Create or reset the local branch to that commit
        repo.branch(&branch, &target_commit, true).map_err(|e| e.to_string())?;

        // Set HEAD and checkout working tree
        let refname = format!("refs/heads/{branch}");
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(CheckoutBuilder::new().force()))
            .map_err(|e| e.to_string())?;

        Ok("switched".into())
    }

}

// ── Compile-time routing: dev/Linux → git_cli, MAS/iOS → git_native ──────────────────
// A single `use` alias lets the Tauri command wrappers below reference
// `git::git_init` etc. without any per-function #[cfg] duplication.
#[cfg(not(any(feature = "mas", target_os = "ios")))]
use git_cli as git;
#[cfg(any(feature = "mas", target_os = "ios"))]
use git_native as git;

// ── Workspace helpers ───────────────────────────────────────────────────────
/// Returns the canonical (symlink-resolved) path of an existing directory.
/// On iOS, documentDir() returns /var/mobile/... but the Tauri FS scope is
/// built with canonicalized /private/var/mobile/... paths. For files that
/// don't exist yet, tauri-plugin-fs can't canonicalize them, so they fail
/// the scope check even though they're under $DOCUMENT/**.
/// Fix: canonicalize the workspace root (which DOES exist) and derive all
/// child paths from it — they'll have /private/var/... and match the scope.
#[tauri::command]
fn canonicalize_path(path: String) -> Result<String, String> {
    std::fs::canonicalize(&path)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// Creates <workspace_path>/.cafezin/ (and parents) using std::fs directly,
/// bypassing tauri-plugin-fs scope for the initial mkdir.
#[tauri::command]
fn ensure_config_dir(workspace_path: String) -> Result<(), String> {
    let dir = std::path::Path::new(&workspace_path).join(".cafezin");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
async fn rag_rebuild_index(workspace_path: String) -> Result<rag::RagBuildSummary, String> {
    tokio::task::spawn_blocking(move || rag::rebuild_index(&workspace_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn rag_search(
    workspace_path: String,
    query: String,
    limit: Option<usize>,
    active_file: Option<String>,
    recent_files: Option<Vec<String>>,
) -> Result<rag::RagSearchResult, String> {
    tokio::task::spawn_blocking(move || {
        rag::search_workspace(
            &workspace_path,
            &query,
            limit.unwrap_or(10),
            active_file.as_deref(),
            recent_files.as_deref().unwrap_or(&[]),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Tauri command dispatchers (one per git command, no duplication) ───────────────
#[tauri::command]
fn git_init(path: String) -> Result<String, String> { git::git_init(path) }
#[tauri::command]
fn git_diff(path: String) -> Result<serde_json::Value, String> { git::git_diff(path) }
#[tauri::command]
async fn git_sync(path: String, message: String, token: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git::git_sync(path, message, token))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn git_get_remote(path: String) -> Result<String, String> { git::git_get_remote(path) }
#[tauri::command]
fn git_set_remote(path: String, url: String) -> Result<String, String> { git::git_set_remote(path, url) }
#[tauri::command]
fn git_checkout_file(path: String, file: String) -> Result<String, String> { git::git_checkout_file(path, file) }
#[tauri::command]
async fn git_checkout_branch(path: String, branch: String, token: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git::git_checkout_branch(path, branch, token))
        .await
        .map_err(|e| e.to_string())?
}
// git_clone and git_pull are async to prevent blocking the tokio runtime.
// On iOS the OS watchdog kills the process if the main/async thread is blocked
// for more than ~few seconds during a network operation.
#[tauri::command]
async fn git_clone(url: String, path: String, token: Option<String>, branch: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git::git_clone(url, path, token, branch))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn git_pull(path: String, token: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git::git_pull(path, token))
        .await
        .map_err(|e| e.to_string())?
}


// ── GitHub Device Flow (public client_id only; no client_secret in the app) ───────────────────

// Optional default client ID injected at compile time from cafezin/.env.local.
// Workspaces may override it by passing their own public client_id from the renderer.
const DEFAULT_GITHUB_CLIENT_ID: Option<&str> = option_env!("GITHUB_OAUTH_CLIENT_ID");

fn resolve_github_client_id(client_id: Option<String>) -> Result<String, String> {
    let provided = client_id.unwrap_or_default().trim().to_string();
    if !provided.is_empty() {
        return Ok(provided);
    }

    if let Some(default_id) = DEFAULT_GITHUB_CLIENT_ID {
        let trimmed = default_id.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    Err("GitHub OAuth client_id is not configured".to_string())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DeviceFlowInit {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DeviceFlowPollResult {
    pub access_token: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct GitHubCreatedRepo {
    pub name: String,
    pub full_name: String,
    pub html_url: String,
    pub clone_url: String,
    pub private: bool,
}

/// Step 1: Request a user_code / device_code pair from GitHub.
/// The renderer may provide a public client_id override. No client_secret is used.
/// `scope` examples: "copilot" (Copilot API access), "repo" (git clone/push private repos).
#[tauri::command]
async fn github_device_flow_init(scope: String, client_id: Option<String>) -> Result<DeviceFlowInit, String> {
    let client_id = resolve_github_client_id(client_id)?;
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "client_id": client_id, "scope": scope }))
        .send()
        .await
        .map_err(|e| format!("device flow init request failed: {e}"))?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Device flow init failed ({status}): {body}"));
    }
    res.json::<DeviceFlowInit>().await.map_err(|e| format!("device flow init parse error: {e}"))
}

/// Step 2: Poll for the access token using only the public client_id.
#[tauri::command]
async fn github_device_flow_poll(device_code: String, client_id: Option<String>) -> Result<DeviceFlowPollResult, String> {
    let client_id = resolve_github_client_id(client_id)?;
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id":     client_id,
            "device_code":   device_code,
            "grant_type":    "urn:ietf:params:oauth:grant-type:device_code",
        }))
        .send()
        .await
        .map_err(|e| format!("device flow poll request failed: {e}"))?;
    res.json::<DeviceFlowPollResult>().await.map_err(|e| format!("device flow poll parse error: {e}"))
}

#[tauri::command]
async fn github_create_repo(repo_name: String, private_repo: bool, token: String) -> Result<GitHubCreatedRepo, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.github.com/user/repos")
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Cafezin")
        .bearer_auth(token)
        .json(&serde_json::json!({
            "name": repo_name,
            "private": private_repo,
            "auto_init": false,
        }))
        .send()
        .await
        .map_err(|e| format!("GitHub repo create request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("GitHub repo create failed ({status}): {body}"));
    }

    res.json::<GitHubCreatedRepo>()
        .await
        .map_err(|e| format!("GitHub repo create parse error: {e}"))
}

/// Returns the distribution channel so the frontend can adapt its update UI.
/// "dev"     → local dev / debug build (script-based update)
/// "release" → production non-store build — uses GitHub releases updater
/// "mas"     → Mac App Store (cargo feature `mas`)
/// "ios"     → iOS App Store
#[tauri::command]
fn build_channel() -> &'static str {
    if cfg!(target_os = "ios") { "ios" }
    else if cfg!(feature = "mas") { "mas" }
    else if cfg!(debug_assertions) { "dev" }
    else { "release" }
}

/// Transcribe a base64-encoded audio blob (webm/ogg/mp4) via Groq's Whisper endpoint.
/// Returns the transcript text, or an error string.
#[tauri::command]
async fn transcribe_audio(audio_base64: String, mime_type: String, api_key: String, language: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let audio_bytes = STANDARD.decode(&audio_base64).map_err(|e| format!("base64 decode: {e}"))?;

    let ext = if mime_type.contains("webm") { "webm" }
               else if mime_type.contains("ogg") { "ogg" }
               else if mime_type.contains("mp4") { "mp4" }
               else { "webm" };
    let filename = format!("audio.{ext}");

    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename)
        .mime_str(&mime_type).map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3-turbo")
        .text("language", language)
        .text("response_format", "text");

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(body.trim().to_string())
    } else {
        Err(format!("Groq API error {status}: {body}"))
    }
}

/// Stub for iOS — App Store handles updates.
#[cfg(target_os = "ios")]
#[tauri::command]
async fn update_app(_app: tauri::AppHandle, _project_root: String) -> Result<(), String> {
    Err("update_app is not available on iOS — updates come through the App Store".into())
}

/// Build the app from source, streaming every output line to the frontend,
/// then copy to ~/Applications and relaunch. Events emitted:
///   update:log     { line: String }
///   update:success ()
///   update:error   { message: String }
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn update_app(app: tauri::AppHandle, project_root: String) -> Result<(), String> {
    let emit_log = |line: &str| { let _ = app.emit("update:log", line.to_string()); };

    fn load_env_value(env_files: &[std::path::PathBuf], key: &str) -> Option<String> {
        for env_file in env_files {
            let Ok(contents) = std::fs::read_to_string(env_file) else {
                continue;
            };

            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let Some((current_key, value)) = line.split_once('=') else {
                    continue;
                };
                if current_key.trim() != key {
                    continue;
                }

                return Some(value.trim().trim_matches('"').trim_matches('\'').to_string());
            }
        }

        None
    }

    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let cargo_bin = format!("{}/.cargo/bin", home);
    let app_dir   = format!("{}/app", project_root);
    let signing_key_path = format!("{}/.tauri/cafezin.key", home);
    let env_files = vec![
        std::path::Path::new(&project_root).join(".env.local"),
        std::path::Path::new(&project_root).join("app").join(".env.local"),
    ];

    let build_cmd = format!(
        r#"
        export PATH="{cargo_bin}:/usr/local/bin:/usr/local/opt/node@20/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@20/bin:/usr/bin:/bin:$PATH"
        export NVM_DIR="{home}/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" --no-use
        cd '{app_dir}'
        npm run tauri build -- --bundles app --config '{{"bundle":{{"createUpdaterArtifacts":false}}}}' 2>&1
        "#
    );

    emit_log("▸ Starting incremental build…");
    emit_log("");

    let signing_password = std::env::var("TAURI_SIGNING_PRIVATE_KEY_PASSWORD")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| load_env_value(&env_files, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"));
    let signing_key = if signing_password.is_some() {
        match std::fs::read_to_string(&signing_key_path) {
            Ok(contents) => {
                emit_log(&format!("▸ Signing key loaded from {}", signing_key_path));
                emit_log("▸ Signing key password loaded from environment");
                Some(contents.trim_end_matches(['\r', '\n']).to_string())
            }
            Err(_) => {
                emit_log(&format!(
                    "⚠ No signing key at {} — updater bundle will not be signed",
                    signing_key_path
                ));
                None
            }
        }
    } else {
        if std::path::Path::new(&signing_key_path).exists() {
            emit_log("▸ No TAURI_SIGNING_PRIVATE_KEY_PASSWORD set — skipping updater signing for local update");
        } else {
            emit_log(&format!(
                "⚠ No signing key at {} — updater bundle will not be signed",
                signing_key_path
            ));
        }
        None
    };

    // Remove stale .app bundles from a previous build so the post-build search
    // always finds exactly one — the freshly produced one.
    let bundle_dir = format!("{}/app/src-tauri/target/release/bundle/macos", project_root);
    if std::path::Path::new(&bundle_dir).exists() {
        if let Ok(entries) = std::fs::read_dir(&bundle_dir) {
            for entry in entries.flatten() {
                if entry.path().extension().map(|x| x == "app").unwrap_or(false) {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }

    let mut command = tokio::process::Command::new("bash");
    command.arg("-c").arg(&build_cmd).stdout(Stdio::piped());
    if let Some(key) = signing_key {
        command.env("TAURI_SIGNING_PRIVATE_KEY", key);
        if let Some(password) = signing_password {
            command.env("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", password);
        } else {
            command.env_remove("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
        }
    }

    let mut child = command
        .spawn()
        .map_err(|e| { let _ = app.emit("update:error", e.to_string()); e.to_string() })?;

    // Stream stdout line by line to the frontend
    if let Some(stdout) = child.stdout.take() {
        let mut reader = tokio::io::BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            emit_log(&line);
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if !status.success() {
        let msg = "Build failed — see log above.".to_string();
        let _ = app.emit("update:error", &msg);
        return Err(msg);
    }

    emit_log("");
    emit_log("▸ Build succeeded — installing…");

    // Find the freshly built .app bundle — pick newest by mtime as a safety net
    let app_path = std::fs::read_dir(&bundle_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().extension().map(|x| x == "app").unwrap_or(false))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
        .ok_or_else(|| "No .app bundle found after build".to_string())?;

    let install_dir = format!("{}/Applications", home);
    std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
    let dest = format!("{}/Cafezin.app", install_dir);

    let _ = std::fs::remove_dir_all(&dest);
    let cp_status = tokio::process::Command::new("cp")
        .args(["-R", app_path.to_str().unwrap_or_default(), &dest])
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if !cp_status.success() {
        let msg = format!("Failed to copy .app to {}", dest);
        let _ = app.emit("update:error", &msg);
        return Err(msg);
    }

    emit_log(&format!("▸ Installed to {}", dest));
    emit_log("");
    emit_log("✓  Done! Relaunching…");

    // Signal success — frontend shows countdown, then we relaunch
    let _ = app.emit("update:success", ());
    tokio::time::sleep(tokio::time::Duration::from_millis(3200)).await;

    // Relaunch via a detached shell so the new instance is fully independent
    // before this process exits. `open -n` forces a new instance even if one
    // is already running; the shell is double-forked so it outlives us.
    tokio::process::Command::new("bash")
        .arg("-c")
        .arg(format!("sleep 0.5 && open -n '{}' &", dest))
        .spawn()
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ShellProcessRegistry::default())
        .setup(|app| {            // ── Deep link handler — OAuth callback (cafezin://auth/callback) ────
            {
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let url_str = url.to_string();
                        // Only forward auth callbacks to the webview
                        if url_str.starts_with("cafezin://auth/") || url_str.starts_with("cafezin://") {
                            let _ = handle.emit("auth-callback", url_str);
                        }
                    }
                });
                // On desktop, also register the scheme so the OS knows to open this app
                #[cfg(desktop)]
                let _ = app.deep_link().register("cafezin");
            }
            // ── Native macOS menu bar (desktop only) ───────────────
            #[cfg(desktop)]
            {
                // Label changes based on build channel:
                // dev → "Update Cafezin…" (triggers in-app build script)
                // mas → "Open App Store…"  (opens the store page)
                let update_label = if cfg!(feature = "mas") {
                    "Open App Store\u{2026}"
                } else {
                    "Update Cafezin\u{2026}"
                };
                let update_item = MenuItem::with_id(
                    app, "update_app", update_label, true, Some("cmd+shift+u")
                )?;
                let settings_item = MenuItem::with_id(
                    app, "settings", "Settings\u{2026}", true, Some("cmd+,")
                )?;
                let separator = PredefinedMenuItem::separator(app)?;
                let separator2 = PredefinedMenuItem::separator(app)?;
                let hide      = PredefinedMenuItem::hide(app, None)?;
                let hide_others = PredefinedMenuItem::hide_others(app, None)?;
                let quit      = PredefinedMenuItem::quit(app, Some("Quit Cafezin"))?;

                let app_menu = Submenu::with_items(
                    app, "Cafezin", true,
                    &[&update_item, &settings_item, &separator, &hide, &hide_others, &separator2, &quit],
                )?;

                // Standard Edit menu so copy/paste/undo work normally
                let undo       = PredefinedMenuItem::undo(app, None)?;
                let redo       = PredefinedMenuItem::redo(app, None)?;
                let sep2       = PredefinedMenuItem::separator(app)?;
                let cut        = PredefinedMenuItem::cut(app, None)?;
                let copy       = PredefinedMenuItem::copy(app, None)?;
                let paste      = PredefinedMenuItem::paste(app, None)?;
                let select_all = PredefinedMenuItem::select_all(app, None)?;
                let edit_menu  = Submenu::with_items(
                    app, "Edit", true,
                    &[&undo, &redo, &sep2, &cut, &copy, &paste, &select_all],
                )?;

                // File menu
                let new_window_item       = MenuItem::with_id(app, "new_window", "New Window", true, Some("cmd+shift+n"))?;
                let switch_workspace_item = MenuItem::with_id(app, "switch_workspace", "Switch Workspace\u{2026}", true, Some("cmd+shift+w"))?;
                let switch_sep            = PredefinedMenuItem::separator(app)?;
                let new_file_item         = MenuItem::with_id(app, "new_file", "New File", true, Some("cmd+n"))?;
                let file_menu = Submenu::with_items(
                    app, "File", true,
                    &[&new_window_item, &switch_workspace_item, &switch_sep, &new_file_item],
                )?;

                // Tools menu
                let image_search_item  = MenuItem::with_id(app, "image_search",  "Image Search\u{2026}",            true, Some("cmd+i"))?;
                let tools_sep1         = PredefinedMenuItem::separator(app)?;
                let export_pdf_item    = MenuItem::with_id(app, "export_pdf",    "Export to PDF\u{2026}",           true, None::<&str>)?;
                let export_sep         = PredefinedMenuItem::separator(app)?;
                let export_modal_item  = MenuItem::with_id(app, "export_modal",  "Export / Build Settings\u{2026}", true, None::<&str>)?;
                let tools_menu = Submenu::with_items(
                    app, "Tools", true,
                    &[&image_search_item, &tools_sep1, &export_pdf_item, &export_sep, &export_modal_item],
                )?;

                // Help menu
                let help_tour_item = MenuItem::with_id(app, "help_tour", "How to Use Cafezin\u{2026}", true, None::<&str>)?;
                let contact_us_item = MenuItem::with_id(app, "contact_us", "Contact Us\u{2026}", true, None::<&str>)?;
                let help_menu = Submenu::with_items(
                    app, "Help", true,
                    &[&help_tour_item, &contact_us_item],
                )?;

                // View menu
                let toggle_sidebar_item = MenuItem::with_id(app, "toggle_sidebar", "Toggle Sidebar",  true, Some("cmd+b"))?;
                let toggle_copilot_item = MenuItem::with_id(app, "toggle_copilot", "Toggle Copilot",  true, Some("cmd+k"))?;
                let view_sep1           = PredefinedMenuItem::separator(app)?;
                let view_edit_item      = MenuItem::with_id(app, "view_edit",      "Edit Mode",        true, None::<&str>)?;
                let view_preview_item   = MenuItem::with_id(app, "view_preview",   "Preview Mode",     true, None::<&str>)?;
                let view_sep2_item      = PredefinedMenuItem::separator(app)?;
                let format_item         = MenuItem::with_id(app, "format_file",    "Format File",      true, Some("alt+f"))?;
                let view_menu = Submenu::with_items(
                    app, "View", true,
                    &[&toggle_sidebar_item, &toggle_copilot_item, &view_sep1, &view_edit_item, &view_preview_item, &view_sep2_item, &format_item],
                )?;

                let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &tools_menu, &help_menu])?;
                app.set_menu(menu)?;

                // Emit to the webview so the frontend can respond
                let handle = app.handle().clone();
                app.on_menu_event(move |_app, event: tauri::menu::MenuEvent| {
                    match event.id().as_ref() {
                        "update_app"         => { let _ = handle.emit("menu-update-app", ()); }
                        "settings"           => { let _ = handle.emit("menu-settings", ()); }
                        "new_window"         => { let _ = handle.emit("menu-new-window", ()); }
                        "switch_workspace"   => { let _ = handle.emit("menu-switch-workspace", ()); }
                        "new_file"           => { let _ = handle.emit("menu-new-file", ()); }
                        "image_search"       => { let _ = handle.emit("menu-image-search", ()); }
                        "export_pdf"         => { let _ = handle.emit("menu-export-pdf", ()); }
                        "export_modal"       => { let _ = handle.emit("menu-export-modal", ()); }
                        "toggle_sidebar"     => { let _ = handle.emit("menu-toggle-sidebar", ()); }
                        "toggle_copilot"     => { let _ = handle.emit("menu-toggle-copilot", ()); }
                        "view_edit"          => { let _ = handle.emit("menu-view-edit", ()); }
                        "view_preview"       => { let _ = handle.emit("menu-view-preview", ()); }
                        "format_file"        => { let _ = handle.emit("menu-format-file", ()); }
                        "help_tour"          => { let _ = handle.emit("menu-help-tour", ()); }
                        "contact_us"         => { let _ = handle.emit("menu-contact-us", ()); }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![canonicalize_path, ensure_config_dir, rag_rebuild_index, rag_search, git_init, git_diff, git_sync, git_checkout_file, git_checkout_branch, git_get_remote, git_set_remote, git_clone, git_pull, shell_run, shell_run_start, shell_run_status, shell_run_kill, update_app, transcribe_audio, open_devtools, build_channel, github_device_flow_init, github_device_flow_poll, github_create_repo])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
