/**
 * Qdrant vector DB client for memory-smart
 * Uses Qdrant REST API directly (no SDK dependency)
 */

import type { MemoryFact, ScoredMemory } from "./types.js";

export class QdrantClient {
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly headers: Record<string, string>;

  constructor(url: string, collection: string, apiKey?: string) {
    this.baseUrl = url.replace(/\/$/, "");
    this.collection = collection;
    this.headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { "api-key": apiKey } : {}),
    };
  }

  // --------------------------------------------------------------------------
  // Collection management
  // --------------------------------------------------------------------------

  async ensureCollection(vectorSize: number): Promise<void> {
    // Check if collection exists
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      headers: this.headers,
    });

    if (res.ok) return; // already exists

    // Create collection
    const createRes = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify({
        vectors: {
          size: vectorSize,
          distance: "Cosine",
        },
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create Qdrant collection: ${await createRes.text()}`);
    }
  }

  // --------------------------------------------------------------------------
  // Upsert
  // --------------------------------------------------------------------------

  async upsert(fact: MemoryFact, vector: number[]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify({
        points: [
          {
            id: fact.id,
            vector,
            payload: {
              text: fact.text,
              category: fact.category,
              importance: fact.importance,
              sessionKey: fact.sessionKey,
              agentId: fact.agentId,
              createdAt: fact.createdAt,
              accessCount: fact.accessCount,
              lastAccessed: fact.lastAccessed,
            },
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Qdrant upsert failed: ${await res.text()}`);
    }
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  async search(
    vector: number[],
    limit: number,
    minScore = 0.3,
  ): Promise<Array<{ fact: MemoryFact; vectorScore: number }>> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/search`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        vector,
        limit,
        score_threshold: minScore,
        with_payload: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`Qdrant search failed: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      result: Array<{
        id: string;
        score: number;
        payload: Record<string, unknown>;
      }>;
    };

    return data.result.map((hit) => ({
      fact: {
        id: hit.id,
        text: hit.payload.text as string,
        category: hit.payload.category as MemoryFact["category"],
        importance: hit.payload.importance as number,
        sessionKey: hit.payload.sessionKey as string,
        agentId: (hit.payload.agentId as string) ?? "unknown",
        createdAt: hit.payload.createdAt as number,
        accessCount: (hit.payload.accessCount as number) ?? 0,
        lastAccessed: (hit.payload.lastAccessed as number) ?? 0,
      },
      vectorScore: hit.score,
    }));
  }

  // --------------------------------------------------------------------------
  // Update payload (for access count bump)
  // --------------------------------------------------------------------------

  async updatePayload(
    id: string,
    payload: Partial<Record<string, unknown>>,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/collections/${this.collection}/points/payload`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          points: [id],
          payload,
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Qdrant update payload failed: ${await res.text()}`);
    }
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  async delete(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/delete`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        points: [id],
      }),
    });

    if (!res.ok) {
      throw new Error(`Qdrant delete failed: ${await res.text()}`);
    }
  }

  // --------------------------------------------------------------------------
  // Count
  // --------------------------------------------------------------------------

  async count(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      headers: this.headers,
    });

    if (!res.ok) return 0;

    const data = (await res.json()) as {
      result: { points_count: number };
    };

    return data.result.points_count;
  }
}
