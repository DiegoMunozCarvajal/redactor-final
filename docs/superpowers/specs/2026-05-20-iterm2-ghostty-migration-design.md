# iTerm2 → Ghostty Migration Spec

## Scope

Migrate all iTerm2 configuration (profiles, colors, fonts, keybindings, hotkey window, shell integration) to Ghostty. Adapt Zsh config to support both terminals during transition. Preserve full rollback capability.

## What stays

- Zsh config in `~/.config/zsh/` — modular structure untouched
- Oh My Zsh, p10k, zsh-defer, zoxide, fzf, aliases — zero changes
- iTerm2 plist, shell integration, utilities — preserved, not deleted
- Ghostty.app 1.3.1 already installed at `/Applications/Ghostty.app`

## What changes

### 1. `config.ghostty` (new, at `~/Library/Application Support/com.mitchellh.ghostty/config.ghostty`)

Single file replacing iTerm2 GUI preferences and profile settings.

**Font:**
- `font-family = MesloLGS NF`
- `font-size = 16`
- `font-feature = calt` (ligatures)
- Regular weight — bold glyphs render bold, normal text renders normal

**Colors (dark mode, adapted from iTerm2 Default profile):**
- `background = #1d2021`
- `foreground = #ebdbb2`
- `palette = 0=#1d2021`
- `palette = 1=#cc2423`
- `palette = 2=#98ab3b`
- `palette = 3=#d79921`
- `palette = 4=#458588`
- `palette = 5=#b16286`
- `palette = 6=#689d6a`
- `palette = 7=#a89984`
- `palette = 8=#928374`
- `palette = 9=#fb4934`
- `palette = 10=#b8bb26`
- `palette = 11=#fabd2f`
- `palette = 12=#83a598`
- `palette = 13=#d3869b`
- `palette = 14=#8ec07c`
- `palette = 15=#ebdbb2`
- `selection-background = #665c54`
- `selection-foreground = #ebdbb2`
- `cursor-color = #ebdbb2`
- `cursor-text = #1d2021`

**Window:**
- `background-opacity = 1.0`
- `background-blur = false`
- `window-padding-x = 4`
- `window-padding-y = 4`
- `macos-titlebar-style = tabs`
- `window-theme = dark`
- `confirm-close-surface = false`

**Cursor and scrollback:**
- `cursor-style = bar`
- `cursor-style-blink = true`
- `scrollback-limit = 67108864` (~64MB, ~650K líneas; Ghostty no soporta unlimited aún)

**Quick Terminal (replaces iTerm2 hotkey window):**
- `quick-terminal-position = top`
- `quick-terminal-animation-duration = 0.15` (seconds, no ms)
- `quick-terminal-autohide = true`
- `quick-terminal-space-behavior = move`

**Keybindings:**
- `keybind = super+shift+f=text:\x1bf` (Escape+f → forward-word)
- `keybind = super+shift+b=text:\x1bb` (Escape+b → backward-word)
- `keybind = global:ctrl+space=toggle_quick_terminal` (reemplaza hotkey window; si no funciona usar `` global:ctrl+backquote ``)

**Mouse:**
- `mouse-hide-while-typing = true`
- `copy-on-select = true`

**Option key:**
- `macos-option-as-alt = true` (Option = Meta, matches iTerm2 Option Key Sends=2)

### 2. Zsh: `conf.d/20-iterm2.zsh` → `conf.d/20-terminal.zsh`

Rename and add Ghostty branch. iTerm2 path preserved for rollback.

Ghostty branch: load shell integration if script exists at `~/.ghostty/shell-integration.zsh` (optional, Ghostty uses OSC 7 natively so this is not required). No user variables emulation.

iTerm2 branch: unchanged, still works when `TERM_PROGRAM == iTerm.app`.

### 3. Zsh: `conf.d/90-local.zsh` title function

Rename `_iterm2_title` to `_terminal_title`. Same OSC 0 escape sequence, works in both terminals. No functional change.

### 4. iTerm2 utilities

All `~/.iterm2/` tools preserved. Replacements documented but not forced:
- `imgcat` → `chafa` (brew install chafa)
- `it2copy` → `pbcopy` (built-in macOS)
- `it2dl`/`it2ul` → `scp`/`rsync` (standard)

## Migration order

1. Write `config.ghostty`
2. Rename and adapt `20-terminal.zsh`
3. Rename title function in `90-local.zsh`
4. Open Ghostty.app — verify prompt renders, colors correct, ligatures work
5. Test: scroll performance, fzf, zoxide, git aliases, ssh colima
6. Use Ghostty as daily driver for 1 week
7. If satisfied: set Ghostty as default terminal, remove iTerm2-specific Zsh code (optional, later)
8. If not: close Ghostty, open iTerm2 — everything works as before

## Rollback

- `config.ghostty` can be deleted or renamed — Ghostty starts with defaults
- `20-terminal.zsh` iTerm2 branch still active — iTerm2 works identically
- iTerm2 plist and shell integration untouched
- Zero data loss risk — this is additive, not destructive

## What is NOT migrated

- **Per-profile shell integration settings** — Ghostty has no equivalent. OSC 7 covers directory tracking.
- **Separate light/dark mode colors** — Ghostty 1.3.x does not support per-theme palettes. Dark theme only.
- **iTerm2 user variables (gitBranch, projectName badges)** — Ghostty has no badge API. Title replacement via OSC 0 is the fallback.
- **colima dynamic profile** — replaced by alias `colima=ssh colima` or manual `ssh colima`.
- **Toolbelt (Jobs, Codecierge)** — Ghostty has no sidebar toolbelt. Standard CLI tools replace them.
- **API Server** — Ghostty has no scripting API. Not used by any scripts in the config.
