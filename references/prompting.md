# Prompting Flow/Veo for realistic brand footage

> Veo 3.1 is biased toward realism and rewards precision. Vague prompts produce glossy-stock genericness; precise prompts produce photographs that move. The stills-first split below is the core craft.

## The two-prompt split (stills-first)

Every shot gets TWO prompts with different jobs:

- **Still prompt** (free iteration): owns the ENTIRE composition. Iterate here until right.
- **Motion prompt** (paid, Frames-to-Video): describes ONLY what moves — action beat, camera move, ambient sound. It must not re-describe the scene (the start frame owns it); it should open with an instruction to preserve the frame.

## Still prompt anatomy — be precise about everything

Include, concretely:

- **Subject**: age band, build, wardrobe with colors/garment names, one grounding detail ("black wired headset", "steel cup, not ceramic")
- **Setting**: 3–5 named props, region-specific cues (a generic "apartment stairwell" defaults to Western/European renders — name the cues you need: exposed conduit, nameplate, chappals on the doormat)
- **Light**: source + direction + quality ("morning light from a window camera-left", "single bare overhead bulb, pool of light in darkness")
- **Lens/framing**: focal feel + aperture + angle ("35mm, f/2.0, over-the-shoulder", "eye-level medium close-up")
- **Grade/mood**: 2–3 words tied to brand palette
- **A Composition Check line** (for the reviewer): the 2–3 things the still must show to pass.
- **Sequence temperature match**: clips that will sit adjacent in an edit must share a lighting-temperature family (all-warm or all-cool). Write the SAME temperature words into both shots' still prompts, and check neighbours against each other at the still gate — before any animation credits burn. A deliberate time-jump (morning→dusk) needs a bridging transition in the edit, never a raw hard cut across temperatures.

Suffix every still prompt with the project's fixed style block (photoreal/documentary/no-text/no-logos/no-readable-screens/aspect).

## Motion prompt anatomy

- ONE action beat per ~8s clip ("she straightens, taps the earpiece, begins speaking" — not a sequence of five events)
- One camera verb ("slow dolly-in", "static", "handheld sway", "tracking at parcel height")
- Ambience: "ambient sound only, no dialogue, no speech, no music" whenever brand bans AI voices
- Open with: "Photorealistic, maintain the exact composition, lighting and subjects of the start frame."

## Known Veo failure modes → prompt countermeasures

| Failure                         | Countermeasure                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Garbled text anywhere           | Ban text in-prompt AND keep screens/labels angled away, out of focus, or plain                           |
| Hand anatomy                    | Keep hands mid-action or partially occluded; REJECT any still with malformed hands before it costs money |
| Uncanny faces                   | Prefer averted/defocused/partially-hidden faces; full-face shots need the most still iterations          |
| Identity/set morphing in motion | Smaller action beats; camera verb ≠ subject motion both large at once                                    |
| Glossy-stock look               | "documentary", "natural imperfect framing", named practical light sources                                |
| Region-generic renders          | Name the regional cues explicitly every time                                                             |
| Stray speech/music in audio     | The ambience line, every motion prompt, no exceptions                                                    |

## Reuse across shots

- Matched pairs (same room, two moods): approve shot A's still → feed it as an Ingredient (reference image) for shot B, or reuse the still with a re-lit variant still prompt.
- The person approving compositions should see stills, not prompts — prompts are the lever, stills are the contract.
