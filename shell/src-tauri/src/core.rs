//! Starting and stopping the hub core: a Node process that gets its keys on standard input and answers with one
//! ready line on standard output (core/src/main.ts).

/// The port from the core's ready line, `{"ready":true,"port":N}`. Anything else is not the ready line.
pub fn parse_ready(line: &str) -> Option<u16> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("ready")?.as_bool()? {
        u16::try_from(v.get("port")?.as_u64()?).ok()
    } else {
        None
    }
}

/// The core's first line of input. The keys go nowhere else: not the command line, not the environment.
pub fn keys_line(db_key: &str, person_key: &str, ui_origin: &str) -> String {
    let v = serde_json::json!({ "dbKey": db_key, "personKey": person_key, "uiOrigin": ui_origin });
    format!("{v}\n")
}

/// What the core said before it stopped, made into one sentence for the window.
pub fn failure_message(code: Option<i32>, stderr: &str) -> String {
    let said: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    match (code, said.last()) {
        // 2 and 3 are the core's own refusals, and their last line is written for the owner.
        (Some(2) | Some(3), Some(last)) => last.chars().take(300).collect(),
        (_, None) => "The hub's background service stopped before it was ready.".into(),
        (Some(c), Some(_)) => format!("The hub's background service stopped unexpectedly (code {c}). Its log is in the logs folder of the data folder."),
        (None, Some(_)) => "The hub's background service stopped unexpectedly. Its log is in the logs folder of the data folder.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ready_reads_the_port_and_ignores_other_lines() {
        assert_eq!(parse_ready(r#"{"ready":true,"port":51234}"#), Some(51234));
        assert_eq!(parse_ready("  {\"ready\":true,\"port\":80}\r"), Some(80));
        assert_eq!(parse_ready(r#"{"ready":false,"port":51234}"#), None);
        assert_eq!(parse_ready("hub started"), None);
        assert_eq!(parse_ready(r#"{"ready":true,"port":99999}"#), None);
    }

    #[test]
    fn the_keys_line_is_one_line_of_json() {
        let line = keys_line(&"a".repeat(64), &"b".repeat(64), "http://tauri.localhost");
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1);
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["dbKey"], "a".repeat(64));
        assert_eq!(v["personKey"], "b".repeat(64));
        assert_eq!(v["uiOrigin"], "http://tauri.localhost");
    }

    #[test]
    fn failure_messages_use_the_cores_own_words() {
        assert_eq!(failure_message(Some(3), "Mini Hub is already running.\n"), "Mini Hub is already running.");
        assert_eq!(
            failure_message(Some(2), "The hub's data could not be opened. The key does not match, or the file is damaged.\n"),
            "The hub's data could not be opened. The key does not match, or the file is damaged."
        );
        assert_eq!(failure_message(None, ""), "The hub's background service stopped before it was ready.");
        // A crash ends with Node's own banner; that is not a message for the owner.
        assert_eq!(
            failure_message(Some(1), "file:///core.mjs:1\nTypeError: x is not a function\n    at main\n\nNode.js v24.20.0\n"),
            "The hub's background service stopped unexpectedly (code 1). Its log is in the logs folder of the data folder."
        );
    }
}
