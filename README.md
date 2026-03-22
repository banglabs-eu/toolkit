# toolkit

Polyglot scripts and tools for Pop!_OS.

## Setup

```bash
./install
```

This installs dependencies and symlinks all tools to `~/.local/bin` so they're available globally.

## Tools

### cleanusb

Manage USB drives — wipe, secure wipe, or browse. Formats as exFAT + GPT for Windows.

```bash
sudo cleanusb                      # interactive — mounts, shows each USB, pick an action
sudo cleanusb /dev/sdX             # quick wipe a specific drive
sudo cleanusb --secure /dev/sdX    # full zero pass — data unrecoverable
sudo cleanusb --open /dev/sdX      # mount and open in file browser
```

Interactive mode presents each USB with: `[w]` wipe, `[s]` secure wipe, `[o]` open, or skip.

After each wipe:
- Shows progress bars for each step
- Runs an integrity check (write random data, flush, re-read, compare md5)
- Benchmarks sustained read/write speed (64 MiB)
- Appends results to `~/usb-report.md`

Only targets USB devices. Refuses to touch system drives.

### cosmic-clean-usb

COSMIC desktop GUI for the same USB management. Built with libcosmic.

**Build and install:**

```bash
cd cosmic-clean-usb && cargo build --release && cd ..
sudo install -Dm755 cosmic-clean-usb/target/release/cosmic-clean-usb /usr/bin/cosmic-clean-usb
sudo install -Dm644 cosmic-clean-usb/data/com.banglabs.CleanUsb.desktop /usr/share/applications/com.banglabs.CleanUsb.desktop
sudo install -Dm644 cosmic-clean-usb/data/com.banglabs.CleanUsb.metainfo.xml /usr/share/metainfo/com.banglabs.CleanUsb.metainfo.xml
sudo install -Dm644 cosmic-clean-usb/data/com.banglabs.CleanUsb.policy /usr/share/polkit-1/actions/com.banglabs.CleanUsb.policy
sudo install -Dm644 cosmic-clean-usb/data/icons/hicolor/scalable/apps/com.banglabs.CleanUsb.svg /usr/share/icons/hicolor/scalable/apps/com.banglabs.CleanUsb.svg
```

**Uninstall:**

```bash
sudo rm -f /usr/bin/cosmic-clean-usb
sudo rm -f /usr/share/applications/com.banglabs.CleanUsb.desktop
sudo rm -f /usr/share/metainfo/com.banglabs.CleanUsb.metainfo.xml
sudo rm -f /usr/share/polkit-1/actions/com.banglabs.CleanUsb.policy
sudo rm -f /usr/share/icons/hicolor/scalable/apps/com.banglabs.CleanUsb.svg
```

**Run:** Search "Clean USB" in the app launcher, or `cosmic-clean-usb` from the terminal.

No sudo needed — runs as your user. PolicyKit prompts for auth when wiping.

Shows all connected USB drives with model, size, and USB version. Per device: Quick Wipe, Secure Wipe, or Open. After wiping, shows results (speeds, integrity) and option to open in file browser. Writes to `~/usb-report.md`.
