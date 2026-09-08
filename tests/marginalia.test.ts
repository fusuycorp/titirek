import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { en } from "@/lib/i18n/en";
import { tr } from "@/lib/i18n/tr";
import { logDiagnostic, getRecentDiagnostics } from "@/lib/errors";
import {
  validateQuoteInput,
  parseTags,
  formatAttribution,
  canUserViewQuote,
  canUserDeleteQuote,
  filterQuotesForViewer,
  type AddQuoteInput,
} from "@/lib/marginalia";

describe("Phase 3: Digital Marginalia & Quote Snaps", () => {
  describe("Input Boundaries & Content Validation", () => {
    it("accepts valid quote input with 1 character", () => {
      const input: AddQuoteInput = {
        titleName: "Dune",
        quoteText: "A",
      };
      const result = validateQuoteInput(input);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.quoteText).toBe("A");
      expect(result.sanitized?.titleName).toBe("Dune");
    });

    it("accepts maximum allowed quote length of 3000 characters", () => {
      const longQuote = "Q".repeat(3000);
      const input: AddQuoteInput = {
        titleName: "War and Peace",
        quoteText: longQuote,
      };
      const result = validateQuoteInput(input);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.quoteText.length).toBe(3000);
    });

    it("rejects empty quote text or whitespace-only", () => {
      expect(validateQuoteInput({ titleName: "Dune", quoteText: "" }).valid).toBe(false);
      expect(validateQuoteInput({ titleName: "Dune", quoteText: "   \n\t  " }).valid).toBe(false);
      expect(validateQuoteInput({ titleName: "Dune", quoteText: (null as unknown as string) }).valid).toBe(false);
    });

    it("rejects quote text exceeding 3000 characters", () => {
      const excessiveQuote = "Q".repeat(3001);
      const result = validateQuoteInput({
        titleName: "Dune",
        quoteText: excessiveQuote,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("3000");
    });

    it("rejects empty or whitespace-only titleName", () => {
      expect(validateQuoteInput({ titleName: "", quoteText: "Valid quote" }).valid).toBe(false);
      expect(validateQuoteInput({ titleName: "   ", quoteText: "Valid quote" }).valid).toBe(false);
    });

    it("rejects titleName exceeding 200 characters", () => {
      const longTitle = "T".repeat(201);
      const result = validateQuoteInput({
        titleName: longTitle,
        quoteText: "Valid quote",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("200");
    });

    it("rejects attribution exceeding 200 characters", () => {
      const longAttribution = "A".repeat(201);
      const result = validateQuoteInput({
        titleName: "Dune",
        quoteText: "Fear is the mind-killer.",
        attribution: longAttribution,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("200");
    });

    it("trims whitespace and preserves unicode, Turkish chars, and emojis", () => {
      const input: AddQuoteInput = {
        titleName: "  Kürk Mantolu Madonna  ",
        quoteText: "  \"Dünyada bana hiçbir şey, tabiat kadar merhametsiz gelmemiştir.\" ✨  ",
        attribution: "  Sabahattin Ali, Sayfa 48  ",
        mediaType: "book",
      };
      const result = validateQuoteInput(input);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.titleName).toBe("Kürk Mantolu Madonna");
      expect(result.sanitized?.quoteText).toBe("\"Dünyada bana hiçbir şey, tabiat kadar merhametsiz gelmemiştir.\" ✨");
      expect(result.sanitized?.attribution).toBe("Sabahattin Ali, Sayfa 48");
      expect(result.sanitized?.mediaType).toBe("book");
    });
  });

  describe("Tag Parsing & Sanitization", () => {
    it("parses comma-separated tag string correctly", () => {
      const raw = "philosophy, sci-fi, favorite, memory";
      expect(parseTags(raw)).toEqual(["philosophy", "sci-fi", "favorite", "memory"]);
    });

    it("parses hashtag-prefixed string and strips hashes", () => {
      const raw = "#stoicism #wisdom #marcus_aurelius";
      expect(parseTags(raw)).toEqual(["stoicism", "wisdom", "marcus_aurelius"]);
    });

    it("handles mixed arrays and strings with whitespace and case deduplication", () => {
      const raw = ["  #Sci-Fi  ", "philosophy", "sci-fi", "PHILOSOPHY", "classic"];
      expect(parseTags(raw)).toEqual(["sci-fi", "philosophy", "classic"]);
    });

    it("handles empty strings, undefined, null, and empty arrays safely", () => {
      expect(parseTags("")).toEqual([]);
      expect(parseTags("   , ,  , ")).toEqual([]);
      expect(parseTags(null)).toEqual([]);
      expect(parseTags(undefined)).toEqual([]);
      expect(parseTags([])).toEqual([]);
    });

    it("truncates individual tags exceeding 50 characters", () => {
      const ultraLongTag = "t".repeat(60);
      const parsed = parseTags(ultraLongTag);
      expect(parsed.length).toBe(1);
      expect(parsed[0].length).toBe(50);
    });
  });

  describe("Attribution Formatting", () => {
    it("formats simple string attribution directly", () => {
      expect(formatAttribution("Chapter 3, p. 45")).toBe("Chapter 3, p. 45");
      expect(formatAttribution("   Frank Herbert   ")).toBe("Frank Herbert");
    });

    it("formats structured object attribution with author, work, chapter, page", () => {
      const formatted = formatAttribution({
        author: "Frank Herbert",
        work: "Dune",
        chapter: "Chapter 1",
        page: "p. 42",
      });
      expect(formatted).toBe("Frank Herbert, Dune, Chapter 1 (p. 42)");
    });

    it("formats structured attribution with audio/video timestamp", () => {
      const formatted = formatAttribution({
        author: "Denis Villeneuve",
        work: "Dune: Part Two",
        timestamp: "01:45:20",
      });
      expect(formatted).toBe("Denis Villeneuve, Dune: Part Two [01:45:20]");
    });

    it("handles partial structured attribution gracefully", () => {
      expect(formatAttribution({ page: "p. 100" })).toBe("(p. 100)");
      expect(formatAttribution({ chapter: "Act II, Scene 1" })).toBe("Act II, Scene 1");
      expect(formatAttribution({ author: "Plato", page: "p. 50" })).toBe("Plato (p. 50)");
      expect(formatAttribution({ work: "The Matrix", timestamp: "00:42:15" })).toBe("The Matrix [00:42:15]");
      expect(formatAttribution({})).toBe("");
    });
  });

  describe("Privacy Scoping & Circle Access Matrix", () => {
    const quoteAuthorId = "user-alice";
    const circleMemberId = "user-bob";
    const outsiderUserId = "user-stranger";

    const privateQuote = {
      id: "quote-1",
      user: quoteAuthorId,
      titleName: "Private Thoughts",
      quoteText: "A secret passage.",
      isSharedWithCircles: [] as string[],
    };

    const circleQuote = {
      id: "quote-2",
      user: quoteAuthorId,
      titleName: "Circle Book Club",
      quoteText: "Shared with sci-fi circle.",
      isSharedWithCircles: ["circle-scifi", "circle-bookclub"],
    };

    it("allows author to view their own quote regardless of circle sharing", () => {
      expect(canUserViewQuote(privateQuote, quoteAuthorId, [])).toBe(true);
      expect(canUserViewQuote(circleQuote, quoteAuthorId, [])).toBe(true);
    });

    it("denies other users from viewing private quotes", () => {
      expect(canUserViewQuote(privateQuote, circleMemberId, ["circle-scifi"])).toBe(false);
      expect(canUserViewQuote(privateQuote, outsiderUserId, [])).toBe(false);
    });

    it("allows circle members to view quotes shared with their circle", () => {
      expect(canUserViewQuote(circleQuote, circleMemberId, ["circle-scifi"])).toBe(true);
      expect(canUserViewQuote(circleQuote, circleMemberId, ["circle-bookclub"])).toBe(true);
    });

    it("denies non-members from viewing circle-shared quotes", () => {
      expect(canUserViewQuote(circleQuote, outsiderUserId, ["circle-general"])).toBe(false);
      expect(canUserViewQuote(circleQuote, outsiderUserId, [])).toBe(false);
    });

    it("filters a list of quotes accurately for a given viewer", () => {
      const allQuotes = [privateQuote, circleQuote];

      // Alice (author) sees both
      const aliceView = filterQuotesForViewer(allQuotes, quoteAuthorId, []);
      expect(aliceView.length).toBe(2);

      // Bob (member of circle-scifi) sees only circleQuote
      const bobView = filterQuotesForViewer(allQuotes, circleMemberId, ["circle-scifi"]);
      expect(bobView.length).toBe(1);
      expect(bobView[0].id).toBe("quote-2");

      // Stranger sees nothing
      const strangerView = filterQuotesForViewer(allQuotes, outsiderUserId, []);
      expect(strangerView.length).toBe(0);
    });
  });

  describe("Author Deletion Rights", () => {
    const quote = {
      id: "quote-1",
      user: "user-alice",
      titleName: "Dune",
      quoteText: "Fear is the mind-killer.",
    };

    it("allows the quote author to delete their quote", () => {
      expect(canUserDeleteQuote(quote, { id: "user-alice" })).toBe(true);
    });

    it("denies other non-admin users from deleting the quote", () => {
      expect(canUserDeleteQuote(quote, { id: "user-bob" })).toBe(false);
    });

    it("allows system administrators to delete any quote", () => {
      expect(canUserDeleteQuote(quote, { id: "user-admin", isAdmin: true })).toBe(true);
    });

    it("denies unauthenticated users from deleting quotes", () => {
      expect(canUserDeleteQuote(quote, null)).toBe(false);
      expect(canUserDeleteQuote(quote, { id: "" })).toBe(false);
    });
  });

  describe("100% Translation Key Parity for Digital Marginalia", () => {
    const requiredMarginaliaKeys = [
      "tabTitle",
      "captureQuote",
      "dialogTitle",
      "dialogSubtitle",
      "quoteTextLabel",
      "quotePlaceholder",
      "titleLabel",
      "titlePlaceholder",
      "attributionLabel",
      "attributionPlaceholder",
      "tagsLabel",
      "tagsPlaceholder",
      "linkToShelfItem",
      "noLinkedMedia",
      "shareWithCircles",
      "shareWithCirclesDesc",
      "emptyQuotes",
      "filterByTag",
      "filterByMedia",
      "allTags",
      "allMedia",
      "copyQuote",
      "copySuccess",
      "deleteQuote",
      "deleteConfirm",
      "quoteDeleted",
      "quoteSaved",
      "characterCount",
    ];

    it("has all required marginalia translation keys in English and Turkish", () => {
      expect("marginalia" in en).toBe(true);
      expect("marginalia" in tr).toBe(true);

      for (const key of requiredMarginaliaKeys) {
        expect(key in en.marginalia).toBe(true);
        expect(key in tr.marginalia).toBe(true);

        const valEn = (en.marginalia as Record<string, string>)[key];
        const valTr = (tr.marginalia as Record<string, string>)[key];

        expect(typeof valEn).toBe("string");
        expect(typeof valTr).toBe("string");
        expect(valEn.trim().length).toBeGreaterThan(0);
        expect(valTr.trim().length).toBeGreaterThan(0);
      }
    });

    it("matches interpolation placeholders between EN and TR", () => {
      for (const key of requiredMarginaliaKeys) {
        const valEn = (en.marginalia as Record<string, string>)[key];
        const valTr = (tr.marginalia as Record<string, string>)[key];

        const placeholdersEn = (valEn.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
        const placeholdersTr = (valTr.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();

        expect(placeholdersEn).toEqual(placeholdersTr);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Server-action privacy gates (S1, S5, C5, S2) — exercised with module mocks
// so the actions run without a live PocketBase. The mock client mirrors the
// pb.filter() parameter binding used by the real PocketBase SDK.
// ---------------------------------------------------------------------------

type FakeQuote = {
  user: string;
  titleName: string;
  isSharedWithCircles: string[];
  authorProfile?: {
    id: string;
    name: string;
    email: string;
    emailVisibility: boolean;
    verified: boolean;
    created: string;
  };
  linkedProgress?: {
    id: string;
    title: string;
    notes: string;
    rating: number;
    currentLabel: string;
    isSharedWithCircles: false;
  };
};

const db = {
  session: null as { id: string } | null,
  quotes: new Map<string, FakeQuote>(),
  memberCircles: new Set<string>(),
  userIsAdmin: false,
  failNextWrite: null as Error | null,
  failNextRead: null as Error | null,
  // Monotonic fake-ID counter: size-based IDs collide after deletions and
  // would mask duplicate-key/upsert bugs under test.
  nextQuoteId: 1,
};

// Tracks getSession invocations across the fresh spy installed per test, so a
// test can assert an action did/didn't re-auth without re-spying the module.
let getSessionCalls = 0;

function resetDb() {
  db.session = null;
  db.quotes.clear();
  db.memberCircles.clear();
  db.userIsAdmin = false;
  db.failNextWrite = null;
  db.failNextRead = null;
  db.nextQuoteId = 1;
  getSessionCalls = 0;
}

function makePbClient() {
  return {
    filter: (expr: string, params: Record<string, unknown>) => {
      let out = expr;
      for (const [k, v] of Object.entries(params)) {
        out = out.replaceAll(`{:${k}}`, JSON.stringify(v));
      }
      return out;
    },
    collection: (name: string) => {
      if (name === "shelf_quotes") {
        return {
          getFullList: async (opts: { filter?: string } = {}) => {
            if (db.failNextRead) throw db.failNextRead;
            let rows = [...db.quotes.entries()].map(([id, q]) => {
              const { authorProfile, linkedProgress, ...rest } = q;
              const row = { id, ...rest };
              if (authorProfile || linkedProgress) {
                // Mirror the real superuser read: the wire carries the FULL
                // UsersResponse (email included) and the linked private shelf
                // record in the expand — the action must project them away.
                return {
                  ...row,
                  expand: { user: authorProfile, progressItem: linkedProgress },
                };
              }
              return row;
            });
            const userMatch = opts.filter?.match(/user = "([^"]+)"/);
            if (userMatch) rows = rows.filter((r) => r.user === userMatch[1]);
            const circleMatch = opts.filter?.match(/isSharedWithCircles ~ "([^"]+)"/);
            if (circleMatch) rows = rows.filter((r) => r.isSharedWithCircles.includes(circleMatch[1]));
            return rows;
          },
          create: async (payload: Record<string, unknown>) => {
            if (db.failNextWrite) throw db.failNextWrite;
            const id = `quote-${db.nextQuoteId++}`;
            db.quotes.set(id, {
              user: payload.user as string,
              titleName: payload.titleName as string,
              isSharedWithCircles: (payload.isSharedWithCircles ?? []) as string[],
            });
            return { id, ...payload };
          },
          getOne: async (id: string) => {
            if (db.failNextRead) throw db.failNextRead;
            const found = db.quotes.get(id);
            if (!found) {
              const err = new Error("not found") as Error & { status?: number };
              err.status = 404;
              throw err;
            }
            return { id, ...found };
          },
          update: async (id: string, payload: object) => {
            if (db.failNextWrite) throw db.failNextWrite;
            const existing = db.quotes.get(id);
            if (!existing) throw new Error("not found");
            const merged = { ...existing, ...payload };
            db.quotes.set(id, merged);
            return { id, ...merged };
          },
          delete: async () => {
            if (db.failNextWrite) throw db.failNextWrite;
            return true;
          },
        };
      }
      if (name === "group_members") {
        return {
          getFullList: async () =>
            [...db.memberCircles].map((group) => ({
              id: `member-${group}`,
              group,
              user: db.session?.id,
            })),
          getFirstListItem: async () => {
            throw new Error("not found");
          },
        };
      }
      if (name === "user_media_progress") {
        return {
          getOne: async (id: string) => {
            return { id, user: db.session?.id };
          },
        };
      }
      if (name === "users") {
        return {
          getOne: async () => ({ id: db.session?.id, isAdmin: db.userIsAdmin }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

const { addQuote, deleteQuote, toggleShareQuoteWithCircle } =
  await import("@/lib/actions/marginalia");
const { getUserQuotes, getCircleQuotes } = await import("@/lib/queries/marginalia");
const { getDiagnosticsAction } = await import("@/lib/actions/diagnostics");

const sessionModule = await import("@/lib/pocketbase/session");
const superuserModule = await import("@/lib/pocketbase/superuser");
const flagsServerModule = await import("@/lib/flags/server");
const membershipModule = await import("@/lib/membership");
const nextCacheModule = await import("next/cache");

describe("Server-Action Privacy Gates (mocked PocketBase)", () => {
  beforeEach(() => {
    resetDb();
    // spyOn patches individual exports; the module namespaces remain intact
    // so sibling test files sharing this process are unaffected.
    spyOn(nextCacheModule, "revalidatePath").mockImplementation(() => {});
    spyOn(sessionModule, "getSession").mockImplementation(async () => {
      getSessionCalls++;
      return db.session as never;
    });
    spyOn(superuserModule, "getSuperuserClient").mockResolvedValue(makePbClient() as never);
    spyOn(flagsServerModule, "requireFeature").mockResolvedValue(undefined as never);
    spyOn(membershipModule, "requireMembership").mockImplementation(
      async (circleId: string) => {
        if (!db.session) throw new Error("not authenticated");
        if (circleId && !db.memberCircles.has(circleId)) {
          throw new Error("You're not a member of this group");
        }
        return { id: "member-ok", role: "member" } as never;
      },
    );
  });

  afterAll(() => {
    // Restore every spy so mocks do not leak into sibling test files that
    // share this process's module namespace (bun test runs files in one
    // process by default).
    mock.restore();
  });

  describe("getUserQuotes (S1 — no anonymous leak)", () => {
    it("returns an empty list for anonymous callers even with a harvested userId", async () => {
      db.quotes.set("q1", {
        user: "victim-user",
        titleName: "Private journal",
        isSharedWithCircles: [],
      });
      expect(db.session).toBeNull();

      const result = await getUserQuotes("victim-user");
      expect(result).toEqual([]);
    });

    it("returns the owner's quotes unfiltered when the caller is the owner", async () => {
      db.session = { id: "me" };
      db.quotes.set("q1", { user: "me", titleName: "Mine", isSharedWithCircles: [] });
      db.quotes.set("q2", { user: "other", titleName: "Theirs", isSharedWithCircles: [] });

      const result = await getUserQuotes("me");
      expect(result.map((r) => r.id)).toEqual(["q1"]);
    });

    it("filters another user's quotes through mutual-circle membership", async () => {
      db.session = { id: "me" };
      db.memberCircles.add("circle-scifi");
      db.quotes.set("q-shared", {
        user: "other",
        titleName: "Shared",
        isSharedWithCircles: ["circle-scifi"],
      });
      db.quotes.set("q-private", {
        user: "other",
        titleName: "Private",
        isSharedWithCircles: [],
      });

      const result = await getUserQuotes("other");
      expect(result.map((r) => r.id)).toEqual(["q-shared"]);
    });

    it("never ships the author's email or linked private shelf record in the expand (F-3/M1)", async () => {
      db.session = { id: "me" };
      db.quotes.set("q1", {
        user: "me",
        titleName: "Dune",
        isSharedWithCircles: ["circle-scifi"],
        authorProfile: {
          id: "me",
          name: "Alice",
          email: "alice-private@example.com",
          emailVisibility: false,
          verified: true,
          created: "2026-01-01T00:00:00.000Z",
        },
        linkedProgress: {
          id: "progress-9",
          title: "Dune",
          notes: "SECRET-READING-NOTES-97f4",
          rating: 5,
          currentLabel: "Chapter 12",
          isSharedWithCircles: false,
        },
      });

      const result = await getUserQuotes("me");
      expect(result.length).toBe(1);
      const quote = result[0];
      expect(quote.expand?.user).not.toHaveProperty("email");
      expect(quote.expand).not.toHaveProperty("progressItem");
      expect(quote.expand?.user?.name).toBe("Alice");
      expect(quote.expand?.user?.id).toBe("me");

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("alice-private@example.com");
      expect(serialized).not.toContain("SECRET-READING-NOTES-97f4");
      expect(serialized).not.toContain("Chapter 12");
      expect(serialized).not.toContain("rating");
    });

    it("skips getSession() entirely when a resolved session is provided (H-2)", async () => {
      db.quotes.set("q1", { user: "me", titleName: "Mine", isSharedWithCircles: [] });
      db.quotes.set("q2", { user: "other", titleName: "Theirs", isSharedWithCircles: [] });

      const result = await getUserQuotes(undefined, {
        id: "me",
        isAdmin: false,
        name: "Me",
        email: "me@example.com",
      });

      expect(getSessionCalls).toBe(0);
      expect(result.map((r) => r.id)).toEqual(["q1"]);
    });

    it("returns an empty list when an explicit null session is passed (S1 preserved)", async () => {
      db.quotes.set("q1", {
        user: "victim-user",
        titleName: "Private journal",
        isSharedWithCircles: [],
      });

      const result = await getUserQuotes("victim-user", null);
      expect(result).toEqual([]);
    });
  });

  describe("getCircleQuotes (S5 — membership mandatory)", () => {
    it("returns an empty list for anonymous callers", async () => {
      db.quotes.set("q1", {
        user: "member-user",
        titleName: "Circle quote",
        isSharedWithCircles: ["circle-secret"],
      });

      const result = await getCircleQuotes("circle-secret");
      expect(result).toEqual([]);
    });

    it("rejects non-members of a private circle with an empty list", async () => {
      db.session = { id: "outsider" };
      db.quotes.set("q1", {
        user: "owner-user",
        titleName: "Secret",
        isSharedWithCircles: ["circle-private"],
      });

      const result = await getCircleQuotes("circle-private");
      expect(result).toEqual([]);
    });

    it("returns only quotes shared with the caller's circle for members", async () => {
      db.session = { id: "member" };
      db.memberCircles.add("circle-scifi");
      db.quotes.set("q-shared", {
        user: "owner",
        titleName: "Shared",
        isSharedWithCircles: ["circle-scifi"],
      });
      db.quotes.set("q-other", {
        user: "owner",
        titleName: "Different circle",
        isSharedWithCircles: ["circle-bookclub"],
      });

      const result = await getCircleQuotes("circle-scifi");
      expect(result.map((r) => r.id)).toEqual(["q-shared"]);
    });

    it("never ships the sharer's private shelf record or email to circle members (F-3)", async () => {
      db.session = { id: "member" };
      db.memberCircles.add("circle-scifi");
      db.quotes.set("q-secret", {
        user: "author-alice",
        titleName: "Dune",
        isSharedWithCircles: ["circle-scifi"],
        authorProfile: {
          id: "author-alice",
          name: "Alice",
          email: "alice@example.com",
          emailVisibility: false,
          verified: true,
          created: "2026-01-01T00:00:00.000Z",
        },
        linkedProgress: {
          id: "progress-1",
          title: "Dune",
          notes: "PRIVATE-NOTES-CIRCLE-9c2e",
          rating: 4,
          currentLabel: "Chapter 4",
          isSharedWithCircles: false,
        },
      });

      const result = await getCircleQuotes("circle-scifi");
      expect(result.length).toBe(1);
      const quote = result[0];
      expect(quote.expand?.user).not.toHaveProperty("email");
      expect(quote.expand).not.toHaveProperty("progressItem");
      expect(quote.expand?.user?.name).toBe("Alice");

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("alice@example.com");
      expect(serialized).not.toContain("PRIVATE-NOTES-CIRCLE-9c2e");
      expect(serialized).not.toContain("Chapter 4");
      expect(serialized).not.toContain("progressItem");
    });
  });

  describe("C5 — generic safe error surface (no raw error passthrough)", () => {
    function createErrorWithSensitiveMessage(): Error {
      const err = new Error(
        "PocketBase validation failed: field 'quoteText' must not contain <script>alert(1)</script>; trace=secret-internal-123",
      );
      err.name = "ClientResponseError";
      return err;
    }

    it("addQuote returns a generic message and a traceId, never the raw error", async () => {
      db.session = { id: "me" };
      const boom = createErrorWithSensitiveMessage();
      db.failNextWrite = boom;

      const result = await addQuote({
        titleName: "Dune",
        quoteText: "Fear is the mind-killer.",
      });

      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toBe("Failed to add quote");
      expect(result.error).not.toContain(boom.message);
      expect(result.traceId).toBeDefined();
      expect(result.traceId?.startsWith("ERR-")).toBe(true);
      expect(result.traceId).not.toContain("secret-internal-123");
    });

    it("deleteQuote returns a generic message and a traceId, never the raw error", async () => {
      db.session = { id: "me" };
      db.quotes.set("q1", { user: "me", titleName: "Mine", isSharedWithCircles: [] });
      db.failNextWrite = new Error("users: forbidden internal detail 0xc0ffee");

      const result = await deleteQuote("q1");
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toBe("Failed to delete quote");
      expect(result.error).not.toContain("0xc0ffee");
      expect(result.traceId?.startsWith("ERR-")).toBe(true);
    });

    it("toggleShareQuoteWithCircle returns a generic message and a traceId", async () => {
      db.session = { id: "me" };
      db.memberCircles.add("circle-scifi");
      db.quotes.set("q1", { user: "me", titleName: "Mine", isSharedWithCircles: [] });
      db.failNextWrite = new Error("cannot parse payload: POST /api/x");

      const result = await toggleShareQuoteWithCircle("q1", "circle-scifi");
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toBe("Failed to toggle circle share");
      expect(result.error).not.toContain("POST /api/x");
      expect(result.traceId?.startsWith("ERR-")).toBe(true);
    });

    it("does not log the raw quote payload in the diagnostic buffer", async () => {
      db.session = { id: "me" };
      const secret = "THE-SECRET-QUOTE-CONTENT-7f8a";
      db.failNextWrite = new Error("boom");

      await addQuote({ titleName: "Dune", quoteText: secret });

      const recent = getRecentDiagnostics();
      expect(JSON.stringify(recent)).not.toContain(secret);
    });

    it("strips foreign circle IDs caller is not a member of in addQuote (SEC-R3-01)", async () => {
      db.session = { id: "user-1" };
      db.memberCircles.add("circle-valid");

      const result = await addQuote({
        titleName: "Dune",
        quoteText: "Fear is the mind-killer",
        isSharedWithCircles: ["circle-valid", "circle-foreign-secret"],
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("expected success");
      expect(result.data.isSharedWithCircles).toEqual(["circle-valid"]);
      expect(result.data.isSharedWithCircles).not.toContain("circle-foreign-secret");
    });
  });

  describe("getDiagnosticsAction (S2 — admin-only)", () => {
    it("returns an empty list for anonymous callers", async () => {
      logDiagnostic(new Error("seed"), { action: "test-any" });
      const result = await getDiagnosticsAction();
      expect(result).toEqual([]);
    });

    it("rejects authenticated non-admin users", async () => {
      db.session = { id: "regular-user" };
      db.userIsAdmin = false;
      logDiagnostic(new Error("seed"), { action: "test-nonadmin" });

      const result = await getDiagnosticsAction();
      expect(result).toEqual([]);
    });

    it("returns the diagnostics buffer for admins", async () => {
      db.session = { id: "admin-user" };
      db.userIsAdmin = true;
      logDiagnostic(new Error("seed"), { action: "test-admin" });

      const result = await getDiagnosticsAction();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((e) => e.action === "test-admin")).toBe(true);
    });
  });
});