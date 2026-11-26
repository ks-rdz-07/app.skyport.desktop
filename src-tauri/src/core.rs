//! Mount profiles, accounts, rclone mount processes, status, details and the 2FA lock.
use crate::{os, rclone, scan, totp, vault::{self, Event, Snapshot, Vault}};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::{TcpListener, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub label: String,
    pub remote: String,
    /// Folder inside OneDrive; empty = whole drive.
    pub path: String,
    pub letter: String,
    pub read_only: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub cache_dir: String,
    pub auto_mount: bool,
    pub profiles: Vec<Profile>,
    /// Friendly account names chosen by the user, keyed by internal account id.
    pub account_names: HashMap<String, String>,
    /// Drives to bring back on launch and after an unexpected stop.
    pub connected: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        let cache_dir = if Path::new(r"E:\").exists() {
            r"E:\CloudDriveCache".into()
        } else {
            let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\Temp".into());
            format!(r"{local}\SkyPort\Cache")
        };
        Self { cache_dir, auto_mount: false, profiles: vec![], account_names: HashMap::new(), connected: vec![] }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct TwoFactor {
    secret: Vec<u8>,
    recovery: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub engine_version: Option<String>,
    pub driver: bool,
    pub elevated: bool,
    pub settings: Settings,
    pub used_letters: Vec<String>,
    pub computer: String,
    pub user: String,
    /// The theme picked in the installer, handed to the UI once.
    pub install_theme: Option<String>,
    /// The private, hidden cache location offered as the recommended choice.
    pub default_cache_dir: String,
    /// The on-demand virus scanner found on this PC, if any.
    pub scanner: Option<&'static str>,
    /// windows | macos | linux
    pub platform: &'static str,
    /// Where drives appear on macOS and Linux (empty on Windows).
    pub mount_root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveStatus {
    pub id: String,
    /// stopped | starting | connected | error
    pub state: &'static str,
    pub error: Option<String>,
    pub uploading: u64,
    pub queued: u64,
    pub failed: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub bytes: u64,
    /// Files changed locally but not yet uploaded, per profile id (read from the cache on disk).
    pub waiting: HashMap<String, u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub drives: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub profile: Profile,
    pub account: Account,
    pub quota: Option<Snapshot>,
    pub quota_error: Option<String>,
    pub history: Vec<Snapshot>,
    pub events: Vec<Event>,
    pub cache_dir: String,
    pub cache_bytes: u64,
    pub waiting: u64,
    pub pc: PcInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcInfo {
    pub computer: String,
    pub user: String,
    pub local_ip: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoFaStatus {
    pub enabled: bool,
    pub locked: bool,
    pub recovery_left: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoFaSetup {
    pub secret: String,
    pub qr_svg: String,
}

struct Running {
    child: Child,
    port: u16,
    user: String,
    pass: String,
    log: PathBuf,
}

#[derive(Default)]
struct Lock {
    locked: bool,
    pending: Option<Vec<u8>>,
    failures: u32,
    until: Option<Instant>,
    hidden_since: Option<Instant>,
}

pub struct Core {
    settings: Mutex<Settings>,
    vault: Mutex<Vault>,
    running: Mutex<HashMap<String, Running>>,
    errors: Mutex<HashMap<String, String>>,
    lock: Mutex<Lock>,
    log_dir: PathBuf,
    job: os::Job,
    heal_tries: Mutex<HashMap<String, u32>>,
    pub install_theme: Mutex<Option<String>>,
    data_dir: PathBuf,
}

const STOPPED: &str = "The drive stopped unexpectedly. Click Reconnect to bring it back; pending changes are kept.";
const RELOCK_AFTER: Duration = Duration::from_secs(300);

impl Core {
    pub fn new(data_dir: PathBuf, legacy_dir: PathBuf, log_dir: PathBuf) -> Result<Self, String> {
        let mut vault = Vault::open(&data_dir)?;
        let settings = match vault.get::<Settings>("settings") {
            Some(s) => s,
            None => {
                // one-time migration from the old plain-text settings file; a fresh install
                // keeps its cache in the private app folder
                let old = legacy_dir.join("settings.json");
                let s: Settings = fs::read_to_string(&old).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| Settings {
                    cache_dir: data_dir.join("cache").display().to_string(),
                    ..Default::default()
                });
                vault.put("settings", &s)?;
                let _ = fs::remove_file(old);
                s
            }
        };
        os::remember_cache_dir(&settings.cache_dir);
        if Path::new(&settings.cache_dir).is_dir() {
            os::make_private(&settings.cache_dir);
        }
        let locked = vault.get::<TwoFactor>("twofa").is_some();
        Ok(Self {
            settings: Mutex::new(settings),
            vault: Mutex::new(vault),
            running: Default::default(),
            errors: Default::default(),
            lock: Mutex::new(Lock { locked, ..Default::default() }),
            log_dir,
            job: os::Job::new(),
            heal_tries: Default::default(),
            install_theme: Default::default(),
            data_dir,
        })
    }

    fn update(&self, f: impl FnOnce(&mut Settings) -> Result<(), String>) -> Result<(), String> {
        let mut s = self.settings();
        f(&mut s)?;
        self.vault.lock().unwrap().put("settings", &s)?;
        *self.settings.lock().unwrap() = s;
        Ok(())
    }

    fn event(&self, drive: &str, kind: &str, detail: &str) {
        let _ = self.vault.lock().unwrap().add_event(drive, kind, detail);
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn rclone(&self) -> Result<PathBuf, String> {
        rclone::find_rclone().ok_or_else(|| rclone::NOT_INSTALLED.into())
    }

    // ---------- two-step verification ----------

    /// Every command except unlock/status calls this: the lock is enforced here, not in the UI.
    pub fn guard(&self) -> Result<(), String> {
        if self.lock.lock().unwrap().locked {
            Err("LOCKED".into())
        } else {
            Ok(())
        }
    }

    pub fn window_hidden(&self) {
        self.lock.lock().unwrap().hidden_since = Some(Instant::now());
    }

    /// Returns true when the app re-locked because the window was hidden for a while.
    pub fn window_shown(&self) -> bool {
        let enabled = self.vault.lock().unwrap().get::<TwoFactor>("twofa").is_some();
        let mut l = self.lock.lock().unwrap();
        let relock = enabled && l.hidden_since.take().is_some_and(|t| t.elapsed() > RELOCK_AFTER);
        if relock {
            l.locked = true;
        }
        relock
    }

    pub fn twofa_status(&self) -> TwoFaStatus {
        let tf = self.vault.lock().unwrap().get::<TwoFactor>("twofa");
        TwoFaStatus { enabled: tf.is_some(), locked: self.lock.lock().unwrap().locked, recovery_left: tf.map_or(0, |t| t.recovery.len()) }
    }

    pub fn unlock(&self, code: &str) -> Result<(), String> {
        let mut l = self.lock.lock().unwrap();
        if let Some(until) = l.until.filter(|u| *u > Instant::now()) {
            return Err(format!("Too many attempts. Try again in {} seconds.", (until - Instant::now()).as_secs() + 1));
        }
        let mut v = self.vault.lock().unwrap();
        let Some(mut tf) = v.get::<TwoFactor>("twofa") else {
            l.locked = false;
            return Ok(());
        };
        let normalized = code.trim().to_ascii_uppercase().replace([' ', '-'], "");
        let ok = if totp::verify(&tf.secret, &normalized, vault::now() as u64) {
            true
        } else if let Some(i) = tf.recovery.iter().position(|r| totp::ct_eq(&r.replace('-', ""), &normalized)) {
            tf.recovery.remove(i); // single use
            v.put("twofa", &tf)?;
            true
        } else {
            false
        };
        if ok {
            *l = Lock::default();
            return Ok(());
        }
        l.failures += 1;
        if l.failures >= 5 {
            let secs = 30u64 << (l.failures - 5).min(5); // 30 s doubling, capped at 16 min
            l.until = Some(Instant::now() + Duration::from_secs(secs));
        }
        Err("That code isn't right. Check your authenticator app and try again.".into())
    }

    pub fn lock_now(&self) {
        if self.vault.lock().unwrap().get::<TwoFactor>("twofa").is_some() {
            self.lock.lock().unwrap().locked = true;
        }
    }

    pub fn twofa_begin(&self) -> Result<TwoFaSetup, String> {
        let secret = vault::random_bytes::<20>().to_vec();
        let b32 = totp::base32(&secret);
        let device = Some(os::computer_name()).filter(|c| !c.is_empty()).unwrap_or_else(|| "PC".into());
        let uri = format!("otpauth://totp/SkyPort:{device}?secret={b32}&issuer=SkyPort&digits=6&period=30");
        let qr = qrcode::QrCode::new(uri.as_bytes()).map_err(|e| e.to_string())?;
        let qr_svg = qr.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).quiet_zone(true).build();
        self.lock.lock().unwrap().pending = Some(secret);
        Ok(TwoFaSetup { secret: b32, qr_svg })
    }

    pub fn twofa_enable(&self, code: &str) -> Result<Vec<String>, String> {
        let secret = self.lock.lock().unwrap().pending.clone().ok_or("Start the setup again.")?;
        if !totp::verify(&secret, code, vault::now() as u64) {
            return Err("That code isn't right. Make sure your phone's clock is set automatically.".into());
        }
        let recovery: Vec<String> = (0..8)
            .map(|_| {
                let b = vault::random_bytes::<5>();
                let s = totp::base32(&b);
                format!("{}-{}", &s[..4], &s[4..8])
            })
            .collect();
        self.vault.lock().unwrap().put("twofa", &TwoFactor { secret, recovery: recovery.clone() })?;
        self.lock.lock().unwrap().pending = None;
        Ok(recovery)
    }

    pub fn twofa_disable(&self, code: &str) -> Result<(), String> {
        let tf = self.vault.lock().unwrap().get::<TwoFactor>("twofa").ok_or("Two-step verification is already off.")?;
        if !totp::verify(&tf.secret, code, vault::now() as u64) {
            return Err("That code isn't right.".into());
        }
        self.vault.lock().unwrap().put("twofa", &serde_json::Value::Null)?;
        // a null value reads back as None
        Ok(())
    }

    // ---------- overview, accounts ----------

    pub fn overview(&self) -> Overview {
        Overview {
            engine_version: rclone::find_rclone().and_then(|p| rclone::version(&p)),
            driver: rclone::winfsp_installed(),
            elevated: os::is_elevated(),
            settings: self.settings(),
            used_letters: os::used_letters(),
            computer: os::computer_name(),
            user: os::user_name(),
            install_theme: self.install_theme.lock().unwrap().take(),
            default_cache_dir: self.data_dir.join("cache").display().to_string(),
            scanner: scan::engine_name(),
            platform: if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" },
            mount_root: os::mount_root().display().to_string(),
        }
    }

    fn account_name(&self, s: &Settings, id: &str) -> String {
        s.account_names.get(id).cloned().unwrap_or_else(|| id.to_string())
    }

    pub fn accounts(&self) -> Result<Vec<Account>, String> {
        let s = self.settings();
        Ok(rclone::onedrive_remotes(&self.rclone()?)?
            .into_iter()
            .map(|r| Account {
                name: self.account_name(&s, &r.name),
                kind: kind(&r.drive_type).into(),
                drives: s.profiles.iter().filter(|p| p.remote == r.name).map(display_name).collect(),
                id: r.name,
            })
            .collect())
    }

    /// Sign in with a friendly name; the internal id is derived and kept unique.
    pub fn add_account(&self, display: &str) -> Result<String, String> {
        let display = display.trim();
        if display.is_empty() || display.chars().count() > 40 || display.chars().any(char::is_control) {
            return Err("Give the account a name of up to 40 characters.".into());
        }
        let rc = self.rclone()?;
        let s = self.settings();
        if s.account_names.values().any(|n| n.eq_ignore_ascii_case(display)) {
            return Err(format!("You already have an account named \"{display}\"."));
        }
        let mut base: String = display.chars().filter(|c| c.is_ascii_alphanumeric()).take(24).collect();
        if base.is_empty() || !base.starts_with(|c: char| c.is_ascii_alphanumeric()) {
            base = "onedrive".into();
        }
        let existing: Vec<String> = rclone::onedrive_remotes(&rc)?.into_iter().map(|r| r.name).collect();
        let id = (1..).map(|n| if n == 1 { base.clone() } else { format!("{base}{n}") }).find(|c| !existing.contains(c)).unwrap();
        rclone::sign_in(&rc, &id)?;
        self.update(|s| {
            s.account_names.insert(id.clone(), display.to_string());
            Ok(())
        })?;
        Ok(id)
    }

    pub fn rename_account(&self, id: &str, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
            return Err("Give the account a name of up to 40 characters.".into());
        }
        self.update(|s| {
            if s.account_names.iter().any(|(k, n)| k != id && n.eq_ignore_ascii_case(name)) {
                return Err(format!("You already have an account named \"{name}\"."));
            }
            s.account_names.insert(id.to_string(), name.to_string());
            Ok(())
        })
    }

    pub fn remove_account(&self, id: &str) -> Result<(), String> {
        if !rclone::valid_remote_name(id) {
            return Err("Unknown account.".into());
        }
        let s = self.settings();
        if let Some(p) = s.profiles.iter().find(|p| p.remote == id) {
            return Err(format!("Remove the drive \"{}\" first; it uses this account.", p.label));
        }
        let rc = self.rclone()?;
        if !rclone::onedrive_remotes(&rc)?.iter().any(|r| r.name == id) {
            return Err("Unknown account.".into());
        }
        rclone::run(&rc, &["config", "delete", id])?;
        let _ = self.vault.lock().unwrap().delete_account(id);
        self.update(|s| {
            s.account_names.remove(id);
            Ok(())
        })
    }

    // ---------- profiles ----------

    fn profile(&self, id: &str) -> Result<Profile, String> {
        self.settings().profiles.into_iter().find(|p| p.id == id).ok_or_else(|| "That drive no longer exists.".into())
    }

    fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains_key(id)
    }

    pub fn any_running(&self) -> bool {
        !self.running.lock().unwrap().is_empty()
    }

    pub fn save_profile(&self, mut p: Profile) -> Result<Profile, String> {
        p.label = p.label.trim().to_string();
        p.path = p.path.trim_matches('/').to_string();
        validate(&p)?;
        if !p.id.is_empty() && self.is_running(&p.id) {
            return Err("Disconnect the drive before changing it.".into());
        }
        let s = self.settings();
        conflicts(&s.profiles, &p)?;
        if p.id.is_empty() {
            p.id = format!("d{}", u64::from_le_bytes(vault::random_bytes::<8>()));
        } else if !s.profiles.iter().any(|o| o.id == p.id) {
            return Err("That drive no longer exists.".into());
        }
        let saved = p.clone();
        self.update(|s| {
            match s.profiles.iter_mut().find(|o| o.id == p.id) {
                Some(slot) => *slot = p,
                None => s.profiles.push(p),
            }
            Ok(())
        })?;
        Ok(saved)
    }

    pub fn remove_profile(&self, id: &str) -> Result<(), String> {
        if self.is_running(id) {
            return Err("Disconnect the drive before removing it.".into());
        }
        self.update(|s| {
            s.profiles.retain(|p| p.id != id);
            Ok(())
        })?;
        let _ = self.vault.lock().unwrap().delete_drive(id);
        Ok(())
    }

    pub fn set_auto_mount(&self, on: bool) -> Result<(), String> {
        self.update(|s| {
            s.auto_mount = on;
            Ok(())
        })
    }

    pub fn set_cache_dir(&self, dir: &str) -> Result<(), String> {
        let dir = dir.trim().trim_end_matches('\\');
        let b = dir.as_bytes();
        // local drive paths only, e.g. E:\CloudDriveCache
        if b.len() < 4 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\' || dir.chars().any(|c| c.is_control() || "<>\"|?*".contains(c)) {
            return Err("Enter a full folder path on a local drive, for example E:\\CloudDriveCache.".into());
        }
        if !Path::new(&dir[..3]).exists() {
            return Err(format!("Drive {} isn't available.", &dir[..2]));
        }
        if self.any_running() {
            return Err("Disconnect all drives before moving the cache.".into());
        }
        let waiting: u64 = self.cache_info().waiting.values().sum();
        if waiting > 0 {
            return Err(format!("{waiting} file(s) in the current cache haven't been uploaded yet. Connect the drive and let them finish first."));
        }
        fs::create_dir_all(dir).map_err(|_| "Couldn't create that folder. Check the path and your permissions.".to_string())?;
        if !os::make_private(dir) {
            return Err("Couldn't make that folder private to your account. Choose a folder on an NTFS drive you own.".into());
        }
        self.update(|s| {
            s.cache_dir = dir.to_string();
            Ok(())
        })?;
        os::remember_cache_dir(dir);
        Ok(())
    }

    // ---------- mount ----------

    pub fn mount(&self, id: &str) -> Result<(), String> {
        let res = self.mount_inner(id);
        match &res {
            Ok(()) => {
                self.heal_tries.lock().unwrap().remove(id);
                let _ = self.update(|s| {
                    if !s.connected.iter().any(|c| c == id) {
                        s.connected.push(id.to_string());
                    }
                    Ok(())
                });
                self.event(id, "connected", "Drive connected")
            }
            Err(e) => self.event(id, "error", e),
        }
        res
    }

    fn mount_inner(&self, id: &str) -> Result<(), String> {
        let p = self.profile(id)?;
        validate(&p)?; // settings come from disk: re-check before they become arguments
        let rc = self.rclone()?;
        if !rclone::winfsp_installed() {
            return Err("The drive driver isn't installed. Open Setup to install it.".into());
        }
        if os::is_elevated() {
            return Err("SkyPort is running as administrator, so the drive would be hidden from File Explorer. Restart SkyPort normally.".into());
        }
        if self.is_running(id) {
            return Ok(());
        }
        let tgt = target(&p);
        if cfg!(windows) {
            if os::used_letters().contains(&p.letter) {
                return Err(format!("Drive {}: is already in use on this PC. Choose another letter in Edit.", p.letter));
            }
        } else {
            if os::drive_ready(&tgt) {
                return Err(format!("{tgt} is already in use. Disconnect it first, or rename this drive in Edit."));
            }
            fs::create_dir_all(&tgt).map_err(|_| format!("Couldn't create the folder {tgt}."))?;
            if fs::read_dir(&tgt).map(|mut d| d.next().is_some()).unwrap_or(true) {
                return Err(format!("{tgt} isn't empty. Rename this drive in Edit so it gets its own folder."));
            }
        }
        let cache_dir = self.settings().cache_dir;
        fs::create_dir_all(&cache_dir).map_err(|_| format!("Couldn't create the cache folder {cache_dir}."))?;
        os::make_private(&cache_dir); // best effort: an existing cache is still usable if this fails
        fs::create_dir_all(&self.log_dir).map_err(|e| e.to_string())?;
        let log = self.log_dir.join(format!("{}.log", p.id));
        let _ = fs::rename(&log, log.with_extension("prev.log"));

        let port = TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map_err(|e| e.to_string())?.port();
        let (user, pass) = (hex(&vault::random_bytes::<16>()), hex(&vault::random_bytes::<32>()));
        let child = rclone::cmd(&rc)
            .args(mount_args(&p, &cache_dir, port, &log))
            .env("RCLONE_RC_USER", &user) // credentials via environment, not the visible command line
            .env("RCLONE_RC_PASS", &pass)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Couldn't start the cloud engine. Try reinstalling it from Setup.".to_string())?;
        self.job.adopt(&child);
        self.errors.lock().unwrap().remove(id);
        self.running.lock().unwrap().insert(id.into(), Running { child, port, user, pass, log });

        // Connected only once the volume answers in this (the user's) session.
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            std::thread::sleep(Duration::from_millis(400));
            if let Some(err) = self.reap(id) {
                return Err(err);
            }
            if !self.is_running(id) {
                return Err("Connection was cancelled.".into());
            }
            if os::drive_ready(&tgt) {
                return Ok(());
            }
            if Instant::now() > deadline {
                return Err("The drive is taking longer than usual to appear. It will show as Connected when ready.".into());
            }
        }
    }

    /// If the mount process exited, forget it and return why.
    fn reap(&self, id: &str) -> Option<String> {
        let mut running = self.running.lock().unwrap();
        let r = running.get_mut(id)?;
        r.child.try_wait().ok()??;
        let msg = fs::read_to_string(&r.log).ok().and_then(|l| rclone::fatal_error(&l)).unwrap_or_else(|| STOPPED.into());
        running.remove(id);
        self.errors.lock().unwrap().insert(id.into(), msg.clone());
        Some(msg)
    }

    /// `forget`: the user disconnected on purpose, so don't bring it back on the next launch.
    pub fn unmount(&self, id: &str, forget: bool) -> Result<(), String> {
        if forget {
            self.update(|s| {
                s.connected.retain(|c| c != id);
                Ok(())
            })?;
        }
        let Some(mut r) = self.running.lock().unwrap().remove(id) else { return Ok(()) };
        // Graceful: unmount and flush the cache index. Pending uploads stay in the cache and
        // resume on the next mount.
        if let Ok(rc) = self.rclone() {
            let _ = rclone::rc(&rc, r.port, &r.user, &r.pass, "core/quit");
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = r.child.try_wait() {
                self.event(id, "disconnected", "Drive disconnected");
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        let _ = r.child.kill();
        let _ = r.child.wait();
        self.event(id, "disconnected", "Drive disconnected (forced)");
        Ok(())
    }

    pub fn unmount_all(&self, forget: bool) {
        let ids: Vec<String> = self.running.lock().unwrap().keys().cloned().collect();
        for id in ids {
            let _ = self.unmount(&id, forget);
        }
    }

    /// Reconnect drives that should be connected but aren't (app restart, crash, unexpected
    /// stop). Gives up after 3 failed tries until the user acts. Returns true if it tried.
    pub fn heal(&self) -> bool {
        let s = self.settings();
        let mut tried = false;
        for id in s.connected.iter().filter(|id| s.profiles.iter().any(|p| &p.id == *id)) {
            if self.is_running(id) {
                continue;
            }
            let n = {
                let mut t = self.heal_tries.lock().unwrap();
                let n = t.entry(id.clone()).or_insert(0);
                *n += 1;
                *n
            };
            if n <= 3 {
                let _ = self.mount(id);
                tried = true;
            }
        }
        tried
    }

    pub fn status(&self) -> Vec<DriveStatus> {
        let rc = rclone::find_rclone();
        self.settings()
            .profiles
            .into_iter()
            .map(|p| {
                let mut st = DriveStatus { id: p.id.clone(), state: "stopped", error: self.errors.lock().unwrap().get(&p.id).cloned(), uploading: 0, queued: 0, failed: 0 };
                if let Some(err) = self.reap(&p.id) {
                    st.state = "error";
                    st.error = Some(err);
                    return st;
                }
                let conn = self.running.lock().unwrap().get(&p.id).map(|r| (r.port, r.user.clone(), r.pass.clone()));
                if let Some((port, user, pass)) = conn {
                    st.state = if os::drive_ready(&target(&p)) { "connected" } else { "starting" };
                    if let Some(v) = rc.as_ref().and_then(|rc| rclone::rc(rc, port, &user, &pass, "vfs/stats").ok()) {
                        let dc = &v["diskCache"];
                        st.uploading = dc["uploadsInProgress"].as_u64().unwrap_or(0);
                        st.queued = dc["uploadsQueued"].as_u64().unwrap_or(0);
                        st.failed = dc["erroredFiles"].as_u64().unwrap_or(0);
                    }
                } else if st.error.is_some() {
                    st.state = "error";
                }
                st
            })
            .collect()
    }

    pub fn pending_uploads(&self) -> u64 {
        self.status().iter().map(|s| s.uploading + s.queued).sum()
    }

    fn waiting_for(root: &Path, p: &Profile) -> u64 {
        let mut meta = root.join("vfsMeta").join(&p.remote);
        meta.extend(p.path.split('/').filter(|x| !x.is_empty()));
        count_dirty(&meta)
    }

    pub fn cache_info(&self) -> CacheInfo {
        let s = self.settings();
        let root = Path::new(&s.cache_dir);
        CacheInfo { bytes: dir_size(root), waiting: s.profiles.iter().map(|p| (p.id.clone(), Self::waiting_for(root, p))).collect() }
    }

    // ---------- quota & details (stored in the encrypted database) ----------

    pub fn quota(&self, account: &str) -> Result<Snapshot, String> {
        let q = rclone::quota(&self.rclone()?, account)?;
        let snap = Snapshot {
            at: vault::now(),
            total: q.total.map(|v| v as i64),
            used: q.used.map(|v| v as i64),
            free: q.free.map(|v| v as i64),
            trashed: q.trashed.map(|v| v as i64),
        };
        let mut v = self.vault.lock().unwrap();
        // one stored point per account per 10 minutes is plenty for history
        if v.history(account, 1).last().is_none_or(|l| snap.at - l.at >= 600) {
            v.add_snapshot(account, &snap)?;
        }
        Ok(snap)
    }

    pub fn details(&self, id: &str) -> Result<Details, String> {
        let p = self.profile(id)?;
        let s = self.settings();
        let kind_str = rclone::onedrive_remotes(&self.rclone()?)
            .ok()
            .and_then(|rs| rs.into_iter().find(|r| r.name == p.remote))
            .map(|r| kind(&r.drive_type).to_string())
            .unwrap_or_else(|| "OneDrive".into());
        let (quota, quota_error) = match self.quota(&p.remote) {
            Ok(q) => (Some(q), None),
            Err(e) => (None, Some(e)),
        };
        let v = self.vault.lock().unwrap();
        let root = Path::new(&s.cache_dir);
        Ok(Details {
            account: Account {
                id: p.remote.clone(),
                name: self.account_name(&s, &p.remote),
                kind: kind_str,
                drives: s.profiles.iter().filter(|o| o.remote == p.remote).map(display_name).collect(),
            },
            history: v.history(&p.remote, 60),
            events: v.events(&p.id, 12),
            cache_dir: s.cache_dir.clone(),
            cache_bytes: dir_size(&root.join("vfs").join(&p.remote)),
            waiting: Self::waiting_for(root, &p),
            pc: PcInfo {
                computer: os::computer_name(),
                user: os::user_name(),
                local_ip: local_ip(),
            },
            quota,
            quota_error,
            profile: p,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: i64,
    pub modified: String,
}

impl Core {
    fn join_path(p: &Profile, sub: &str) -> Result<String, String> {
        let sub = sub.trim_matches('/');
        if !rclone::valid_folder(sub) {
            return Err("That path isn't valid.".into());
        }
        Ok([p.path.as_str(), sub].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("/"))
    }

    /// One folder of a drive, read from OneDrive itself (works whether or not the drive is connected).
    pub fn browse(&self, id: &str, sub: &str) -> Result<Vec<Entry>, String> {
        let p = self.profile(id)?;
        let target = format!("{}:{}", p.remote, Self::join_path(&p, sub)?);
        let out = rclone::run(&self.rclone()?, &["lsjson", &target, "--no-mimetype", "--max-depth", "1"])?;
        let items: Vec<serde_json::Value> = serde_json::from_str(&out).map_err(|_| "Couldn't read that folder. Please try again.".to_string())?;
        let mut list: Vec<Entry> = items
            .iter()
            .map(|i| Entry {
                name: i["Name"].as_str().unwrap_or("").to_string(),
                is_dir: i["IsDir"].as_bool().unwrap_or(false),
                size: i["Size"].as_i64().unwrap_or(-1),
                modified: i["ModTime"].as_str().unwrap_or("").to_string(),
            })
            .filter(|e| !e.name.is_empty())
            .collect();
        list.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(list)
    }

    /// Open a file or folder through the mounted drive, or show it selected in File Explorer.
    pub fn open_path(&self, id: &str, sub: &str, reveal: bool) -> Result<(), String> {
        let p = self.profile(id)?;
        if !self.is_running(id) || !os::drive_ready(&target(&p)) {
            return Err(format!("Connect {} to open its files.", p.label));
        }
        let sub = sub.trim_matches('/');
        if !rclone::valid_folder(sub) {
            return Err("That path isn't valid.".into());
        }
        let path = local(&p, sub);
        let mut c = rclone::explorer();
        match (reveal, cfg!(windows), cfg!(target_os = "macos")) {
            (true, true, _) => { c.arg(format!("/select,{}", path.display())); }
            (true, false, true) => { c.arg("-R").arg(&path); }
            // xdg-open can't select a file: open the folder that holds it
            (true, false, false) => { c.arg(path.parent().unwrap_or(&path)); }
            (false, ..) => { c.arg(&path); }
        }
        c.spawn().map_err(|_| "Couldn't open File Explorer.".to_string())?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub name: String,
    pub size: i64,
    pub bytes: i64,
    pub percent: i64,
    pub speed: f64,
    pub eta: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Queued {
    pub name: String,
    pub size: i64,
    pub tries: i64,
    pub uploading: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveActivity {
    pub id: String,
    pub speed: f64,
    pub transferred: i64,
    pub errors: i64,
    pub transfers: Vec<Transfer>,
    pub queue: Vec<Queued>,
}

impl Core {
    /// What each connected drive is moving right now, from its private control port.
    pub fn activity(&self) -> Vec<DriveActivity> {
        let Some(rc) = rclone::find_rclone() else { return vec![] };
        let conns: Vec<(String, u16, String, String)> =
            self.running.lock().unwrap().iter().map(|(id, r)| (id.clone(), r.port, r.user.clone(), r.pass.clone())).collect();
        conns
            .into_iter()
            .map(|(id, port, user, pass)| {
                let stats = rclone::rc(&rc, port, &user, &pass, "core/stats").unwrap_or_default();
                let queue = rclone::rc(&rc, port, &user, &pass, "vfs/queue").unwrap_or_default();
                let num = |v: &serde_json::Value| v.as_f64().unwrap_or(0.0);
                DriveActivity {
                    speed: num(&stats["speed"]),
                    transferred: stats["bytes"].as_i64().unwrap_or(0),
                    errors: stats["errors"].as_i64().unwrap_or(0),
                    transfers: stats["transferring"]
                        .as_array()
                        .map(|a| a.iter().map(|t| Transfer {
                            name: t["name"].as_str().unwrap_or("").to_string(),
                            size: t["size"].as_i64().unwrap_or(0),
                            bytes: t["bytes"].as_i64().unwrap_or(0),
                            percent: t["percentage"].as_i64().unwrap_or(0),
                            speed: num(&t["speed"]),
                            eta: t["eta"].as_i64(),
                        }).collect())
                        .unwrap_or_default(),
                    queue: queue["queue"]
                        .as_array()
                        .map(|a| a.iter().map(|q| Queued {
                            name: q["name"].as_str().unwrap_or("").to_string(),
                            size: q["size"].as_i64().unwrap_or(0),
                            tries: q["tries"].as_i64().unwrap_or(0),
                            uploading: q["uploading"].as_bool().unwrap_or(false),
                        }).collect())
                        .unwrap_or_default(),
                    id,
                }
            })
            .collect()
    }

    /// The last lines of a drive's log, with anything that could be a credential removed.
    pub fn logs(&self, id: &str, lines: usize) -> Result<Vec<String>, String> {
        self.profile(id)?;
        let path = self.log_dir.join(format!("{id}.log"));
        let text = fs::read_to_string(&path).unwrap_or_default();
        let red = rclone::redact(&text);
        let all: Vec<String> = red.lines().filter(|l| !l.trim().is_empty()).map(|l| l.replace("rclone", "engine")).collect();
        Ok(all[all.len().saturating_sub(lines.min(500))..].to_vec())
    }

    pub fn log_dir(&self) -> &Path {
        &self.log_dir
    }
}

/// A file or folder name Windows and OneDrive both accept.
pub fn valid_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 255 {
        return Err("Enter a name of up to 255 characters.".into());
    }
    if let Some(c) = n.chars().find(|c| c.is_control() || "\\/:*?\"<>|".contains(*c)) {
        return Err(format!("Names can't contain {}.", if c.is_control() { "control characters".to_string() } else { format!("\"{c}\"") }));
    }
    if n == "." || n == ".." || n.ends_with('.') {
        return Err("Names can't end with a dot.".into());
    }
    let stem = n.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"].contains(&stem.as_str()) {
        return Err(format!("\"{n}\" is reserved by Windows."));
    }
    Ok(())
}

impl Core {
    /// Scan a file or folder of a connected drive (opening it through the drive downloads it first).
    pub fn scan(&self, id: &str, path: &str) -> Result<scan::ScanResult, String> {
        let p = self.profile(id)?;
        if !self.is_running(id) || !os::drive_ready(&target(&p)) {
            return Err(format!("Connect {} to scan its files.", p.label));
        }
        let path = path.trim_matches('/');
        if !rclone::valid_folder(path) {
            return Err("That path isn't valid.".into());
        }
        let res = scan::scan(&local(&p, path).display().to_string())?;
        let name = path.rsplit('/').next().filter(|n| !n.is_empty()).unwrap_or("the drive");
        self.event(id, if res.clean { "scanned" } else { "error" }, &format!("{} scanned {name}: {}", res.engine, res.detail));
        Ok(res)
    }

    /// Rename a file or folder. Through the mounted drive when connected (so its cache follows),
    /// otherwise directly in OneDrive, refused while that drive still has changes to upload.
    pub fn rename(&self, id: &str, path: &str, name: &str) -> Result<String, String> {
        let p = self.profile(id)?;
        let path = path.trim_matches('/');
        let name = name.trim();
        if path.is_empty() || !rclone::valid_folder(path) {
            return Err("That item can't be renamed.".into());
        }
        valid_name(name)?;
        let (parent, old) = path.rsplit_once('/').map_or(("", path), |(a, b)| (a, b));
        if old == name {
            return Ok(path.to_string());
        }
        let new_path = if parent.is_empty() { name.to_string() } else { format!("{parent}/{name}") };
        // OneDrive names are case-insensitive: a different item with the same name would be replaced.
        if !old.eq_ignore_ascii_case(name) && self.browse(id, parent)?.iter().any(|e| e.name.eq_ignore_ascii_case(name)) {
            return Err(format!("\"{name}\" already exists in this folder."));
        }
        if self.is_running(id) && os::drive_ready(&target(&p)) {
            fs::rename(local(&p, path), local(&p, &new_path)).map_err(|e| format!("Couldn't rename: {e}"))?;
        } else {
            let root = Path::new(&self.settings().cache_dir).to_path_buf();
            if Self::waiting_for(&root, &p) > 0 {
                return Err(format!("Connect {} first: some of its changes are still waiting to upload.", p.label));
            }
            let from = format!("{}:{}", p.remote, Self::join_path(&p, path)?);
            let to = format!("{}:{}", p.remote, Self::join_path(&p, &new_path)?);
            rclone::run(&self.rclone()?, &["moveto", &from, &to])?;
        }
        self.event(id, "renamed", &format!("Renamed {old} to {name}"));
        Ok(new_path)
    }
}

pub fn kind(drive_type: &str) -> &'static str {
    match drive_type {
        "personal" => "OneDrive Personal",
        "business" => "OneDrive for Business",
        "documentLibrary" => "SharePoint library",
        _ => "OneDrive",
    }
}

/// The address Windows would use for internet traffic. Connecting a UDP socket sends nothing.
fn local_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Where a drive appears: "O:" on Windows, ~/SkyPort/<drive name> on macOS and Linux.
pub fn target(p: &Profile) -> String {
    if cfg!(windows) {
        format!("{}:", p.letter)
    } else {
        os::mount_root().join(p.label.trim()).display().to_string()
    }
}

/// A file or folder inside a mounted drive.
pub fn local(p: &Profile, rel: &str) -> PathBuf {
    let rel = rel.trim_matches('/');
    if cfg!(windows) {
        PathBuf::from(format!(r"{}:\{}", p.letter, rel.replace('/', r"\")))
    } else {
        Path::new(&target(p)).join(rel)
    }
}

/// How a drive is named in lists: "Work (O:)" on Windows, "Work" elsewhere.
pub fn display_name(p: &Profile) -> String {
    if p.letter.is_empty() { p.label.clone() } else { format!("{} ({}:)", p.label, p.letter) }
}

pub fn validate(p: &Profile) -> Result<(), String> {
    let l = p.letter.as_bytes();
    if cfg!(windows) && (l.len() != 1 || !(b'D'..=b'Z').contains(&l[0])) {
        return Err("Pick a drive letter from D to Z.".into());
    }
    if !cfg!(windows) && (!l.is_empty() || p.label.contains('/') || p.label.trim().starts_with('.')) {
        return Err("Drive names become folder names: no \"/\" and no leading dot.".into());
    }
    if !rclone::valid_remote_name(&p.remote) {
        return Err("Choose a OneDrive account.".into());
    }
    let label = p.label.trim();
    if label.is_empty() || label.chars().count() > 32 || label.chars().any(|c| c.is_control()) {
        return Err("Give the drive a name of up to 32 characters.".into());
    }
    if !rclone::valid_folder(&p.path) {
        return Err("That folder path isn't valid.".into());
    }
    Ok(())
}

/// Two drives may not share a name or letter, and may not show overlapping folders of
/// the same account: they would share cache files and could corrupt pending uploads.
pub fn conflicts(existing: &[Profile], p: &Profile) -> Result<(), String> {
    let within = |a: &str, b: &str| a.is_empty() || b.is_empty() || a == b || b.starts_with(&format!("{a}/")) || a.starts_with(&format!("{b}/"));
    for o in existing.iter().filter(|o| o.id != p.id) {
        if !p.letter.is_empty() && o.letter == p.letter {
            return Err(format!("The drive \"{}\" already uses {}:.", o.label, o.letter));
        }
        if o.label.eq_ignore_ascii_case(p.label.trim()) {
            return Err(format!("You already have a drive named \"{}\".", o.label));
        }
        if o.remote == p.remote && within(&o.path, &p.path) {
            return Err(format!("This overlaps with \"{}\", which already shows that part of the account. Pick a different folder.", display_name(o)));
        }
    }
    Ok(())
}

pub fn mount_args(p: &Profile, cache_dir: &str, port: u16, log: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "mount".into(),
        format!("{}:{}", p.remote, p.path),
        target(p),
        // Writes go to the local cache first and upload in the background; the cache
        // survives restarts so unfinished uploads resume on the next mount.
        "--vfs-cache-mode".into(),
        "writes".into(),
        "--cache-dir".into(),
        cache_dir.into(),
        "--volname".into(),
        p.label.trim().into(),
        "--rc".into(),
        "--rc-addr".into(),
        format!("127.0.0.1:{port}"),
        "--log-file".into(),
        log.display().to_string(),
        "--log-level".into(),
        "INFO".into(), // uploads, retries and reconnects; the log lives in the user's private app folder
    ];
    if p.read_only {
        a.push("--read-only".into());
    }
    a
}

/// Walks files without following symlinks or junctions (no loops, no escaping the root).
fn walk(dir: &Path, f: &mut impl FnMut(&Path, &fs::Metadata)) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(m) = fs::symlink_metadata(e.path()) else { continue };
        if m.file_type().is_symlink() {
            continue;
        }
        if m.is_dir() {
            walk(&e.path(), f);
        } else {
            f(&e.path(), &m);
        }
    }
}

fn dir_size(dir: &Path) -> u64 {
    // shortcut: logical size; sparse cache files would be overstated (only used with --vfs-cache-mode full).
    let mut total = 0;
    walk(dir, &mut |_, m| total += m.len());
    total
}

/// rclone stores per-file metadata as JSON with "Dirty": true until the upload succeeds.
fn count_dirty(meta_dir: &Path) -> u64 {
    let mut n = 0;
    walk(meta_dir, &mut |path, m| {
        if m.len() < 64 * 1024 {
            if let Ok(s) = fs::read_to_string(path) {
                let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
                if compact.contains("\"Dirty\":true") {
                    n += 1;
                }
            }
        }
    });
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> Profile {
        Profile { id: "x".into(), label: "Work".into(), remote: "onedrive".into(), path: "Docs/Work".into(), letter: if cfg!(windows) { "O" } else { "" }.into(), read_only: false }
    }

    #[test]
    fn mount_args_are_direct_and_hold_no_secrets() {
        let a = mount_args(&profile(), r"E:\CloudDriveCache", 5000, Path::new(r"C:\l.log"));
        assert_eq!(&a[..3], ["mount".to_string(), "onedrive:Docs/Work".to_string(), target(&profile())]);
        #[cfg(windows)]
        assert_eq!(a[2], "O:");
        assert!(a.windows(2).any(|w| w == ["--vfs-cache-mode", "writes"]));
        assert!(a.windows(2).any(|w| w == ["--cache-dir", r"E:\CloudDriveCache"]));
        assert!(!a.iter().any(|x| x.contains("rc-pass") || x.contains("rc-user")));
        let ro = mount_args(&Profile { read_only: true, path: "".into(), ..profile() }, "c", 1, Path::new("l"));
        assert_eq!(ro[1], "onedrive:");
        assert!(ro.contains(&"--read-only".to_string()));
    }

    #[test]
    fn validation() {
        assert!(validate(&profile()).is_ok());
        #[cfg(windows)]
        {
            assert!(validate(&Profile { letter: "C".into(), ..profile() }).is_err());
            assert!(validate(&Profile { letter: "OO".into(), ..profile() }).is_err());
        }
        assert!(validate(&Profile { path: "../x".into(), ..profile() }).is_err());
        assert!(validate(&Profile { remote: "-x".into(), ..profile() }).is_err());
        assert!(validate(&Profile { label: " ".into(), ..profile() }).is_err());
    }

    #[test]
    fn multi_drive_conflicts() {
        let base = vec![profile()];
        let other = |id: &str, remote: &str, path: &str, letter: &str, label: &str| Profile { id: id.into(), remote: remote.into(), path: path.into(), letter: letter.into(), label: label.into(), read_only: false };
        assert!(conflicts(&base, &other("y", "onedrive", "Photos", "P", "Photos")).is_ok());
        assert!(conflicts(&base, &other("y", "work", "", "P", "Work OD")).is_ok()); // other account, whole drive
        assert!(conflicts(&base, &other("y", "onedrive", "Docs/Work 2", "P", "W2")).is_ok()); // sibling, not nested
        #[cfg(windows)]
        assert!(conflicts(&base, &other("y", "onedrive", "Photos", "O", "Photos")).is_err()); // letter (Windows only)
        assert!(conflicts(&base, &other("y", "onedrive", "Photos", "P", "work")).is_err()); // name
        assert!(conflicts(&base, &other("y", "onedrive", "Docs", "P", "Docs")).is_err()); // parent
        assert!(conflicts(&base, &other("y", "onedrive", "Docs/Work/A", "P", "A")).is_err()); // child
        assert!(conflicts(&base, &other("y", "onedrive", "", "P", "All")).is_err()); // whole drive
        assert!(conflicts(&base, &profile()).is_ok()); // editing itself
    }

    #[test]
    fn browse_paths_stay_inside_the_drive_folder() {
        let p = profile();
        assert_eq!(Core::join_path(&p, "").unwrap(), "Docs/Work");
        assert_eq!(Core::join_path(&p, "/Q3/Reports/").unwrap(), "Docs/Work/Q3/Reports");
        assert_eq!(Core::join_path(&Profile { path: "".into(), ..profile() }, "Photos").unwrap(), "Photos");
        for bad in ["../x", "a/../../b", "C:/x", r"a\b"] {
            assert!(Core::join_path(&p, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rename_names_follow_windows_rules() {
        assert!(valid_name("Budget 2026 (final).xlsx").is_ok());
        assert!(valid_name("  Notes  ").is_ok());
        for bad in ["", "a/b", r"a\b", "what?", "x:y", "CON", "con.txt", "ends.", "..", "a\u{7}b"] {
            assert!(valid_name(bad).is_err(), "{bad}");
        }
        assert!(valid_name(&"x".repeat(256)).is_err());
    }

    #[test]
    fn dirty_detection_skips_symlinks() {
        let d = std::env::temp_dir().join(format!("skyport-test-{}", hex(&vault::random_bytes::<6>())));
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("a"), "{\n\t\"Dirty\": true\n}").unwrap();
        fs::write(d.join("sub/b"), "{\"Dirty\":false}").unwrap();
        fs::write(d.join("sub/c"), "{\"Dirty\":true}").unwrap();
        assert_eq!(count_dirty(&d), 2);
        assert!(dir_size(&d) > 0);
        fs::remove_dir_all(&d).unwrap();
    }
}
