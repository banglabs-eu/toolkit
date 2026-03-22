# toolkit

Polyglot scripts and tools for Pop!_OS.

## Setup

```bash
./install
```

Installs dependencies, builds the COSMIC app, and installs everything. One command.

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

COSMIC desktop GUI for the same USB management. Built with libcosmic. Installed by `./install`.

Search "Clean USB" in the app launcher, or run `cosmic-clean-usb`.

No sudo needed — runs as your user. PolicyKit prompts for auth when wiping. Shows all connected USB drives with model, size, and USB version. Per device: Quick Wipe, Secure Wipe, or Open. After wiping, shows results (speeds, integrity) and option to open in file browser. Writes to `~/usb-report.md`.
