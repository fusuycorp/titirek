import { logDiagnostic } from "@/lib/errors";
import { cachedSearch, normalizeSearchKey } from "./search-cache";
import type { MediaProvider, NormalizedSearchResult } from "./types";

type SpotifyAlbum = {
  id: string;
  name: string;
  artists?: { name: string }[];
  images?: { url: string }[];
  release_date?: string;
};

type ItunesAlbumResult = {
  collectionId: number;
  collectionName: string;
  artistName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

async function fetchAccessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET are not configured");
  }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  if (!pendingToken) {
    pendingToken = fetchAccessToken().finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
}

async function searchItunesMusic(query: string): Promise<NormalizedSearchResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("limit", "12");

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "HepYeni/1.0 (https://hepyeni.net)",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`iTunes music search failed: ${res.status}`);
  }

  const data = (await res.json()) as { results?: ItunesAlbumResult[] };

  return (data.results ?? []).map((item) => ({
    externalId: String(item.collectionId),
    externalSource: "itunes",
    title: item.collectionName || "Untitled",
    creator: item.artistName,
    coverUrl: item.artworkUrl100?.replace("100x100", "600x600"),
    metadata: { releaseDate: item.releaseDate },
  }));
}

async function searchSpotifyUncached(
  cleanQuery: string,
): Promise<NormalizedSearchResult[]> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (clientId && clientSecret) {
    try {
      const token = await getAccessToken();
      const url = new URL("https://api.spotify.com/v1/search");
      url.searchParams.set("q", cleanQuery);
      url.searchParams.set("type", "album");
      url.searchParams.set("limit", "12");

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          albums?: { items: SpotifyAlbum[] };
        };
        const results = (data.albums?.items ?? []).map((album) => ({
          externalId: album.id,
          externalSource: "spotify",
          title: album.name,
          creator: album.artists?.map((a) => a.name).join(", "),
          coverUrl: album.images?.[0]?.url,
          metadata: { releaseDate: album.release_date },
        }));
        if (results.length > 0) return results;
      }
    } catch (err) {
      logDiagnostic(err, {
        action: "spotify:search",
        queryLength: cleanQuery.length,
        note: "Falling back to iTunes music search",
      });
    }
  }

  // Public zero-config fallback via iTunes Music Search
  return searchItunesMusic(cleanQuery);
}

export const spotifyProvider: MediaProvider = {
  mediaType: "music",
  async search(query): Promise<NormalizedSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    return cachedSearch(normalizeSearchKey("music", cleanQuery), () =>
      searchSpotifyUncached(cleanQuery),
    );
  },
};

