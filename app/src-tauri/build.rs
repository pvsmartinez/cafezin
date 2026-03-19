fn main() {
    // ── Load optional default GitHub OAuth client_id from .env.local ───────
    // The device flow only needs a public client_id. No client_secret is
    // compiled into the app.
    //
    // Resolution order:
    //   1. GITHUB_OAUTH_CLIENT_ID already set in
    //      the shell environment (e.g. CI) → used as-is (no file needed).
    //   2. cafezin/.env.local  (root of the cafezin project, two levels up from src-tauri/)
    //   3. cafezin/app/.env.local  (Vite env file, adjacent to app/)
    //
    // Keys recognised in the .env.local file:
    //   GITHUB_OAUTH_CLIENT_ID      — GitHub OAuth App client_id  (scope: copilot)
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let src_tauri = std::path::Path::new(&manifest_dir);
    // src-tauri/ → app/ → cafezin/
    let cafezin_root = src_tauri.parent().and_then(|p| p.parent());

    let env_files: Vec<std::path::PathBuf> = {
        let mut v = Vec::new();
        if let Some(root) = cafezin_root {
            v.push(root.join(".env.local"));
            v.push(root.join("app").join(".env.local"));
        }
        v
    };

    println!("cargo:rerun-if-env-changed=GITHUB_OAUTH_CLIENT_ID");
    let mut oauth_client_id = std::env::var("GITHUB_OAUTH_CLIENT_ID").ok();

    for env_file in &env_files {
        if let Ok(contents) = std::fs::read_to_string(env_file) {
            println!("cargo:rerun-if-changed={}", env_file.display());
            for line in contents.lines() {
                let line = line.trim();
                if line.starts_with('#') || line.is_empty() {
                    continue;
                }
                if let Some((key, val)) = line.split_once('=') {
                    let key = key.trim();
                    let val = val.trim().trim_matches('"').trim_matches('\'');
                    match key {
                        "GITHUB_OAUTH_CLIENT_ID" if oauth_client_id.is_none() => {
                            oauth_client_id = Some(val.to_string());
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    if let Some(val) = oauth_client_id {
        println!("cargo:rustc-env=GITHUB_OAUTH_CLIENT_ID={val}");
    }

    // ── iOS link flags ─────────────────────────────────────────────────────
    // libgit2 (vendored) needs zlib and iconv from the system SDK.
    // These are available on all iOS devices but not auto-linked by the linker.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=iconv");
    }

    tauri_build::build()
}
