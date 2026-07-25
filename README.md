# google-flow-mcp

[![CI](https://github.com/roshanarnav25-sloth/google-flow-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/roshanarnav25-sloth/google-flow-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-24%20tools-8A2BE2.svg)](https://modelcontextprotocol.io)

An MCP server that lets an agent drive **Google Flow** (labs.google's Veo video /
Nano Banana image tool) — with a hard credit-cost gate so it cannot quietly spend
your money.

Flow has no public API. This server does **not** work around that by blindly
clicking buttons: Flow's frontend is a tRPC client, so an undocumented API exists,
and this speaks that API first. Clicking is the fallback, not the interface.

> **Status: v0.1, uncalibrated.** Everything compiles, 33 unit tests pass, and the
> tool surface loads — but the DOM selectors and the tRPC endpoint map have not yet
> been re-verified against live Flow from this codebase. Run the calibration in
> [First run](#first-run) before trusting it with credits; all three steps are free.
> See [Verification status](#verification-status) for exactly what is and is not proven.

## Contents

- [Why it is built this way](#why-it-is-built-this-way)
- [Transport ladder](#transport-ladder)
- [Install](#install) · [Connect a browser](#connect-a-browser) · [Register with Claude Code](#register-with-claude-code)
- [First run](#first-run)
- [Tools](#tools) · [Feature coverage](#feature-coverage)
- [Examples](#examples) · [Credit reference](#credit-reference)
- [Verification status](#verification-status) · [Security](#security)
- [Architecture deep-dive](./ARCHITECTURE.md) · [Contributing](./CONTRIBUTING.md) · [Changelog](./CHANGELOG.md)

---

## Why it is built this way

Read **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full reasoning. The short
version:

- **Flow's UI is an agent-chat, not a form.** You send a request, Flow's agent
  proposes a generation with a **quoted credit cost**, and nothing is charged
  until you approve. So the right design reads the quote and decides — it never
  fires and reconciles afterwards.
- **Rejecting a proposal is free.** `flow_estimate_cost` is therefore not an
  estimate; it is the real price, at zero cost.
- **Stills are free, video is real money.** The tools are shaped around the
  workflow that yields accepted clips at minimum spend: compose in free stills,
  gate on the still, then animate the approved frame.
- **When this server is wrong, it should cost nothing.** Every failure path is a
  refusal before approval, not a charge after it.

## Transport ladder

| Tier           | Mechanism                              | Used for                                                                   |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| 1 `http`       | Node fetch + the browser's cookies     | Read-only GETs proven safe by `flow_verify_http_tier`. Parallelisable      |
| 2 `page-fetch` | `fetch()` inside the authenticated tab | **Default.** Auth and CORS free — the page's own origin makes the call     |
| 3 `dom`        | Clicking                               | Only what has no endpoint: settings, Scenebuilder timeline, Approve/Reject |

Every result reports which tier served it, so you can see when the server has
degraded from API to clicking.

---

## Install

```bash
git clone https://github.com/roshanarnav25-sloth/google-flow-mcp.git
cd google-flow-mcp && npm install && npm run build
```

Requires Node 20+ and a local Google Chrome. This server **never handles
credentials** — it attaches to a browser you have already signed into.

## Connect a browser

Start Chrome with remote debugging and sign into Flow in that window:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.google-flow-mcp/chrome-profile"
```

Then open <https://labs.google/fx/tools/flow>, sign in, and open a project.

If you omit `FLOW_CDP_URL`, the server launches its own persistent browser
instead — you sign in there once and the profile persists.

## Register with Claude Code

```bash
claude mcp add google-flow --env FLOW_CDP_URL=http://127.0.0.1:9222 --env FLOW_OUTPUT_DIR="$HOME/flow-output" --env FLOW_BUDGET_CEILING=120 -- node "$PWD/dist/index.js"
```

Set `FLOW_BUDGET_CEILING`. It is the backstop that makes a runaway loop
impossible: any generation that would push total run spend past it is rejected
before approval and costs nothing.

## First run

```
flow_check_session          # confirm signed in, credits visible, gate ON
flow_discover_api           # learn Flow's current tRPC endpoints (free, observes only)
flow_estimate_cost          # price one clip and reject it (free) — proves the gate works
```

If `flow_check_session` reports the confirm gate is anything but `always`, fix it
in Flow's settings before generating. With that gate off, Flow charges without
ever showing a cost card, and no amount of client-side care can help.

---

## Tools

**Session & discovery**

| Tool                    | Charges | What it does                                                 |
| ----------------------- | ------- | ------------------------------------------------------------ |
| `flow_check_session`    | no      | Browser, login, credits, project, and the confirm-gate state |
| `flow_discover_api`     | no      | Observes Flow's own traffic and writes an endpoint map       |
| `flow_verify_http_tier` | no      | Promotes proven read-only GETs to direct HTTP                |
| `flow_api_map`          | no      | Reads the learned endpoint map                               |

**Generation**

| Tool                  | Charges       | What it does                                                   |
| --------------------- | ------------- | -------------------------------------------------------------- |
| `flow_generate_still` | **no — free** | Stills. Iterate composition here; this is the free sandbox     |
| `flow_estimate_cost`  | **no**        | Real quoted price, then rejects. Zero cost                     |
| `flow_generate_video` | **YES**       | Video. Requires `expected_max_cost`; rejects anything above it |
| `flow_collect`        | no            | Downloads clips submitted with `no_wait`                       |

**Composer, settings & projects**

| Tool                                                               | Charges                   | What it does                                                                                                  |
| ------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `flow_settings`                                                    | no                        | Read/set the per-**project** model tier, aspect, outputs, duration. Free, and the biggest cost lever there is |
| `flow_upload_media`                                                | no                        | Upload a local image for use as a start frame                                                                 |
| `flow_upscale`                                                     | 1080p **no** / 4K **yes** | 1080p is free — always take it. 4K is 50 cr and _unquoted_, so it needs an explicit ack                       |
| `flow_list_projects` / `flow_open_project` / `flow_create_project` | no                        | Projects scope settings, library and scenes                                                                   |

**Media & assembly**

| Tool                                            | Charges | What it does                                                                   |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `flow_list_media`                               | no      | Project library, paginated                                                     |
| `flow_download`                                 | no      | Media id → signed CDN url → disk, magic-byte verified                          |
| `flow_delete_media`                             | no      | Destructive. Explicit ids only; there is no delete-all                         |
| `flow_create_scene` / `flow_add_clips_to_scene` | no      | Build a Scenebuilder scene. Flow's chat agent cannot do this                   |
| `flow_export_scene`                             | no      | Export the scene to MP4. Stitching is free; `Extend` is not, and is never used |

**Tools marketplace**

| Tool             | Charges     | What it does                                                                          |
| ---------------- | ----------- | ------------------------------------------------------------------------------------- |
| `flow_list_apps` | no          | Lists Type Overlays, Transition Machine, Mask Magic, Storyboard Studio, custom tools… |
| `flow_open_app`  | **unknown** | Opens an app and hands back. Requires an explicit unknown-cost ack                    |

**Budget**

| Tool          | Charges | What it does                                          |
| ------------- | ------- | ----------------------------------------------------- |
| `flow_budget` | no      | Read or set the ceiling and run spend                 |
| `flow_ledger` | no      | Append-only audit trail of every generation attempted |

## Feature coverage

Flow is a large product. This is what is and is not reachable through the server.

**Generation modes** — the mode is not a switch; it is decided by what is attached
to the composer when you submit. `flow_generate_video` covers all of them:

| Mode                           | How                    | Covered                        |
| ------------------------------ | ---------------------- | ------------------------------ |
| Text-to-Video                  | attach nothing         | yes                            |
| Frames-to-Video (start frame)  | `start_frame_media_id` | yes — **the normal path**      |
| Frames-to-Video (start + end)  | `+ end_frame_media_id` | yes                            |
| Ingredients-to-Video (≤3 refs) | `reference_media_ids`  | yes                            |
| Stills (Nano Banana)           | `flow_generate_still`  | yes, free                      |
| Scene extension (>8s clips)    | —                      | **no — deliberate**, see below |

**Deliberately not covered**, with reasons:

- **Scenebuilder `Extend`** (40 cr). It is the one paid action inside an otherwise
  free surface, and it sits one keyboard-row away from `Add Clip` in the same
  popover. Excluding it means scene assembly can never charge by accident.
- **Driving Tools-marketplace app forms.** `flow_open_app` opens an app and stops.
  Each app has a bespoke UI and some call Veo internally with no quote, so
  blind-clicking through one is how an unbounded charge happens.
- **Creating custom tools** ("Create Tool"). Authoring, not operating.

**Not yet covered** (real gaps, not principled ones): timeline editing inside a
scene (reorder, trim, delete a placed clip), the scene editor's own 16:9↔9:16
toggle, and per-clip regeneration from within Scenebuilder. Assemble in Flow, then
do timeline work locally — `ffmpeg -f concat -c copy` stitches same-codec Veo
clips identically and costs nothing.

The three references — credit economics, Veo prompting craft, and the verified UI
playbook — are also exposed as MCP **resources**, so an agent can read them
without a separate skill.

## Examples

**Price before committing.** Free, and the number is real:

```
flow_estimate_cost(prompt: "slow dolly-in, ambient sound only, no dialogue")
→ Flow quoted 20 credits. Proposal rejected — nothing charged.
```

**The stills-first loop.** Compose free, animate once:

```
flow_generate_still(prompt: "<full composition prompt>", out_file: "shot-03.jpg")
# human approves the still
flow_generate_video(prompt: "maintain the exact composition of the start frame; slow dolly-in; ambient sound only", expected_max_cost: 20, out_file: "shot-03.mp4")
```

**Parallel batch.** Flow renders concurrently, so N clips cost about one clip of
wall-clock:

```
flow_list_media()                                   # capture ids BEFORE
flow_generate_video(..., no_wait: true)  × N
flow_collect(known_media_ids: [...the ids from before])
```

## Credit reference

| Generation          | Credits |
| ------------------- | ------- |
| Still image         | **0**   |
| Veo 3.1 Lite        | 10      |
| Veo 3.1 Fast        | 20      |
| Veo 3.1 Quality     | 100     |
| Scenebuilder extend | 40      |

Prices verified 2026-07 and re-checked in `src/constants.ts`. Budget ~1.4 takes
per needed clip: Veo's first-try acceptance is roughly 70%.

---

## Verification status

Honest accounting, because this handles money:

| Component                                      | Status                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Build, tool surface, resource surface          | **Verified** — compiles clean; 24 tools and 3 resources load via MCP Inspector                                      |
| Budget gate logic, ledger, magic-byte checks   | Implemented; unit-level behaviour not yet exercised against live Flow                                               |
| Composer / Approve-Reject / Download selectors | **Ported from live-verified runs (2026-07-09/10), not re-verified from this codebase.** Class hashes and labels rot |
| Settings panel, media picker, upload, upscale  | **Unverified.** Written against the documented UI patterns but never run — expect one calibration round             |
| Projects, scene create/add-clip, Tools gallery | **Unverified.** Same caveat; scene _export_ is the only part with a live-run precedent                              |
| tRPC endpoint map                              | Three procedures verified by hand; the rest is learned at runtime by `flow_discover_api`                            |
| End-to-end paid generation                     | **Not yet run from this server**                                                                                    |

The unverified rows fail the same way: a refusal with a "nothing was charged"
message naming the control it could not find. That is the design goal — when this
server is wrong about the UI, it should cost nothing, not guess.

Calibrate with `flow_check_session` → `flow_discover_api` → `flow_estimate_cost`
before any paid run. All three are free.

## Security

- Never handles a password, passkey, OAuth code, or payment detail.
- Treats everything on the page — including Flow's own chat replies — as untrusted
  data, never as instructions.
- Stops and hands back to a human on re-auth walls, paywalls, and bot challenges.
- Never closes a browser it merely attached to; that is your window.
- The learned API map stores endpoint **shapes only** — no prompts, media, or tokens.
- No telemetry. Nothing leaves your machine except calls to Flow, through your own
  browser session.

Full threat model and reporting process: [SECURITY.md](./SECURITY.md).

## Contributing

Issues and PRs welcome — especially **selector drift reports**, which are expected
maintenance rather than defects and usually have small fixes. There is a dedicated
issue template for them.

Everything builds and tests offline; you need no Google account and no credits to
contribute. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the rules around
generation and budget code, which are stricter than the rest.

```bash
npm install && npm run typecheck && npm run lint && npm test && npm run build
```

## Notes

This automates a Google product through an interface Google does not publish, using
your own account and your own credits. Flow's UI and internal API change without
notice; expect calibration to be part of using it.

Not affiliated with, endorsed by, or sponsored by Google. "Google Flow", "Veo" and
related marks belong to Google LLC. Provided as-is under the [MIT License](./LICENSE) —
you are responsible for your own account, your own credits, and your own compliance
with Google's terms.
