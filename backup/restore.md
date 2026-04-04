# System Restore Guide

Restore steps after a fresh Pop!_OS install.

## 1. Install rclone and connect pCloud

```bash
sudo apt install rclone
rclone config
# Create remote named 'pcloud', type 'pcloud', authorize via browser
```

Verify: `rclone lsd pcloud:Backups/popOS/`

## 2. Generate new SSH keys

```bash
ssh-keygen -t ed25519
```

Add the new public key to:
- GitHub: https://github.com/settings/keys
- Any servers you access via SSH

## 3. Restore dotfiles

```bash
rclone copy pcloud:Backups/popOS/dotfiles/ ~/restore-tmp/dotfiles/
cp ~/restore-tmp/dotfiles/.bashrc ~/.bashrc
cp ~/restore-tmp/dotfiles/.profile ~/.profile
cp ~/restore-tmp/dotfiles/.zshenv ~/.zshenv
cp ~/restore-tmp/dotfiles/.gitconfig ~/.gitconfig
mkdir -p ~/.config/git
cp ~/restore-tmp/dotfiles/git/* ~/.config/git/
# If you had an SSH config:
cp ~/restore-tmp/dotfiles/ssh_config ~/.ssh/config
source ~/.bashrc
```

## 4. Reinstall packages

```bash
rclone copy pcloud:Backups/popOS/package-lists/ ~/restore-tmp/package-lists/

# APT packages (review first — some may not exist on new OS version)
sudo xargs apt install -y < ~/restore-tmp/package-lists/apt-manual.txt

# Flatpak apps
cat ~/restore-tmp/package-lists/flatpak-apps.txt
# Install each manually, e.g.:
# flatpak install flathub com.jetbrains.PyCharm-Professional
```

## 5. Restore code projects

```bash
rclone copy pcloud:Backups/popOS/Bang-Labs/ ~/Bang-Labs/
```

Then re-initialize git repos. Each project directory needs:
```bash
cd ~/Bang-Labs/Code/<project>
git init
git remote add origin git@github.com:AdamBK/<repo>.git
git fetch origin
git reset origin/main
```

Or clone fresh and copy working files over:
```bash
git clone git@github.com:AdamBK/<repo>.git /tmp/<repo>
rsync -av ~/Bang-Labs/Code/<project>/ /tmp/<repo>/ --exclude=.git
```

## 6. Restore app configs

```bash
rclone copy pcloud:Backups/popOS/config/ ~/.config/
```

Log out and back in for COSMIC desktop settings to take effect.

## 7. Restore local data (fonts, keyrings, etc.)

```bash
rclone copy pcloud:Backups/popOS/local-share/ ~/.local/share/
fc-cache -fv  # rebuild font cache
```

## 8. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rclone copyto pcloud:Backups/popOS/rustup/settings.toml ~/.rustup/settings.toml
```

## 9. Restore Claude Code config

```bash
mkdir -p ~/.claude
rclone copy pcloud:Backups/popOS/claude/ ~/.claude/
```

## 10. Re-enable backups

```bash
cd ~/Bang-Labs/Code/toolkit/backup
./install.sh
```

## Cleanup

```bash
rm -rf ~/restore-tmp
```
