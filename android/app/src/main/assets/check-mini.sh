#!/data/data/com.termux/files/usr/bin/bash
# Started by the Mini app through Termux's RUN_COMMAND, with this script on standard input. It only READS: it writes
# nothing, answers no question for the owner, and changes no setting of Termux or Claude Code. It prints one line,
# MINI_CHECK {json}, with the answers the Brain screen needs and nothing else from the files it looks at (no account,
# name or mail address): claude, claudeFound, node, tmux, git, signedIn, plugin, trusted, widened, runtime, session, and
# two answers about Termux's own logging (logMore, errorNotes). "read" says whether the node program ran; when it did
# not, or a file could not be read, the answer is null (unknown), never an empty "all clear".

# Termux's exec helper breaks Claude Code ("unexpected e_type: 2").
unset LD_PRELOAD
export PATH="$PATH:$HOME/.local/bin"

has() { command -v "$1" >/dev/null 2>&1 && echo true || echo false; }
HAS_NODE=$(has node)
HAS_TMUX=$(has tmux)
HAS_GIT=$(has git)
HAS_CLAUDE=$(has claude)

# Claude Code's version text, plain characters only, at most 40 of them. Null when it did not answer.
CLAUDE=null
if [ "$HAS_CLAUDE" = true ]; then
  V=$(timeout 20 claude --version 2>/dev/null </dev/null | head -n 1 | tr -cd 'A-Za-z0-9 ._()+-' | cut -c1-40)
  [ -n "$V" ] && CLAUDE="\"$V\""
fi

# Signed in: Claude Code's credentials file has something in it. Only its size is looked at, never its text.
CRED="$HOME/.claude/.credentials.json"
if [ -s "$CRED" ] && [ -r "$CRED" ]; then
  SIGNED=true
elif [ -e "$CRED" ] && [ ! -r "$CRED" ]; then
  SIGNED=null
else
  SIGNED=false
fi

# Mini's two tmux sessions: the runtime and Claude Code.
RT=false
SESSION=false
if [ "$HAS_TMUX" = true ]; then
  tmux -L mini has-session -t =rt 2>/dev/null </dev/null && RT=true
  tmux -L mini has-session -t =mini 2>/dev/null </dev/null && SESSION=true
fi

# Termux's own logging: a log level above Normal, or plugin error notifications (Termux's default is on), can put what
# a command was given into Termux's log or a notification. Read from Termux's preferences; null when they cannot be
# read, or hold the value in a form this does not know.
LOGMORE=null
ERRNOTES=null
SPDIR="${PREFIX:-/data/data/com.termux/files/usr}/../../shared_prefs"
if [ -d "$SPDIR" ] && [ -r "$SPDIR" ]; then
  XML="$SPDIR/com.termux_preferences.xml"
  if [ ! -e "$XML" ]; then
    # Nothing stored yet: Termux's defaults (log level Normal, plugin error notifications on).
    LOGMORE=false
    ERRNOTES=true
  elif [ -r "$XML" ]; then
    LEVEL=$(sed -n -e 's/.*<int name="log_level" value="\([0-9]*\)".*/\1/p' -e 's/.*<string name="log_level">\([0-9]*\)<\/string>.*/\1/p' "$XML" 2>/dev/null </dev/null | head -n 1)
    if [ -n "$LEVEL" ]; then
      if [ "$LEVEL" -gt 1 ]; then LOGMORE=true; else LOGMORE=false; fi
    elif grep -q 'log_level' "$XML" 2>/dev/null </dev/null; then
      LOGMORE=null
    else
      LOGMORE=false
    fi
    NOTES=$(sed -n 's/.*<boolean name="plugin_error_notifications_enabled" value="\([a-z]*\)".*/\1/p' "$XML" 2>/dev/null </dev/null | head -n 1)
    if [ -n "$NOTES" ]; then
      if [ "$NOTES" = false ]; then ERRNOTES=false; else ERRNOTES=true; fi
    elif grep -q 'plugin_error_notifications_enabled' "$XML" 2>/dev/null </dev/null; then
      ERRNOTES=null
    else
      ERRNOTES=true
    fi
  fi
fi

# Plugin version, folder trust and widened settings: one node program that prints only these fields.
EXTRA='"read":false,"plugin":null,"trusted":null,"widened":null'
if [ "$HAS_NODE" = true ]; then
  OUT=$(node -e '
    const fs = require("fs"), path = require("path")
    const home = process.env.HOME || ""
    const mini = path.posix.join(home, ".mini"), work = path.posix.join(mini, "work")
    const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch { return null } }
    // A file that is not there is an empty answer; one that is there and cannot be read is unknown.
    const load = (f) => {
      let t
      try { t = fs.readFileSync(f, "utf8") } catch (e) { return e && e.code === "ENOENT" ? { none: true } : { bad: true } }
      try { return { v: JSON.parse(t) } } catch { return { bad: true } }
    }
    const exists = (f) => { try { fs.accessSync(f); return true } catch { return false } }
    const text = (v) => String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60)

    let plugin = null
    const p = read(path.posix.join(mini, "plugin", ".claude-plugin", "plugin.json"))
    if (p && typeof p.version === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(p.version)) plugin = p.version

    // Only whether Claude Code was told to trust the folder of Mini, nothing else from ~/.claude.json.
    let trusted = null
    const c = read(path.posix.join(home, ".claude.json"))
    const entry = c && c.projects && typeof c.projects === "object" ? c.projects[work] : null
    if (entry && typeof entry.hasTrustDialogAccepted === "boolean") trusted = entry.hasTrustDialogAccepted

    // What the own Claude Code settings of the owner allow beyond the folder of Mini. Null when they cannot be read.
    const items = []
    const add = (s) => { s = text(s); if (s && !items.includes(s)) items.push(s) }
    const FILES = "Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep"
    const RULE = new RegExp("^(" + FILES + "|Bash|WebFetch|WebSearch)(\\(|$)")
    const inWork = (rule) => {
      const m = new RegExp("^(?:" + FILES + ")\\((.*)\\)$").exec(rule)
      if (!m) return false
      let spec = m[1].trim()
      if (spec.startsWith("~/")) spec = path.posix.join(home, spec.slice(2))
      else if (spec.startsWith("//")) spec = spec.slice(1)
      else return false
      spec = path.posix.normalize(spec)
      return spec === work || spec.startsWith(work + "/")
    }
    let widened = null
    const s = load(path.posix.join(home, ".claude", "settings.json"))
    const perms = s.none ? {} : s.bad || !s.v || typeof s.v !== "object" ? null : s.v.permissions === undefined ? {} : s.v.permissions
    if (perms && typeof perms === "object" && !Array.isArray(perms) && (perms.allow === undefined || Array.isArray(perms.allow))) {
      if (exists(path.posix.join(work, ".claude"))) add("work/.claude")
      if (exists(path.posix.join(work, ".mcp.json"))) add("work/.mcp.json")
      if (Array.isArray(perms.additionalDirectories) && perms.additionalDirectories.length > 0) add("additionalDirectories")
      let bash = 0
      for (const rule of perms.allow || []) {
        if (typeof rule !== "string") continue
        const t = rule.trim()
        if (!RULE.test(t) || inWork(t)) continue
        // Bash rules are only counted, and web rules named without their hosts: what the owner typed there stays there.
        if (/^Bash(\(|$)/.test(t)) bash++
        else if (/^Web(Fetch|Search)/.test(t)) add(t.replace(/\(.*$/, ""))
        else add(t)
      }
      if (bash > 0) add("Bash (" + bash + " rule" + (bash === 1 ? "" : "s") + ")")
      widened = items.slice(0, 10)
    }
    process.stdout.write(JSON.stringify({ read: true, plugin, trusted, widened }))
  ' 2>/dev/null </dev/null)
  case "$OUT" in
    '{'*'}')
      EXTRA=${OUT#\{}
      EXTRA=${EXTRA%\}}
      ;;
  esac
fi

printf 'MINI_CHECK {"claude":%s,"claudeFound":%s,"node":%s,"tmux":%s,"git":%s,"signedIn":%s,%s,"runtime":%s,"session":%s,"logMore":%s,"errorNotes":%s}\n' \
  "$CLAUDE" "$HAS_CLAUDE" "$HAS_NODE" "$HAS_TMUX" "$HAS_GIT" "$SIGNED" "$EXTRA" "$RT" "$SESSION" "$LOGMORE" "$ERRNOTES"
