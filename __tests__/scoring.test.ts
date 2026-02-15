/**
 * Tests for memory-smart scoring system
 */

import { describe, test, expect } from "vitest";
import { scoreMemories, DEFAULT_SCORING } from "../scoring.js";
import type { MemoryFact } from "../types.js";

// Helper to create test facts
function createFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: "test-id",
    text: "Test fact",
    category: "fact",
    importance: 0.7,
    sessionKey: "test-session",
    agentId: "test-agent",
    createdAt: Date.now(),
    accessCount: 0,
    lastAccessed: 0,
    ...overrides,
  };
}

describe("scoreMemories", () => {
  test("scores based on vector similarity", () => {
    const fact = createFact({ importance: 0.5, createdAt: Date.now(), accessCount: 0 });
    const results = [
      { fact, vectorScore: 0.9 },
      { fact: createFact(), vectorScore: 0.5 },
    ];

    const scored = scoreMemories(results);

    expect(scored[0].vectorScore).toBe(0.9);
    expect(scored[1].vectorScore).toBe(0.5);
    // Higher vector score should rank higher (all else equal)
    expect(scored[0].finalScore).toBeGreaterThan(scored[1].finalScore);
  });

  test("boosts recent memories", () => {
    const now = Date.now();
    const recentFact = createFact({ createdAt: now, importance: 0.5, accessCount: 0 });
    const oldFact = createFact({
      createdAt: now - 180 * 24 * 60 * 60 * 1000, // 180 days ago
      importance: 0.5,
      accessCount: 0,
    });

    const scored = scoreMemories([
      { fact: recentFact, vectorScore: 0.7 },
      { fact: oldFact, vectorScore: 0.7 },
    ]);

    // Recent memory should score higher
    expect(scored[0].fact.id).toBe(recentFact.id);
    expect(scored[0].finalScore).toBeGreaterThan(scored[1].finalScore);
  });

  test("boosts frequently accessed memories", () => {
    const freshFact = createFact({ accessCount: 0, importance: 0.5, createdAt: Date.now() });
    const popularFact = createFact({ accessCount: 10, importance: 0.5, createdAt: Date.now() });

    const scored = scoreMemories([
      { fact: freshFact, vectorScore: 0.7 },
      { fact: popularFact, vectorScore: 0.7 },
    ]);

    // Popular memory should score higher
    expect(scored[0].fact.id).toBe(popularFact.id);
    expect(scored[0].finalScore).toBeGreaterThan(scored[1].finalScore);
  });

  test("respects importance score", () => {
    const importantFact = createFact({
      importance: 0.9,
      createdAt: Date.now(),
      accessCount: 0,
    });
    const trivialFact = createFact({
      importance: 0.2,
      createdAt: Date.now(),
      accessCount: 0,
    });

    const scored = scoreMemories([
      { fact: trivialFact, vectorScore: 0.7 },
      { fact: importantFact, vectorScore: 0.7 },
    ]);

    // Important memory should score higher
    expect(scored[0].fact.id).toBe(importantFact.id);
    expect(scored[0].finalScore).toBeGreaterThan(scored[1].finalScore);
  });

  test("composite scoring balances all factors", () => {
    const now = Date.now();
    const facts = [
      // High vector, low everything else
      createFact({ importance: 0.3, createdAt: now - 200 * 24 * 60 * 60 * 1000, accessCount: 0 }),
      // High importance, low vector
      createFact({ importance: 0.95, createdAt: now - 100 * 24 * 60 * 60 * 1000, accessCount: 0 }),
      // Balanced (should win)
      createFact({ importance: 0.7, createdAt: now, accessCount: 5 }),
    ];

    const scored = scoreMemories([
      { fact: facts[0], vectorScore: 0.95 },
      { fact: facts[1], vectorScore: 0.4 },
      { fact: facts[2], vectorScore: 0.7 },
    ]);

    // Balanced fact should rank highest
    expect(scored[0].fact.id).toBe(facts[2].id);
  });

  test("handles empty results", () => {
    const scored = scoreMemories([]);
    expect(scored).toEqual([]);
  });

  test("sorts by finalScore descending", () => {
    const facts = [
      createFact({ importance: 0.3, createdAt: Date.now(), accessCount: 0 }),
      createFact({ importance: 0.8, createdAt: Date.now(), accessCount: 0 }),
      createFact({ importance: 0.5, createdAt: Date.now(), accessCount: 0 }),
    ];

    const scored = scoreMemories(
      facts.map((f, i) => ({ fact: f, vectorScore: 0.7 }))
    );

    // Should be sorted high to low
    expect(scored[0].finalScore).toBeGreaterThanOrEqual(scored[1].finalScore);
    expect(scored[1].finalScore).toBeGreaterThanOrEqual(scored[2].finalScore);
  });

  test("custom decay days affects recency boost", () => {
    const now = Date.now();
    const fact = createFact({
      createdAt: now - 100 * 24 * 60 * 60 * 1000, // 100 days ago
      importance: 0.5,
      accessCount: 0,
    });

    const shortDecay = scoreMemories([{ fact, vectorScore: 0.7 }], {
      ...DEFAULT_SCORING,
      decayDays: 30, // 100 days should be fully decayed
    });

    const longDecay = scoreMemories([{ fact, vectorScore: 0.7 }], {
      ...DEFAULT_SCORING,
      decayDays: 365, // 100 days should still have some boost
    });

    // Longer decay period should give higher score
    expect(longDecay[0].finalScore).toBeGreaterThan(shortDecay[0].finalScore);
  });
});
