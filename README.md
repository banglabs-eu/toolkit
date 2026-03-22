# toolkit

Polyglot scripts and tools for Pop!_OS.

## Setup

```bash
./install
```

This installs dependencies and symlinks all tools to `~/.local/bin` so they're available globally.

## Tools

### cleanusb

Wipe and format USB drives for Windows (exFAT + GPT).

```bash
sudo cleanusb                      # interactive — pick from detected USB drives
sudo cleanusb /dev/sdX             # quick wipe — clears signatures + partition tables
sudo cleanusb --secure /dev/sdX    # full zero pass — data unrecoverable
```

Only targets USB devices. Refuses to touch system drives.
