#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod core;
mod rclone;
mod scan;
mod totp;
mod vault;
#[cfg(windows)]
#[path = "win.rs"]
mod os;
#[cfg(unix)]
#[path = "unix.rs"]
mod os;

use crate::core::{Account, CacheInfo, Core, Details, DriveStatus, Overview, Profile, TwoFaSetup, TwoFaStatus};
use crate::vault::Snapshot;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

type S<'a> = tauri::State<'a, Arc<Core>>;

/// Blocking work off the async runtime, behind the 2FA lock (enforced here, not in the UI).
async fn guarded<T: Send + 'static>(s: S<'_>, f: impl FnOnce(&Core) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let c = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        c.guard()?;
        f(&c)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn overview(s: S<'_>) -> Result<Overview, String> {
    guarded(s, |c| Ok(c.overview())).await
}
#[tauri::command]
async fn status(s: S<'_>) -> Result<Vec<DriveStatus>, String> {
    guarded(s, |c| Ok(c.status())).await
}
#[tauri::command]
async fn cache_info(s: S<'_>) -> Result<CacheInfo, String> {
    guarded(s, |c| Ok(c.cache_info())).await
}
#[tauri::command]
async fn accounts(s: S<'_>) -> Result<Vec<Account>, String> {
    guarded(s, |c| c.accounts()).await
}
#[tauri::command]
async fn add_account(app: AppHandle, s: S<'_>, name: String) -> Result<String, String> {
    let id = guarded(s, move |c| c.add_account(&name)).await?;
    show_main(&app); // bring SkyPort back in front of the browser
    Ok(id)
}
#[tauri::command]
fn cancel_sign_in() {
    rclone::cancel_sign_in();
}
#[tauri::command]
async fn rename_account(s: S<'_>, id: String, name: String) -> Result<(), String> {
    guarded(s, move |c| c.rename_account(&id, &name)).await
}
#[tauri::command]
async fn remove_account(s: S<'_>, id: String) -> Result<(), String> {
    guarded(s, move |c| c.remove_account(&id)).await
}
#[tauri::command]
async fn list_folders(s: S<'_>, account: String, path: String) -> Result<Vec<String>, String> {
    guarded(s, move |c| {
        if !rclone::valid_remote_name(&account) || !rclone::valid_folder(&path) {
            return Err("That folder isn't valid.".into());
        }
        rclone::list_folders(&c.rclone()?, &account, &path)
    })
    .await
}
#[tauri::command]
async fn quota(s: S<'_>, account: String) -> Result<Snapshot, String> {
    guarded(s, move |c| {
        if !rclone::valid_remote_name(&account) {
            return Err("Unknown account.".into());
        }
        c.quota(&account)
    })
    .await
}
#[tauri::command]
async fn details(s: S<'_>, id: String) -> Result<Details, String> {
    guarded(s, move |c| c.details(&id)).await
}
#[tauri::command]
async fn browse(s: S<'_>, id: String, path: String) -> Result<Vec<crate::core::Entry>, String> {
    guarded(s, move |c| c.browse(&id, &path)).await
}
#[tauri::command]
async fn open_path(s: S<'_>, id: String, path: String, reveal: bool) -> Result<(), String> {
    guarded(s, move |c| c.open_path(&id, &path, reveal)).await
}
#[tauri::command]
async fn rename_item(s: S<'_>, id: String, path: String, name: String) -> Result<String, String> {
    guarded(s, move |c| c.rename(&id, &path, &name)).await
}
#[tauri::command]
async fn scan_item(s: S<'_>, id: String, path: String) -> Result<scan::ScanResult, String> {
    guarded(s, move |c| c.scan(&id, &path)).await
}
#[tauri::command]
async fn activity(s: S<'_>) -> Result<Vec<crate::core::DriveActivity>, String> {
    guarded(s, |c| Ok(c.activity())).await
}
#[tauri::command]
async fn logs(s: S<'_>, id: String) -> Result<Vec<String>, String> {
    guarded(s, move |c| c.logs(&id, 200)).await
}
#[tauri::command]
fn open_logs(s: S<'_>) -> Result<(), String> {
    s.guard()?;
    std::fs::create_dir_all(s.log_dir()).map_err(|e| e.to_string())?;
    rclone::explorer().arg(s.log_dir()).spawn().map_err(|_| "Couldn't open File Explorer.".to_string())?;
    Ok(())
}
#[tauri::command]
async fn save_profile(s: S<'_>, profile: Profile) -> Result<Profile, String> {
    guarded(s, move |c| c.save_profile(profile)).await
}
#[tauri::command]
async fn remove_profile(s: S<'_>, id: String) -> Result<(), String> {
    guarded(s, move |c| c.remove_profile(&id)).await
}
#[tauri::command]
async fn mount(s: S<'_>, id: String) -> Result<(), String> {
    guarded(s, move |c| c.mount(&id)).await
}
#[tauri::command]
async fn unmount(s: S<'_>, id: String) -> Result<(), String> {
    guarded(s, move |c| c.unmount(&id, true)).await
}
#[tauri::command]
async fn reconnect(s: S<'_>, id: String) -> Result<(), String> {
    guarded(s, move |c| {
        c.unmount(&id, false)?;
        c.mount(&id)
    })
    .await
}
#[tauri::command]
async fn unmount_all(s: S<'_>) -> Result<(), String> {
    guarded(s, |c| Ok(c.unmount_all(true))).await
}
#[tauri::command]
async fn set_cache_dir(s: S<'_>, path: String) -> Result<(), String> {
    guarded(s, move |c| c.set_cache_dir(&path)).await
}
#[tauri::command]
async fn set_auto_mount(app: AppHandle, s: S<'_>, enabled: bool) -> Result<(), String> {
    s.guard()?;
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|_| "Couldn't update the Windows startup setting.".to_string())?;
    guarded(s, move |c| c.set_auto_mount(enabled)).await
}
#[tauri::command]
fn open_drive(s: S<'_>, id: String) -> Result<(), String> {
    s.guard()?;
    let p = s.settings().profiles.into_iter().find(|p| p.id == id).ok_or("That drive no longer exists.")?;
    rclone::explorer().arg(crate::core::local(&p, "")).spawn().map_err(|_| "Couldn't open File Explorer.".to_string())?;
    Ok(())
}
/// Only the two fixed download pages can be opened; the UI never passes a URL.
#[tauri::command]
fn open_download(which: String) -> Result<(), String> {
    let url = match which.as_str() {
        "engine" => rclone::RCLONE_URL,
        "driver" => rclone::DRIVER_URL,
        "clamav" => scan::CLAMAV_URL,
        _ => return Err("Unknown link".into()),
    };
    rclone::explorer().arg(url).spawn().map_err(|_| "Couldn't open your browser.".to_string())?;
    Ok(())
}
#[tauri::command]
async fn quit_app(app: AppHandle, s: S<'_>) -> Result<(), String> {
    let c = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || c.unmount_all(false)).await.map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

// ---- two-step verification (status and unlock work while locked) ----
#[tauri::command]
fn twofa_status(s: S<'_>) -> TwoFaStatus {
    s.twofa_status()
}
#[tauri::command]
async fn unlock(s: S<'_>, code: String) -> Result<(), String> {
    let c = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || c.unlock(&code)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn lock_now(s: S<'_>) {
    s.lock_now();
}
#[tauri::command]
async fn twofa_begin(s: S<'_>) -> Result<TwoFaSetup, String> {
    guarded(s, |c| c.twofa_begin()).await
}
#[tauri::command]
async fn twofa_enable(s: S<'_>, code: String) -> Result<Vec<String>, String> {
    guarded(s, move |c| c.twofa_enable(&code)).await
}
#[tauri::command]
async fn twofa_disable(s: S<'_>, code: String) -> Result<(), String> {
    guarded(s, move |c| c.twofa_disable(&code)).await
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if app.state::<Arc<Core>>().window_shown() {
            let _ = app.emit("locked", ());
        }
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Tray actions that would drop pending uploads ask the UI to confirm first.
fn tray_disconnect(app: &AppHandle, action: &'static str) {
    let app = app.clone();
    std::thread::spawn(move || {
        let core = app.state::<Arc<Core>>().inner().clone();
        let pending = core.pending_uploads();
        if pending > 0 {
            show_main(&app);
            let _ = app.emit("confirm-action", serde_json::json!({ "action": action, "pending": pending }));
            return;
        }
        core.unmount_all(action != "quit");
        if action == "quit" {
            app.exit(0);
        }
        let _ = app.emit("drives-changed", ());
    });
}

fn mount_all(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let core = app.state::<Arc<Core>>().inner().clone();
        for p in core.settings().profiles {
            let _ = core.mount(&p.id);
            let _ = app.emit("drives-changed", ());
        }
    });
}

fn main() {
    // run by the MSI on uninstall (not upgrade), before single-instance can forward it to a running SkyPort
    #[cfg(windows)]
    if std::env::args().any(|a| a == "--uninstall-cleanup") {
        return os::uninstall_cleanup();
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .setup(|app| {
            // %LOCALAPPDATA%: per-machine, not roamed, readable only by this user (plus SYSTEM/admins).
            let core = Arc::new(Core::new(app.path().app_local_data_dir()?, app.path().app_config_dir()?, app.path().app_log_dir()?)?);
            // First launch after an install: apply the installer's choices once.
            let (install_theme, install_autostart) = os::take_install_prefs();
            *core.install_theme.lock().unwrap() = install_theme;
            if let Some(on) = install_autostart {
                let al = app.autolaunch();
                let _ = if on { al.enable() } else { al.disable() };
                let _ = core.set_auto_mount(on);
            }
            let autostart = std::env::args().any(|a| a == "--autostart");
            let auto_mount = core.settings().auto_mount;
            app.manage(core);

            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "open", "Open SkyPort", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "mount_all", "Connect all drives", true, None::<&str>)?,
                    &MenuItem::with_id(app, "unmount_all", "Disconnect all drives", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "lock", "Lock SkyPort", true, None::<&str>)?,
                    &MenuItem::with_id(app, "quit", "Quit SkyPort", true, None::<&str>)?,
                ],
            )?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("SkyPort")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "mount_all" => mount_all(app),
                    "unmount_all" => tray_disconnect(app, "disconnect-all"),
                    "lock" => {
                        app.state::<Arc<Core>>().lock_now();
                        let _ = app.emit("locked", ());
                    }
                    "quit" => tray_disconnect(app, "quit"),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Bring back drives that were connected last time, and heal unexpected stops.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if handle.state::<Arc<Core>>().heal() {
                    let _ = handle.emit("drives-changed", ());
                }
                std::thread::sleep(std::time::Duration::from_secs(15));
            });

            if autostart {
                if auto_mount {
                    mount_all(app.handle());
                }
            } else {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            // Closing the window keeps drives connected; Quit lives in the tray.
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
                w.app_handle().state::<Arc<Core>>().window_hidden();
            }
        })
        .invoke_handler(tauri::generate_handler![
            overview, status, cache_info, accounts, add_account, cancel_sign_in, rename_account, remove_account,
            list_folders, quota, details, browse, open_path, rename_item, scan_item, activity, logs, open_logs, save_profile, remove_profile, mount, unmount, reconnect, unmount_all,
            set_cache_dir, set_auto_mount, open_drive, open_download, quit_app,
            twofa_status, unlock, lock_now, twofa_begin, twofa_enable, twofa_disable
        ])
        .run(tauri::generate_context!())
        .expect("error while running SkyPort");
}
