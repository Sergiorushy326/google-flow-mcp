import { promises as fs } from "node:fs";
import { config, paths } from "../config.js";
import { ABSOLUTE_COST_CEILING } from "../constants.js";
import { BudgetError, type BudgetState, type LedgerEntry } from "../types.js";

/**
 * Credits are real money, so spend is append-only and survives restarts. The
 * ledger is the audit trail; the budget file is the enforcement point.
 */

async function ensureStateDir(): Promise<void> {
  await fs.mkdir(config.stateDir, { recursive: true });
}

export async function readBudget(): Promise<BudgetState> {
  try {
    return JSON.parse(await fs.readFile(paths.budget, "utf8")) as BudgetState;
  } catch {
    return { ceiling: config.budgetCeiling, spent: 0, startedAt: new Date().toISOString() };
  }
}

export async function writeBudget(state: BudgetState): Promise<void> {
  await ensureStateDir();
  await fs.writeFile(paths.budget, JSON.stringify(state, null, 2), "utf8");
}

export async function setCeiling(ceiling: number | null): Promise<BudgetState> {
  const budget = await readBudget();
  budget.ceiling = ceiling;
  await writeBudget(budget);
  return budget;
}

/** Reset the spend counter, e.g. at the start of a new run. Ceiling is preserved. */
export async function resetSpend(): Promise<BudgetState> {
  const budget = await readBudget();
  budget.spent = 0;
  budget.startedAt = new Date().toISOString();
  await writeBudget(budget);
  return budget;
}

/**
 * The gate. Called with a quoted cost BEFORE approval, never after — the whole
 * point is that a rejected proposal costs nothing, so every refusal must happen
 * while rejection is still possible.
 */
export async function assertAffordable(
  quotedCost: number,
  expectedMaxCost: number,
  balance: number | null,
): Promise<void> {
  if (quotedCost > ABSOLUTE_COST_CEILING) {
    throw new BudgetError(
      `Flow quoted ${quotedCost} credits, above this server's absolute ceiling of ${ABSOLUTE_COST_CEILING}.`,
      `This usually means the project's model tier is set to Veo Quality (100 cr) rather than Fast (20 cr). Check the settings gear before retrying.`,
    );
  }

  if (quotedCost > expectedMaxCost) {
    throw new BudgetError(
      `Flow quoted ${quotedCost} credits but the caller allowed at most ${expectedMaxCost}.`,
      `Nothing was charged — the proposal was rejected. Either raise expected_max_cost deliberately, or fix the model tier so the quote comes back where you expect.`,
    );
  }

  const budget = await readBudget();
  if (budget.ceiling !== null && budget.spent + quotedCost > budget.ceiling) {
    throw new BudgetError(
      `This generation (${quotedCost} cr) would take run spend to ${budget.spent + quotedCost}, over the ceiling of ${budget.ceiling}.`,
      `Nothing was charged. Stop and report to whoever owns the budget; raise the ceiling with flow_budget only on their explicit say-so.`,
    );
  }

  if (balance !== null && quotedCost > balance) {
    throw new BudgetError(
      `Quoted ${quotedCost} credits but the account balance is ${balance}.`,
      `Nothing was charged. Top up the account or switch to a cheaper tier (Veo 3.1 Lite is 10 cr vs Fast at 20).`,
    );
  }
}

export async function recordSpend(credits: number): Promise<BudgetState> {
  const budget = await readBudget();
  budget.spent += credits;
  await writeBudget(budget);
  return budget;
}

export async function appendLedger(entry: LedgerEntry): Promise<void> {
  await ensureStateDir();
  await fs.appendFile(paths.ledger, JSON.stringify(entry) + "\n", "utf8");
}

export async function readLedger(limit = 50): Promise<LedgerEntry[]> {
  try {
    const raw = await fs.readFile(paths.ledger, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as LedgerEntry);
  } catch {
    return [];
  }
}
