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

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Extract ONLY durable facts worth remembering months from now.

Rules:
- Extract: preferences, personal info, key relationships, technical decisions with lasting impact, lessons learned
- SKIP: operational details (deployments, commits, builds), transient events, progress updates, things that won't matter in a month
- Each fact must be self-contained and concise (one sentence)
- Be VERY selective — fewer high-quality facts beat many low-quality ones
- Importance scoring: 0.9-1.0 = life-changing, 0.7-0.8 = important preference/decision, 0.5-0.6 = useful context, 0.3-0.4 = nice to know
- Most facts should score 0.5-0.7. Reserve 0.9+ for truly critical info.
- Categorize: preference, decision, entity, fact, event, lesson
- If nothing is worth remembering long-term, return []

Output JSON array: [{"text": "...", "category": "...", "importance": 0.0}]`;

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
