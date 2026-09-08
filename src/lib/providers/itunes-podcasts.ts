import { cachedSearch, normalizeSearchKey } from "./search-cache";
import type { MediaProvider, NormalizedSearchResult } from "./types";

type ItunesResult = {
  collectionId: number;
  collectionName: string;
  artistName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
};

export const itunesPodcastProvider: MediaProvider = {
  mediaType: "podcast",
  async search(query): Promise<NormalizedSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    return cachedSearch(
      normalizeSearchKey("podcast", cleanQuery),
      async (): Promise<NormalizedSearchResult[]> => {
        const url = new URL("https://itunes.apple.com/search");
        url.searchParams.set("term", cleanQuery);
        url.searchParams.set("media", "podcast");
        url.searchParams.set("limit", "12");

        const res = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          throw new Error(`iTunes podcast search failed: ${res.status}`);
        }

        const data = (await res.json()) as { results?: ItunesResult[] };

        return (data.results ?? []).map((item) => ({
          externalId: String(item.collectionId),
          externalSource: "itunes",
          title: item.collectionName,
          creator: item.artistName,
          coverUrl: item.artworkUrl100?.replace("100x100", "600x600"),
          metadata: { releaseDate: item.releaseDate },
        }));
      },
    );
  },
};
