---
title: "Why My AI Agents Were Stuck: Six Layers of Silent Failure"
date: 2026-04-24
tokens: "~5k"
description: "I ran 10 autonomous coding agents for weeks thinking they were working. They weren't. Here are the six compounding failures I found, from broken model auth to ghost issues on the project board."
tags:
  - AI Agents
  - Multi-Agent Systems
  - Debugging
  - Automation
series: "OpenClaw"
series_order: 1
---

I run a multi-agent system with 10 AI coding agents — a project manager, four platform developers (Android, iOS, Web, Backend), and several specialists. They're orchestrated through a gateway with cron jobs, heartbeats, and Discord channels. Each agent picks issues from a GitHub Project board, implements features, opens PRs, and reports status.

For weeks, everything looked fine. Cron jobs showed `ok`. No crash alerts. The dashboard was green. But nothing was shipping. No PRs opened, no issues advancing, no specs drafted. The agents were running but producing zero output.

I sat down to debug it and found six failures stacked on top of each other. Each one was silent. Each one would have been enough to block all progress on its own. Together, they made the system look alive while doing nothing.

## Failure 1: The model didn't work

The first thing I checked was the gateway error log.

```
embedded run agent end: isError=true model=gpt-5.2-codex
error: "The 'gpt-5.2-codex' model is not supported when using
Codex with a ChatGPT account."
```

Every agent had `gpt-5.2-codex` hardcoded as its model. This model didn't work with our auth method. The gateway config had fallbacks defined at the defaults level, but each agent's per-agent `model` field overrode the defaults. So the fallback chain never kicked in.

The cron scheduler reported `ok` because the job technically completed — it just completed with an error that the agent couldn't generate a response. The status check didn't distinguish between "agent ran and did work" and "agent crashed immediately."

**Fix:** Changed all six active agents to `gpt-5.3-codex`, which worked with our auth.

**Lesson:** Per-agent model overrides bypass default fallback chains. If you set `model` on individual agents, the `defaults.model.fallbacks` array is ignored for those agents. Either set fallbacks per-agent too, or don't override the default model.

## Failure 2: Heartbeats were disabled

The gateway status showed:

```
Heartbeat: disabled (main), disabled (beet-android-dev),
disabled (beet-web-dev), disabled (beet-ios-dev), ...
```

Every agent had `heartbeat: { "every": "0m" }` — disabled. I set the default to `"30m"`, but heartbeats stayed off. The documentation explained why: "When any agent defines `heartbeat`, only those agents run heartbeats." Three utility agents had explicit `"0m"` overrides, and their existence caused the gateway to ignore the defaults for all other agents.

**Fix:** Removed all per-agent heartbeat overrides. Set `agents.defaults.heartbeat.every: "30m"` with `lightContext: true` and `isolatedSession: true` for cost control.

**Lesson:** In OpenClaw's config, per-agent fields don't merge with defaults — they replace them. One agent with an explicit heartbeat config switches the entire system from "use defaults for everyone" to "only agents with explicit configs get heartbeats."

## Failure 3: Cron messages contradicted agent instructions

Each agent's `AGENTS.md` file said:

> If `picked=false`, proactively draft missing scoped work and create one actionable issue with acceptance criteria.

But the cron job `payload.message` said:

> If picked=false, end quietly.

The cron message wins. It's the direct instruction for that turn. The agent reads `AGENTS.md` as background context, but the cron payload is the actual prompt. So agents received their work instructions, saw "end quietly," and complied.

I checked the task history with `openclaw tasks list`. Forty consecutive runs across all agents said variations of:

```
"No issue picked (picked=false). Ending quietly."
"Staying idle..."
"No issue picked. Ending run quietly."
```

**Fix:** Replaced the cron messages with a "work priority waterfall" — a cascade of six tiers. If pickup finds nothing, check open PRs. If no PRs, check blocked issues. If nothing blocked, create an issue. If the lane is full, run quality checks. Only report idle if all tiers are exhausted.

**Lesson:** When you have standing orders in `AGENTS.md` and per-run instructions in cron messages, they will conflict. The cron message should reference the standing orders, not override them.

## Failure 4: The boot sequence asked "who am I?"

When I messaged an agent through Discord, instead of responding to my question, it asked me to confirm its identity:

> "Hey. I just came online. Who am I? Who are you?"

Every agent workspace had a `BOOTSTRAP.md` file designed for first-time setup — an onboarding flow where the agent discovers its name, personality, and learns about its human. This made sense for initial configuration. But agents run in isolated cron sessions that start fresh each time. Every cron run was a "first time."

Six of ten `USER.md` files were blank templates with empty name and timezone fields. The agent would read `BOOTSTRAP.md`, see an empty `USER.md`, and conclude it hadn't been set up yet.

**Fix:** Replaced all `BOOTSTRAP.md` files with operational boot instructions: "You are already configured. Read AGENTS.md and follow your standing orders. Never ask the human to confirm your identity." Populated all blank `USER.md` files.

**Lesson:** Isolated sessions are amnesiac by design. Any file that assumes persistent state (like "this only runs once") will re-trigger on every session. Boot files for autonomous agents should be stateless and operational, not conversational.

## Failure 5: The pickup script filtered out all work

After fixing failures 1-4, agents started running but still couldn't find issues. The pickup script returned `picked=false` for Web and Backend every single time, despite the board showing 15 Web and 2 Backend items as `Todo`.

The jq filter in the pickup script had:

```jq
select(.status=="Todo" and .execution_stage!="Spec Drafted")
```

It excluded `Spec Drafted` items — the stage where a spec exists but hasn't been approved yet. The intent was to prevent agents from picking items that need human review. But every Web Todo item was at `Spec Drafted`. Every Backend Todo item was at `Spec Drafted`. The filter made 100% of their work invisible.

The agents were supposed to be the ones refining and advancing specs at this stage. The filter was protecting against the agents doing exactly what they were built to do.

**Fix:** Removed the `Spec Drafted` exclusion. The execution stage gate in the cron message already handles what agents can and can't do at each stage — they'll do spec work on `Spec Drafted` items and only write code after `Spec Approved`.

**Lesson:** Filters compound. The pickup script filtered by platform, status, lock state, blocked state, AND execution stage. Each filter seemed reasonable alone, but together they created a pipeline where nothing passed through. When debugging empty results from a filter chain, remove filters one at a time to find which one is the bottleneck.

## Failure 6: The board was lying

Even after fixing the pickup filter, some platforms showed phantom work. The project board displayed 51 `Todo` items. The actual number was 30.

Twenty-four GitHub issues had been closed (PRs merged, manually resolved) but their project board `Status` field was never updated. GitHub Projects doesn't auto-sync issue state with project fields. So the board showed `Todo` for issues that were `CLOSED` in the repo.

The pickup script correctly checked `state=="OPEN"`, so it skipped these. But the board's inflated count made it look like there was plenty of work when lanes were actually empty. The project manager agent's morning plan referenced these phantom items, creating plans for work that couldn't be picked up.

I also found eight items with contradictory state combinations: `Status=Todo` with `Execution Stage=Review`, `Status=In Progress` with `Execution Lock=Unlocked`, items locked at `Spec Drafted` stage where agents could only do spec work but couldn't advance to `Spec Approved` without human review — a dead-end loop.

**Fix:** Updated all 24 closed issues to `Status=Done`. Fixed the eight state violations. Added a state integrity validation layer to the pickup script that rejects items with contradictory field combinations. Documented valid state transitions in the multi-agent policy.

**Lesson:** Project boards are views, not source of truth. The source of truth is the issue state in the repo. Any automation that reads project fields must also verify the underlying issue state. And field combinations that seem impossible (Todo + Review, Locked + Done) will happen — your pickup logic needs to handle them gracefully rather than silently skipping them.

## After

With all six failures fixed, the task history changed:

```
Before: "No issue picked. Ending quietly." (×40 consecutive runs)

After:
  "Picked (resumed): Beet-API#292 — Stage gate: Spec Drafted"
  "Executed waterfall through PR Maintenance"
  "Waterfall executed, Backend task picked and advanced"
  "Done — waterfall executed and progressed"
```

The token efficiency analysis showed agents spending 91.3% of tokens on cached context (cheap) and only 0.8% on actual output. Each isolated cron run pays ~35K input tokens just for bootstrapping system prompt, AGENTS.md, SOUL.md, and workspace files. With four agents running 12 times daily, that's ~280K fresh input tokens per day on bootstrap alone. Custom sessions (which persist context across runs) would cut this significantly, but the current orchestrator only supports `isolated` sessions for cron jobs.

## What I'd do differently

If I were setting this up again:

1. **Start with one agent, not ten.** Each agent multiplies the configuration surface. Get one agent reliably picking issues and opening PRs before adding more.

2. **Build a state integrity check that runs before every pickup.** The pickup script should validate the board state and auto-heal violations before trying to find work. I added this after the fact — it should have been there from the start.

3. **Use the orchestrator's built-in observability first.** `openclaw tasks list` and `openclaw sessions --all-agents` showed everything I needed. I spent time parsing trajectory files manually before discovering these commands existed.

4. **Test with `--dry-run` after every config change.** The pickup script supports `--dry-run`. I should have run it for each platform after every filter change to verify agents could actually find work.

5. **Don't split instructions across files.** Having standing orders in `AGENTS.md` and contradictory instructions in cron messages is a recipe for confusion. Put the authoritative instructions in one place and reference them from the other.
