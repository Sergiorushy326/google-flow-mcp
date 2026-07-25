# Notes for AI coding agents

Guidance for Claude Code and similar agents working in this repo. Humans should
read [CONTRIBUTING.md](./CONTRIBUTING.md) instead — it covers the same ground with
more context.

## What this is

An MCP server that drives Google Flow (labs.google's Veo / Nano Banana tool)
through a real browser session. Flow has no public API, but its frontend is a tRPC
client — so this speaks that undocumented API first and falls back to DOM clicking
only for surfaces with no endpoint.

**Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing the transport layer or
the cost gate.** It carries the reasoning, not just the shape.

## Hard rules

This code spends real money. These are not style preferences.

- **The cost gate is the point.** Never move a budget check to after Approve.
  Every refusal must happen while rejection is still free.
- **Never guess a tRPC procedure name.** A wrong GET is a 404; a wrong mutation can
  charge. New endpoints come from `flow_discover_api`, not from constants.
- **Never resubmit an in-flight generation.** Completion is detected by diffing the
  media library, precisely so the composer is never touched twice.
- **Never widen a text match near Approve.** `checkApprove` versus the
  "Approve, do not ask again" row — see `references/ui-playbook.md`. A loose match
  disables the cost gate for the whole session.
- **This server handles no credentials, ever.** It attaches to a browser a human
  signed into. Re-auth walls stop the run and hand back to the human.
- **Fail toward a refusal.** When wrong about Flow's UI, cost nothing and say which
  control could not be found.

## Before you claim it works

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Then confirm the tool surface still loads — a server whose tools fail to register
is broken regardless of what compiles:

```bash
npm run inspect
```

Browser-driving code cannot be unit tested. Do not describe it as verified on the
basis of a passing build; the README tracks verification status per surface, and it
should stay honest.

## Layout

- `src/index.ts` — tool and resource registration only
- `src/services/transport.ts` — the tiered transport ladder
- `src/services/generate.ts` — the cost gate and generation lifecycle
- `src/services/ledger.ts` — budget enforcement and the spend audit trail
- `src/services/compose.ts` — settings, frame attachment, upload, upscale
- `references/` — credit economics, Veo prompting, and the UI playbook, also
  exposed as MCP resources

`references/ui-playbook.md` is the project's institutional memory. If you learn
something about Flow's behaviour, write it there.
