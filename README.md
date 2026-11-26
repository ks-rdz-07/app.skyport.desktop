# SkyPort

Skyport is a Windows desktop app that mounts your OneDrive (Personal or for Business) as a drive letter such as `O:`. The drive shows up under **This PC** in File Explorer. rclone does the cloud and mount work, WinFsp provides the Windows filesystem driver, and Rust (Tauri 2) manages processes, profiles and status. The UI is React + TypeScript.

![splash](docs/splash.mp4)

## What it does

- Sign in with Microsoft in your browser, or pick an existing rclone OneDrive connection.
- Mount the whole OneDrive or one folder, with a drive letter you choose, read/write or read-only.
- Connect, Disconnect, Reconnect and Open in Explorer. Drive-letter conflicts are checked before mounting. A drive shows **Connected** only once the volume answers in your own Windows session.
- Shows the OneDrive storage quota (when the account reports one) and local cache usage separately.
- Uses rclone's VFS write cache (`--vfs-cache-mode writes`): edits are saved locally and uploaded in the background. Pending uploads are shown, you're warned before disconnecting or quitting while uploads are pending, and the same cache folder is reused so unfinished uploads resume after a restart.
- Detects missing rclone or WinFsp and links to the official download pages.
- System tray menu (Open, Connect all, Disconnect all, Quit). Optional "Start with Windows" connects all drives at sign-in.

## Security notes

- OAuth tokens stay in rclone's own config (`%APPDATA%\rclone\rclone.conf`). Rust reads the config only to list connection names and types and drops the tokens immediately. `rclone config create` stdout (which ends with the token) is discarded. rclone error text is redacted before it reaches the UI.
- Every rclone call uses `std::process::Command` with an argument vector. No shell is ever involved. The UI can't pass URLs or executables: download links are two fixed URLs in Rust.
- Each mount's remote-control port is bound to `127.0.0.1` with a random user and password.
- Run Skyport **without** "Run as administrator". Drives mounted from an elevated process are hidden from your Explorer, so Skyport refuses to mount when elevated and shows a banner.

## Windows setup guide

### 1. Install the two components

| Component | Official source | winget alternative |
|---|---|---|
| rclone (v1.60 or newer) | https://rclone.org/downloads/ | `winget install Rclone.Rclone` |
| WinFsp | https://winfsp.dev/rel/ | `winget install WinFsp.WinFsp` (UAC prompt) |

Skyport looks for `rclone.exe` next to `Skyport.exe`, on `PATH`, and in winget's package folder. Click **Check again** on the Setup screen after installing.

### 2. Install or build Skyport

**Build from source** (needs Rust stable, Node 20+, pnpm, and Visual Studio C++ Build Tools with WebView2, which ships with Windows 11):

```powershell
cd skyport
pnpm install
pnpm tauri build            # installer: src-tauri\target\release\bundle\nsis\
# or, for development:
pnpm tauri dev
```

For a plain exe without an installer: `pnpm tauri build --no-bundle`, which writes `src-tauri\target\release\skyport.exe`.

### 3. Add your OneDrive

1. Open Skyport and click **Add drive**.
2. **Account**: choose an existing connection, or enter a connection name and click **Sign in with Microsoft**. Finish sign-in in the browser. Personal and work or school accounts both work, and the account's own OneDrive is selected automatically.
3. **Folder**: *Entire OneDrive*, or *One folder* (browse and pick).
4. **Drive**: name, drive letter (letters already in use are disabled) and access (*Read & write* / *Read only*).
5. Click **Add and connect**. When the card says **Connected**, the drive is in This PC.

### 4. Cache location

**Settings → Local cache.** The default is `E:\CloudDriveCache` when an E: drive exists, otherwise `%LOCALAPPDATA%\Skyport\Cache`. Disconnect all drives before moving the cache. Skyport refuses to move it while files are still waiting to upload, so nothing gets stranded.

### 5. Start with Windows

**Settings → Start with Windows** adds a per-user startup entry. Skyport then starts in the tray and connects every drive. Closing the window keeps drives connected; use **Quit** from the tray icon to stop.

## Where things live

| What | Path |
|---|---|
| Encrypted database (profiles, account names, settings, storage history, activity, 2FA secret) | `%LOCALAPPDATA%\app.skyport.desktop\skyport.db` |
| Database key (256-bit, DPAPI-wrapped to your Windows account) | `%LOCALAPPDATA%\app.skyport.desktop\vault.key` |
| Mount logs, errors only (one per drive) | `%LOCALAPPDATA%\app.skyport.desktop\logs\` |
| VFS cache (pending uploads live here) | the cache folder above (`vfs\` and `vfsMeta\`) |
| OneDrive sign-in tokens | `%APPDATA%\rclone\rclone.conf` (managed by rclone) |

`%LOCALAPPDATA%` is per-machine, never roams, and only your account, SYSTEM and Administrators can read it. The database is a SQLite file held in memory and written to disk as AES-256-GCM ciphertext. If it can't be decrypted, it's set aside (`skyport.db.unreadable-*`), never deleted.

## Accounts, drives and security

- **Multiple accounts**: each sign-in gets a friendly name (Settings → Accounts: rename, remove, storage per account). An account can't be removed while a drive uses it.
- **Multiple drives**: names and letters must be unique, and two drives can't show overlapping folders of the same account, because they would share cache files.
- **Two-step verification** (Settings): TOTP codes from any authenticator app (Microsoft Authenticator, Google Authenticator, Authy, 1Password, Bitwarden, Proton Pass…), 8 single-use recovery codes, and lockout back-off after 5 wrong codes. The lock is enforced in Rust: every command except unlock is refused while locked. Skyport re-locks after 5 minutes in the tray, or from tray → Lock Skyport. Drives stay connected while locked.
- **Drive details**: storage total, used, free and recycle bin, with history; account; access and uploads; cache; this PC (name, Windows user, local IP, time zone, region); recent activity.
- **Guided tour** on first run; replay it from Settings.

## Platforms

| | Windows 10/11 | macOS | Linux |
|---|---|---|---|
| A drive appears as | a drive letter in This PC (`O:`) | a folder, `~/SkyPort/<name>` | a folder, `~/SkyPort/<name>` |
| Filesystem driver | [WinFsp](https://winfsp.dev/rel/) | [macFUSE](https://macfuse.github.io/) or FUSE-T | FUSE 3 (`fuse3` package) |
| Database key kept by | DPAPI (your Windows account) | Keychain | Secret Service, else a `0600` file |
| Cache made private by | folder permissions + hidden | `chmod 700` | `chmod 700` |
| Virus scanning | Microsoft Defender or ClamAV | ClamAV | ClamAV |
| Installers | NSIS, MSI, Inno Setup | `.app`, `.dmg` | `.deb`, AppImage |

The interface uses each system's own words (Finder, This Mac, Start at login…). CI builds and tests all three on every push (`.github/workflows/build.yml`). `scripts/linux-check.sh` runs the Linux build and tests in a container: `podman run --rm -v <project>:/src:ro docker.io/library/rust:1-bookworm sh /src/scripts/linux-check.sh`.

## Installers

| Installer | Build | Notes |
|---|---|---|
| **Inno Setup** (recommended for people) | `ISCC.exe installer\skyport.iss` after `pnpm tauri build` | Per-user, no admin rights. Checkboxes: start with Windows (on), desktop shortcut, launch when done. Theme: System / Light / Dark. Uninstall cleans up and asks about the cache. |
| **MSI** (for IT and silent installs) | `pnpm tauri build` (WiX, downloaded by Tauri) | First-run choices as properties: `msiexec /i SkyPort_0.1.0_x64_en-US.msi STARTUP=0 THEME=dark /qn`. Doesn't remove app data on uninstall. Use Inno or NSIS when that matters. |
| **NSIS** | `pnpm tauri build` | Per-user. Uninstall cleans up and asks about the cache. |

All three hand the choices to SkyPort through `HKCU\Software\Skyport`. SkyPort applies them once at first launch, then deletes them, so later changes in Settings win.

To build while SkyPort is running, use a separate output folder: `$env:CARGO_TARGET_DIR="src-tauri\target-dist"; pnpm tauri build`, then `ISCC.exe /DBuildDir=..\src-tauri\target-dist\release installer\skyport.iss`.

## Uninstall

The uninstaller removes `%LOCALAPPDATA%\app.skyport.desktop` (database, key, logs, webview data), `%APPDATA%\app.skyport.desktop`, the "Start with Windows" entry and `HKCU\Software\Skyport`. It **asks** before deleting the cache folder (default: keep), because the cache can hold edits that haven't uploaded yet. In-place updates skip all of this. Sign-ins in `rclone.conf` are left alone, because that file may be shared with other tools; remove accounts in Settings first if you want them gone.

## Troubleshooting

- **"Drive O: is already in use"**: another disk, mapped share or a leftover rclone process holds the letter. Pick another letter in Edit, or end `rclone.exe` in Task Manager. A leftover rclone mount keeps uploading on its own; ending it is safe because pending files resume from the cache.
- **Drive works in Skyport but not in Explorer**: Skyport is probably elevated. Restart it normally.
- **Uploads stuck**: they retry automatically with backoff. Errors are in the drive's log file.

## Development

```powershell
cd src-tauri; cargo test      # Rust unit tests (args, validation, redaction, cache scanning)
pnpm build                    # TypeScript type-check + Vite build
```

Imports use the `@/` alias for `src/` (set in `tsconfig.json` and `vite.config.ts`).

**Rebuilding while Skyport runs fails** with `failed to remove file …\skyport.exe: Access is denied`, because Windows locks a running program's file. Quit Skyport from the tray first: it warns about pending uploads and unmounts cleanly, and drives that were connected come back on the next launch. Don't end it in Task Manager while files are uploading. They'd survive in the cache, but the upload in progress restarts.

`pnpm dev` without the Tauri shell runs a browser preview with sample data (`src/dev/mock.ts`, dev builds only). Add `?theme=light` or `?theme=dark` to the URL to check a theme, and `#/drives`, `#/accounts`, `#/security`, `#/settings`, `#/drives/<id>` or `#/drives/<id>/files` to open a screen.
