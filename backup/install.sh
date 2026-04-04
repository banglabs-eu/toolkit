#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/bang-backup"
SYSTEMD_DIR="$HOME/.config/systemd/user"

# --- Check rclone ---

if ! command -v rclone &>/dev/null; then
    echo "Installing rclone..."
    sudo apt install -y rclone
fi

if ! rclone listremotes 2>/dev/null | grep -q "^pcloud:$"; then
    echo ""
    echo "pCloud remote not configured. Run this now:"
    echo "  rclone config"
    echo ""
    echo "Create a remote named 'pcloud' with type 'pcloud'."
    echo "Re-run this script after setup."
    exit 1
fi

echo "rclone configured with pcloud remote."

# --- Make backup script executable ---

chmod +x "$BACKUP_SCRIPT"

# --- Create systemd user units ---

mkdir -p "$SYSTEMD_DIR"

cat > "$SYSTEMD_DIR/pcloud-backup.service" << EOF
[Unit]
Description=Backup to pCloud via rclone

[Service]
Type=oneshot
ExecStart=${BACKUP_SCRIPT}
Nice=10
IOSchedulingClass=idle
EOF

cat > "$SYSTEMD_DIR/pcloud-backup.timer" << EOF
[Unit]
Description=Run pCloud backup 4x daily

[Timer]
OnCalendar=*-*-* 08,12,16,20:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

# --- Enable timer ---

systemctl --user daemon-reload
systemctl --user enable --now pcloud-backup.timer

echo ""
echo "Backup timer installed and active."
echo ""
systemctl --user list-timers pcloud-backup.timer
echo ""
echo "Manual run:  ./bang-backup"
echo "Dry run:     ./bang-backup --dry-run"
echo "Force run:   ./bang-backup --force"
echo "Check logs:  ls ${SCRIPT_DIR}/logs/"
echo "Disable:     systemctl --user disable --now pcloud-backup.timer"
