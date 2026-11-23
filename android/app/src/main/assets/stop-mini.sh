#!/data/data/com.termux/files/usr/bin/bash
# Started by the Mini app: ends Mini's runtime and its Claude Code session, and lets Termux sleep again.
# Claude Code is ended only here, in Mini's own tmux session; the owner's other Termux sessions are untouched.
# A start still under way (cloning, waiting for its lock, starting the runtime) sees the stop mark left here and ends
# itself with whatever it made, so nothing a start began before this stop keeps running after it.
MINI="$HOME/.mini"
mkdir -p "$MINI/tmp" && chmod 700 "$MINI/tmp"
umask 077
printf '%s %s\n' "$$" "$(date +%s%N)" >"$MINI/tmp/stopped"
# The runtime first, so its keeper cannot start Claude Code again in between.
tmux -L mini kill-session -t rt 2>/dev/null
tmux -L mini kill-session -t mini 2>/dev/null
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
echo "MINI_STOPPED"
