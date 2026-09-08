import { describe, expect, it } from "bun:test";
import {
  cachedSearch,
  clearSearchCache,
  normalizeSearchKey,
} from "@/lib/providers/search-cache";
import { itunesPodcastProvider } from "@/lib/providers/itunes-podcasts";

describe("search-cache", () => {
  it("normalizes keys across case and surrounding whitespace", () => {
    expect(normalizeSearchKey("book", "  Dune  ")).toBe(
      normalizeSearchKey("book", "dune"),
    );
    expect(normalizeSearchKey("book", "dune")).not.toBe(
      normalizeSearchKey("movie", "dune"),
    );
  });

  it("serves repeats from cache without re-invoking the fetcher", async () => {
    clearSearchCache();
    try {
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return ["a"];
      };
      const first = await cachedSearch("k-hit", fetcher);
      const second = await cachedSearch("k-hit", fetcher);
      expect(first).toEqual(["a"]);
      expect(second).toEqual(["a"]);
      expect(calls).toBe(1);
    } finally {
      clearSearchCache();
    }
  });

  it("dedups concurrent identical in-flight searches into one fetch", async () => {
    clearSearchCache();
    try {
      let calls = 0;
      const fetcher = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return [calls];
      };
      const [a, b] = await Promise.all([
        cachedSearch("k-flight", fetcher),
        cachedSearch("k-flight", fetcher),
      ]);
      expect(a).toEqual([1]);
      expect(b).toEqual([1]);
      expect(calls).toBe(1);
    } finally {
      clearSearchCache();
    }
  });

  it("refetches after TTL expiry and never caches errors", async () => {
    clearSearchCache();
    try {
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return calls;
      };
      expect(await cachedSearch("k-ttl", fetcher, 10)).toBe(1);
      await new Promise((r) => setTimeout(r, 25));
      expect(await cachedSearch("k-ttl", fetcher, 10)).toBe(2);
      expect(calls).toBe(2);

      let attempts = 0;
      const flaky = async () => {
        attempts++;
        if (attempts === 1) throw new Error("boom");
        return "recovered";
      };
      await expect(cachedSearch("k-err", flaky)).rejects.toThrow("boom");
      expect(await cachedSearch("k-err", flaky)).toBe("recovered");
      expect(attempts).toBe(2);
    } finally {
      clearSearchCache();
    }
  });

  it("ignores stale completions after clear-during-flight", async () => {
    clearSearchCache();
    try {
      let releaseStale!: () => void;
      const gate = new Promise<void>((r) => {
        releaseStale = r;
      });
      const stale = cachedSearch("k-clear", async () => {
        await gate;
        return "stale";
      });
      clearSearchCache();
      expect(await cachedSearch("k-clear", async () => "fresh")).toBe(
        "fresh",
      );
      releaseStale();
      // Stale caller still resolves, but must not clobber the fresh entry.
      await expect(stale).resolves.toBe("stale");
      expect(await cachedSearch("k-clear", async () => "third")).toBe(
        "fresh",
      );
    } finally {
      clearSearchCache();
    }
  });

  it("routes repeated podcast searches through the cache (wiring)", async () => {
    clearSearchCache();
    const original = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              collectionId: 42,
              collectionName: "Cached Cast",
              artistName: "Anon",
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;
    try {
      const first = await itunesPodcastProvider.search("  cached cast ");
      const second = await itunesPodcastProvider.search("CACHED CAST");
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(fetchCalls).toBe(1);
      expect(await itunesPodcastProvider.search("   ")).toEqual([]);
    } finally {
      globalThis.fetch = original;
      clearSearchCache();
    }
  });
});
