#!/usr/bin/env bash
set -euo pipefail

REMOTE="pcloud"
SRC="${REMOTE}:Backups/popOS"

log() {
    echo ""
    echo "=== $* ==="
}

confirm() {
    read -rp "$1 [Y/n] " answer
    case "$answer" in
        [nN]*) return 1 ;;
        *) return 0 ;;
    esac
}

# --- Step 1: Install rclone ---

log "Step 1: rclone"

if ! command -v rclone &>/dev/null; then
    echo "Installing rclone..."
    sudo apt install -y rclone
fi

if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:$"; then
    echo "pCloud remote not configured. Setting up now..."
    echo "Create a remote named 'pcloud' with type 'pcloud'."
    echo ""
    rclone config
fi

# Verify connection
if ! rclone lsd "${SRC}" &>/dev/null; then
    echo "ERROR: Cannot access ${SRC}. Check your rclone config."
    exit 1
fi
echo "Connected to pCloud backup."

# --- Step 2: SSH keys ---

log "Step 2: SSH keys"

if [[ ! -f "$HOME/.ssh/id_ed25519" ]]; then
    if confirm "Generate new SSH key?"; then
        mkdir -p "$HOME/.ssh"
        chmod 700 "$HOME/.ssh"
        ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519"
        echo ""
        echo "Your new public key:"
        cat "$HOME/.ssh/id_ed25519.pub"
        echo ""
        echo "Add this key to:"
        echo "  - GitHub: https://github.com/settings/keys"
        echo "  - Any other servers you use"
        echo ""
        read -rp "Press Enter when done..."
    fi
else
    echo "SSH key already exists, skipping."
fi

# --- Step 3: Restore dotfiles ---

log "Step 3: Dotfiles"

if confirm "Restore dotfiles (.bashrc, .profile, .zshenv, .gitconfig)?"; then
    rclone copyto "${SRC}/dotfiles/.bashrc"    "$HOME/.bashrc"    2>/dev/null || true
    rclone copyto "${SRC}/dotfiles/.profile"   "$HOME/.profile"   2>/dev/null || true
    rclone copyto "${SRC}/dotfiles/.zshenv"    "$HOME/.zshenv"    2>/dev/null || true
    rclone copyto "${SRC}/dotfiles/.gitconfig" "$HOME/.gitconfig" 2>/dev/null || true
    rclone copy "${SRC}/dotfiles/git" "$HOME/.config/git/"        2>/dev/null || true
    rclone copyto "${SRC}/dotfiles/ssh_config" "$HOME/.ssh/config" 2>/dev/null || true
    echo "Dotfiles restored."
fi

# --- Step 4: Install packages ---

log "Step 4: Packages"

TMPDIR=$(mktemp -d)
rclone copy "${SRC}/package-lists/" "$TMPDIR/"

if [[ -f "$TMPDIR/apt-manual.txt" ]] && confirm "Install apt packages from backup list?"; then
    echo "Installing packages (this may take a while)..."
    sudo xargs apt install -y < "$TMPDIR/apt-manual.txt" 2>&1 | tail -5
    echo "Done. Some packages may have been skipped if unavailable."
fi

if [[ -f "$TMPDIR/flatpak-apps.txt" ]] && confirm "Install flatpak apps?"; then
    while IFS=$'\t' read -r app_id app_name; do
        echo "Installing ${app_name:-$app_id}..."
        flatpak install -y flathub "$app_id" 2>/dev/null || echo "  SKIP: $app_id"
    done < "$TMPDIR/flatpak-apps.txt"
fi

rm -rf "$TMPDIR"

# --- Step 5: Restore code projects ---

log "Step 5: Code projects (Bang-Labs)"

if confirm "Restore Bang-Labs workspace?"; then
    echo "Pulling files from backup (this may take a while)..."
    rclone copy "${SRC}/Bang-Labs/" "$HOME/Bang-Labs/" --progress
    echo ""
    echo "Files restored. Git repos need re-initializing."
    echo "For each project, run:"
    echo "  cd ~/Bang-Labs/Code/<project>"
    echo "  git init"
    echo "  git remote add origin git@github.com:AdamBK/<repo>.git"
    echo "  git fetch origin"
    echo "  git reset origin/main"
    echo ""
    read -rp "Press Enter to continue..."
fi

# --- Step 6: Restore app configs ---

log "Step 6: App configs"

if confirm "Restore app configs (cosmic, kitty, wezterm, VS Code, etc.)?"; then
    for dir in cosmic git kitty wezterm Code libreoffice rclone \
               qBittorrent qt5ct qt6ct gtk-3.0 gtk-4.0 dconf autostart pulse; do
        rclone copy "${SRC}/config/$dir" "$HOME/.config/$dir/" 2>/dev/null || true
    done
    echo "App configs restored. Log out and back in for desktop settings to take effect."
fi

# --- Step 7: Restore local data ---

log "Step 7: Local data (fonts, keyrings, etc.)"

if confirm "Restore ~/.local/share data?"; then
    rclone copy "${SRC}/local-share/" "$HOME/.local/share/" --progress
    fc-cache -fv 2>/dev/null || true
    echo "Local data restored."
fi

# --- Step 8: Install Rust ---

log "Step 8: Rust"

if ! command -v rustup &>/dev/null; then
    if confirm "Install Rust via rustup?"; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
        rclone copyto "${SRC}/rustup/settings.toml" "$HOME/.rustup/settings.toml" 2>/dev/null || true
    fi
else
    echo "Rust already installed, skipping."
fi

# --- Step 9: Restore Claude config ---

log "Step 9: Claude Code config"

if confirm "Restore Claude Code settings?"; then
    mkdir -p "$HOME/.claude"
    rclone copy "${SRC}/claude/" "$HOME/.claude/" --progress
    echo "Claude config restored."
fi

# --- Step 10: Re-enable backups ---

log "Step 10: Re-enable automatic backups"

if confirm "Set up automatic backup timer?"; then
    BACKUP_DIR="$HOME/Bang-Labs/Code/toolkit/backup"
    if [[ -f "$BACKUP_DIR/install.sh" ]]; then
        "$BACKUP_DIR/install.sh"
    else
        echo "SKIP: install.sh not found at $BACKUP_DIR"
        echo "Re-enable manually once git repos are set up."
    fi
fi

log "Restore complete!"
echo ""
echo "Remaining manual steps:"
echo "  1. Re-initialize git repos (see step 5 above)"
echo "  2. Log out and back in for desktop config changes"
echo "  3. Log into browsers to sync bookmarks/passwords"
echo ""
