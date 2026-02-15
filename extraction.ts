/**
 * LLM-based fact extraction for memory-smart
 * Uses a lightweight model (gpt-4.1-nano) to extract structured facts from messages.
 */

import OpenAI from "openai";
import type { ExtractedFact, FactCategory } from "./types.js";

const VALID_CATEGORIES: FactCategory[] = [
  "preference",
  "decision",
  "entity",
  "fact",
  "event",
  "lesson",
];

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Your job is to extract durable, important facts from conversation messages.

Rules:
- Only extract facts worth remembering long-term (preferences, decisions, personal info, important events, lessons learned)
- Skip greetings, small talk, transient info, and things that won't matter in a week
- Each fact should be self-contained (understandable without context)
- Be concise but complete
- Score importance 0-1 (1 = critical to remember, 0.3 = nice to know)
- Categorize each fact: preference, decision, entity, fact, event, lesson

Output JSON array (empty [] if nothing worth remembering):
[{"text": "...", "category": "...", "importance": 0.0}]`;

export class FactExtractor {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-4.1-nano") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async extract(messages: string[]): Promise<ExtractedFact[]> {
    if (messages.length === 0) return [];

    const userContent = messages.map((m, i) => `[${i + 1}] ${m}`).join("\n");

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        max_tokens: 1000,
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      });

      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) return [];

      // Parse JSON (handle markdown code blocks)
      const jsonStr = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) return [];

      // Validate and sanitize
      return parsed
        .filter(
          (f: Record<string, unknown>) =>
            typeof f.text === "string" &&
            f.text.length >= 5 &&
            f.text.length <= 500 &&
            typeof f.importance === "number" &&
            f.importance > 0 &&
            f.importance <= 1 &&
            // Skip "nothing to remember" type responses
            !/no (important|notable|significant|durable)/i.test(f.text as string) &&
            !/nothing (worth|to) remember/i.test(f.text as string),
        )
        .map((f: Record<string, unknown>) => ({
          text: f.text as string,
          category: VALID_CATEGORIES.includes(f.category as FactCategory)
            ? (f.category as FactCategory)
            : "fact",
          importance: Math.round((f.importance as number) * 100) / 100,
        }));
    } catch (err) {
      // Extraction failure is non-fatal — just skip this turn
      console.warn(`memory-smart: extraction failed: ${String(err)}`);
      return [];
    }
  }
}
