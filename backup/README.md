# bang-backup

Backs up a Pop!_OS system to pCloud via rclone. Runs automatically 4x daily, skips metered networks, and keeps weekly snapshots.

## What gets backed up

- `~/Bang-Labs/` — code projects (minus .git, build artifacts, open-source)
- Dotfiles — .bashrc, .profile, .zshenv, .gitconfig, ssh config
- App configs — COSMIC, kitty, wezterm, VS Code, rclone, etc.
- `~/.local/share/` — fonts, keyrings, app data
- `~/.claude/` — settings and project configs
- Rust config — rustup settings
- Package lists — apt, flatpak (for reinstalling on restore)

## What gets excluded

Build artifacts, caches, .git, node_modules, .venv, target/, browsers, pCloud internals, SSH private keys, .env files, open-source projects. See `backup.exclude` for the full list.

## Setup

```bash
# Install rclone and configure pCloud (one-time)
sudo apt install rclone
rclone config   # create remote named 'pcloud', type 'pcloud'

# Enable automatic backups
./install.sh
```

## Usage

```bash
./bang-backup              # run backup
./bang-backup --dry-run    # preview without uploading
./bang-backup --force      # override metered network check
./bang-backup --verbose    # detailed output
```

## How it works

- **Every run:** Syncs incrementally to `pcloud:Backups/popOS/` (only changed files transfer)
- **Sundays:** Creates a snapshot at `pcloud:Backups/popOS-YYMMDD/` and prunes snapshots older than 4 weeks
- **Metered networks:** Automatically skipped (checks NetworkManager)
- **Scheduling:** systemd user timer runs at 8am, noon, 4pm, 8pm with `Persistent=true` (catches up after sleep)

## Restore

Run `./restore.sh` on a fresh Pop!_OS install. It walks through each step interactively — rclone setup, SSH key generation, package reinstall, file restore, and re-enabling backups.

See `restore.md` for the manual step-by-step guide.

## Managing the timer

```bash
systemctl --user list-timers              # check schedule
systemctl --user status pcloud-backup     # last run status
systemctl --user disable --now pcloud-backup.timer  # disable
systemctl --user enable --now pcloud-backup.timer   # re-enable
```
