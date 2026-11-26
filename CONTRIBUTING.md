# Contributing to SkyPort

Thanks for helping. This guide covers setup, the code layout, and the rules every change must follow.

## Development setup

Requires Rust stable, Node.js 22 or newer and pnpm. On Windows, the Visual Studio C++ Build Tools and
WebView2 (built into Windows 11). On Linux, the WebKitGTK libraries listed in
`.github/workflows/build.yml`. To mount drives you also need rclone and WinFsp / macFUSE / FUSE 3.

```sh
pnpm install
pnpm tauri dev     # run the app
pnpm dev           # interface only, in a browser, with sample data (src/dev/mock.ts)
```

## Tests

```sh
pnpm build                    # type-check, class guard, front-end build
cd src-tauri && cargo test    # Rust unit tests
```

Linux checks run in a container on any OS: see *Development* in the README.

## Project layout

| Path | Purpose |
| ---- | ------- |
| `src-tauri/src/` | Rust: commands, mounts (`core.rs`), rclone (`rclone.rs`), encrypted vault, TOTP, scanning, `win.rs` / `unix.rs` per platform |
| `src/` | React + TypeScript interface (`components/`, `api.ts`, `styles.css`) |
| `src/dev/mock.ts` | Sample data for the browser preview (dev builds only) |
| `installer/`, `src-tauri/windows/` | Inno Setup script, NSIS hooks, WiX fragment |
| `marketing/` | Share images and banners (sample data only) |
| `docs/` | Screenshots and media for the README |

## Rules

- Keep the dependency list short. Discuss a new dependency in an issue first.
- Never show sign-in tokens, never log them, and never start a process through a shell.
- Security-sensitive code (vault, keys, TOTP, lock, process arguments, cache permissions) needs a test.
- New logic needs a test: a Rust unit test, or a check in `scripts/`.
- The interface never names the underlying engine (rclone); use the wording in `src/components/`.
- Use sample data only in screenshots, fixtures and examples ("Customer", "Work", `customer@example.com`).
  Never a real name, email or file.

## Branches and pull requests

1. Fork the repository, or create a branch if you have write access.
2. Keep each pull request to one change.
3. Run the tests before you push.
4. Fill in the pull request template. Attach screenshots for interface changes.
5. Open the pull request against `main`.

`main` is protected: nobody pushes to it directly, the required checks (build and tests on Windows, macOS
and Linux, and the security scans) must pass, and pull requests are squash-merged.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, for example
`fix(mount): keep the cache when a drive stops`. Common types: `feat`, `fix`, `docs`, `test`, `refactor`,
`chore`, `ci`. Release notes are grouped from pull request labels.

## Releases

Maintainers release by bumping the version in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`, merging, then pushing a tag `vX.Y.Z`. The Release workflow builds Windows, macOS
and Linux installers and publishes a GitHub Release with generated notes. A tag with a suffix
(`v0.2.0-beta.1`) becomes a pre-release.

## License

SkyPort is licensed under the Apache License 2.0 (see `LICENSE`). Contributions are accepted under the same
license: by submitting a change, you agree that it is licensed under Apache-2.0.

## Conduct and security

Participation is governed by `CODE_OF_CONDUCT.md`. Report security problems privately as described in
`SECURITY.md`, not in public issues.
