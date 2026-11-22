//! Mini Hub's desktop shell: the tray, the window, the global key, and the hub core in the background. It holds the
//! keys and hands them to the core and to its own window, and to nothing else (docs/02 > Shell, docs/03 > Keys).

pub mod core;
pub mod keys;
pub mod process;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use keys::{database_key, new_key, CredentialStore};
use process::{plain_path, post_stop, resolve_home, start_core, CoreHandle, CoreSpec};

const SHORTCUT: &str = "ctrl+alt+h";
const SHORTCUT_LABEL: &str = "Ctrl+Alt+H";
// Started by Windows at sign-in: stay in the tray until opened.
const HIDDEN_ARG: &str = "--hidden";

struct Hub {
    port: Option<u16>,
    person_key: String,
    error: Option<String>,
    shortcut_ok: bool,
    core: Option<CoreHandle>,
}

#[derive(Serialize)]
struct Keys {
    api: String,
    key: String,
}

#[derive(Serialize)]
struct ShortcutStatus {
    key: &'static str,
    ok: bool,
}

/// Where the core is, where its data goes, which credential holds the key, and the dashboard's origin.
struct Setup {
    spec: CoreSpec,
    account: String,
    ui_origin: &'static str,
}

fn setup_for(app: &AppHandle) -> Result<Setup, String> {
    if cfg!(debug_assertions) {
        // Development: the core from the source tree, with Node from PATH, on a scratch data folder and its own key,
        // and away from the owner's real Mini Bot unless MINI_HUB_DEV_BOT=1.
        let repo = plain_path(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").canonicalize().map_err(|e| e.to_string())?);
        let dev_home = repo.join(".minihub-home").join("shell-dev");
        let home = resolve_home(std::env::var_os("MINI_HUB_HOME"), Some(dev_home.into_os_string()))?;
        let home = if std::env::var_os("MINI_HUB_HOME").filter(|s| !s.is_empty()).is_some() { home } else { repo.join(".minihub-home").join("shell-dev") };
        let bot_home = if std::env::var("MINI_HUB_DEV_BOT").as_deref() == Ok("1") { None } else { Some(home.join("no-bot")) };
        return Ok(Setup {
            spec: CoreSpec { node: PathBuf::from("node"), script: repo.join("core").join("src").join("main.ts"), home, bot_home },
            account: "database-dev".into(),
            ui_origin: "http://127.0.0.1:5173",
        });
    }
    let core = plain_path(&app.path().resource_dir().map_err(|e| e.to_string())?).join("core");
    Ok(Setup {
        spec: CoreSpec {
            node: core.join("node.exe"),
            script: core.join("core.mjs"),
            home: resolve_home(std::env::var_os("MINI_HUB_HOME"), std::env::var_os("APPDATA"))?,
            bot_home: None,
        },
        account: std::env::var("MINI_HUB_KEY_ACCOUNT").unwrap_or_else(|_| "database".into()),
        ui_origin: "http://tauri.localhost",
    })
}

fn data_dir(setup: &Setup) -> PathBuf {
    setup.spec.home.clone()
}

fn start_hub(app: &AppHandle) -> Hub {
    let person_key = new_key();
    let mut hub = Hub { port: None, person_key: person_key.clone(), error: None, shortcut_ok: false, core: None };
    let started = setup_for(app).and_then(|setup| {
        let db_exists = data_dir(&setup).join("hub.db").exists();
        let db_key = database_key(&CredentialStore { account: setup.account.clone() }, db_exists)?;
        start_core(&setup.spec, &db_key, &person_key, setup.ui_origin)
    });
    match started {
        Ok((core, port)) => {
            hub.port = Some(port);
            hub.core = Some(core);
        }
        Err(e) => hub.error = Some(e),
    }
    hub
}

/// The window, made again if it was closed. Closing it frees the web view's memory; the core keeps running.
fn show_main(app: &AppHandle) {
    let window = match app.get_webview_window("main") {
        Some(w) => Some(w),
        None => app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == "main")
            .and_then(|cfg| tauri::WebviewWindowBuilder::from_config(app, cfg).ok())
            .and_then(|b| b.build().ok()),
    };
    if let Some(w) = window {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[derive(Debug, PartialEq)]
enum WindowAction {
    Open,
    Close,
}

/// The key toggles: a window in front closes (freeing its memory); anything else opens or brings it forward.
fn toggle_action(exists: bool, visible: bool, focused: bool) -> WindowAction {
    if exists && visible && focused {
        WindowAction::Close
    } else {
        WindowAction::Open
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_opens_a_closed_window_and_closes_one_in_front() {
        assert_eq!(toggle_action(false, false, false), WindowAction::Open);
        assert_eq!(toggle_action(true, false, false), WindowAction::Open);
        assert_eq!(toggle_action(true, true, false), WindowAction::Open);
        assert_eq!(toggle_action(true, true, true), WindowAction::Close);
    }

    #[test]
    fn the_window_is_not_built_at_start() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &config["app"]["windows"][0];
        assert_eq!(main["label"], "main");
        assert_eq!(main["create"], false, "started with Windows, nothing but the tray should load");
    }
}

fn toggle_main(app: &AppHandle) {
    let window = app.get_webview_window("main");
    let (visible, focused) = window
        .as_ref()
        .map(|w| (w.is_visible().unwrap_or(false), w.is_focused().unwrap_or(false)))
        .unwrap_or((false, false));
    match (toggle_action(window.is_some(), visible, focused), window) {
        (WindowAction::Close, Some(w)) => {
            let _ = w.close();
        }
        _ => show_main(app),
    }
}

/// Stop Mini from the tray, as the owner: the same as the Stop button in the dashboard.
fn stop_mini(app: &AppHandle) {
    let state = app.state::<Mutex<Hub>>();
    let (port, key) = match state.lock() {
        Ok(h) => (h.port, h.person_key.clone()),
        Err(_) => return,
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        // If the stop could not be sent, the dashboard opens: its own Stop button and status say what is going on.
        let sent = port.map(|p| post_stop(p, &key)).unwrap_or_else(|| Err("not running".into()));
        if sent.is_err() {
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || show_main(&h));
        }
    });
}

fn stop_core(app: &AppHandle) {
    if let Some(state) = app.try_state::<Mutex<Hub>>() {
        if let Ok(mut h) = state.lock() {
            if let Some(mut core) = h.core.take() {
                core.stop();
            }
        }
    }
}

#[tauri::command]
fn hub_keys(state: State<'_, Mutex<Hub>>) -> Result<Keys, String> {
    let mut h = state.lock().map_err(|_| "Mini Hub is busy.".to_string())?;
    // A core that stopped after it was ready is noticed here, with its own words.
    let died = h.core.as_mut().and_then(|c| c.exit_message());
    if let Some(message) = died {
        h.core = None;
        h.port = None;
        h.error = Some(message);
    }
    if let Some(e) = &h.error {
        return Err(e.clone());
    }
    let port = h.port.ok_or("The hub's background service is not running.")?;
    Ok(Keys { api: port.to_string(), key: h.person_key.clone() })
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if on { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())?;
    Ok(manager.is_enabled().unwrap_or(false))
}

#[tauri::command]
fn shortcut_status(state: State<'_, Mutex<Hub>>) -> ShortcutStatus {
    ShortcutStatus { key: SHORTCUT_LABEL, ok: state.lock().map(|h| h.shortcut_ok).unwrap_or(false) }
}

pub fn run() {
    let app = tauri::Builder::default()
        // First: a second launch only brings the running one forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![hub_keys, autostart_get, autostart_set, shortcut_status])
        .setup(|app| {
            let handle = app.handle().clone();
            let mut hub = start_hub(&handle);
            hub.shortcut_ok = handle.global_shortcut().register(SHORTCUT).is_ok();
            app.manage(Mutex::new(hub));

            let open = MenuItem::with_id(app, "open", "Open Mini Hub", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop Mini", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &stop, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main").tooltip("Mini Hub").menu(&menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show_main(app),
                "stop" => stop_mini(app),
                "quit" => {
                    stop_core(app);
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;

            if !std::env::args().any(|a| a == HIDDEN_ARG) {
                show_main(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Mini Hub could not start");

    app.run(|app, event| match event {
        // Closing the last window is not quitting: Mini Hub stays in the tray. Quit (app.exit) has a code.
        RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
        RunEvent::Exit => stop_core(app),
        _ => {}
    });
}
