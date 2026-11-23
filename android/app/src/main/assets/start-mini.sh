#!/data/data/com.termux/files/usr/bin/bash
# Started by the Mini app through Termux's RUN_COMMAND, with this script on standard input and three lines put before
# it: MINI_OVERLAY_KEY, MINI_HANDS_URL and MINI_HANDS_TOKEN. They stay plain shell variables and are never exported:
# the tmux server Mini's sessions share takes its environment from here, so anything exported reaches Mini's session.
# Every start restarts Mini's runtime with these fresh keys, handed to it once through a one-use fifo. Mini's own Claude
# Code session is left as it is; the new runtime takes it back, or starts it with ~/.mini/session.sh.
# The answer for the app is one line: MINI_READY {"port":N,"token":"...","version":"..."}, or MINI_ERROR <text>.
# The runtime's token is given only in that line; the app keeps it in memory.

MINI="$HOME/.mini"
PLUGIN="$MINI/plugin"
HOME_DIR="$MINI/home"
WORK="$MINI/work"
REPO="https://github.com/Vinith-00704/Claude-Mini-bot"
TMUX_SOCKET="mini"
STARTED_RT=0
WOKE=0
FIFO=""
WRITER=""
# What stop-mini.sh last left; a different mark later means Mini was stopped after this start began.
STOPS="$MINI/tmp/stopped"
STOPS_SEEN=$(cat "$STOPS" 2>/dev/null)

fail() {
  [ -n "$WRITER" ] && kill "$WRITER" 2>/dev/null
  [ -n "$FIFO" ] && rm -f "$FIFO"
  [ "$STARTED_RT" = 1 ] && tmux -L "$TMUX_SOCKET" kill-session -t rt 2>/dev/null
  echo "MINI_ERROR $*"
  exit 1
}

# Mini was stopped while this start was under way: what it made goes (the runtime first, then the Claude Code session
# the runtime may have started), Termux may sleep again, and the start ends.
end_if_stopped() {
  [ "$(cat "$STOPS" 2>/dev/null)" = "$STOPS_SEEN" ] && return 0
  if [ "$STARTED_RT" = 1 ]; then
    tmux -L "$TMUX_SOCKET" kill-session -t rt 2>/dev/null
    tmux -L "$TMUX_SOCKET" kill-session -t mini 2>/dev/null
    STARTED_RT=0
  fi
  [ "$WOKE" = 1 ] && command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
  fail "Mini was stopped while it was starting."
}

# 1. The app's keys, as the app makes them.
HEX='^[0-9a-f]{64}$'
LOOPBACK='^http://127\.0\.0\.1:[0-9]{1,5}$'
[[ $MINI_OVERLAY_KEY =~ $HEX && $MINI_HANDS_TOKEN =~ $HEX && $MINI_HANDS_URL =~ $LOOPBACK ]] ||
  fail "Mini's start was missing its keys. Start Mini again from the app."

# 2. Termux's exec helper breaks Claude Code ("unexpected e_type: 2"), and tmux would hand it down.
unset LD_PRELOAD
export PATH="$PATH:$HOME/.local/bin"
# ~/.mini/tmp holds the start's own things (its lock, the stop mark, the keys' fifo) and is the app's scripts' alone:
# Claude Code's temporary files go to ~/.mini/claude-tmp, and Mini's session may neither read nor change ~/.mini/tmp.
mkdir -p "$HOME_DIR" "$WORK" "$MINI/tmp" "$MINI/claude-tmp" && chmod 700 "$MINI/tmp" "$MINI/claude-tmp" ||
  fail "Mini's folders could not be made in Termux."

# One start at a time: a start the app gave up waiting for may still be cloning or starting the runtime. A lock older
# than 3 minutes is left from a start that was killed. A stop while this start waits ends it here.
LOCK="$MINI/tmp/start.lock"
LOCKED=0
for _ in $(seq 1 120); do
  end_if_stopped
  if mkdir "$LOCK" 2>/dev/null; then
    LOCKED=1
    break
  fi
  SINCE=$(stat -c %Y "$LOCK" 2>/dev/null) && [ $(($(date +%s) - SINCE)) -gt 180 ] && rm -rf "$LOCK"
  sleep 0.5
done
[ "$LOCKED" = 1 ] || fail "Mini is already starting in Termux. Try again in a minute."
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

command -v claude >/dev/null 2>&1 || fail "Claude Code is not installed in Termux."
command -v node >/dev/null 2>&1 || fail "Node.js is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"
command -v tmux >/dev/null 2>&1 || fail "tmux is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"
command -v git >/dev/null 2>&1 || fail "git is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"

if [ ! -f "$PLUGIN/runtime/server.mjs" ]; then
  rm -rf "$PLUGIN"
  git clone --depth 1 --quiet "$REPO" "$PLUGIN" >/dev/null 2>&1 || fail "The Mini Bot plugin could not be downloaded. Check the phone's internet."
fi

# 3. The plugin must know the phone: 0.8.0 or later.
VERSION=$(node -e '
  let v = ""
  try { v = String(require(process.argv[1]).version ?? "") } catch {}
  if (!/^[0-9A-Za-z.+-]{1,40}$/.test(v)) v = ""
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  process.stdout.write(v)
  process.exitCode = m && (Number(m[1]) > 0 || Number(m[2]) >= 8) ? 0 : 1
' "$PLUGIN/.claude-plugin/plugin.json") ||
  fail "Mini Bot on this phone is ${VERSION:-an unknown version}; Mini needs 0.8.0 or later. Tap Update Mini Bot on the Brain screen."

# 4. How Mini's own Claude Code session starts, written afresh at every start, with no keys in it. Its limits are Claude
# Code's command-line flags, not a settings file: no commands, no web, files only in ~/.mini/work. Deny wins over allow,
# so the work folder's .claude/ and .mcp.json stay shut and the session cannot widen itself.
umask 077
cat >"$MINI/session.sh.new" <<'SESSION'
#!/data/data/com.termux/files/usr/bin/bash
# Mini's own Claude Code session on the phone. Written by the Mini app's start script at every start: edits here do not
# last. Started by Mini's runtime in the "mini" tmux session, with --resume <id> and --model <name> when it has them.
unset LD_PRELOAD
export MINI_BOT_HOME="$HOME/.mini/home" MINI_BOT_ROLE=main MINI_BOT_PLATFORM=android CLAUDE_CODE_TMPDIR="$HOME/.mini/claude-tmp"
cd "$HOME/.mini/work" || exit 1
SAFE='^[A-Za-z0-9][]A-Za-z0-9._:@/[-]*$'
KEEP=()
while [ $# -gt 0 ]; do
  case "$1" in
    --resume | --model)
      if [ $# -ge 2 ] && [[ $2 =~ $SAFE ]]; then
        KEEP+=("$1" "$2")
        shift 2
        continue
      fi
      ;;
  esac
  shift
done
exec claude --plugin-dir "$HOME/.mini/plugin" -n Mini --permission-mode dontAsk \
  '--disallowedTools=Bash,NotebookEdit,WebFetch,WebSearch,AskUserQuestion,EnterPlanMode,ExitPlanMode,Read(~/.mini/home/**),Read(~/.mini/tmp/**),Read(~/.claude/**),Read(~/.claude.json),Read(~/.termux/**),Edit(~/.claude/**),Edit(~/.termux/**),Edit(~/.mini/*.sh),Edit(~/.mini/tmp/**),Edit(~/.mini/work/.claude/**),Edit(~/.mini/work/.mcp.json)' \
  '--allowedTools=mcp__mini-bot__phone_status,mcp__mini-bot__phone_read,mcp__mini-bot__add_routine,mcp__mini-bot__list_routines,mcp__mini-bot__remove_routine,mcp__mini-bot__design_bot,mcp__mini-bot__get_bot,Read(~/.mini/work/**),Edit(~/.mini/work/**)' \
  "${KEEP[@]}"
SESSION
[ -s "$MINI/session.sh.new" ] && chmod 700 "$MINI/session.sh.new" && mv -f "$MINI/session.sh.new" "$MINI/session.sh" ||
  fail "Mini's session script could not be written in Termux."

# A stop that came while this start cloned or waited ends it before anything runs.
end_if_stopped

# 5. Keep Termux awake while Mini runs; the app's own notification says Mini is on.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock && WOKE=1

# 6. The runtime, always fresh, with this start's keys. Mini's "mini" tmux session is not touched here.
tmux -L "$TMUX_SOCKET" kill-session -t rt 2>/dev/null
rm -f "$HOME_DIR/runtime.json"
FIFO="$MINI/tmp/keys.$$"
rm -f "$FIFO"
mkfifo -m 600 "$FIFO" || { FIFO=""; fail "Mini's runtime could not be given its keys."; }
tmux -L "$TMUX_SOCKET" new-session -d -s rt \
  "unset LD_PRELOAD; MINI_BOT_HOME='$HOME_DIR' MINI_BOT_WORK='$WORK' MINI_BOT_OVERLAY=external MINI_BOT_SESSION_SCRIPT='$MINI/session.sh' exec node '$PLUGIN/runtime/server.mjs' --serve <'$FIFO' >'$MINI/runtime.log' 2>&1" ||
  fail "Mini's runtime could not be started in tmux."
STARTED_RT=1
# The keys reach the runtime only through the fifo, written by the shell itself (a builtin: no process shows them).
LINE="{\"overlayKey\":\"$MINI_OVERLAY_KEY\",\"handsUrl\":\"$MINI_HANDS_URL\",\"handsToken\":\"$MINI_HANDS_TOKEN\"}"
( printf '%s\n' "$LINE" >"$FIFO" ) &
WRITER=$!
LINE=""
unset MINI_OVERLAY_KEY MINI_HANDS_URL MINI_HANDS_TOKEN
for _ in $(seq 1 20); do
  kill -0 "$WRITER" 2>/dev/null || break
  sleep 0.5
done
kill -0 "$WRITER" 2>/dev/null && fail "Mini's runtime did not take its keys."
wait "$WRITER" || { WRITER=""; fail "Mini's runtime did not take its keys."; }
WRITER=""
rm -f "$FIFO"
FIFO=""

# 7. The runtime says where it listens.
for _ in $(seq 1 80); do
  end_if_stopped
  [ -s "$HOME_DIR/runtime.json" ] && break
  sleep 0.5
done
end_if_stopped
[ -s "$HOME_DIR/runtime.json" ] || fail "Mini's runtime did not start. Its log is ~/.mini/runtime.log in Termux."

READY=$(node -e 'const i = require(process.argv[1]); process.stdout.write(JSON.stringify({ port: i.port, token: i.token, version: process.argv[2] }))' "$HOME_DIR/runtime.json" "$VERSION") ||
  fail "Mini's runtime file could not be read."
end_if_stopped
echo "MINI_READY $READY"
