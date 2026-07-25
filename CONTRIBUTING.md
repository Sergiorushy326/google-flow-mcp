# Contributing

Thanks for helping. This project automates a tool that **spends real money**, so the
bar for changes near generation and budget code is higher than for a typical repo.
Everything else is ordinary.

## Setup

```bash
git clone https://github.com/roshanarnav25-sloth/google-flow-mcp.git
cd google-flow-mcp
npm install
npm run build
```

Then run the whole check suite exactly as CI does:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

Node 20+ and a local Google Chrome are required. You do **not** need a Google
account or any credits to build, lint, or run the test suite — every test is
offline and free.

## The rules that are not negotiable

These exist because breaking them costs a user money, not just correctness.

1. **Never move a budget check to after approval.** Flow quotes a cost before
   charging; that is the entire safety property this project rests on. Every
   refusal must happen while rejection is still free. See `assertAffordable` in
   `src/services/ledger.ts`.
2. **Never guess a tRPC procedure name.** A wrong GET is a 404; a wrong _mutation_
   can generate and charge. New endpoints come from `flow_discover_api` observing
   real traffic, never from a plausible-looking constant.
3. **Never resubmit an in-flight generation.** Completion is detected by diffing the
   media library precisely so the composer is never touched twice.
4. **Never handle a credential.** No password, passkey, OAuth code, or payment
   detail may pass through this server. It attaches to a browser a human already
   signed into. Re-auth walls stop the run and hand back to a human.
5. **Never widen a text-match selector near Approve.** Read the warning in
   `references/ui-playbook.md` about `checkApprove` versus the
   "Approve, do not ask again" row first — a loose match silently disables the cost
   gate for the whole session.
6. **Fail toward a refusal.** When this server is wrong about Flow's UI, it should
   cost nothing and say what it could not find. Errors carry a `remedy` explaining
   the next step; keep that habit.

## Adding a tool

- Name it `flow_<verb>_<noun>`, snake_case, service-prefixed.
- Give it a Zod `inputSchema` with `.describe()` on every parameter.
- Set `annotations` honestly. **`destructiveHint: true` means "this can spend
  credits or destroy data"** — that is how a client warns a user, so do not soften it.
- If the action can charge, require an explicit cost parameter or acknowledgement
  in the schema. `flow_generate_video` requires `expected_max_cost`;
  `flow_open_app` requires `acknowledge_unknown_cost`. Make it structurally
  impossible to spend by accident.
- Say in the description whether it charges. Every existing tool does.

## Testing

Unit tests use Node's built-in runner via `tsx`; there is no test framework to
learn:

```bash
npm test
```

Pure logic must have tests — budget arithmetic, URL construction, file-type
identification, redaction, payload extraction. Browser-driving code is not unit
tested; it is verified by calibration against live Flow, which is why the README
tracks verification status per surface honestly.

If you fix a selector, **say which date and which Flow build you verified it
against** in the PR, and update `references/ui-playbook.md`. That file is the
project's institutional memory and is worth more than the code around it.

## Calibrating against live Flow

All three calibration steps are free:

```
flow_check_session      # browser, login, credits, confirm gate
flow_discover_api       # observes traffic, submits nothing
flow_estimate_cost      # real quote, then rejects
```

Never open a PR whose testing story required a paid generation unless you say so
and report what it cost.

## Style

Prettier and ESLint are enforced in CI; run `npm run format` before pushing.
Comments should explain a constraint the code cannot show — not narrate the next
line. Match the surrounding density.

## Reporting bugs

Use the issue templates. For anything involving an unexpected charge, please
include the relevant `flow_ledger` output with prompts redacted — the ledger is
designed to make that diagnosable.
