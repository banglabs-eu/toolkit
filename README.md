# toolkit

Tools for Ubuntu based machines.

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

### mermaid

Workflow tool for Mermaid diagrams — generate HTML previews, export to SVG/PNG, or scaffold new projects.

```bash
mermaid -html              # generate index.html from .mmd file in current dir
mermaid -export            # generate SVG and PNG from .mmd file
mermaid -create NAME       # create a new project folder with a starter .mmd file
```

### backup

Backs up your system to pCloud via rclone. Excludes build artifacts, caches, secrets, and SSH keys. Skips metered networks automatically.

```bash
cd backup
./bang-backup                # run backup
./bang-backup --dry-run      # preview without uploading
./bang-backup --force        # override metered network check
./bang-backup --verbose      # detailed output
./install.sh               # set up systemd timer (runs 4x daily, catches up after sleep)
```

See `backup/restore.md` for full system recovery steps.
