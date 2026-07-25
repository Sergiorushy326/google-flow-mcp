# Flow credit economics

> Confirmed via support.google.com/flow/answer/16526234 (2026-07) + live account observation. Re-verify the table if months have passed — pricing moves.

## Cost table (standard / Ultra-plan discount)

| Generation                             | Credits               | Ultra |
| -------------------------------------- | --------------------- | ----- |
| Still image (Nano Banana / Pro / Lite) | **0 — free**          | 0     |
| Veo 3.1 Lite (4/6/8s)                  | 10                    | 5     |
| Veo 3.1 Fast (4/6/8s)                  | 20                    | 10    |
| Veo 3.1 Quality (8s)                   | 100                   | 100   |
| Gemini Omni Flash (4/6/8/10s)          | 15/20/25/30           | —     |
| Scenebuilder edit segment (≤10s)       | 40                    | —     |
| 1080p upscale                          | free (Plus/Pro/Ultra) | free  |
| 4K upscale                             | 50 (Ultra only)       | 50    |

## Facts that change behavior

- The chat quotes the cost per proposal BEFORE approval. Read it every time — model/tier misconfiguration shows up right there.
- A proposal you Reject costs 0. Dry-run-then-reject is the sanctioned pricing probe.
- Multiple outputs per prompt multiply cost linearly. Default to 1.
- Take the free 1080p upscale at download; never pay for 4K on social content.
- Real-world acceptance on Veo 3.1 is roughly 70% first-try (directional, third-party) → budget ~1.4 generations per needed clip, and put that math in the plan before starting.

## Budget plan template (put this in every task brief)

```
Balance at start:            X
Clips needed:                N
First takes:                 N × tier-cost
Retry allowance (~40%):      0.4 × N × tier-cost
Hero reserve (optional):     1 × Quality if one named shot warrants it
CEILING (hard):              sum — stop and report at ceiling, never exceed
```
