# iTerm2 → Ghostty Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate complete iTerm2 configuration to Ghostty — colors, fonts, keybindings, hotkey window, shell integration — while preserving full rollback to iTerm2.

**Architecture:** Write single `config.ghostty` file (~60 lines) replacing all iTerm2 GUI preferences. Adapt two Zsh config files: rename `20-iterm2.zsh` → `20-terminal.zsh` with Ghostty branch, rename title function in `90-local.zsh`. All iTerm2 files preserved untouched.

**Tech Stack:** Ghostty 1.3.1, Zsh 5.9, MesloLGS Nerd Font, Powerlevel10k

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| **Create** | `~/Library/Application Support/com.mitchellh.ghostty/config.ghostty` | Full Ghostty config |
| **Rename + Edit** | `~/.config/zsh/conf.d/20-iterm2.zsh` → `20-terminal.zsh` | Add Ghostty shell integration branch |
| **Edit** | `~/.config/zsh/conf.d/90-local.zsh` | Rename `_iterm2_title` → `_terminal_title` |

---

### Task 1: Write Ghostty config file

**Files:**
- Create: `~/Library/Application Support/com.mitchellh.ghostty/config.ghostty`

All keys verified against ghostty.org/docs via Context7. Colors extracted from `~/Library/Preferences/com.googlecode.iterm2.plist` dark mode values via plistlib RGB→hex conversion.

- [ ] **Step 1: Write config.ghostty**

```ini
# Ghostty config — migrated from iTerm2 on 2026-05-20
# iTerm2 profile: Default (1A3402F9-10B7-4349-A88C-569EDFFB0351)

# Font
font-family = MesloLGS NF
font-size = 16
font-feature = calt

# Colors (dark mode, exact values from iTerm2 plist)
background = #1d2021
foreground = #ebdbb2
palette = 0=#1d2021
palette = 1=#cc241d
palette = 2=#98971a
palette = 3=#d79921
palette = 4=#458588
palette = 5=#b16286
palette = 6=#689d6a
palette = 7=#a89984
palette = 8=#928374
palette = 9=#fb4934
palette = 10=#b8bb26
palette = 11=#fabd2f
palette = 12=#83a598
palette = 13=#d3869b
palette = 14=#8ec07c
palette = 15=#ebdbb2
selection-background = #665c54
selection-foreground = #ebdbb2
cursor-color = #ebdbb2
cursor-text = #1d2021

# Window
background-opacity = 1.0
background-blur = false
window-padding-x = 4
window-padding-y = 4
macos-titlebar-style = tabs
window-theme = dark
confirm-close-surface = false

# Cursor and scrollback
cursor-style = bar
cursor-style-blink = true
scrollback-limit = 67108864

# Quick Terminal (replaces iTerm2 Ctrl+Space hotkey window)
quick-terminal-position = top
quick-terminal-animation-duration = 0.15
quick-terminal-autohide = true
quick-terminal-space-behavior = move

# Keybindings
keybind = super+shift+f=text:\x1bf
keybind = super+shift+b=text:\x1bb
keybind = global:ctrl+space=toggle_quick_terminal

# Mouse
mouse-hide-while-typing = true
copy-on-select = true

# Option as Meta (matches iTerm2 Option Key Sends=2)
macos-option-as-alt = true
```

- [ ] **Step 2: Commit**

```bash
git add "~/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
# Not in repo — this is a local config file. No commit needed.
echo "Ghostty config written — verify with: cat ~/Library/Application\ Support/com.mitchellh.ghostty/config.ghostty"
```

---

### Task 2: Adapt Zsh — rename 20-iterm2.zsh → 20-terminal.zsh with Ghostty branch

**Files:**
- Rename: `~/.config/zsh/conf.d/20-iterm2.zsh` → `~/.config/zsh/conf.d/20-terminal.zsh`
- Edit: `~/.config/zsh/conf.d/20-terminal.zsh`

- [ ] **Step 1: Rename the file**

```bash
mv ~/.config/zsh/conf.d/20-iterm2.zsh ~/.config/zsh/conf.d/20-terminal.zsh
```

- [ ] **Step 2: Edit the file — add Ghostty branch + update header**

Read the current file content and replace entirely:

```zsh
# === Terminal-specific integrations (iTerm2 + Ghostty) ===

# iTerm2 utilities (imgcat, it2dl, it2ul, it2copy, etc.)
[[ -d "$HOME/.iterm2" ]] && path=("$HOME/.iterm2" $path)

# ── Ghostty ──────────────────────────────────────────────────────
if [[ "$TERM_PROGRAM" == "ghostty" ]]; then
  # Ghostty sets TERM_PROGRAM=ghostty (like iTerm2 sets TERM_PROGRAM=iTerm.app)
  # OSC 7 directory tracking is built-in, no script needed
  # GHOSTTY_RESOURCES_DIR is also set at startup for locating integration scripts
  if [[ -f "$GHOSTTY_RESOURCES_DIR/shell-integration.zsh" ]]; then
    source "$GHOSTTY_RESOURCES_DIR/shell-integration.zsh"
  fi
  return
fi

# ── iTerm2 ───────────────────────────────────────────────────────
if [[ "$TERM_PROGRAM" != "iTerm.app" ]]; then
  return
fi

# Prevent shell integration from modifying PS1 (p10k owns it)
export ITERM2_SQUELCH_MARK=1

# Load iTerm2 shell integration
if [[ -f "$HOME/.iterm2_shell_integration.zsh" ]]; then
  source "$HOME/.iterm2_shell_integration.zsh"
fi

# User-defined variables — exposed to badges, status bar, automatic profile switching
function iterm2_print_user_vars() {
  local toplevel git_branch

  toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" || return

  git_branch="$(git branch --show-current 2>/dev/null)"
  [[ -n "$git_branch" ]] && iterm2_set_user_var gitBranch "$git_branch"

  iterm2_set_user_var projectName "${toplevel##*/}"
}
```

Key changes:
- `TERM == "xterm-ghostty"` guard (Ghostty sets this TERM)
- Ghostty branch returns early (skip iTerm2 code)
- iTerm2 code unchanged
- Function signatures preserved (for rollback)

- [ ] **Step 3: Verify file loads without errors**

```bash
zsh -c 'source ~/.config/zsh/conf.d/20-terminal.zsh; echo "OK: \$?=$?"'
```

Expected: `OK: $?=0` (loads cleanly, exits silently when not in iTerm2 or Ghostty)

- [ ] **Step 4: Commit**

```bash
cd ~/.config/zsh
git add conf.d/20-iterm2.zsh conf.d/20-terminal.zsh  # if zsh config is git-tracked
# If not in git:
echo "20-terminal.zsh ready — verify: cat ~/.config/zsh/conf.d/20-terminal.zsh"
```

---

### Task 3: Adapt Zsh — rename title function in 90-local.zsh

**Files:**
- Modify: `~/.config/zsh/conf.d/90-local.zsh`

- [ ] **Step 1: Rename function and hook reference**

Current content:
```zsh
# === Machine-specific: secrets, integrations ===

# Secrets — sourced from separate file (chmod 600, never committed)
[[ -f "$ZDOTDIR/conf.d/secrets.env" ]] && source "$ZDOTDIR/conf.d/secrets.env"

# iTerm2 — report directory for title bar
function _iterm2_title() {
  print -n "\e]0;${HOST%%.*}:${PWD/#$HOME/~}\a"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _iterm2_title

# zoxide
if command -v zoxide >/dev/null 2>&1; then
  eval "$(zoxide init zsh)"
fi
```

Replace the title block:

```zsh
# === Machine-specific: secrets, integrations ===

# Secrets — sourced from separate file (chmod 600, never committed)
[[ -f "$ZDOTDIR/conf.d/secrets.env" ]] && source "$ZDOTDIR/conf.d/secrets.env"

# Terminal title (works in iTerm2, Ghostty, Terminal.app)
function _terminal_title() {
  print -n "\e]0;${HOST%%.*}:${PWD/#$HOME/~}\a"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _terminal_title

# zoxide
if command -v zoxide >/dev/null 2>&1; then
  eval "$(zoxide init zsh)"
fi
```

- [ ] **Step 2: Verify file loads without errors**

```bash
zsh -c 'source ~/.config/zsh/conf.d/90-local.zsh; echo "OK: \$?=$?"'
```

Expected: `OK: $?=0`

- [ ] **Step 3: Commit**

```bash
# If zsh config is git-tracked:
cd ~/.config/zsh && git add conf.d/90-local.zsh && git commit -m "refactor: rename _iterm2_title to _terminal_title"
# If not tracked:
echo "90-local.zsh updated — verify: cat ~/.config/zsh/conf.d/90-local.zsh"
```

---

### Task 4: Verification — launch Ghostty and test

- [ ] **Step 1: Open Ghostty.app and check basics**

```bash
open -a Ghostty
```

Verify:
- [ ] Prompt renders with p10k powerline separators (Nerd Font icons visible)
- [ ] Background is dark (#1d2021), foreground is warm white (#ebdbb2)
- [ ] Ligatures render (check `!=`, `->`, `=>` in terminal)
- [ ] `echo $TERM_PROGRAM` outputs `ghostty`

- [ ] **Step 2: Test colors with a color strip**

Run in Ghostty:
```bash
for i in {0..15}; do printf "\e[48;5;${i}m  %3d  \e[0m" $i; (( (i+1) % 8 == 0 )) && echo; done
```

Verify: all 16 ANSI colors are visible and distinct on dark background.

- [ ] **Step 3: Test keybindings**

- Press Cmd+Shift+F → cursor should move forward one word (forward-word)
- Press Cmd+Shift+B → cursor should move backward one word (backward-word)
- Press Ctrl+Space → quick terminal should toggle (if binding works)

- [ ] **Step 4: Test with heavy output**

```bash
cat /usr/share/dict/words 2>/dev/null || find /usr -name "*.plist" -exec cat {} \; 2>/dev/null | head -100000
```

Verify: scroll is smooth, no jank, no tearing.

- [ ] **Step 5: Test Zsh features**

- `ls -la` → colors with `ls -G` (or gls/eza)
- `cd ~/code/redactor-v4` → zoxide `z redactor` 
- Ctrl+T → fzf file selector
- `git log --oneline --graph -20` → ANSI colors, no corruption
- Option+F / Option+B → word navigation in shell

- [ ] **Step 6: Verify iTerm2 still works (rollback check)**

```bash
open -a iTerm
```

Verify: everything works as before. iTerm2 config untouched.

---

### Task 5: Cleanup (optional, after 1 week of Ghostty use)

Only after confirming Ghostty as daily driver:

- [ ] **Step 1: Remove iTerm2-specific code from 20-terminal.zsh**

Remove the iTerm2 branch (everything after `# ── iTerm2 ──` comment). Keep Ghostty branch and iTerm2 utils PATH.

- [ ] **Step 2: Set Ghostty as default terminal**

macOS: System Settings → Desktop & Dock → Default web browser (bottom) → select Ghostty. Or:
```bash
# Not directly settable — must be done in Ghostty preferences or System Settings
```

- [ ] **Step 3: Remove iTerm2 shell integration (optional)**

```bash
rm -f ~/.iterm2_shell_integration.zsh
# Keep ~/.iterm2/ utilities (imgcat etc.) as they may be useful
```
