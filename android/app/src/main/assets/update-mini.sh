#!/data/data/com.termux/files/usr/bin/bash
# Started by the Mini app through Termux's RUN_COMMAND, with this script on standard input, when the owner taps Update
# Mini Bot. It brings the phone's own copy of the Mini Bot plugin (~/.mini/plugin, a clone made for the phone, not a
# repository of the owner's) up to the latest version. It touches nothing else and holds no key. The old copy stays
# until the new one is in place and its version reads: a failed download or checkout leaves the old copy as it was.
# The answer for the app is one line: MINI_UPDATED <version>, or MINI_ERROR <text>.

MINI="$HOME/.mini"
PLUGIN="$MINI/plugin"
NEW="$MINI/tmp/plugin-new"
OLD="$MINI/tmp/plugin-old"
REPO="https://github.com/Vinith-00704/Claude-Mini-bot"

fail() {
  echo "MINI_ERROR $*"
  exit 1
}

unset LD_PRELOAD
export PATH="$PATH:$HOME/.local/bin"
# Git never looks above ~/.mini for a repository (an owner's own repository around it is never touched), and never asks.
export GIT_CEILING_DIRECTORIES="$MINI" GIT_TERMINAL_PROMPT=0
mkdir -p "$MINI/tmp"

command -v git >/dev/null 2>&1 || fail "git is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"
command -v node >/dev/null 2>&1 || fail "Node.js is missing in Termux. In Termux, run: pkg install nodejs-lts tmux git"

# Not while Mini is being started (the same lock as the start script). A lock older than 3 minutes is left from a
# start that was killed.
LOCK="$MINI/tmp/start.lock"
LOCKED=0
for _ in $(seq 1 60); do
  if mkdir "$LOCK" 2>/dev/null; then
    LOCKED=1
    break
  fi
  SINCE=$(stat -c %Y "$LOCK" 2>/dev/null) && [ $(($(date +%s) - SINCE)) -gt 180 ] && rm -rf "$LOCK"
  sleep 0.5
done
[ "$LOCKED" = 1 ] || fail "Mini is starting in Termux. Try again in a minute."
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# The plugin's version from its manifest, or nothing.
version_of() {
  node -e '
    let v = ""
    try { v = String(require(process.argv[1]).version ?? "") } catch {}
    process.stdout.write(/^[0-9A-Za-z.+-]{1,40}$/.test(v) ? v : "")
  ' "$1/.claude-plugin/plugin.json" </dev/null
}

# 150 s at most for the network, so a dead connection ends here, before the app gives up at 180 s.
git_net() { timeout 150 git "$@" >/dev/null 2>&1 </dev/null; }

# The phone's own clone of the Mini Bot repository: a .git of its own, and origin is the repository.
own_clone() {
  [ -d "$PLUGIN/.git" ] && [ -f "$PLUGIN/runtime/server.mjs" ] &&
    [ "$(git -C "$PLUGIN" remote get-url origin 2>/dev/null </dev/null)" = "$REPO" ]
}

if own_clone; then
  PREV=$(git -C "$PLUGIN" rev-parse HEAD 2>/dev/null </dev/null)
  git_net -C "$PLUGIN" fetch --quiet --depth 1 origin HEAD || fail "The Mini Bot plugin could not be downloaded. Check the phone's internet."
  if ! git -C "$PLUGIN" checkout --quiet --force FETCH_HEAD >/dev/null 2>&1 </dev/null || [ -z "$(version_of "$PLUGIN")" ]; then
    # Back to what was there.
    [ -n "$PREV" ] && git -C "$PLUGIN" checkout --quiet --force "$PREV" >/dev/null 2>&1 </dev/null
    fail "The Mini Bot plugin could not be updated in Termux. The copy that was there is kept."
  fi
else
  # Missing, or not a clone of its own: a fresh clone beside it, swapped in only when it is whole.
  rm -rf "$NEW" "$OLD"
  git_net clone --depth 1 --quiet "$REPO" "$NEW" || { rm -rf "$NEW"; fail "The Mini Bot plugin could not be downloaded. Check the phone's internet."; }
  if [ ! -f "$NEW/runtime/server.mjs" ] || [ -z "$(version_of "$NEW")" ]; then
    rm -rf "$NEW"
    fail "The Mini Bot plugin was downloaded, but it is not complete. The copy that was there is kept."
  fi
  [ -e "$PLUGIN" ] && { mv "$PLUGIN" "$OLD" || { rm -rf "$NEW"; fail "The Mini Bot plugin could not be replaced in Termux."; }; }
  if ! mv "$NEW" "$PLUGIN"; then
    [ -e "$OLD" ] && mv "$OLD" "$PLUGIN"
    rm -rf "$NEW"
    fail "The Mini Bot plugin could not be replaced in Termux."
  fi
  rm -rf "$OLD"
fi

VERSION=$(version_of "$PLUGIN")
[ -n "$VERSION" ] || fail "The Mini Bot plugin was downloaded, but its version could not be read."
echo "MINI_UPDATED $VERSION"
