# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

Only the latest release gets fixes.

## Reporting a vulnerability

Do not open a public issue or pull request for a security problem.

Report it privately with **Report a vulnerability** on the [Security tab](../../security/advisories/new)
of this repository (GitHub private vulnerability reporting).

Please include:

- The SkyPort version (the installer name, or Apps & features on Windows) and your operating system.
- Steps to reproduce, and the impact you expect.
- The file or command involved, if you know it.
- A proof of concept, kept to the minimum needed. Never include real sign-in tokens, `rclone.conf`
  contents or personal files.

We aim to acknowledge every report within 7 days.

## Security model

- **No servers.** SkyPort has no backend, no account and no telemetry. It talks only to Microsoft (through
  rclone) and, when you click a download link, to the official rclone, WinFsp or ClamAV sites.
- **Sign-in tokens** stay in rclone's own config. SkyPort reads that file only to list account names and
  types, never shows tokens, and redacts rclone's error text before it reaches the interface or logs.
- **Local database.** Drives, account names, settings, history and the two-step secret live in a SQLite
  database kept in memory and written to disk as AES-256-GCM ciphertext. Its 256-bit key is held by the
  operating system: DPAPI on Windows, the Keychain on macOS, the Secret Service on Linux (a `0600` file as
  fallback).
- **Two-step verification** (TOTP, RFC 6238) and the lock screen are enforced in Rust: every command checks
  the lock, not only the interface. Unlock attempts are rate-limited.
- **Processes.** Every process starts directly with an argument vector, never through a shell. The
  interface cannot pass programs or URLs; download links are fixed in Rust.
- **Mount control port** listens only on `127.0.0.1`, with a random user and password passed through the
  environment, never on the command line.
- **Cache** is a private folder: on Windows only your account can open it (ACL) and it is hidden; on macOS
  and Linux it is `chmod 700`.
- **Elevation.** On Windows SkyPort refuses to mount while running as administrator, because such drives
  are invisible to your normal File Explorer session.

## Out of scope

- Anyone with access to your unlocked user account can read your OneDrive through the mounted drive, by
  design, as with any synced folder.
- The security of rclone, WinFsp, FUSE and Microsoft's services themselves; report those upstream.
