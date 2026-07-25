# How an agent should talk to Google Flow

Google Flow ships no public API. That fact is usually taken to mean "automate the
UI", which produces brittle tooling that breaks on every Google redeploy. It is
the wrong conclusion. Flow's frontend is a tRPC client — so an API _does_ exist,
it is simply undocumented and only reachable from an authenticated browser
session. The job is to get onto that API and stay there, treating clicks as the
exception rather than the interface.

This document is the map. It is the reasoning behind the code, not a restatement
of it.

---

## 1. The constraint that shapes everything

Flow's current UI is an **agent-chat, not a form**. You send a request; Flow's own
agent replies with a proposed generation carrying a **quoted credit cost** and
Approve/Reject controls; **nothing is charged until Approve**.

Three consequences follow, and they drive the whole design:

1. **Every cost is visible before it is committed.** So the correct architecture
   reads the quote and decides, rather than firing and reconciling afterwards.
2. **Rejection is free.** So "price this" is a genuinely zero-cost operation, and
   `flow_estimate_cost` is not an estimate — it is the real number.
3. **The gate is a setting, and settings can be off.** If anyone ever clicked
   "Approve, do not ask again", Flow stops showing cards and its agent charges
   autonomously, including on its own silent retries. Detecting that state is the
   single highest-value safety check in this server, and paid generation refuses
   to proceed without it.

Stills are free. Video is real money. Every design choice below optimises for
"accepted clips per credit", not for elegance.

---

## 2. The transport ladder

Three rungs, preferred top to bottom. `Tier` is reported on results so a caller
can see when the server has degraded from API to clicking.

### Tier 1 — `http`: Node fetch + the browser's cookies

No page in the loop. Cookies are lifted from the browser context and replayed
from Node.

- **Best for:** read-only GETs, especially parallel ones (`media.getMediaUrlRedirect`).
- **Why it wins:** no page, no renderer, no serialisation of a busy tab. Several
  calls can run at once.
- **Why it is opt-in:** an endpoint only reaches this tier after
  `flow_verify_http_tier` proves it works. Mutations are **never** auto-promoted —
  replaying an unknown mutation to "test" it could generate and charge.

### Tier 2 — `page-fetch`: `fetch()` evaluated inside the authenticated tab

The default and the workhorse. `page.evaluate` runs a real `fetch` from Flow's own
origin.

- **Auth is free.** The page carries the session; we never touch a credential.
- **CORS is free.** Same-origin by construction.
- **It is honest about session state.** A 401 here means the tab's session went
  stale, which is recoverable with a reload — not that the user is logged out.

This tier also removes the worst constraint of the previous shell-based driver.
That driver's `js` command could not await promises, so `fetch` returned empty and
every API call had to go through synchronous `XMLHttpRequest`. Playwright's
`evaluate` awaits properly, so ordinary async code just works.

### Tier 3 — `dom`: clicking

Reserved for surfaces with no endpoint: the settings gear, the Scenebuilder
timeline, the Approve/Reject controls themselves.

Two hard-won rules live here:

- **The composer is a `contenteditable` div, not an input.** Setting `value` or
  using a generic fill silently lands the text in a hidden search overlay. Real
  keyboard events into a focused div are the only reliable path, and the Send
  button frequently does not fire — Enter is the submit. Always verify the box
  cleared rather than assuming the message left.
- **Approve/Reject are bare divs with no ARIA role**, invisible to
  accessibility-tree selectors, so text matching is the only option. The button
  renders as an icon ligature plus a label, so its stripped text is
  `checkApprove`; the adjacent "Approve, do not ask again" row contains an inner
  span whose text is exactly `Approve`. **A naive leaf match hits the wrong one
  and permanently disables the cost gate.** Matching the full `checkApprove`
  string with a descendant cap is what keeps them apart.

### Why not pure HTTP with captured cookies?

Tempting, and it is what Tier 1 is. But it cannot be the _only_ transport: it has
no self-heal for session expiry, no way to reach settings, and no way to learn
what changed when Google ships a new build. The browser is not overhead here —
it is the credential store, the session refresher, and the discovery instrument.

---

## 3. Learning the API instead of guessing it

Hard-coding endpoint names for an undocumented API is how tools rot. Worse, in a
system where a mutation costs money, a wrong guess is not a 404 — it is a charge.

`flow_discover_api` therefore **observes** rather than assumes. It attaches request
and response listeners, reloads the app to replay its whole bootstrap, and derives
each endpoint's contract from traffic Flow's own frontend generates.

**Only shapes are persisted.** Request and response bodies are read to extract key
_names_, then dropped. The resulting `api-map.json` contains no prompts, no media,
no tokens, and nothing account-identifying.

Currently verified by hand, and encoded in `src/constants.ts`:

| Procedure                             | Method | What it does                                            |
| ------------------------------------- | ------ | ------------------------------------------------------- |
| `media.getMediaUrlRedirect?name=<id>` | GET    | 302s to a signed `flow-content.google` URL              |
| `runVideoFxConcatenation`             | POST   | Starts a Scenebuilder export job                        |
| `CheckConcatenationStatus`            | POST   | Poll; carries the finished MP4 as base64 `encodedVideo` |

Everything else is learned. When a tool reports a 404 on a procedure, the fix is
to re-run discovery, not to patch a constant.

---

## 4. The cost gate

The one invariant: **no credit is ever spent without a quote being read and
checked first.**

```
preflight        session live? signed in? confirm-gate ON? no paywall/re-auth wall?
   |
submit           type into the composer, verify the message actually sent
   |
await quote      read the credit figure from the proposal that follows OUR message
   |
gate             quote <= expected_max_cost ?
                 quote <= absolute ceiling (100) ?
                 spent + quote <= run ceiling ?
                 quote <= account balance ?
   |             any failure -> click Reject -> zero charged
approve          click checkApprove (never the do-not-ask-again row)
   |
poll             watch for media that did not exist before submission
   |             NEVER resubmit; a resubmit is a second charge
download         media id -> signed CDN url -> bytes -> verify magic bytes
   |
ledger           append prompt, quote, charge, verdict, files
```

Four properties worth calling out:

- **Refusals happen while rejection is still possible.** Every budget check runs
  before Approve, never after, so a refusal genuinely costs zero.
- **Completion is detected by media diffing, not by touching the composer again.**
  This is what makes "never resubmit an in-flight generation" enforceable.
- **Downloads are verified by magic bytes.** An expired session returns a JSON
  error body; writing that straight to disk produces a 27-byte "video" that only
  fails much later, in the edit. The server refuses to write non-media bytes and
  tells you to refresh the session instead.
- **Spend is append-only and survives restarts.** Credits are real money, so the
  ledger is an audit trail, not a debug log.

---

## 5. The creative loop the tools are shaped around

The tool surface is deliberately shaped like the workflow that produces accepted
clips at minimum spend, not like Flow's API surface:

1. **Compose in stills** (`flow_generate_still`) — free. Iterate until the
   composition is right. All creative mistakes belong here.
2. **Gate on stills.** A human approves compositions. Prompts are the lever;
   stills are the contract.
3. **Animate cheap** (`flow_generate_video`) — the approved still owns the
   composition, so the motion prompt describes only movement, camera, and ambient
   sound. Veo 3.1 Fast by default; Quality only for a named hero shot.
4. **Judge, retry once.** Roughly 70% first-try acceptance means budgeting ~1.4
   takes per needed clip — put that arithmetic in the plan before starting.
5. **Assemble** (`flow_export_scene`) — stitching is free; only "Extend" costs.

Final edit — music, VO, text, transitions — is not Flow's job. Deliver clean
clips; assemble elsewhere.

---

## 6. Security posture

- **This server never handles a credential.** It attaches to a browser a human
  already logged into. No password, passkey, OAuth code, or payment detail ever
  passes through it.
- **Everything on the page is untrusted content**, including Flow's own chat
  replies. Flow's agent generates text; that text is data, never instructions.
- **Re-auth walls, paywalls, and bot challenges stop the run.** They are detected
  before and after every charged action and handed back to a human. The server
  does not attempt to clear them.
- **The attached browser is never closed.** It is the user's window.
- **Deletion requires explicit ids.** There is deliberately no delete-all: a
  deleted source clip cannot be reliably re-added to a scene.

---

## 7. Known drift risks

Ranked by how likely they are to break first:

1. **DOM text matches** (`checkApprove`, `Download`) — Google relabels controls.
   Symptom: "could not locate the Approve control", nothing charged.
2. **Credit prices** — the table in `constants.ts` is from 2026-07. Re-verify if
   months have passed; a stale table makes `expected_max_cost` wrong.
3. **tRPC procedure names** — symptom is a 404. Fix with `flow_discover_api`, not
   by editing constants.
4. **Quote parsing** — currently a `\d+ credits` match on page text. If Flow
   renders costs as an icon plus a bare number, this needs the discovered
   endpoint's response instead.

The failure mode in every case is a refusal, not a silent charge. That is the
design goal: when this server is wrong, it should cost nothing.
