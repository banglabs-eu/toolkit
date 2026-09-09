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

### music-index

Measures every track in a music library — tempo, musical key, loudness (LUFS +
ReplayGain), true peak and an energy rating — and writes the results to a CSV, to
a playlist built from a BPM window, and optionally into the files' own tags.
Reads `pCloudDrive/Audio/Music/Artists` by default.

```bash
music-index                        # analyse whatever is new, refresh index + playlist
music-index --limit 20             # stop after 20 new files
music-index --retry-failed         # re-try tracks that previously failed
music-index --tag-dry-run          # preview what would be written to the files
music-index --tag                  # write BPM/key/gain into the files' tags
music-index --low 90 --high 120 --playlist chill.m3u8
music-index --bands                # a ladder of BPM playlists instead of just one
music-index --band Run=130-150 --band Sprint=150-180
music-index --playlists-only --bands   # rebuild playlists from the cache, no analysis
music-index --run-mix              # ranked running playlist, not just a BPM window
music-index --run-mix --cadence 165 --top 80
music-index --root ~/other-library # point it at a different library
```

`--bands` writes one playlist per window — Chill 60-90, Walk 90-110, Jog 110-130,
Run 130-150, Sprint 150-180 — and `--band NAME=LOW-HIGH` (repeatable) defines your
own. Band windows are half-open, so a track at exactly 130 BPM lands in Run and
nowhere else; the single `--playlist` window stays inclusive at both ends. Asking
for bands drops the default `running_130_160.m3u8` unless you name a `--playlist`
as well.

`--playlists-only` builds them straight from the cache: no library walk, no
analysis, no CSV. That is the flag for re-cutting playlists at different tempos,
and it returns in well under a second.

#### Why BPM alone picks the wrong songs

A BPM window will hand you calm music, and the energy rating does not save you:
Birdy's *Wild Horses* and Basshunter's *Dota* both score 9, because energy leans on
loudness, which is a fact about the mastering rather than about the music. Two
level-independent measures separate them:

| Track | BPM | Energy | Pulse | Percussive |
|---|---|---|---|---|
| Alela Diane — Heavy Walls | 112 | 7 | **0.19** | 0.11 |
| Birdy — Wild Horses | 112 | 9 | **0.41** | 0.17 |
| AC/DC — Shoot To Thrill | 144 | 9 | 0.55 | **0.40** |
| Basshunter — Dota | 144 | 9 | **0.78** | 0.26 |

`Pulse` is how far a steady beat rises out of the onset envelope's autocorrelation;
`Percussive` is the percussive share of a harmonic/percussive split, which catches
AC/DC, whose pulse is swung but whose drums are not.

`--run-mix` ranks on those rather than filtering on tempo alone:

```
0.35  cadence fit    tempo, or its double or half, against --cadence (default 170 spm)
0.25  pulse          is there a beat to run to
0.20  percussive     are there drums, or strings and pads
0.10  valence        major/minor, weighted by how sure the key is, plus brightness
0.10  consistency    EBU R128 loudness range: a long quiet intro breaks a run
```

Tracks under 2.5 minutes are dropped, the same song on two albums is entered once,
and the playlist is written best-first. Cadence fit counts a track's double and half
tempo too — a runner lands on the beat or on every second one — so an 85 BPM track
can legitimately match a 170 spm cadence. That doubling is also how a ballad gets in,
so it is discounted to 0.70 and withheld entirely from tracks below 0.45 pulse or
0.20 percussive: a slow song with a hard backbeat qualifies, a rubato one does not.

Output lands next to the library root:

```
bpm_index.csv          every track: BPM, key, mode, energy, pulse, percussive,
                       dynamics, LUFS, LRA, ReplayGain, true peak, duration, path
running_130_160.m3u8   the BPM window as a playlist, slowest track first
run_130_150.m3u8       one file per --band / --bands window, same shape
run_mix.m3u8           --run-mix, ranked best-first
.bpm_cache.jsonl       append-only cache, one record per track
```

A player showing a blank BPM column is reading the files, not the CSV: nothing is
written to your music until you run `music-index --tag`. After tagging, rescan the
library in the player (Strawberry: Tools -> Full collection rescan) so it re-reads the
tags it already cached.

The cache is the point. It is flushed after every track, so an interrupted run —
a reboot, a Ctrl-C, a pCloud stall — costs only the handful of tracks in flight.
Re-running skips everything already measured, so adding music next month costs
the new tracks and nothing else. Just run `music-index` again.

New measurements do not need `--rescan` either: each cached record carries the
feature version that wrote it, and a record older than the running build is
re-analysed like a new file, errors excepted.

`--rescan` is the one flag that throws that away and re-analyses the whole
library from scratch; `--retry-failed` is the gentler one, retrying only the
tracks that errored.

Tempo detection cannot tell a bar from a half-bar, so a track may land on half or
double its felt tempo — hence the `BPM_Half` and `BPM_Double` columns, and the
`Confidence` column measuring how well three separate windows of the track
agreed. Key detection is dependable on tonal pop and rock, much less so on
ambient or heavily percussive material.

Needs `ffmpeg`. `librosa` and `mutagen` are pip-only, so on first run the tool
builds its own venv under `~/.local/share/bpm-scan` — nothing to activate.

Keep `--jobs` low (4 is the default) when the library is on a pCloud FUSE mount;
higher concurrency has repeatedly pushed the mount into unresponsive D-state
reads.

### pslag

Measures input lag on a PS Remote Play session, so "the cloud feels worse than
local" becomes a number.

```bash
pslag rig --label local          # flashing marker; film the screen at 240fps
pslag frame clip.mp4             # dump a frame with a grid, to pick the boxes
pslag measure clip.mp4 --fps 240 \
    --marker 300,700,120,120 --game 900,400,160,160 --label local
pslag net --label cloud          # rtt, jitter, loss and bitrate, live
pslag runs                       # every run so far, cloud next to local
```

Timing a game stream needs two moments: when your thumb moved, and when the
screen reacted. Because the client runs on this laptop the kernel already
timestamps the button press, so only the second moment needs a camera.

`rig` fills a terminal with black and flashes it white the instant the kernel
sees a button — it adds about 0.15 ms of its own. Put that terminal beside the
stream window, run the stream **windowed** so both are in shot, and film the
screen with a phone at 240fps. `measure` then walks the video, finds every
flash and the first reaction that followed it, and reports the gap per trial.

The flash and the game frame reach the panel through the same compositor and
the same screen, so the gap between them is the streaming loop alone:
controller → console → encode → network → decode. That is the right number for
comparing two connections. For absolute click-to-photon, add your local
display pipeline back with `--marker-latency`.

The camera never needs to see your hands. The flash *is* the button press —
that is the entire point of it — so the video holds both events and the only
clock involved is the frame number. There is nothing to synchronise.

What that does mean is that **the flashing terminal has to stay in shot**. Zoom
in on the reaction as tightly as you like, but leave a strip of the terminal at
the edge of the frame. The box is averaged down to one number, so a sliver of
it is plenty.

Picking the two boxes matters more than anything else:

- `--marker` sits inside the flashing terminal, away from its edges.
- `--game` sits on something that visibly changes when you press, and well away
  from the marker so its light cannot spill in.

Keep the scene still between presses; a trial where the game box was already
moving is reported as skipped rather than guessed at. Press 15–20 times, 30 if
you want a tight median.

**What to press.** Reference methods all use a step change — a muzzle flash,
the first frame of a shooting animation. PS5 menu transitions are eased ramps
instead, so the detector fires somewhere up the slope and reads late. That bias
lands the same way on both routes, which makes a menu fine for comparing cloud
against local and poor for an absolute figure. Never change stimulus between
two runs you mean to compare.

Best to worst, staying inside the PS5 UI:

1. **On-screen keyboard.** Open Search from the menu bar and press X on a key.
   The key's press highlight is about as close to a step as the UI gets, it
   lands in the same spot every time, and it repeats forever. Put `--game` on
   that one key. This is the one to use.
2. **PS button → Control Center.** Screen-wide, so the signal dwarfs the noise
   and the box is trivial to place. It fades in, so it reads late — but
   consistently late.
3. **Sliding along the menu bar.** Noisiest of the three. Aim the box at a
   narrow vertical strip on the boundary between two icons so the highlight
   sweeps across it — the steepest part of the ramp — rather than at an icon.

Stay off the game cards: they auto-play video previews, which trip the "already
moving" check and skip most trials. The static icon row — Search, the Settings
gear — is safe.

`net` is the other half, and needs no camera. It finds the stream peer among
the open UDP sockets, then logs RTT, jitter, loss, bitrate and wifi signal for
the whole session, printing a summary at the end. Handy on its own for
catching the wifi dropouts behind a lag spike. PSN relays often refuse ICMP; it
says so and keeps the bitrate log going.

Everything lands in `~/pslag/` — a CSV per run, plus a summary each run appends
to, which is what `pslag runs` prints. Label runs `cloud` and `local` and the
comparison reads straight off that table.

Needs `ffmpeg` and `python3-numpy`. No root, no GUI toolkit.

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
