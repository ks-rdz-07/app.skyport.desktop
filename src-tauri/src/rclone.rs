//! Everything that talks to the cloud engine (rclone). Processes are always spawned
//! directly with an argument vector (never through a shell), with no console window.
//! Nothing in here returns rclone wording to the UI: errors go through `friendly`.
use serde::Serialize;
use serde_json::Value;
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

pub const RCLONE_URL: &str = "https://rclone.org/downloads/";
/// Where the filesystem driver comes from on each system.
pub const DRIVER_URL: &str = if cfg!(windows) { "https://winfsp.dev/rel/" } else if cfg!(target_os = "macos") { "https://macfuse.github.io/" } else { "https://github.com/libfuse/libfuse" };
const EXE: &str = if cfg!(windows) { "rclone.exe" } else { "rclone" };
pub const NOT_INSTALLED: &str = "The cloud engine isn't installed. Open Setup to install it.";

pub fn find_rclone() -> Option<PathBuf> {
    let mut candidates = vec![];
    if let Ok(exe) = std::env::current_exe() {
        candidates.push(exe.with_file_name(EXE));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).filter(|d| d.is_absolute()).map(|d| d.join(EXE)));
    }
    #[cfg(unix)]
    candidates.extend(["/opt/homebrew/bin/rclone", "/usr/local/bin/rclone", "/usr/bin/rclone"].map(PathBuf::from));
    // winget installs rclone as a portable package; PATH only picks it up after a re-login.
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let winget = PathBuf::from(local).join(r"Microsoft\WinGet");
        candidates.push(winget.join(r"Links\rclone.exe"));
        if let Ok(pkgs) = std::fs::read_dir(winget.join("Packages")) {
            for pkg in pkgs.flatten().filter(|p| p.file_name().to_string_lossy().starts_with("Rclone.Rclone_")) {
                if let Ok(inner) = std::fs::read_dir(pkg.path()) {
                    candidates.extend(inner.flatten().map(|d| d.path().join("rclone.exe")));
                }
            }
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

pub fn winfsp_installed() -> bool {
    crate::os::driver_installed()
}

/// The system's opener: File Explorer, Finder (open) or xdg-open.
pub fn explorer() -> Command {
    crate::os::opener()
}

pub fn cmd(rclone: &Path) -> Command {
    let mut c = Command::new(rclone);
    c.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // no console window
    }
    c
}

/// Run and return stdout. Errors are user-facing (friendly, redacted).
pub fn run_cmd(mut c: Command) -> Result<String, String> {
    let out = c.output().map_err(|_| "Couldn't start the cloud engine. Try reinstalling it from Setup.".to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(clean_error(&String::from_utf8_lossy(&out.stderr)))
    }
}

pub fn run(rclone: &Path, args: &[&str]) -> Result<String, String> {
    let mut c = cmd(rclone);
    c.args(args);
    run_cmd(c)
}

/// Drop any line that might carry credentials.
pub fn redact(text: &str) -> String {
    text.lines()
        .map(|l| {
            let lower = l.to_ascii_lowercase();
            if ["token", "secret", "password", "pass="].iter().any(|k| lower.contains(k)) {
                "[redacted]"
            } else {
                l
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Last meaningful error line of rclone output/log, turned into a user-facing message.
pub fn clean_error(stderr: &str) -> String {
    let red = redact(stderr);
    let line = red
        .lines()
        .rev()
        .find(|l| l.contains("ERROR") || l.contains("CRITICAL") || l.contains("Fatal") || l.contains("Failed"))
        .or_else(|| red.lines().rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("");
    // "2026/11/26 15:39:11 ERROR : msg" -> "msg"
    friendly(line.splitn(2, " : ").nth(1).unwrap_or(line).trim())
}

/// Why a mount process died: only fatal lines count. A log's earlier ERROR lines are often
/// harmless (e.g. the startup symlink notice) and must not be shown as the cause.
pub fn fatal_error(log: &str) -> Option<String> {
    let red = redact(log);
    let line = red.lines().rev().find(|l| l.contains("CRITICAL") || l.contains("Fatal error"))?;
    Some(friendly(line.splitn(2, " : ").nth(1).unwrap_or(line).trim()))
}

pub fn friendly(msg: &str) -> String {
    let m = msg.to_ascii_lowercase();
    let has = |keys: &[&str]| keys.iter().any(|k| m.contains(k));
    let text = if has(&["no such host", "dial tcp", "connection refused", "network is unreachable", "i/o timeout", "context deadline"]) {
        "Can't reach OneDrive right now. Check your internet connection and try again."
    } else if has(&["invalid_grant", "unauthenticated", "401", "token expired", "couldn't fetch token", "[redacted]"]) {
        "Your Microsoft sign-in has expired. Add the account again to sign in."
    } else if has(&["didn't find section", "not found in config"]) {
        "This OneDrive account is no longer set up on this PC. Add it again."
    } else if has(&["itemnotfound", "directory not found", "object not found", "not found"]) {
        "That folder couldn't be found in OneDrive. It may have been moved or deleted."
    } else if has(&["mountpoint", "already in use", "already exists"]) {
        "That drive letter is already in use. Choose another letter."
    } else if has(&["winfsp", "cgofuse", "fuse"]) {
        "The drive driver isn't working. Reinstall it from the Setup page."
    } else if has(&["access is denied", "permission denied"]) {
        "Windows denied access. Check that the cache folder can be written to."
    } else if has(&["quota", "insufficient storage", "507"]) {
        "Your OneDrive is full. Free up space and try again."
    } else if m.is_empty() {
        "Something went wrong while talking to OneDrive. Please try again."
    } else {
        return format!("OneDrive reported a problem: {}", scrub(msg));
    };
    text.into()
}

/// Never show the engine's name to end users.
fn scrub(msg: &str) -> String {
    let mut out = msg.to_string();
    for w in ["rclone", "Rclone", "RCLONE"] {
        out = out.replace(w, "SkyPort");
    }
    out
}

pub fn version(rclone: &Path) -> Option<String> {
    run(rclone, &["version"]).ok()?.lines().next().map(|l| l.trim_start_matches("rclone ").to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub drive_type: String,
}

/// Fully set-up OneDrive accounts. The dump contains tokens; they never leave this function.
pub fn onedrive_remotes(rclone: &Path) -> Result<Vec<Remote>, String> {
    let dump: serde_json::Map<String, Value> =
        serde_json::from_str(&run(rclone, &["config", "dump"])?).map_err(|_| "Couldn't read your saved accounts.")?;
    Ok(dump
        .iter()
        .filter(|(_, v)| v["type"] == "onedrive" && v["drive_id"].as_str().is_some_and(|s| !s.is_empty()))
        .map(|(k, v)| Remote { name: k.clone(), drive_type: v["drive_type"].as_str().unwrap_or("").into() })
        .collect())
}

fn remote_exists(rclone: &Path, name: &str) -> Result<bool, String> {
    let dump: Value = serde_json::from_str(&run(rclone, &["config", "dump"])?).map_err(|_| "Couldn't read your saved accounts.")?;
    Ok(dump.get(name).is_some())
}

/// Also blocks argument injection: a name can never start with '-'.
pub fn valid_remote_name(name: &str) -> bool {
    name.len() <= 40
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Folder inside OneDrive, '/'-separated, no traversal or drive syntax.
pub fn valid_folder(path: &str) -> bool {
    path.len() <= 1024
        && !path.chars().any(|c| c.is_control() || c == ':' || c == '\\')
        && !path.split('/').any(|s| s == ".." || s == ".")
}

static SIGN_IN: Mutex<Option<Child>> = Mutex::new(None);
static SIGN_IN_ACTIVE: Mutex<bool> = Mutex::new(false);

/// One config step, killable from `cancel_sign_in` (the OAuth step waits for the browser).
fn config_step(rclone: &Path, args: &[&str], deadline: Instant) -> Result<Value, String> {
    let mut child = cmd(rclone)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Couldn't start the cloud engine. Try reinstalling it from Setup.".to_string())?;
    let (mut so, mut se) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let out = std::thread::spawn(move || { let mut s = String::new(); let _ = so.read_to_string(&mut s); s });
    let err = std::thread::spawn(move || { let mut s = String::new(); let _ = se.read_to_string(&mut s); s });
    *SIGN_IN.lock().unwrap() = Some(child);
    let status = loop {
        std::thread::sleep(Duration::from_millis(250));
        let mut guard = SIGN_IN.lock().unwrap();
        let Some(child) = guard.as_mut() else { break None }; // cancelled
        if let Ok(Some(st)) = child.try_wait() {
            guard.take();
            break Some(st);
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            guard.take();
            break None;
        }
    };
    let (out, err) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    match status {
        None => Err("Sign-in was cancelled.".into()),
        Some(st) if !st.success() => Err(clean_error(&err)),
        Some(_) => serde_json::from_str(out.trim()).map_err(|_| "Sign-in returned an unexpected answer. Please try again.".into()),
    }
}

/// Pick the answer an end user would: the account's own "OneDrive" drive, otherwise defaults.
pub fn answer(opt: &Value) -> String {
    let examples = opt["Examples"].as_array().cloned().unwrap_or_default();
    match opt["Name"].as_str() {
        Some("config_type") => return "onedrive".into(),
        Some("config_driveid") => {
            if let Some(v) = examples.iter().find(|e| e["Help"].as_str().is_some_and(|h| h.split(" (").next() == Some("OneDrive"))) {
                return v["Value"].as_str().unwrap_or("").into();
            }
        }
        _ => {}
    }
    match &opt["Default"] {
        Value::String(s) if !s.is_empty() => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        _ => examples.first().and_then(|e| e["Value"].as_str()).unwrap_or("").into(),
    }
}

/// Sign in to Microsoft (personal or work/school) and save the account. The browser opens
/// during the OAuth step; tokens are written by rclone straight into its own config.
pub fn sign_in(rclone: &Path, name: &str) -> Result<(), String> {
    {
        let mut active = SIGN_IN_ACTIVE.lock().unwrap();
        if *active {
            return Err("A sign-in is already in progress.".into());
        }
        *active = true;
    }
    let result = (|| {
        if remote_exists(rclone, name)? {
            return Err(format!("An account named \"{name}\" already exists. Choose another name."));
        }
        let res = sign_in_steps(rclone, name);
        if res.is_err() {
            let _ = run(rclone, &["config", "delete", name]); // only ever a name we just created
        }
        res
    })();
    *SIGN_IN_ACTIVE.lock().unwrap() = false;
    result
}

fn sign_in_steps(rclone: &Path, name: &str) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(600);
    let mut q = config_step(rclone, &["config", "create", name, "onedrive", "--non-interactive"], deadline)?;
    for _ in 0..20 {
        if let Some(e) = q["Error"].as_str().filter(|e| !e.is_empty()) {
            return Err(friendly(e));
        }
        let state = q["State"].as_str().unwrap_or("").to_string();
        if state.is_empty() {
            return if onedrive_remotes(rclone)?.iter().any(|r| r.name == name) {
                Ok(())
            } else {
                Err("Sign-in finished but no OneDrive was found for this account.".into())
            };
        }
        let a = answer(&q["Option"]);
        q = config_step(rclone, &["config", "update", name, "--continue", "--state", &state, "--result", &a, "--non-interactive"], deadline)?;
    }
    Err("Sign-in didn't finish. Please try again.".into())
}

pub fn cancel_sign_in() {
    if let Some(mut c) = SIGN_IN.lock().unwrap().take() {
        let _ = c.kill();
    }
}

pub fn list_folders(rclone: &Path, remote: &str, path: &str) -> Result<Vec<String>, String> {
    let target = format!("{remote}:{path}");
    let out = run(rclone, &["lsjson", &target, "--dirs-only", "--no-modtime", "--no-mimetype"])?;
    let items: Vec<Value> = serde_json::from_str(&out).map_err(|_| "Couldn't read the folder list. Please try again.")?;
    let mut names: Vec<String> = items.iter().filter_map(|i| i["Name"].as_str().map(String::from)).collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

#[derive(Serialize, Default)]
pub struct Quota {
    pub total: Option<u64>,
    pub used: Option<u64>,
    pub free: Option<u64>,
    pub trashed: Option<u64>,
}

pub fn quota(rclone: &Path, remote: &str) -> Result<Quota, String> {
    let v: Value = serde_json::from_str(&run(rclone, &["about", &format!("{remote}:"), "--json"])?)
        .map_err(|_| "OneDrive didn't report storage usage.")?;
    Ok(Quota { total: v["total"].as_u64(), used: v["used"].as_u64(), free: v["free"].as_u64(), trashed: v["trashed"].as_u64() })
}

/// Ask a running mount through its private rc port. Credentials go through the
/// environment, never the command line.
pub fn rc(rclone: &Path, port: u16, user: &str, pass: &str, method: &str) -> Result<Value, String> {
    let mut c = cmd(rclone);
    c.args(["rc", method, "--url", &format!("http://127.0.0.1:{port}/")]).env("RCLONE_USER", user).env("RCLONE_PASS", pass);
    serde_json::from_str(&run_cmd(c)?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn errors_are_redacted_friendly_and_unbranded() {
        let s = "2026/11/26 10:00:00 INFO  : starting\n{\"access_token\":\"abc\"}\n2026/11/26 10:00:01 ERROR : Failed: dial tcp: no such host";
        assert!(!redact(s).contains("abc"));
        assert!(clean_error(s).starts_with("Can't reach OneDrive"));
        assert!(friendly("token=xyz [redacted]").contains("sign-in has expired"));
        let other = friendly("rclone weird thing");
        assert!(!other.to_lowercase().contains("rclone") && other.contains("weird thing"));
    }

    #[test]
    fn benign_log_errors_are_not_reported_as_the_cause() {
        let log = "NOTICE: Serving remote control
ERROR : symlinks not supported without the --links flag: /
The service rclone has been started.";
        assert_eq!(fatal_error(log), None);
        let fatal = "ERROR : symlinks not supported
CRITICAL: Fatal error: failed to mount FUSE fs: mountpoint already in use";
        assert!(fatal_error(fatal).unwrap().contains("drive letter is already in use"));
    }

    #[test]
    fn names_and_folders() {
        assert!(valid_remote_name("onedrive-work_2"));
        assert!(valid_remote_name("KSR"));
        for bad in ["", "a b", "x;rm", "-vv", "--config", "_x"] {
            assert!(!valid_remote_name(bad), "{bad}");
        }
        assert!(valid_folder("") && valid_folder("Documents/Work 2026"));
        for bad in ["../x", "a/../b", "C:/x", "a\\b", "a/./b", "a\nb"] {
            assert!(!valid_folder(bad), "{bad}");
        }
    }

    #[test]
    fn picks_the_real_onedrive_not_the_default_drive() {
        let q = json!({ "Name": "config_driveid", "Default": "b!hidden",
            "Examples": [{"Value": "b!hidden", "Help": "AEEE102E (personal)"}, {"Value": "0AC6", "Help": "OneDrive (personal)"}] });
        assert_eq!(answer(&q), "0AC6");
        assert_eq!(answer(&json!({"Name": "config_type", "Default": "sharepoint"})), "onedrive");
        assert_eq!(answer(&json!({"Name": "config_is_local", "Default": true})), "true");
        assert_eq!(answer(&json!({"Name": "x", "Default": "", "Examples": [{"Value": "a"}]})), "a");
    }
}
