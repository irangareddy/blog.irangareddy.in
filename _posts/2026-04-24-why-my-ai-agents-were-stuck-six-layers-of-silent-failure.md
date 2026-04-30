---
title: "Why My AI Agents Were Stuck"
date: 2026-04-24
tokens: "~5.8k"
description: "I ran 10 autonomous coding agents for weeks thinking they were working. They weren't. Six compounding silent failures, from broken model auth to ghost issues on the project board."
tags:
  - AI Agents
  - Multi-Agent Systems
  - Debugging
  - Automation
series: "OpenClaw"
series_order: 1
---

I run a multi-agent system with 10 AI coding agents. A project manager, four platform-specific developers, and several specialists. They pick issues from a GitHub Project board, implement features, open PRs, and report status through Discord. Cron jobs fire every two hours. Heartbeats pulse every thirty minutes.

For weeks, everything looked fine. Cron jobs showed `ok`. No crash alerts. The dashboard was green. But nothing shipped. No PRs opened, no issues moved, no specs drafted.

I dug into it and found six failures stacked on top of each other. Every one was silent. Any single one would have blocked all progress. Together they made the system look alive while doing nothing.

![Agent run outcomes before and after fixes](/public/images/openclaw-agents-stuck/before-after-runs.svg)

## 1. The model didn't work

The gateway error log:

```
embedded run agent end: isError=true model=gpt-5.2-codex
error: "The 'gpt-5.2-codex' model is not supported when using
Codex with a ChatGPT account."
```

Every agent had `gpt-5.2-codex` hardcoded. The gateway config had fallbacks at the defaults level, but per-agent `model` fields override defaults entirely. The fallback chain never kicked in.

The cron scheduler still reported `ok` because the job completed. It just completed with an error. The status check didn't distinguish "agent ran and did work" from "agent crashed immediately."

I switched all six active agents to `gpt-5.3-codex`. Per-agent model overrides bypass default fallback chains. If you set `model` on individual agents, set fallbacks there too.

## 2. Heartbeats were disabled

```
Heartbeat: disabled (main), disabled (android-dev),
disabled (web-dev), disabled (ios-dev), ...
```

Every agent had `heartbeat: { "every": "0m" }`. I set the default to `"30m"`, but heartbeats stayed off. The docs explained why: "When any agent defines `heartbeat`, only those agents run heartbeats." Three utility agents had explicit `"0m"` overrides, and their existence caused the gateway to ignore the defaults for everyone else.

I removed all per-agent heartbeat overrides. In OpenClaw's config, per-agent fields don't merge with defaults. They replace them. One agent with an explicit heartbeat config switches the entire system from "defaults for everyone" to "only explicit agents."

## 3. Cron messages contradicted agent instructions

Each agent's `AGENTS.md` said:

> If `picked=false`, proactively draft missing scoped work and create one actionable issue with acceptance criteria.

The cron job message said:

> If picked=false, end quietly.

The cron message wins. It's the direct prompt for that turn. `AGENTS.md` is background context. So agents saw "end quietly" and complied.

The task history confirmed it. Forty consecutive runs:

```
"No issue picked (picked=false). Ending quietly."
"Staying idle..."
"No issue picked. Ending run quietly."
```

I replaced the cron messages with a work priority waterfall: pickup, then PR maintenance, then unblock, then lane refill, then quality checks. Agents only report idle if every tier is exhausted.

The lesson: when you split instructions between standing orders and per-run prompts, they will conflict. The cron message should reference the standing orders, not override them.

I ran a simple eval loop through these fixes: check eight things (model auth, heartbeat, cron behavior, boot sequence, pickup filters, board state, context size, Discord stability), fix what's broken, check again. Four passes to get from half-broken to fully working.

![Debug progress across four iterations](/public/images/openclaw-agents-stuck/eval-progression.svg)

## 4. The boot sequence asked "who am I?"

I messaged an agent through Discord. Instead of answering, it asked me to confirm its identity:

> "Hey. I just came online. Who am I? Who are you?"

Every agent workspace had a `BOOTSTRAP.md` designed for first-time setup. An onboarding flow where the agent discovers its name and learns about its human. Reasonable for initial config. But agents run in isolated cron sessions that start fresh each time. Every run was a first time.

Six of ten `USER.md` files were blank templates with empty fields. The agent read `BOOTSTRAP.md`, saw an empty `USER.md`, and concluded it hadn't been set up yet.

I replaced all `BOOTSTRAP.md` files with operational boot instructions: "You are already configured. Read your standing orders. Never ask the human to confirm your identity." Isolated sessions are amnesiac by design. Boot files for autonomous agents must be stateless.

## 5. The pickup script filtered out all work

After fixing the first four, agents started running but still found nothing. The pickup script returned `picked=false` for two platforms every time, despite the board showing 15 and 2 items as `Todo`.

The jq filter:

```jq
select(.status=="Todo" and .execution_stage!="Spec Drafted")
```

It excluded `Spec Drafted` items. But every Todo item on those platforms was `Spec Drafted`. The filter hid every pickable item on those platforms. The agents were supposed to be refining specs at that stage. The filter was preventing them from doing what they were built for.

I removed the exclusion. The execution stage gate in the cron message already controls what agents do at each stage. Spec work on `Spec Drafted`, code only after `Spec Approved`.

Filters compound. This script filtered by platform, status, lock state, blocked state, AND execution stage. Each filter was reasonable alone. Together, nothing passed through. When debugging empty results from a filter chain, remove one filter at a time.

## 6. The board was lying

The project board displayed 51 `Todo` items. The real number was 30.

Twenty-four issues had been closed (PRs merged, manually resolved) but their project board `Status` field never updated. GitHub Projects doesn't auto-sync issue state with project fields. The board showed `Todo` for `CLOSED` issues.

The pickup script checked `state=="OPEN"`, so it skipped these correctly. But the inflated count made it look like there was plenty of work. The PM agent's morning plan referenced phantom items, creating plans for work that couldn't be picked up.

I also found eight items with contradictory state: `Todo` with `Execution Stage=Review`. `In Progress` but `Unlocked`. Items locked at `Spec Drafted` where agents could only do spec work but couldn't advance past it. Dead-end loops.

![Project board before and after cleanup](/public/images/openclaw-agents-stuck/board-before-after.svg)

I updated all 24 closed issues to `Done`, fixed the eight violations, added a state integrity layer to the pickup script, and documented valid transitions.

Project boards are views, not source of truth. The source of truth is issue state in the repo. Any automation reading project fields must also verify the underlying issue state.

## After

The task history:

```
Before: "No issue picked. Ending quietly." (×40 runs)

After:
  "Picked (resumed): issue #292, stage gate: Spec Drafted"
  "Executed waterfall through PR Maintenance"
  "Waterfall executed, one task picked and advanced"
```

I pulled token usage from `openclaw sessions --all-agents`. Out of 3.96M tokens consumed across all runs, 91.3% were cache reads (the orchestrator reuses prompt prefix across calls), 7.9% were fresh input (system prompt, workspace files, cron message), and 0.8% were agent output (the actual work).

![Token distribution across 3.96M total tokens](/public/images/openclaw-agents-stuck/token-distribution.svg)

The cache hit rate is good. The problem is the fresh input: each isolated cron run loads ~35K tokens of system prompt, AGENTS.md, SOUL.md, and workspace files from scratch. Four agents, 12 runs per day each, that's ~280K fresh input tokens daily just on context bootstrap. Persistent sessions across runs would eliminate most of that, but the orchestrator currently only supports isolated sessions for cron jobs.

## What I'd do differently

Start with one agent, not ten. Each agent multiplies the config surface. Get one reliably shipping before scaling.

Build state integrity checks before the first pickup, not after you find violations. The pickup script should validate and auto-heal the board before looking for work.

Use the orchestrator's built-in observability. `openclaw tasks list` and `openclaw sessions --all-agents` had everything I needed. I spent time parsing trajectory files before finding these commands.

Test with `--dry-run` after every config change. The pickup script supports it. Run it per platform after every filter change.

Don't split authoritative instructions across files. Standing orders in `AGENTS.md` and contradictory prompts in cron messages will conflict. One source of truth, referenced by everything else.
