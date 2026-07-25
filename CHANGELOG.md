# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-07-25

First public release. **Not yet calibrated against live Flow** — see
[Verification status](./README.md#verification-status) before spending credits.

### Added

**Transport**

- Tiered transport ladder over Google Flow's undocumented internal tRPC API:
  direct HTTP (cookies, no page) → in-page `fetch` (default) → DOM automation
  (only for surfaces with no endpoint). The tier used is reported on every result.
- `flow_discover_api` learns Flow's endpoints by observing its own frontend
  traffic, rather than hard-coding guesses. Persists endpoint **shapes only** — no
  prompts, media, or tokens.
- `flow_verify_http_tier` promotes proven read-only GETs to the no-browser tier.
  Mutations are never auto-promoted, since replaying one to test it could charge.

**Cost safety**

- Hard cost gate: Flow's quoted price is read and checked against
  `expected_max_cost`, an absolute ceiling, the run budget, and the account balance
  — all _before_ approval, while rejection is still free.
- `expected_max_cost` is a required schema parameter on the only charging tool.
- Persistent budget ceiling and append-only spend ledger that survive restarts.
- `flow_estimate_cost` returns Flow's real quote at zero cost by rejecting the
  proposal.
- Refusal to run any paid generation when Flow's "Confirm before generating"
  setting is off, because the gate cannot work without it.

**Generation**

- All Flow generation modes. Mode is selected by attachment, matching how Flow
  actually works: `start_frame_media_id` for Frames-to-Video,
  `+ end_frame_media_id` for start/end interpolation, `reference_media_ids` for
  Ingredients-to-Video, nothing for Text-to-Video.
- Free stills via `flow_generate_still`.
- Parallel batching with `no_wait` plus `flow_collect`.
- `flow_settings` for the per-project model tier, aspect ratio, outputs and
  duration — free, and the largest cost lever available.

**Media, projects, assembly**

- Library listing, download, and deletion. Downloads are verified by magic bytes,
  so an expired-session error body is never written to disk as media.
- Project list/open/create.
- Scenebuilder scene creation and clip assembly (free), plus export that captures
  the job's base64 payload directly, since Flow's export never writes a file.
- Upload of local images for use as start frames; 1080p and (gated) 4K upscale.
- Tools-marketplace listing, and app opening behind an explicit unknown-cost
  acknowledgement.

**Documentation**

- `ARCHITECTURE.md` explaining the transport ladder, the cost gate, and known
  drift risks.
- Credit economics, Veo prompting craft, and the Flow UI playbook shipped as MCP
  resources so an agent can read them directly.

### Security

- Never handles credentials; attaches to a browser the user has already signed
  into. Re-auth walls, paywalls, and bot challenges stop the run.
- Treats all page content, including Flow's own chat replies, as untrusted data.
- Never closes a browser it merely attached to.

### Known limitations

- Scenebuilder `Extend` (40 credits) is deliberately unimplemented — it is the one
  paid action inside an otherwise free surface, adjacent to `Add Clip` in the same
  popover.
- Tools-marketplace app _forms_ are not driven; apps are opened and handed back.
- Scene timeline editing (reorder, trim, delete a placed clip) is not covered.

[Unreleased]: https://github.com/roshanarnav25-sloth/google-flow-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/roshanarnav25-sloth/google-flow-mcp/releases/tag/v0.1.0
