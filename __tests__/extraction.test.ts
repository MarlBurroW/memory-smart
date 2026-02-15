/**
 * Tests for memory-smart fact extraction
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { FactExtractor } from "../extraction.js";
import type { ExtractedFact } from "../types.js";

// Mock OpenAI client
const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

describe("FactExtractor", () => {
  let extractor: FactExtractor;

  beforeEach(() => {
    extractor = new FactExtractor("test-api-key", "gpt-4.1-nano");
    mockCreate.mockReset();
  });

  test("extracts valid facts from LLM response", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                text: "Joshua prefers Cilium over Calico",
                category: "preference",
                importance: 0.8,
              },
              {
                text: "Cluster has 3 nodes",
                category: "fact",
                importance: 0.6,
              },
            ]),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Joshua said he prefers Cilium"]);

    expect(facts).toHaveLength(2);
    expect(facts[0].text).toBe("Joshua prefers Cilium over Calico");
    expect(facts[0].category).toBe("preference");
    expect(facts[0].importance).toBe(0.8);
  });

  test("handles markdown code blocks in LLM response", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '```json\n[{"text": "Test fact", "category": "fact", "importance": 0.5}]\n```',
          },
        },
      ],
    });

    const facts = await extractor.extract(["Some message"]);

    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("Test fact");
  });

  test("filters meta-facts (nothing to remember)", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                text: "No important facts to remember",
                category: "fact",
                importance: 0,
              },
              {
                text: "Joshua likes cats",
                category: "preference",
                importance: 0.7,
              },
            ]),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Some conversation"]);

    // Should filter out the meta-fact (importance=0)
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("Joshua likes cats");
  });

  test("filters facts with importance=0", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                text: "Zero importance fact",
                category: "fact",
                importance: 0,
              },
              {
                text: "Normal fact",
                category: "fact",
                importance: 0.5,
              },
            ]),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("Normal fact");
  });

  test("validates fact text length (5-500 chars)", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                text: "Hi",
                category: "fact",
                importance: 0.5,
              }, // too short
              {
                text: "Valid fact here",
                category: "fact",
                importance: 0.5,
              },
              {
                text: "x".repeat(600),
                category: "fact",
                importance: 0.5,
              }, // too long
            ]),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("Valid fact here");
  });

  test("validates importance range (0-1)", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                text: "Negative importance",
                category: "fact",
                importance: -0.5,
              },
              {
                text: "Valid importance",
                category: "fact",
                importance: 0.7,
              },
              {
                text: "Over 1.0 importance",
                category: "fact",
                importance: 2.5,
              },
            ]),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    // Only the valid one should pass
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toBe("Valid importance");
  });

  test("sanitizes invalid categories to 'fact'", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                text: "Invalid category fact",
                category: "invalid_category",
                importance: 0.5,
              },
              {
                text: "Valid category fact",
                category: "preference",
                importance: 0.5,
              },
            ]),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts).toHaveLength(2);
    expect(facts[0].category).toBe("fact"); // sanitized
    expect(facts[1].category).toBe("preference"); // kept
  });

  test("rounds importance to 2 decimal places", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                text: "Precise importance fact",
                category: "fact",
                importance: 0.123456789,
              },
            ]),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts[0].importance).toBe(0.12);
  });

  test("handles empty LLM response", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "",
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts).toEqual([]);
  });

  test("handles empty input messages", async () => {
    const facts = await extractor.extract([]);

    expect(facts).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("handles LLM returning non-array", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"text": "not an array"}',
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts).toEqual([]);
  });

  test("handles malformed JSON gracefully", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "not valid json at all",
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts).toEqual([]);
  });

  test("handles API errors gracefully (non-fatal)", async () => {
    mockCreate.mockRejectedValue(new Error("API timeout"));

    const facts = await extractor.extract(["Test"]);

    // Should return empty array, not throw
    expect(facts).toEqual([]);
  });

  test("formats multiple messages with indices", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "[]",
          },
        },
      ],
    });

    await extractor.extract(["First message", "Second message", "Third message"]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "[1] First message\n[2] Second message\n[3] Third message",
          }),
        ]),
      })
    );
  });

  test("all valid categories are accepted", async () => {
    const validCategories = ["preference", "decision", "entity", "fact", "event", "lesson"];

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(
              validCategories.map((cat) => ({
                text: `Test ${cat}`,
                category: cat,
                importance: 0.5,
              }))
            ),
          },
        },
      ],
    });

    const facts = await extractor.extract(["Test"]);

    expect(facts).toHaveLength(validCategories.length);
    facts.forEach((fact, i) => {
      expect(fact.category).toBe(validCategories[i]);
    });
  });
});
