//! On-demand virus scanning with whatever engine this PC really has: Microsoft Defender when its
//! antivirus service is running, or ClamAV when installed. Both are started directly with an
//! argument vector (no shell). With neither, the PC's own antivirus still checks files on open.
use serde::Serialize;
use std::{path::PathBuf, process::{Command, Stdio}};

pub const CLAMAV_URL: &str = "https://www.clamav.net/downloads";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub engine: String,
    pub clean: bool,
    pub detail: String,
}

enum Engine {
    Defender(PathBuf),
    ClamAv(PathBuf),
}

fn quiet(exe: &PathBuf) -> Command {
    let mut c = Command::new(exe);
    c.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

#[cfg(not(windows))]
fn defender() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn defender() -> Option<PathBuf> {
    let pf = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or(r"C:\Program Files".into());
    let exe = pf.join(r"Windows Defender\MpCmdRun.exe");
    if !exe.is_file() {
        return None;
    }
    // Defender stays installed but stops when another antivirus takes over; only use it while it runs.
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or(r"C:\Windows".into());
    let out = quiet(&root.join(r"System32\sc.exe")).args(["query", "WinDefend"]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).contains("RUNNING").then_some(exe)
}

fn clamav() -> Option<PathBuf> {
    #[cfg(unix)]
    return crate::os::in_path("clamscan");
    #[cfg(windows)]
    {
        let mut c: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).filter(|d| d.is_absolute()).map(|d| d.join("clamscan.exe")).collect()).unwrap_or_default();
        let pf = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or(r"C:\Program Files".into());
        c.push(pf.join(r"ClamAV\clamscan.exe"));
        c.into_iter().find(|p| p.is_file())
    }
}

fn engine() -> Option<Engine> {
    defender().map(Engine::Defender).or_else(|| clamav().map(Engine::ClamAv))
}

pub fn engine_name() -> Option<&'static str> {
    engine().map(|e| match e { Engine::Defender(_) => "Microsoft Defender", Engine::ClamAv(_) => "ClamAV" })
}

/// Scan one file or folder. The path is pre-validated and points into a mounted drive.
pub fn scan(path: &str) -> Result<ScanResult, String> {
    match engine().ok_or("No on-demand scanner is available. Your antivirus still checks files when you open them.")? {
        Engine::Defender(exe) => {
            let out = quiet(&exe).args(["-Scan", "-ScanType", "3", "-File", path]).output().map_err(|_| "Couldn't start Microsoft Defender.".to_string())?;
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            interpret_defender(out.status.code(), &text)
        }
        Engine::ClamAv(exe) => {
            let out = quiet(&exe).args(["--no-summary", "--infected", "--recursive", path]).output().map_err(|_| "Couldn't start ClamAV.".to_string())?;
            interpret_clamav(out.status.code(), &String::from_utf8_lossy(&out.stdout))
        }
    }
}

pub fn interpret_defender(code: Option<i32>, text: &str) -> Result<ScanResult, String> {
    let engine = "Microsoft Defender".to_string();
    if text.contains("Failed with hr") {
        return Err("Microsoft Defender couldn't scan right now. Is another antivirus active?".into());
    }
    match code {
        Some(0) => Ok(ScanResult { engine, clean: true, detail: "No threats found.".into() }),
        Some(2) => {
            let threats = text.lines().filter(|l| l.trim_start().starts_with("Threat")).count().max(1);
            Ok(ScanResult { engine, clean: false, detail: format!("{threats} threat(s) found. Microsoft Defender has dealt with them; check Windows Security for details.") })
        }
        _ => Err("Microsoft Defender couldn't finish the scan.".into()),
    }
}

pub fn interpret_clamav(code: Option<i32>, text: &str) -> Result<ScanResult, String> {
    let engine = "ClamAV".to_string();
    match code {
        Some(0) => Ok(ScanResult { engine, clean: true, detail: "No threats found.".into() }),
        Some(1) => {
            let names: Vec<String> = text.lines().filter_map(|l| l.strip_suffix(" FOUND")).filter_map(|l| l.rsplit(": ").next()).map(String::from).collect();
            Ok(ScanResult { engine, clean: false, detail: format!("Found: {}. The file was not changed; delete it or keep it closed.", if names.is_empty() { "a threat".into() } else { names.join(", ") }) })
        }
        _ => Err("ClamAV couldn't finish the scan. Its signatures may need updating (run freshclam).".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_scanner_results() {
        assert!(interpret_defender(Some(0), "Scan starting...\nScan finished.\nScanning found no threats.").unwrap().clean);
        let bad = interpret_defender(Some(2), "Scan finished.\nThreat                  : Virus:DOS/EICAR_Test_File\n").unwrap();
        assert!(!bad.clean && bad.detail.starts_with("1 threat"));
        assert!(interpret_defender(Some(2), "CmdTool: Failed with hr = 0x800106ba").is_err());
        assert!(interpret_clamav(Some(0), "").unwrap().clean);
        let found = interpret_clamav(Some(1), "O:\\x\\eicar.com: Win.Test.EICAR_HDB-1 FOUND\n").unwrap();
        assert!(!found.clean && found.detail.contains("Win.Test.EICAR_HDB-1"));
        assert!(interpret_clamav(Some(2), "").is_err());
    }
}
