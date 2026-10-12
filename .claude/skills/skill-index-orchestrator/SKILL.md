---
name: skill-index-orchestrator
description: Builds an index of every installed skill (project, personal, plugin and built-in), picks the right skill or skills for a task, and plans and runs multi-skill workflows in order, passing each step's output to the next. Use it whenever a request could involve more than one skill or it's unclear which skill fits, for example "which skill should I use for…", "what skills do I have", "list my skills", "is there a skill for…", "chain these skills", "do X then Y then Z", or any large multi-step task that spans domains (research → draft → review → publish). Also use it when the user asks to refresh or rebuild the skill index.
---

# Skill Index Orchestrator

Find out which skills exist, choose the ones that fit the task, and run them in an order that works. Once each skill is loaded, its own instructions still apply. This skill only decides which skills to use and passes work between them.

## 1. Index

```bash
python3 .claude/skills/skill-index-orchestrator/scripts/build_index.py                    # every skill on disk
python3 .claude/skills/skill-index-orchestrator/scripts/build_index.py --query "<task>"    # ranked shortlist
```

(Adjust the path if this skill is installed somewhere other than the project's `.claude/skills/`. `--root <dir>` scans another directory. `--out SKILLS_INDEX.md` saves the index. `--json` prints JSON.)

- The `Skill` column holds the exact name to pass to the Skill tool. Plugin skills use `plugin:skill`.
- `--query` matches keywords, not meaning. Use it as a shortlist and read the full index if the matches look thin.
- **Neither the disk nor your skill list is complete on its own.** Built-in skills such as `dataviz` and `artifact-design` aren't on disk, so add them from your available-skills list. The opposite also happens: the disk often holds example skills that aren't enabled.

## 2. Only route to skills that are enabled

A skill is usable if it's in your available-skills list, or if the user named it and the Skill tool accepts it. A skill that is only on disk, for example under `/mnt/skills/examples/`, isn't enabled. **Don't open its SKILL.md and carry out its steps by hand.** That imitates a tool the user hasn't turned on, without its scripts or assets and without them choosing it. If the user asks for one:

- say plainly that it isn't enabled in this session
- tell them how to enable it, if you know
- plan with enabled skills that do the same job

## 3. Plan before running more than one skill

When the task needs more than one skill, write the plan before invoking anything:

```
Plan
1. <skill> - <what it produces>            → output: <file/artifact>
2. <skill> - uses #1's <output> to <...>   → output: <...>
Needs from you: <inputs no skill can produce, or "nothing">
```

**Check each chosen skill's prerequisites before committing to the order.** Skim each one's SKILL.md for gates, such as:

- a setup or cold-start interview it requires
- another skill that must run first (for example, an intake step before a hold notice)
- a connector that must be authorized

Add any missing prerequisite as an earlier step or put it under "Needs from you". A plan that stops at step 3 because step 2 skipped a prerequisite is the most common orchestration failure.

## 4. Run it

- Put each step after the steps whose output it uses.
- When you invoke the next skill, pass it the previous output: a path, or the key content.
- If a skill asks the user a question or for confirmation, still do it. Orchestration doesn't skip a skill's checkpoints.
- If a step fails or changes what's needed, update the plan and say why in one line.
- Before each step, give one short line (for example, "Step 2/3: …").
- When you finish, list what each skill produced and anything left for the user.
