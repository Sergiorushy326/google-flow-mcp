## What this changes

<!-- One or two sentences. -->

## Why

<!-- Link an issue if there is one. -->

## Testing

<!-- How did you verify this? -->

- [ ] `npm run typecheck && npm run lint && npm run format:check && npm test` passes
- [ ] Added or updated unit tests for any pure logic touched

**If this touches browser automation**, which Flow build did you verify against, and
on what date?

<!-- e.g. "Verified against Flow on 2026-08-01; Approve control now renders as ..." -->

**If this touches generation, budget, or approval code**, confirm:

- [ ] No budget check moved to after approval
- [ ] No new tRPC procedure name was guessed rather than discovered
- [ ] Any new charging path requires an explicit cost parameter or acknowledgement
- [ ] Failure modes refuse rather than charge

## Credits spent testing

<!-- State the number, or "none". Most changes need none — calibration is free. -->
