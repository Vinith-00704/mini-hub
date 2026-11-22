#!/data/data/com.termux/files/usr/bin/bash
# Started by the Mini app: ends Mini's Claude Code session and its runtime, and lets Termux sleep again.
# Claude Code is ended only here, in Mini's own tmux session; the owner's other Termux sessions are untouched.
tmux -L mini kill-session -t mini 2>/dev/null
tmux -L mini kill-session -t rt 2>/dev/null
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
echo "MINI_STOPPED"
