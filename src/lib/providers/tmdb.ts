import { logDiagnostic } from "@/lib/errors";
import { cachedSearch, normalizeSearchKey } from "./search-cache";
import type { MediaProvider, NormalizedSearchResult } from "./types";

type TmdbResult = {
  id: number;
  title?: string; // movie
  name?: string; // tv
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
};

type ItunesVideoResult = {
  trackId?: number;
  collectionId?: number;
  trackName?: string;
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  longDescription?: string;
  shortDescription?: string;
};

async function searchItunesVideo(
  query: string,
  mediaType: "movie" | "tv",
): Promise<NormalizedSearchResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", mediaType === "movie" ? "movie" : "tvShow");
  url.searchParams.set("entity", mediaType === "movie" ? "movie" : "tvSeason");
  url.searchParams.set("limit", "12");

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "HepYeni/1.0 (https://hepyeni.net)",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`iTunes ${mediaType} search failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as { results?: ItunesVideoResult[] };

  return (data.results ?? []).map((item) => ({
    externalId: String(
      item.trackId ||
        item.collectionId ||
        `itunes-${
          (item.trackName || item.collectionName || "untitled")
            .toLowerCase()
            .trim()
            .replace(/[^\p{L}\p{N}]+/gu, "-")
            .replace(/^-+|-+$/g, "") || "untitled"
        }-${(item.releaseDate || "undated").slice(0, 10)}`,
    ),
    externalSource: "itunes",
    title: item.trackName || item.collectionName || "Untitled",
    creator: item.artistName,
    coverUrl: item.artworkUrl100?.replace("100x100", "600x600"),
    metadata: {
      overview: item.longDescription || item.shortDescription,
      releaseDate: item.releaseDate,
    },
  }));
}

async function searchTmdbUncached(
  endpoint: "movie" | "tv",
  mediaType: "movie" | "tv",
  cleanQuery: string,
): Promise<NormalizedSearchResult[]> {
  const apiKey = process.env.TMDB_API_KEY;
  if (apiKey) {
    try {
      const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
      url.searchParams.set("query", cleanQuery);
      url.searchParams.set("include_adult", "false");

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = (await res.json()) as { results?: TmdbResult[] };
        return (data.results ?? []).map((item) => ({
          externalId: String(item.id),
          externalSource: "tmdb",
          title: item.title ?? item.name ?? "Untitled",
          creator: undefined,
          coverUrl: item.poster_path
            ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
            : undefined,
          metadata: {
            overview: item.overview,
            releaseDate: item.release_date ?? item.first_air_date,
          },
        }));
      }
    } catch (err) {
      logDiagnostic(err, {
        action: `tmdb:${endpoint}:search`,
        queryLength: cleanQuery.length,
        note: `Falling back to iTunes ${mediaType} search`,
      });
    }
  }

  // Zero-config public fallback via iTunes
  return searchItunesVideo(cleanQuery, mediaType);
}

function makeTmdbProvider(
  endpoint: "movie" | "tv",
  mediaType: "movie" | "tv",
): MediaProvider {
  return {
    mediaType,
    async search(query): Promise<NormalizedSearchResult[]> {
      const cleanQuery = query.trim();
      if (!cleanQuery) return [];
      return cachedSearch(normalizeSearchKey(mediaType, cleanQuery), () =>
        searchTmdbUncached(endpoint, mediaType, cleanQuery),
      );
    },
  };
}

export const tmdbMovieProvider = makeTmdbProvider("movie", "movie");
export const tmdbTvProvider = makeTmdbProvider("tv", "tv");

