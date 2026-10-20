#!/usr/bin/env python3
"""Build an index of every Claude skill installed on this machine.

Scans the usual skill locations for SKILL.md files, reads the YAML
frontmatter (name + description), and prints a Markdown table or JSON.
With --query, ranks skills by keyword overlap with a task description so
the orchestrator has a short candidate list to reason over.

Usage:
  build_index.py                      # Markdown index of all skills
  build_index.py --json               # same, as JSON
  build_index.py --query "draft an NDA and send it for signature" [--top 10]
  build_index.py --root extra/dir     # add more directories to scan
  build_index.py --out SKILLS_INDEX.md
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

HOME = Path.home()
DEFAULT_ROOTS = [
    Path.cwd() / ".claude" / "skills",   # project skills
    HOME / ".claude" / "skills",         # personal + synced skills
    HOME / ".claude" / "plugins",        # plugin skills (<plugin>/skills/<skill>)
    Path("/mnt/skills"),                 # built-in skills in some environments
]
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "evals", "workspace"}
STOPWORDS = set("""a an and are as at be by can do for from has have how i if in into is it
its me my of on or our so that the this to use used uses using want we what when whenever
where which while who will with you your skill skills claude make help""".split())


def parse_frontmatter(text):
    """Minimal YAML frontmatter reader for name/description (no PyYAML needed)."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*(\n|$)", text, re.S)
    if not m:
        return {}
    fields, key = {}, None
    for line in m.group(1).splitlines():
        kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if val in ("|", ">", "|-", ">-"):
                val = ""
            fields[key] = val
        elif key and line.startswith((" ", "\t")):
            fields[key] = (fields[key] + " " + line.strip()).strip()
    for k, v in fields.items():
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            fields[k] = v[1:-1]
    return fields


def invocation_name(skill_md, name):
    """Plugin skills live at .../<plugin>/skills/<skill>/SKILL.md and are invoked as plugin:skill."""
    parts = skill_md.parts
    # Account skills synced from claude.ai are invoked under the anthropic-skills: namespace.
    if "skills" in parts and "synced" in parts and "plugins" not in parts:
        return f"anthropic-skills:{name}"
    if "plugins" in parts and len(parts) >= 4 and parts[-3] == "skills":
        return f"{parts[-4]}:{name}"
    return name


def find_skills(roots):
    seen, skills = set(), []
    for root in roots:
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.endswith("-workspace")]
            if "SKILL.md" not in filenames:
                continue
            path = Path(dirpath) / "SKILL.md"
            real = path.resolve()
            if real in seen:
                continue
            seen.add(real)
            try:
                fm = parse_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
            name = fm.get("name") or Path(dirpath).name
            skills.append({
                "name": name,
                "invoke": invocation_name(path, name),
                "description": fm.get("description", ""),
                "path": str(path),
            })
    # Deduplicate same invoke name (e.g. a skill synced to two places): keep the first root's copy.
    unique = {}
    for s in skills:
        unique.setdefault(s["invoke"], s)
    # Drop a bare copy (e.g. /mnt/skills/pptx) when a namespaced copy with the same description exists.
    namespaced = {(s["name"], s["description"]) for s in unique.values() if ":" in s["invoke"]}
    unique = {k: s for k, s in unique.items()
              if ":" in k or (s["name"], s["description"]) not in namespaced}
    return sorted(unique.values(), key=lambda s: s["invoke"])


def tokens(text):
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in STOPWORDS}


def rank(skills, query, top):
    q = tokens(query)
    scored = []
    for s in skills:
        name_t = tokens(s["invoke"].replace("-", " ").replace(":", " "))
        desc_t = tokens(s["description"])
        score = 3 * len(q & name_t) + len(q & desc_t)
        if score:
            scored.append({**s, "score": score})
    scored.sort(key=lambda s: (-s["score"], s["invoke"]))
    return scored[:top]


def to_markdown(skills, show_score=False):
    head = "| Skill | Score | Description |\n|---|---|---|" if show_score else "| Skill | Description |\n|---|---|"
    rows = []
    for s in skills:
        desc = s["description"].replace("|", "\\|").replace("\n", " ")
        if len(desc) > 300:
            desc = desc[:297] + "..."
        rows.append(f"| `{s['invoke']}` | {s['score']} | {desc} |" if show_score
                    else f"| `{s['invoke']}` | {desc} |")
    return head + "\n" + "\n".join(rows) + f"\n\n_{len(skills)} skill(s)_\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", action="append", default=[], help="extra directory to scan (repeatable)")
    ap.add_argument("--query", help="task description to rank skills against")
    ap.add_argument("--top", type=int, default=12, help="max results for --query")
    ap.add_argument("--json", action="store_true", help="output JSON instead of Markdown")
    ap.add_argument("--out", help="write output to this file instead of stdout")
    args = ap.parse_args()

    skills = find_skills(DEFAULT_ROOTS + [Path(r).expanduser() for r in args.root])
    result = rank(skills, args.query, args.top) if args.query else skills

    if args.json:
        out = json.dumps(result, indent=2)
    else:
        out = to_markdown(result, show_score=bool(args.query))
        if args.query and not result:
            out = "No keyword matches. Read the full index (run without --query) and judge by meaning.\n"

    if args.out:
        Path(args.out).write_text(out, encoding="utf-8")
        print(f"Wrote {len(result)} skill(s) to {args.out}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
