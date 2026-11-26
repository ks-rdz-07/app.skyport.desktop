//! Encrypted local database. A SQLite database lives in memory and is written to disk
//! as AES-256-GCM ciphertext. The 256-bit key is random and kept by the operating system:
//! wrapped with DPAPI on Windows, in the Keychain on macOS, in the Secret Service on Linux.
use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAGIC: &[u8; 4] = b"SKY1";

pub struct Vault {
    conn: Connection,
    file: PathBuf,
    key: [u8; 32],
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub at: i64,
    pub total: Option<i64>,
    pub used: Option<i64>,
    pub free: Option<i64>,
    pub trashed: Option<i64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub at: i64,
    pub kind: String,
    pub detail: String,
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

pub fn seal(key: &[u8; 32], plain: &[u8]) -> Vec<u8> {
    let nonce = random_bytes::<12>();
    let ct = Aes256Gcm::new(key.into()).encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad: MAGIC }).expect("encrypt");
    [MAGIC.as_slice(), &nonce, &ct].concat()
}

pub fn open_sealed(key: &[u8; 32], blob: &[u8]) -> Option<Vec<u8>> {
    if blob.len() < 16 + 16 || &blob[..4] != MAGIC {
        return None;
    }
    Aes256Gcm::new(key.into()).decrypt(Nonce::from_slice(&blob[4..16]), Payload { msg: &blob[16..], aad: MAGIC }).ok()
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (account TEXT NOT NULL, at INTEGER NOT NULL, total INTEGER, used INTEGER, free INTEGER, trashed INTEGER);
CREATE INDEX IF NOT EXISTS snapshots_account ON snapshots(account, at);
CREATE TABLE IF NOT EXISTS events (drive TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_drive ON events(drive, at);
";

impl Vault {
    pub fn open(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let key = crate::os::vault_key(dir)?;
        let file = dir.join("skyport.db");
        let mut conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        if let Ok(blob) = fs::read(&file) {
            match open_sealed(&key, &blob) {
                Some(plain) => conn.deserialize_read_exact("main", &plain[..], plain.len(), false).map_err(|e| e.to_string())?,
                // Never silently destroy data: keep the unreadable file aside and start fresh.
                None => fs::rename(&file, dir.join(format!("skyport.db.unreadable-{}", now()))).map_err(|e| e.to_string())?,
            }
        }
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(Self { conn, file, key })
    }

    fn persist(&mut self) -> Result<(), String> {
        let data = self.conn.serialize("main").map_err(|e| e.to_string())?;
        let tmp = self.file.with_extension("tmp");
        fs::write(&tmp, seal(&self.key, &data)).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.file).map_err(|e| e.to_string())
    }

    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let s: String = self.conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).ok()?;
        serde_json::from_str(&s).ok()
    }

    pub fn put<T: Serialize>(&mut self, key: &str, v: &T) -> Result<(), String> {
        let s = serde_json::to_string(v).map_err(|e| e.to_string())?;
        self.conn
            .execute("INSERT INTO kv(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, s])
            .map_err(|e| e.to_string())?;
        self.persist()
    }

    pub fn add_snapshot(&mut self, account: &str, s: &Snapshot) -> Result<(), String> {
        self.conn
            .execute("INSERT INTO snapshots VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![account, s.at, s.total, s.used, s.free, s.trashed])
            .map_err(|e| e.to_string())?;
        // keep ~3 months of history per account
        self.conn.execute("DELETE FROM snapshots WHERE account = ?1 AND at < ?2", params![account, s.at - 90 * 86400]).map_err(|e| e.to_string())?;
        self.persist()
    }

    pub fn history(&self, account: &str, limit: u32) -> Vec<Snapshot> {
        let mut st = self.conn.prepare("SELECT at, total, used, free, trashed FROM snapshots WHERE account = ?1 ORDER BY at DESC LIMIT ?2").unwrap();
        let rows = st
            .query_map(params![account, limit], |r| Ok(Snapshot { at: r.get(0)?, total: r.get(1)?, used: r.get(2)?, free: r.get(3)?, trashed: r.get(4)? }))
            .map(|it| it.flatten().collect::<Vec<_>>())
            .unwrap_or_default();
        rows.into_iter().rev().collect()
    }

    pub fn add_event(&mut self, drive: &str, kind: &str, detail: &str) -> Result<(), String> {
        self.conn.execute("INSERT INTO events VALUES (?1, ?2, ?3, ?4)", params![drive, now(), kind, detail]).map_err(|e| e.to_string())?;
        self.conn.execute("DELETE FROM events WHERE drive = ?1 AND at < ?2", params![drive, now() - 90 * 86400]).map_err(|e| e.to_string())?;
        self.persist()
    }

    pub fn events(&self, drive: &str, limit: u32) -> Vec<Event> {
        let mut st = self.conn.prepare("SELECT at, kind, detail FROM events WHERE drive = ?1 ORDER BY at DESC LIMIT ?2").unwrap();
        st.query_map(params![drive, limit], |r| Ok(Event { at: r.get(0)?, kind: r.get(1)?, detail: r.get(2)? }))
            .map(|it| it.flatten().collect())
            .unwrap_or_default()
    }

    pub fn delete_drive(&mut self, drive: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM events WHERE drive = ?1", [drive]).map_err(|e| e.to_string())?;
        self.persist()
    }

    pub fn delete_account(&mut self, account: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM snapshots WHERE account = ?1", [account]).map_err(|e| e.to_string())?;
        self.persist()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_roundtrip_and_tamper_detection() {
        let key = random_bytes::<32>();
        let blob = seal(&key, b"hello");
        assert_eq!(open_sealed(&key, &blob).unwrap(), b"hello");
        assert!(!blob.windows(5).any(|w| w == b"hello"));
        let mut bad = blob.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(open_sealed(&key, &bad).is_none());
        assert!(open_sealed(&random_bytes::<32>(), &blob).is_none());
    }

    #[test]
    fn database_persists_encrypted() {
        let dir = std::env::temp_dir().join(format!("skyport-vault-{}", u64::from_le_bytes(random_bytes::<8>())));
        {
            let mut v = Vault::open(&dir).unwrap();
            v.put("settings", &serde_json::json!({"cacheDir": "E:\\CloudDriveCache"})).unwrap();
            v.add_snapshot("acct", &Snapshot { at: now(), total: Some(100), used: Some(10), free: Some(90), trashed: Some(0) }).unwrap();
            v.add_event("d1", "connected", "O:").unwrap();
        }
        let raw = fs::read(dir.join("skyport.db")).unwrap();
        assert!(!raw.windows(15).any(|w| w == b"CloudDriveCache") && !raw.windows(6).any(|w| w == b"SQLite"));
        let v = Vault::open(&dir).unwrap();
        assert_eq!(v.get::<serde_json::Value>("settings").unwrap()["cacheDir"], "E:\\CloudDriveCache");
        assert_eq!(v.history("acct", 10)[0].used, Some(10));
        assert_eq!(v.events("d1", 10)[0].kind, "connected");
        fs::remove_dir_all(&dir).unwrap();
    }
}
