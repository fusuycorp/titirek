import { logDiagnostic } from "@/lib/errors";
import { cachedSearch, normalizeSearchKey } from "./search-cache";
import type { MediaProvider, NormalizedSearchResult } from "./types";

type GoogleBooksItem = {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    pageCount?: number;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
};

type ItunesEbookResult = {
  trackId: number;
  trackName: string;
  artistName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  description?: string;
};

type OpenLibraryDoc = {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  number_of_pages_median?: number;
};

async function searchItunesBooks(
  query: string,
): Promise<NormalizedSearchResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "ebook");
  url.searchParams.set("entity", "ebook");
  url.searchParams.set("limit", "12");

  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "HepYeni/1.0 (https://hepyeni.net)" },
    signal: AbortSignal.timeout(4000),
  });

  if (!res.ok) {
    throw new Error(`iTunes eBook search failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as { results?: ItunesEbookResult[] };

  return (data.results ?? []).map((item) => ({
    externalId: String(item.trackId),
    externalSource: "itunes",
    title: item.trackName || "Untitled",
    creator: item.artistName,
    coverUrl: item.artworkUrl100?.replace("100x100", "600x600"),
    metadata: {
      description: item.description,
      publishedDate: item.releaseDate,
    },
  }));
}

async function searchOpenLibrary(
  query: string,
): Promise<NormalizedSearchResult[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set(
    "fields",
    "key,title,author_name,cover_i,first_publish_year,number_of_pages_median",
  );
  url.searchParams.set("limit", "12");

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "HepYeni/1.0 (https://hepyeni.net; contact@hepyeni.net)",
    },
    signal: AbortSignal.timeout(4000),
  });

  if (!res.ok) {
    throw new Error(`OpenLibrary search failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as { docs?: OpenLibraryDoc[] };

  return (data.docs ?? []).map((doc) => ({
    externalId: doc.key.replace("/works/", ""),
    externalSource: "open-library",
    title: doc.title || "Untitled",
    creator: doc.author_name?.slice(0, 3).join(", "),
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : undefined,
    metadata: {
      publishedDate: doc.first_publish_year
        ? String(doc.first_publish_year)
        : undefined,
      pageCount: doc.number_of_pages_median,
    },
  }));
}

async function searchGoogleBooksUncached(
  cleanQuery: string,
): Promise<NormalizedSearchResult[]> {
    const apiKey =
      process.env.GOOGLE_BOOKS_API_KEY || process.env.GOOGLE_API_KEY;

    // 1. Try Google Books (if configured or available)
    try {
      const url = new URL("https://www.googleapis.com/books/v1/volumes");
      url.searchParams.set("q", cleanQuery);
      url.searchParams.set("maxResults", "12");
      if (apiKey) {
        url.searchParams.set("key", apiKey);
      }

      const res = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": "HepYeni/1.0 (https://hepyeni.net)" },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = (await res.json()) as { items?: GoogleBooksItem[] };
        const results = (data.items ?? []).map((item) => ({
          externalId: item.id,
          externalSource: "google-books",
          title: item.volumeInfo?.title ?? "Untitled",
          creator: item.volumeInfo?.authors?.join(", "),
          coverUrl: (
            item.volumeInfo?.imageLinks?.thumbnail ||
            item.volumeInfo?.imageLinks?.smallThumbnail
          )?.replace("http://", "https://"),
          metadata: {
            description: item.volumeInfo?.description,
            publishedDate: item.volumeInfo?.publishedDate,
            pageCount: item.volumeInfo?.pageCount,
          },
        }));
        if (results.length > 0) return results;
      }
    } catch (googleErr) {
      logDiagnostic(googleErr, {
        action: "searchTitles:google-books",
        // S2: never log the raw user search query — length only
        queryLength: cleanQuery.length,
        note: "Google Books quota/rate-limited, falling back to iTunes Books",
      });
    }

    // 2. High-speed zero-config public fallback via iTunes Books
    try {
      const itunesResults = await searchItunesBooks(cleanQuery);
      if (itunesResults.length > 0) return itunesResults;
    } catch (itunesErr) {
      logDiagnostic(itunesErr, {
        action: "searchTitles:itunes-ebook-fallback",
        queryLength: cleanQuery.length,
        note: "Falling back to Open Library",
      });
    }

    // 3. Resilient third-tier fallback via Open Library
    try {
      return await searchOpenLibrary(cleanQuery);
    } catch (openLibErr) {
      logDiagnostic(openLibErr, {
        action: "searchTitles:open-library-fallback",
        queryLength: cleanQuery.length,
      });
      return [];
    }
}

export const googleBooksProvider: MediaProvider = {
  mediaType: "book",
  async search(query): Promise<NormalizedSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    return cachedSearch(normalizeSearchKey("book", cleanQuery), () =>
      searchGoogleBooksUncached(cleanQuery),
    );
  },
};
