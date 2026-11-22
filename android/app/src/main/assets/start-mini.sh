#!/data/data/com.termux/files/usr/bin/bash
# Started by the Mini app through Termux's RUN_COMMAND, with this script on standard input.
# Starts Mini's runtime and Mini's own Claude Code session in tmux (if they are not already running) and answers with
# one line for the app: MINI_READY {"port":N,"token":"..."}, or MINI_ERROR <what is wrong>.
# The token is printed only in that line; the app keeps it in memory.

# Termux's exec helper breaks Claude Code ("unexpected e_type: 2"), and tmux would hand it down.
unset LD_PRELOAD

MINI="$HOME/.mini"
PLUGIN="$MINI/plugin"
HOME_DIR="$MINI/home"
WORK="$MINI/work"
REPO="https://github.com/Vinith-00704/Claude-Mini-bot"
TMUX_SOCKET="mini"
export PATH="$PATH:$HOME/.local/bin"
mkdir -p "$HOME_DIR" "$WORK" "$MINI/tmp"

fail() {
  echo "MINI_ERROR $*"
  exit 1
}

command -v claude >/dev/null 2>&1 || fail "Claude Code is not installed in Termux."
command -v node >/dev/null 2>&1 || fail "Node.js is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"
command -v tmux >/dev/null 2>&1 || fail "tmux is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"
command -v git >/dev/null 2>&1 || fail "git is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"

if [ ! -f "$PLUGIN/runtime/server.mjs" ]; then
  rm -rf "$PLUGIN"
  git clone --depth 1 --quiet "$REPO" "$PLUGIN" >/dev/null 2>&1 || fail "The Mini Bot plugin could not be downloaded. Check the phone's internet."
fi

# Keep Termux awake while Mini runs; the app's own notification says Mini is on.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

if ! tmux -L "$TMUX_SOCKET" has-session -t rt 2>/dev/null; then
  rm -f "$HOME_DIR/runtime.json"
  tmux -L "$TMUX_SOCKET" new-session -d -s rt \
    "unset LD_PRELOAD; MINI_BOT_HOME='$HOME_DIR' node '$PLUGIN/runtime/server.mjs' --serve >'$MINI/runtime.log' 2>&1"
fi

if ! tmux -L "$TMUX_SOCKET" has-session -t mini 2>/dev/null; then
  tmux -L "$TMUX_SOCKET" new-session -d -s mini -x 100 -y 40 -c "$WORK" \
    "unset LD_PRELOAD; export MINI_BOT_HOME='$HOME_DIR' MINI_BOT_ROLE=main CLAUDE_CODE_TMPDIR='$MINI/tmp'; exec claude --plugin-dir '$PLUGIN' -n Mini --permission-mode dontAsk --disallowedTools=AskUserQuestion,EnterPlanMode"
fi

for _ in $(seq 1 80); do
  [ -s "$HOME_DIR/runtime.json" ] && break
  sleep 0.5
done
[ -s "$HOME_DIR/runtime.json" ] || fail "Mini's runtime did not start. Its log is ~/.mini/runtime.log in Termux."

READY=$(node -e 'const i = require(process.argv[1]); process.stdout.write(JSON.stringify({ port: i.port, token: i.token }))' "$HOME_DIR/runtime.json") ||
  fail "Mini's runtime file could not be read."
echo "MINI_READY $READY"
