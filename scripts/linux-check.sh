#!/bin/sh
# Builds and tests SkyPort's Rust side on Linux. Run inside a Debian-based Rust container with the
# project mounted read-only at /src, e.g.:
#   podman run --rm -v <project>:/src:ro -v skyport-target:/target docker.io/library/rust:1-bookworm sh /src/scripts/linux-check.sh
set -e
apt-get update -qq
apt-get install -y -qq libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev libxdo-dev pkg-config build-essential >/dev/null
# Tauri's build step writes generated files, so work on a copy (without node_modules or Windows build output).
mkdir -p /work
tar -C /src --exclude=./node_modules --exclude=./src-tauri/target --exclude=./src-tauri/target-dist -cf - . | tar -C /work -xf -
export CARGO_TARGET_DIR=/target
cd /work/src-tauri
cargo test 2>&1 | grep -vE "^\s+(Compiling|Downloaded|Downloading)" | tail -40
