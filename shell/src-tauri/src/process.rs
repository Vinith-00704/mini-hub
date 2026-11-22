//! The core as a running process: started with its keys on standard input, stopped by closing that input.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::core::{failure_message, keys_line, parse_ready};

// The core opens its database and starts listening in about a second; this leaves room for a slow, busy PC.
const READY_WAIT: Duration = Duration::from_secs(20);
const STOP_WAIT: Duration = Duration::from_secs(5);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Windows hands out some folders in its long-path form (`\\?\C:\...`). Node cannot load modules through that form,
/// so paths given to it are turned back into ordinary ones.
pub fn plain_path(p: &std::path::Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn long_paths_become_ordinary_ones() {
        assert_eq!(plain_path(Path::new(r"\\?\F:\mini-hub\core\core.mjs")), PathBuf::from(r"F:\mini-hub\core\core.mjs"));
        assert_eq!(plain_path(Path::new(r"\\?\UNC\server\share\core.mjs")), PathBuf::from(r"\\server\share\core.mjs"));
        assert_eq!(plain_path(Path::new(r"F:\already\plain")), PathBuf::from(r"F:\already\plain"));
    }

    #[test]
    fn the_data_folder_is_worked_out_once_and_absolute() {
        use std::ffi::OsString;
        let appdata = Some(OsString::from(r"C:\Users\x\AppData\Roaming"));
        assert_eq!(resolve_home(None, appdata.clone()).unwrap(), PathBuf::from(r"C:\Users\x\AppData\Roaming\MiniHub"));
        assert_eq!(resolve_home(Some(OsString::new()), appdata.clone()).unwrap(), PathBuf::from(r"C:\Users\x\AppData\Roaming\MiniHub"));
        assert_eq!(resolve_home(Some(OsString::from(r"D:\scratch")), appdata.clone()).unwrap(), PathBuf::from(r"D:\scratch"));
        assert!(resolve_home(Some(OsString::from("relative\\folder")), appdata).is_err());
        assert!(resolve_home(None, None).is_err());
    }

    #[test]
    fn the_stop_request_ignores_proxies() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;
        // A proxy that does not exist: if the request went to it, it would fail and never reach the listener.
        std::env::set_var("HTTP_PROXY", "http://127.0.0.1:9");
        std::env::set_var("ALL_PROXY", "http://127.0.0.1:9");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut head = Vec::new();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                head.push(line.to_lowercase());
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}").unwrap();
            head
        });
        post_stop(port, &"k".repeat(64)).unwrap();
        let head = server.join().unwrap();
        assert!(head[0].starts_with("post /v1/stop "), "{head:?}");
        assert!(head.iter().any(|h| h.trim() == format!("x-hub-ui: {}", "k".repeat(64))), "{head:?}");
    }

    #[test]
    fn a_core_that_dies_after_ready_is_noticed_and_gets_no_node_options() {
        let dir = std::env::temp_dir().join(format!("minihub-stub-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("stub.mjs");
        std::fs::write(
            &script,
            r#"let s = ''
process.stdin.on('data', d => {
  s += d
  if (!s.includes('\n')) return
  if (process.env.NODE_OPTIONS) { console.error('NODE_OPTIONS reached the core'); process.exit(4) }
  console.log(JSON.stringify({ ready: true, port: 4321 }))
  setTimeout(() => { console.error('Something broke inside the hub.'); process.exit(1) }, 300)
})"#,
        )
        .unwrap();
        std::env::set_var("NODE_OPTIONS", "--max-old-space-size=64");
        let spec = CoreSpec { node: PathBuf::from("node"), script: script.clone(), home: dir.clone(), bot_home: None };
        let (mut core, port) = start_core(&spec, &"a".repeat(64), &"b".repeat(64), "http://tauri.localhost").unwrap();
        assert_eq!(port, 4321);
        assert_eq!(core.exit_message(), None, "still running right after ready");
        std::thread::sleep(Duration::from_millis(1200));
        let said = core.exit_message().expect("the stop is noticed");
        assert!(said.contains("stopped unexpectedly (code 1)"), "{said}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// The one data folder, worked out once by the shell and always given to the core, so the two never disagree.
/// An empty setting counts as unset; a relative one is refused.
pub fn resolve_home(setting: Option<std::ffi::OsString>, appdata: Option<std::ffi::OsString>) -> Result<PathBuf, String> {
    match setting.filter(|s| !s.is_empty()) {
        Some(s) => {
            let p = PathBuf::from(s);
            if p.is_absolute() {
                Ok(p)
            } else {
                Err(format!("MINI_HUB_HOME must be a full path, like C:\\MiniHub, not \"{}\".", p.display()))
            }
        }
        None => appdata
            .filter(|a| !a.is_empty())
            .map(|a| PathBuf::from(a).join("MiniHub"))
            .ok_or_else(|| "Windows did not say where application data goes (APPDATA is not set).".to_string()),
    }
}

/// Tray > Stop Mini, as the owner. Straight to the core on this PC: never through a proxy, whatever the environment says.
pub fn post_stop(port: u16, person_key: &str) -> Result<(), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().proxy(None).timeout_global(Some(Duration::from_secs(3))).build().into();
    agent
        .post(&format!("http://127.0.0.1:{port}/v1/stop"))
        .header("x-hub-ui", person_key)
        .send_empty()
        .map(|_| ())
        .map_err(|e| format!("Mini could not be stopped from the tray: {e}"))
}

pub struct CoreSpec {
    pub node: PathBuf,
    pub script: PathBuf,
    /// Always given to the core, so the shell and the core look in the same place (see resolve_home).
    pub home: PathBuf,
    /// For development: the Mini Bot folder the core should look at. None leaves the core's own default.
    pub bot_home: Option<PathBuf>,
}

pub struct CoreHandle {
    child: Child,
    stdin: Option<ChildStdin>,
    errors: Arc<Mutex<String>>,
}

impl CoreHandle {
    /// None while the core runs; once it has stopped, what it said, for the window.
    pub fn exit_message(&mut self) -> Option<String> {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                // Let the reader catch the last words on standard error.
                std::thread::sleep(Duration::from_millis(150));
                let said = self.errors.lock().map(|e| e.clone()).unwrap_or_default();
                Some(failure_message(status.code(), &said))
            }
            _ => None,
        }
    }

    /// End of input is the core's signal to stop cleanly (it removes hub.json and its lock). Killed if it hangs.
    pub fn stop(&mut self) {
        drop(self.stdin.take());
        let until = Instant::now() + STOP_WAIT;
        while Instant::now() < until {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn start_core(spec: &CoreSpec, db_key: &str, person_key: &str, ui_origin: &str) -> Result<(CoreHandle, u16), String> {
    let mut cmd = Command::new(&spec.node);
    cmd.arg(&spec.script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = spec.script.parent() {
        cmd.current_dir(dir);
    }
    cmd.env("MINI_HUB_HOME", &spec.home);
    if let Some(bot) = &spec.bot_home {
        cmd.env("MINI_BOT_HOME", bot);
    }
    // The core holds both keys: no inherited Node options (a debugger, a preloaded script) may reach it.
    cmd.env_remove("NODE_OPTIONS");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("The hub's background service could not be started: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("The hub's background service has no input.")?;
    stdin
        .write_all(keys_line(db_key, person_key, ui_origin).as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("The hub's background service did not take its keys: {e}"))?;

    let errors = Arc::new(Mutex::new(String::new()));
    if let Some(mut err) = child.stderr.take() {
        let errors = Arc::clone(&errors);
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = err.read_to_string(&mut text);
            if let Ok(mut e) = errors.lock() {
                e.push_str(&text);
            }
        });
    }

    let (tx, rx) = mpsc::channel();
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Some(port) = parse_ready(&line) {
                    let _ = tx.send(port);
                }
            }
        });
    }

    let until = Instant::now() + READY_WAIT;
    loop {
        if let Ok(port) = rx.recv_timeout(Duration::from_millis(100)) {
            return Ok((CoreHandle { child, stdin: Some(stdin), errors }, port));
        }
        if let Ok(Some(status)) = child.try_wait() {
            std::thread::sleep(Duration::from_millis(150));
            let said = errors.lock().map(|e| e.clone()).unwrap_or_default();
            return Err(failure_message(status.code(), &said));
        }
        if Instant::now() > until {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The hub's background service did not start in time.".into());
        }
    }
}
