# toolkit

Polyglot scripts and tools for Pop!_OS.

## Setup

```bash
./install
```

Installs dependencies and symlinks scripts. One command.

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

### bravia-ready

Converts a movie library into files a Sony Bravia will actually play off a USB stick. Reads from `pCloudDrive/Video/Movies`, writes to `pCloudDrive/Bravia-Ready`.

```bash
bravia-ready --list                 # show what was found and what's outstanding
bravia-ready                        # convert everything not already done
bravia-ready "Spy Game (2001)"      # convert one title
bravia-ready --limit 2              # convert the next two, then stop
bravia-ready --dry-run              # print the ffmpeg commands, run nothing
bravia-ready --subs-only            # rebuild .srt sidecars, leave the .mp4s alone
```

Per film it picks the largest video file that isn't bonus material, renames it to
`Title (Year)`, finds the best subtitle (sidecar, `Subs/`, or embedded), and produces
a matched `.mp4` + `.srt` pair.

The target format, and why each part matters:

| | | |
|---|---|---|
| Container | MP4 + `+faststart` | |
| Video | H.264 | HEVC is refused: "File format not supported" |
| Audio | AAC-LC, **48 kHz**, stereo | AC3 refused; 96 kHz gives picture and **silence** |
| Subtitles | sidecar `.srt`, **UTF-16LE** | UTF-8 renders as boxes — bytes get read in pairs |
| Naming | `Title (Year).mp4` + `.srt` | simple players need identical basenames |
| Resolution | fits inside 1920×1080 | 4K H.264 busts the decoder's level and is refused |

Two of those three failures are silent, so the script verifies its own output and
refuses to deliver a file whose audio is not 48 kHz or whose video is not H.264.

Encoding happens in a local scratch directory and is only copied up to pCloud once
complete and verified — nothing partial ever lands in the destination, so an
interrupted run is resumed by just running the command again. Files already present
are skipped unless you pass `--force`.

**Subtitles** are looked for in this order: a sidecar `.srt` beside the film, then a
`Subs/` directory, then an embedded text track. Failing all of those, Blu-ray rips
often carry only PGS — subtitles stored as *pictures*, which cannot be turned into
text — and a foreign-language film would arrive unwatchable. So the last resort
decodes the PGS bitmaps and OCRs them with tesseract (~98% accurate on the Criterion
discs tested; the residual errors come from italics). `--no-ocr` skips it. VOBSUB
(DVD-era picture subtitles) is not handled.

Because subtitles are sidecar files, `--subs-only` can add or repair them for films
already converted, without touching a single frame of video.

Anything larger than 1920×1080 is scaled to fit inside that box, aspect ratio kept
(`--max-height 0` to disable). It never upscales — a 1280×544 source stays 1280×544,
since upscaling only inflates the file and the TV upscales anyway. Note the limit is
a frame budget, not a height: a 3840×1606 scope film at 1080 tall would still be 2582
wide and still be refused, so it becomes 1920×804.

5.1 sources are downmixed dialogue-forward rather than with a naive `-ac 2`: the
centre channel is kept loud relative to the rest and LFE is dropped, since TV
speakers can't reproduce that band and it only eats headroom.

Uses VAAPI (`/dev/dri/renderD128`) when available, falling back to libx264. Needs `ffmpeg`.

Full write-up: <https://snippets.eu/post/bang/usb-movies-on-sony-tvs>

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
