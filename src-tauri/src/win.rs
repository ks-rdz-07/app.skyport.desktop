//! Windows helpers: drive letters, volume readiness, elevation, DPAPI. unix.rs has the same interface.
use std::{ffi::c_void, mem::size_of, ptr::null_mut};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    Storage::FileSystem::{GetLogicalDrives, GetVolumeInformationW},
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

/// Drive letters visible in this process's logon session (local disks, mapped shares, subst, mounts).
pub fn used_letters() -> Vec<String> {
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| ((b'A' + i) as char).to_string())
        .collect()
}

/// True when the volume answers in this session. Volume info is served locally by WinFsp,
/// so this does not hit OneDrive (unlike listing the root).
pub fn drive_ready(target: &str) -> bool {
    let letter = target.trim_end_matches(':');
    if !used_letters().iter().any(|l| l == letter) {
        return false;
    }
    let root: Vec<u16> = format!("{letter}:\\").encode_utf16().chain([0]).collect();
    unsafe {
        GetVolumeInformationW(root.as_ptr(), null_mut(), 0, null_mut(), null_mut(), null_mut(), null_mut(), 0) != 0
    }
}

/// A drive mounted from an elevated process lives in the admin logon session and is
/// invisible to the user's Explorer, so we refuse to mount when elevated.
pub fn is_elevated() -> bool {
    unsafe {
        let mut token: HANDLE = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut c_void,
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

/// Plain (non-sensitive) cache location for the uninstaller, which can't read the encrypted database.
pub fn remember_cache_dir(dir: &str) {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let w = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let (key, name, val) = (w(r"Software\Skyport"), w("CacheDir"), w(dir));
    unsafe {
        RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, val.as_ptr().cast(), (val.len() * 2) as u32);
    }
}

/// A job object that ends every mount process when SkyPort exits for any reason, so no
/// orphaned engine keeps holding a drive letter. Unuploaded changes stay in the cache.
pub struct Job(usize); // raw HANDLE kept as usize so Core stays Send + Sync

impl Job {
    pub fn new() -> Self {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const c_void, size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
            Job(job as usize)
        }
    }

    pub fn adopt(&self, child: &std::process::Child) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(self.0 as HANDLE, child.as_raw_handle() as HANDLE);
        }
    }
}

/// Lock a folder down to this user, SYSTEM and Administrators (inheritance off, rules pushed to
/// everything inside). The cache holds plain copies of cloud files, and new folders on a data
/// drive such as E: are otherwise readable by every signed-in user. Uses Windows' own icacls,
/// started directly with arguments (no shell). The path is pre-validated as `X:\...`.
pub fn make_private(dir: &str) -> bool {
    use std::os::windows::process::CommandExt;
    let user = match (std::env::var("USERDOMAIN"), std::env::var("USERNAME")) {
        (Ok(d), Ok(u)) => format!(r"{d}\{u}:(OI)(CI)F"),
        _ => return false,
    };
    let root = std::env::var_os("SystemRoot").map(std::path::PathBuf::from).unwrap_or(r"C:\Windows".into());
    std::process::Command::new(root.join(r"System32\icacls.exe"))
        .args([dir, "/inheritance:r", "/grant:r", &user, "/grant:r", "*S-1-5-18:(OI)(CI)F", "/grant:r", "*S-1-5-32-544:(OI)(CI)F", "/Q"])
        .creation_flags(0x0800_0000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
        && hide(dir)
}

/// Mark a folder hidden so it stays out of the way in File Explorer.
pub fn hide(dir: &str) -> bool {
    use windows_sys::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, INVALID_FILE_ATTRIBUTES};
    let w: Vec<u16> = dir.encode_utf16().chain([0]).collect();
    unsafe {
        let a = GetFileAttributesW(w.as_ptr());
        a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_HIDDEN != 0 || SetFileAttributesW(w.as_ptr(), a | FILE_ATTRIBUTE_HIDDEN) != 0)
    }
}

/// Choices made in the installer (theme, start with Windows), read once and then deleted so a
/// later change in Settings is never overridden. Values come from HKCU\Software\Skyport.
pub fn take_install_prefs() -> (Option<String>, Option<bool>) {
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let w = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let key = w(r"Software\Skyport");
    let read = |name: &str| -> Option<String> {
        let n = w(name);
        let mut buf = [0u16; 64];
        let mut len = (buf.len() * 2) as u32;
        let rc = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        if rc != 0 {
            return None;
        }
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), n.as_ptr()) };
        let chars = (len as usize / 2).saturating_sub(1);
        Some(String::from_utf16_lossy(&buf[..chars]).trim().to_ascii_lowercase())
    };
    let theme = read("InstallTheme").filter(|t| matches!(t.as_str(), "system" | "light" | "dark"));
    let autostart = read("InstallAutostart").and_then(|v| match v.as_str() { "1" | "true" | "yes" => Some(true), "0" | "false" | "no" => Some(false), _ => None });
    (theme, autostart)
}

/// MSI uninstall: remove what the Inno and NSIS uninstallers remove. The cache is kept, since it can
/// hold edits not yet uploaded and an MSI uninstall is often silent, so there is nobody to ask.
pub fn uninstall_cleanup() {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegDeleteTreeW, HKEY_CURRENT_USER};
    // quit a running SkyPort (its job object ends the mounts) so the database isn't held open
    let root = std::env::var_os("SystemRoot").map(std::path::PathBuf::from).unwrap_or(r"C:\Windows".into());
    let _ = std::process::Command::new(root.join(r"System32\taskkill.exe"))
        .args(["/F", "/T", "/IM", "skyport.exe", "/FI", &format!("PID ne {}", std::process::id())])
        .creation_flags(0x0800_0000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    std::thread::sleep(std::time::Duration::from_secs(1));
    // encrypted database, its DPAPI-wrapped key, logs, webview data
    for var in ["LOCALAPPDATA", "APPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            let _ = std::fs::remove_dir_all(std::path::Path::new(&base).join("app.skyport.desktop"));
        }
    }
    let w = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    unsafe {
        RegDeleteKeyValueW(HKEY_CURRENT_USER, w(r"Software\Microsoft\Windows\CurrentVersion\Run").as_ptr(), w("SkyPort").as_ptr());
        RegDeleteTreeW(HKEY_CURRENT_USER, w(r"Software\Skyport").as_ptr());
    }
}

/// File Explorer opens a folder, file or URL. Absolute path, so a planted explorer.exe is never used.
pub fn opener() -> std::process::Command {
    let root = std::env::var_os("SystemRoot").map(std::path::PathBuf::from).unwrap_or(r"C:\Windows".into());
    std::process::Command::new(root.join("explorer.exe"))
}

pub fn computer_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

pub fn user_name() -> String {
    std::env::var("USERNAME").unwrap_or_default()
}

/// WinFsp, the Windows filesystem driver rclone mounts through.
pub fn driver_installed() -> bool {
    // shortcut: checks the default install dir only; read HKLM\SOFTWARE\WOW6432Node\WinFsp if custom dirs show up.
    let base = std::env::var_os("ProgramFiles(x86)").map(std::path::PathBuf::from).unwrap_or(r"C:\Program Files (x86)".into());
    base.join(r"WinFsp\bin\winfsp-x64.dll").is_file()
}

/// Windows uses drive letters, not a mount folder.
pub fn mount_root() -> std::path::PathBuf {
    std::path::PathBuf::new()
}

fn dpapi(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
    let ok = unsafe {
        if protect {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        }
    };
    if ok == 0 {
        return Err("Windows couldn't unlock SkyPort's secure storage for this account.".into());
    }
    let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { windows_sys::Win32::Foundation::LocalFree(out.pbData as _) };
    Ok(v)
}

/// The vault's 256-bit key, wrapped with DPAPI (CurrentUser) so only this Windows account can unwrap it.
pub fn vault_key(dir: &std::path::Path) -> Result<[u8; 32], String> {
    let kf = dir.join("vault.key");
    if let Ok(wrapped) = std::fs::read(&kf) {
        return dpapi(&wrapped, false)?.try_into().map_err(|_| "Secure storage key is damaged.".to_string());
    }
    let key = crate::vault::random_bytes::<32>();
    std::fs::write(&kf, dpapi(&key, true)?).map_err(|e| e.to_string())?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    #[test]
    fn make_private_stops_inheriting_and_drops_other_users() {
        let dir = std::env::temp_dir().join(format!("skyport-acl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();
        assert!(super::make_private(&path));
        let out = std::process::Command::new("icacls").arg(&path).output().unwrap();
        let acl = String::from_utf8_lossy(&out.stdout).to_string();
        let folder_lines: Vec<&str> = acl.lines().take_while(|l| !l.trim().is_empty() && !l.starts_with("Successfully")).collect();
        assert!(folder_lines.iter().all(|l| !l.contains("(I)")), "folder still inherits: {acl}");
        assert!(!acl.contains("Authenticated Users") && !acl.contains("Everyone") && !acl.contains(r"BUILTIN\Users"), "{acl}");
        assert!(acl.contains(&std::env::var("USERNAME").unwrap()), "{acl}");
        let attrs = std::fs::metadata(&dir).unwrap();
        use std::os::windows::fs::MetadataExt;
        assert!(attrs.file_attributes() & 0x2 != 0, "cache folder should be hidden");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
