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
- Speaks progress and results via `spd-say`
- Runs an integrity check (write random data, flush, re-read, compare md5)
- Benchmarks sustained read/write speed (64 MiB)
- Appends results to `~/usb-report.md`

Only targets USB devices. Refuses to touch system drives.
