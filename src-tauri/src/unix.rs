//! macOS and Linux counterparts of the Windows helpers in win.rs. A drive is a folder under
//! ~/SkyPort instead of a drive letter; the vault key lives in the macOS Keychain or the Linux
//! Secret Service (falling back to a 0600 file when neither is available).
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
};

/// Unix has no drive letters.
pub fn used_letters() -> Vec<String> {
    vec![]
}

/// Where drives appear: ~/SkyPort/<drive name>.
pub fn mount_root() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/tmp".into()).join("SkyPort")
}

/// True when `target` is a mount point: it sits on a different device from its parent.
pub fn drive_ready(target: &str) -> bool {
    let p = Path::new(target);
    match (fs::metadata(p), p.parent().map(fs::metadata)) {
        (Ok(m), Some(Ok(parent))) => m.is_dir() && m.dev() != parent.dev(),
        _ => false,
    }
}

/// Mounting as root would put the drive where the signed-in user can't see it.
pub fn is_elevated() -> bool {
    unsafe { libc::geteuid() == 0 }
}

pub fn remember_cache_dir(_dir: &str) {}

/// No job objects on Unix; drives are unmounted when SkyPort quits normally.
pub struct Job;
impl Job {
    pub fn new() -> Self {
        Job
    }
    pub fn adopt(&self, _child: &std::process::Child) {}
}

/// Only this user may open the cache (it holds plain copies of cloud files).
pub fn make_private(dir: &str) -> bool {
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).is_ok()
}

pub fn take_install_prefs() -> (Option<String>, Option<bool>) {
    (None, None)
}

/// The file manager or browser opens a folder, file or URL.
pub fn opener() -> std::process::Command {
    std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" })
}

pub fn computer_name() -> String {
    let mut buf = [0u8; 256];
    if unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) } == 0 {
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        return String::from_utf8_lossy(&buf[..end]).into_owned();
    }
    String::new()
}

pub fn user_name() -> String {
    std::env::var("USER").unwrap_or_default()
}

/// The FUSE layer rclone mounts through: macFUSE or FUSE-T on macOS, FUSE on Linux.
pub fn driver_installed() -> bool {
    if cfg!(target_os = "macos") {
        Path::new("/Library/Filesystems/macfuse.fs").exists()
            || Path::new("/usr/local/lib/libfuse-t.dylib").exists()
            || Path::new("/opt/homebrew/lib/libfuse-t.dylib").exists()
    } else {
        Path::new("/dev/fuse").exists() && in_path("fusermount3").or_else(|| in_path("fusermount")).is_some()
    }
}

pub fn in_path(name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).filter(|d| d.is_absolute()).collect()).unwrap_or_default();
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

/// The vault's 256-bit key, kept by the OS keychain; created on first use.
pub fn vault_key(dir: &Path) -> Result<[u8; 32], String> {
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    let unhex = |s: &str| -> Option<[u8; 32]> {
        (s.len() == 64).then(|| ())?;
        let v: Option<Vec<u8>> = (0..32).map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()).collect();
        v?.try_into().ok()
    };
    if let Ok(entry) = keyring::Entry::new("SkyPort", "vault-key") {
        if let Ok(s) = entry.get_password() {
            return unhex(&s).ok_or_else(|| "Secure storage key is damaged.".to_string());
        }
        let key = crate::vault::random_bytes::<32>();
        if entry.set_password(&hex(&key)).is_ok() {
            return Ok(key);
        }
    }
    // No keychain (for example a headless Linux session): a file only this user can read.
    let kf = dir.join("vault.key");
    if let Ok(s) = fs::read_to_string(&kf) {
        return unhex(s.trim()).ok_or_else(|| "Secure storage key is damaged.".to_string());
    }
    let key = crate::vault::random_bytes::<32>();
    fs::write(&kf, hex(&key)).map_err(|e| e.to_string())?;
    fs::set_permissions(&kf, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_folder_is_owner_only() {
        let d = std::env::temp_dir().join(format!("skyport-priv-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        assert!(make_private(d.to_str().unwrap()));
        assert_eq!(fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_plain_folder_is_not_a_mount() {
        let d = std::env::temp_dir().join(format!("skyport-mnt-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        assert!(!drive_ready(d.to_str().unwrap()));
        fs::remove_dir_all(&d).unwrap();
        assert!(drive_ready("/proc") || drive_ready("/dev") || cfg!(target_os = "macos"));
    }
}
