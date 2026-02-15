/**
 * Memory scoring with recency decay and access boost.
 */

import type { MemoryFact, ScoredMemory } from "./types.js";

export interface ScoringConfig {
  /** How many days until a memory fully decays (default 365) */
  decayDays: number;
  /** Weight for vector similarity (default 0.35) */
  vectorWeight: number;
  /** Weight for importance (default 0.30) */
  importanceWeight: number;
  /** Weight for recency (default 0.20) */
  recencyWeight: number;
  /** Weight for access frequency (default 0.15) */
  accessWeight: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  decayDays: 365,
  vectorWeight: 0.35,
  importanceWeight: 0.30,
  recencyWeight: 0.20,
  accessWeight: 0.15,
};

/**
 * Compute recency boost (1.0 = just created, 0.0 = older than decayDays)
 */
function recencyBoost(createdAt: number, decayDays: number): number {
  const daysSince = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - daysSince / decayDays);
}

/**
 * Compute access frequency boost (logarithmic, capped at 1.0)
 * 0 accesses = 0, 1 = 0.3, 5 = 0.7, 10+ = ~1.0
 */
function accessBoost(accessCount: number): number {
  if (accessCount <= 0) return 0;
  return Math.min(1, Math.log10(accessCount + 1) / Math.log10(11));
}

/**
 * Score a set of vector search results with composite ranking.
 */
export function scoreMemories(
  results: Array<{ fact: MemoryFact; vectorScore: number }>,
  config: ScoringConfig = DEFAULT_SCORING,
): ScoredMemory[] {
  return results
    .map(({ fact, vectorScore }) => {
      const recency = recencyBoost(fact.createdAt, config.decayDays);
      const access = accessBoost(fact.accessCount);

      const finalScore =
        config.vectorWeight * vectorScore +
        config.importanceWeight * fact.importance +
        config.recencyWeight * recency +
        config.accessWeight * access;

      return { fact, vectorScore, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}
