---
name: skill-index-orchestrator
description: Builds an index of every installed skill (project, personal, plugin and built-in), picks the right skill or skills for a task, and plans and runs multi-skill workflows in order, passing each step's output to the next. Use it whenever a request could involve more than one skill or it's unclear which skill fits, for example "which skill should I use for…", "what skills do I have", "list my skills", "is there a skill for…", "chain these skills", "do X then Y then Z", or any large multi-step task that spans domains (research → draft → review → publish). Also use it when the user asks to refresh or rebuild the skill index.
---

# Skill Index Orchestrator

You act as a dispatcher. You find out which skills exist, match the task to the best ones, and run them in a sensible order. You don't replace those skills: each one's own instructions still apply once it's loaded. Your job is choosing the skills and handing work from one to the next.

## 1. Build or refresh the index

The skill list in your system prompt may be truncated, and some entries have no description. The files on disk are the real source, so scan them:

```bash
python3 .claude/skills/skill-index-orchestrator/scripts/build_index.py            # full Markdown table
python3 .claude/skills/skill-index-orchestrator/scripts/build_index.py --query "<the task in plain words>"  # ranked shortlist
```

(Adjust the script path if this skill is installed somewhere other than the project's `.claude/skills/`.)

- The script scans `./.claude/skills`, `~/.claude/skills`, `~/.claude/plugins/**/skills` and `/mnt/skills`. To scan another directory, add `--root <dir>`.
- `--query` ranks skills by keyword overlap. Treat the result as a shortlist, not a decision. Keyword overlap misses synonyms. For example, "contract" won't match a skill described as covering "agreements". Judge relevance by meaning, and read the full index when the shortlist looks thin.
- The `Skill` column holds the exact name to pass to the Skill tool. Plugin skills use `plugin:skill`.
- If the user wants a saved index, write it with `--out SKILLS_INDEX.md`. If they asked for a list, show it in the conversation.

**Combine the disk index with your available-skills list. Neither one is complete on its own.** Built-in skills such as `dataviz`, `artifact-design`, `code-review` and `simplify` ship inside Claude Code, so the script can't see them. They're still in your system prompt, so add them to the candidates. The reverse also happens: the disk can hold example skills that aren't enabled.

Only invoke skills that the Skill tool will actually accept, meaning they appear in your available-skills list or the user named them. A skill can exist on disk without being enabled. If the best match isn't available, tell the user rather than reading its file and imitating it.

## 2. Route: pick skills for the task

For each candidate, ask: *does this skill's description cover a real part of this task?* Then decide:

- **One skill clearly fits.** Say which one in one line and invoke it. Don't build a plan for a single-skill task.
- **Several skills fit different parts.** Go to step 3.
- **Two skills overlap.** Prefer the more specific one: a domain skill beats a general one, and a project skill beats a personal one. Also prefer the one the user has used in this conversation. If it's genuinely a toss-up and the choice changes the outcome, ask the user briefly.
- **Nothing fits.** Say so, do the task directly, and mention that `skill-creator` could turn the work into a skill if it will recur.

Process skills, such as brainstorming, debugging and planning, run before implementation skills, because they decide *how* the rest of the work happens.

## 3. Orchestrate: run a multi-skill workflow

Write a short plan before invoking anything. A plan is mostly useful for spotting a missing input or a wrong order before work is done:

```
Plan
1. <skill> - <what it produces>            → output: <file/artifact>
2. <skill> - uses #1's <output> to <...>   → output: <...>
3. <skill> - ...
Needs from you: <any input no skill can produce, or "nothing">
```

Then run it:

- **Order by data dependency.** A step goes after the steps whose output it consumes. Independent steps can run in any order, or in parallel with subagents if the user asked for that.
- **Hand off explicitly.** When you invoke the next skill, pass the previous output's file path or its key content. A skill only knows what you give it.
- **Follow each skill on its own terms.** If a loaded skill asks the user a question or needs a confirmation, that still happens. Orchestration doesn't skip a skill's checkpoints.
- **Re-plan when a step changes things.** If a step fails, returns something unexpected, or makes a later step unnecessary, update the plan and say why in one line. Don't push on with a stale plan.
- **Keep the user oriented.** Before each step, give one short line, such as "Step 2/3: reviewing the draft with `legal:review-contract`". Don't narrate inside a step.

When you finish, summarise briefly: which skills ran, what each produced (with paths or links), and anything left for the user.

## Examples

**Single skill.** The user says: "can you review this NDA from Acme?" Run `--query "review NDA"`. It surfaces `legal:triage-nda`, `commercial-legal:review` and `commercial-legal:nda-review`. The first two are invocable entry points, and `nda-review` is a reference loaded *by* `commercial-legal:review`. Pick `commercial-legal:review` if the user has a commercial-legal profile set up, otherwise `legal:triage-nda`. Invoke it with no plan.

**Workflow.** The user says: "turn last quarter's numbers in data/q3.csv into a chart and a 5-slide deck for the board." The plan is:
1. `dataviz` to design the chart, producing a PNG or chart spec.
2. A slides skill, such as `anthropic-skills:pptx` or the Artifact Slides type, to build the deck around step 1's chart.

**Inventory.** The user says: "what skills do I have for legal stuff?" Run the full index, filter it to the legal entries, and present them grouped by plugin. Don't invoke anything.
