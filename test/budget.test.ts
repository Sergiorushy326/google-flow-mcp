import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The budget gate is the only thing standing between a bad quote-parse and a real
 * charge, so it gets the most thorough tests in this repo. Every case here maps to
 * a way someone could lose money.
 *
 * FLOW_STATE_DIR must be set before importing the module under test, because
 * config.ts snapshots the environment at import time.
 */
const stateDir = path.join(os.tmpdir(), `flow-mcp-test-${process.pid}`);
process.env.FLOW_STATE_DIR = stateDir;

const { assertAffordable, readBudget, recordSpend, resetSpend, setCeiling, appendLedger, readLedger } =
  await import("../src/services/ledger.js");
const { ABSOLUTE_COST_CEILING } = await import("../src/constants.js");

describe("budget gate", () => {
  before(async () => {
    await fs.mkdir(stateDir, { recursive: true });
    await setCeiling(null);
    await resetSpend();
  });

  after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("allows a quote at exactly the caller's limit", async () => {
    await assert.doesNotReject(() => assertAffordable(20, 20, 500));
  });

  it("rejects a quote one credit over the caller's limit", async () => {
    await assert.rejects(
      () => assertAffordable(21, 20, 500),
      (err: Error) => err.name === "BudgetError" && /quoted 21/.test(err.message),
    );
  });

  it("rejects anything above the absolute ceiling even when the caller allows it", async () => {
    await assert.rejects(
      () => assertAffordable(ABSOLUTE_COST_CEILING + 1, ABSOLUTE_COST_CEILING + 50, 10_000),
      (err: Error) => err.name === "BudgetError" && /absolute ceiling/.test(err.message),
    );
  });

  it("names the likely cause when the quote looks like the wrong model tier", async () => {
    await assert.rejects(
      () => assertAffordable(100, 20, 500),
      (err: Error) => /Veo Quality|model tier/i.test(err.message),
    );
  });

  it("rejects a quote larger than the account balance", async () => {
    await assert.rejects(
      () => assertAffordable(20, 20, 5),
      (err: Error) => err.name === "BudgetError" && /balance is 5/.test(err.message),
    );
  });

  it("treats an unknown balance as non-blocking, since callers gate on the ceiling", async () => {
    await assert.doesNotReject(() => assertAffordable(20, 20, null));
  });

  it("blocks the generation that would cross the run ceiling", async () => {
    await setCeiling(50);
    await resetSpend();
    await recordSpend(40);

    await assert.rejects(
      () => assertAffordable(20, 20, 500),
      (err: Error) => err.name === "BudgetError" && /ceiling of 50/.test(err.message),
    );
    // ...but the one that lands exactly on the ceiling is allowed.
    await assert.doesNotReject(() => assertAffordable(10, 20, 500));
  });

  it("accumulates spend across calls and survives a re-read", async () => {
    await setCeiling(null);
    await resetSpend();
    await recordSpend(20);
    await recordSpend(10);
    assert.equal((await readBudget()).spent, 30);
  });

  it("preserves the ceiling when spend is reset", async () => {
    await setCeiling(120);
    await recordSpend(50);
    const budget = await resetSpend();
    assert.equal(budget.spent, 0);
    assert.equal(budget.ceiling, 120);
  });
});

describe("ledger", () => {
  before(async () => {
    await fs.mkdir(stateDir, { recursive: true });
  });

  it("appends entries and reads them back newest-last", async () => {
    await appendLedger({
      ts: new Date().toISOString(),
      kind: "video",
      prompt: "test clip",
      model: null,
      quotedCost: 20,
      charged: 20,
      balanceAfter: 480,
      verdict: "downloaded",
      files: ["/tmp/a.mp4"],
      note: null,
    });
    const entries = await readLedger(10);
    assert.ok(entries.length >= 1);
    assert.equal(entries[entries.length - 1].charged, 20);
  });

  it("records a rejected proposal as a zero charge", async () => {
    await appendLedger({
      ts: new Date().toISOString(),
      kind: "video",
      prompt: "too expensive",
      model: null,
      quotedCost: 100,
      charged: 0,
      balanceAfter: null,
      verdict: "rejected",
      files: [],
      note: "over ceiling",
    });
    const last = (await readLedger(1))[0];
    assert.equal(last.verdict, "rejected");
    assert.equal(last.charged, 0);
    assert.equal(last.quotedCost, 100);
  });
});
