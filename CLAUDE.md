# CLAUDE.md

## What This Is

A polyglot collection of scripts and tools for Pop!_OS. Shell, Python, and whatever else fits. Personal repo by AdamBK, cloned inside the Bang Labs workspace.

## Structure

Scripts are organized by purpose. Each script should be self-contained or document its dependencies.

## Conventions

- Scripts should have a usage comment or `--help` flag
- Shell scripts: Bash, use `set -euo pipefail`
- Python scripts: Python 3, use `#!/usr/bin/env python3`
- Keep dependencies minimal; prefer standard library where practical
