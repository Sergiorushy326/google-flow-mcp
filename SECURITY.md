# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/roshanarnav25-sloth/google-flow-mcp/security/advisories/new)
rather than opening a public issue.

Expect an initial response within 7 days. Please include reproduction steps and,
where relevant, whether the issue could cause an **unintended credit charge** —
that is treated with the same seriousness as a data-exposure bug here.

## Threat model

This server is unusual: it drives a paid product on a user's behalf, inside a
browser the user is signed into. The security properties that matter most:

### It never handles credentials

No password, passkey, OAuth code, or payment detail passes through this server. It
attaches to a Chrome instance a human has already signed into, over CDP. There is
no credential store, no token file, and no login flow. Re-authentication walls,
paywalls, and bot challenges **stop the run** and are handed back to a human.

If you find a code path where this server could be made to type a credential or
clear an auth challenge, that is a vulnerability — please report it.

### Page content is untrusted

Google Flow is an agent-chat product, so the page contains model-generated text.
**All page content — including Flow's own chat replies — is treated as data, never
as instructions.** Nothing read from the DOM is executed, evaluated as code, or
allowed to redirect the server's behaviour.

Prompt-injection resistance is a real concern here: a malicious or manipulated
page could try to talk the calling agent into approving an expensive generation.
The cost gate is deliberately enforced in this server's own code against a
caller-supplied limit, not by anything read from the page.

### Spend is bounded structurally

- `expected_max_cost` is a **required** schema parameter on the only tool that can
  charge. It cannot be omitted.
- `FLOW_BUDGET_CEILING` bounds total spend across the run and survives restarts.
- An absolute ceiling in `src/constants.ts` overrides any caller-supplied limit.
- Every check runs _before_ approval, while rejection is still free.

A bug that lets a generation be approved without passing these checks is a
security issue, not just a defect.

### What is stored locally

Under `FLOW_STATE_DIR` (default `~/.google-flow-mcp`):

- `api-map.json` — learned endpoint **shapes only**. Key names, never values. No
  prompts, media, tokens, cookies, or account identifiers.
- `ledger.jsonl` — your own generation history: prompt (first 500 chars), quoted
  cost, actual charge, verdict, output paths. Local only; never transmitted.
- `budget.json` — ceiling and spend counters.

Nothing is sent anywhere except to Google Flow itself, through your own browser
session. There is no telemetry.

## Supported versions

Pre-1.0: only the latest release receives fixes.

## Scope

Out of scope: Google Flow's own behaviour, pricing changes, and UI changes that
break selectors. Those are bugs — file them as issues, not advisories.
