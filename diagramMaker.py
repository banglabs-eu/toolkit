#!/usr/bin/env python3
"""Extract mermaid diagram skeletons from kbud-backend Java sources.

This is a regex-based extractor — not a Java parser. It produces a *starting
point* that captures the mechanical bits (class names, package paths, JPA
relationships, injected dependencies). You then hand-edit the resulting .mmd
to add what matters: which methods to show, sequence message order, Note over
annotations, subgraph groupings.

Conventions enforced (matching docs/architecture/diagrams/*.mmd):
  - Strip 'src/main/java/dk/dataproces/akjkpbp/' prefix from paths.
  - Class labels: class Name["Name<br/>pkg/"].
  - Sequence participants: participant Alias as Name<br/>pkg/.
  - No trailing %% inline comments — they break the sequenceDiagram parser.
    (Line-leading %% comments are fine and used here as edit hints.)
  - No parens-with-commas inside Note text — also a parser trap.

Subcommands:
  aggregate ENTITY      classDiagram of the JPA entity + its
                        @OneToMany/@ManyToOne/@OneToOne/@ManyToMany neighbours.

  controller CTL        sequenceDiagram skeleton: participants are the
                        controller's injected dependencies; one labeled
                        message group per @{Get,Post,Put,Delete,Patch}Mapping.

Examples:
  scripts/extract-diagram-skeleton.py aggregate Budget
  scripts/extract-diagram-skeleton.py controller BudgetController -o out.mmd

Limitations (heuristic — won't handle perfectly):
  - String literals or comments containing annotation-like text.
  - Inherited fields (only sees declarations in the named file itself).
  - Field declarations split across multiple lines in odd ways.
When the heuristics miss something, hand-edit. The output is a starting point.
"""

import argparse
import re
import sys
from pathlib import Path

JAVA_ROOT = (
    Path(__file__).resolve().parent.parent
    / "src" / "main" / "java" / "dk" / "dataproces" / "akjkpbp"
)


# ---------- shared helpers ----------

def find_class(name: str) -> Path | None:
    """Locate the file declaring class/interface/record `name`."""
    matches = list(JAVA_ROOT.rglob(f"{name}.java"))
    return matches[0] if matches else None


def rel_pkg(p: Path) -> str:
    """Package directory relative to akjkpbp/ (e.g. 'budget/model/')."""
    rel = p.parent.relative_to(JAVA_ROOT)
    return f"{rel}/" if str(rel) != "." else ""


def strip_comments(src: str) -> str:
    """Drop block + line comments only — string literal contents survive."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def strip_noise(src: str) -> str:
    """Drop comments AND blank out string literal contents.

    Use when string contents could cause regex false positives (e.g. when
    scanning for annotations) and the matches don't need to read string
    payloads. For path-containing patterns like @RequestMapping("/foo"),
    use strip_comments instead.
    """
    src = strip_comments(src)
    src = re.sub(r'"(?:\\.|[^"\\])*"', '""', src)
    return src


def label(name: str, path: Path | None) -> str:
    """Build a `class Foo["Foo<br/>pkg/"]` label, or unlabelled if path unknown."""
    if not path:
        return f"class {name}"
    return f'class {name}["{name}<br/>{rel_pkg(path)}"]'


# ---------- aggregate (JPA entity → classDiagram) ----------

RELATION_RE = re.compile(
    r"@(?P<kind>OneToMany|ManyToOne|OneToOne|ManyToMany)\b"
    r"[^;{}]*?"                                       # rest of annotation args + other annotations
    r"(?:private|protected|public)\s+"
    r"(?:final\s+)?"
    r"(?P<type>[\w.]+(?:\s*<\s*[\w.,\s]+\s*>)?)"      # type, optionally generic
    r"\s+(?P<field>\w+)\s*[;=]",
    re.DOTALL,
)


def parse_relations(src: str) -> list[tuple[str, str, str]]:
    out = []
    for m in RELATION_RE.finditer(src):
        kind = m.group("kind")
        full_type = m.group("type")
        field = m.group("field")
        gen = re.search(r"<\s*([\w.]+)\s*>", full_type)
        target = (gen.group(1) if gen else full_type).split(".")[-1]
        out.append((kind, field, target))
    return out


def emit_aggregate(entity: str) -> str:
    p = find_class(entity)
    if not p:
        sys.exit(f"Entity '{entity}' not found under {JAVA_ROOT}")
    src = strip_noise(p.read_text(encoding="utf-8"))
    rels = parse_relations(src)

    lines = ["classDiagram"]
    lines.append(f'    {label(entity, p)} {{')
    lines.append("        <<@Entity>>")
    lines.append("    }")

    seen: set[str] = set()
    for _, _, tgt in rels:
        if tgt == entity or tgt in seen:
            continue
        seen.add(tgt)
        lines.append(f"    {label(tgt, find_class(tgt))}")

    if rels:
        lines.append("")
    for kind, field, tgt in rels:
        if tgt == entity:
            continue
        if kind == "OneToMany":
            lines.append(f'    {entity} "1" --> "*" {tgt} : {field}')
        elif kind == "ManyToOne":
            lines.append(f'    {entity} "many" --> "1" {tgt}')
        elif kind == "OneToOne":
            lines.append(f'    {entity} "1" --> "1" {tgt} : {field}')
        else:  # ManyToMany
            lines.append(f'    {entity} "*" --> "*" {tgt} : {field}')

    return "\n".join(lines) + "\n"


# ---------- controller (@RestController → sequenceDiagram) ----------

INJECT_RE = re.compile(
    r"private\s+(?:final\s+)?"
    r"(?P<type>\w+)\s+(?P<name>\w+)\s*;",
)

ENDPOINT_RE = re.compile(
    r"@(?P<verb>GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)"
    r"(?:\(\s*(?:path\s*=\s*)?\"(?P<path>[^\"]*)\"[^)]*\))?"
    r"[^{}]*?"
    r"public\s+(?P<rtype>[^()]+?)\s+(?P<name>\w+)\s*\(",
    re.DOTALL,
)


def short_alias(name: str) -> str:
    """Compress CamelCase to initials; falls back to first 4 chars."""
    parts = re.findall(r"[A-Z][a-z0-9]*", name)
    if len(parts) >= 2:
        return "".join(p[0] for p in parts)
    return name[:4]


def parse_controller(src: str) -> tuple[list[tuple[str, str]], list[dict]]:
    """Return (deps, endpoints). Deps are service/repo-like injected fields."""
    suffixes = ("Service", "Repository", "Mapper", "Builder", "Handler", "Client")
    deps = []
    seen_types: set[str] = set()
    for m in INJECT_RE.finditer(src):
        t = m.group("type")
        if t in seen_types or not t.endswith(suffixes):
            continue
        seen_types.add(t)
        deps.append((t, m.group("name")))

    endpoints = []
    for m in ENDPOINT_RE.finditer(src):
        endpoints.append({
            "verb": m.group("verb").replace("Mapping", "").upper(),
            "path": (m.group("path") or "").lstrip("/"),
            "name": m.group("name"),
        })
    return deps, endpoints


def emit_controller(ctl: str) -> str:
    p = find_class(ctl)
    if not p:
        sys.exit(f"Controller '{ctl}' not found under {JAVA_ROOT}")
    # Strip comments only — the controller scan needs to read string contents
    # of @RequestMapping / @GetMapping / etc. for path extraction.
    src = strip_comments(p.read_text(encoding="utf-8"))
    deps, endpoints = parse_controller(src)

    # Resolve @RequestMapping("/api/.../foo") class-level base path, if any.
    base = ""
    base_m = re.search(
        r'@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"(?P<p>[^"]*)"',
        src,
    )
    if base_m:
        base = base_m.group("p").rstrip("/")

    lines = ["sequenceDiagram", "    autonumber"]
    lines.append("    actor FE as Frontend")
    lines.append(f"    participant Ctl as {ctl}<br/>{rel_pkg(p)}")
    aliases: dict[str, str] = {}
    used: set[str] = {"Ctl", "FE"}
    for typ, _ in deps:
        a = short_alias(typ)
        while a in used:
            a += "X"
        used.add(a)
        aliases[typ] = a
        dp = find_class(typ)
        pkg = rel_pkg(dp) if dp else "?/"
        lines.append(f"    participant {a} as {typ}<br/>{pkg}")
    lines.append("")

    if not endpoints:
        lines.append("    %% No @{Get,Post,Put,Delete,Patch}Mapping endpoints found.")
        return "\n".join(lines) + "\n"

    for ep in endpoints:
        path = f"{base}/{ep['path']}".rstrip("/") if ep["path"] else base
        path = path or "/"
        lines.append(f"    %% --- {ep['name']} ---")
        lines.append(f"    FE->>Ctl: {ep['verb']} {path}")
        lines.append(f"    Note over Ctl: {ep['name']} — fill in the actual call chain")
        for typ, _ in deps:
            lines.append(f"    %% Ctl->>{aliases[typ]}: someMethod(...)")
        lines.append("    Ctl-->>FE: 200 OK")
        lines.append("")

    return "\n".join(lines) + "\n"


# ---------- CLI ----------

def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(
        description="Extract mermaid diagram skeletons from kbud-backend.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See module docstring for full usage and conventions.",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("aggregate", help="JPA entity → classDiagram skeleton")
    a.add_argument("entity")
    a.add_argument("-o", "--out", type=Path, help="write to file instead of stdout")

    c = sub.add_parser("controller", help="Controller → sequenceDiagram skeleton")
    c.add_argument("controller")
    c.add_argument("-o", "--out", type=Path, help="write to file instead of stdout")

    args = ap.parse_args(argv)

    if args.cmd == "aggregate":
        out = emit_aggregate(args.entity)
    else:
        out = emit_controller(args.controller)

    if args.out:
        args.out.write_text(out, encoding="utf-8")
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()

