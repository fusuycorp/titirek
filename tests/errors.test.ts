import { describe, expect, it } from "bun:test";
import {
  AppError,
  extractErrorMessage,
  generateTraceId,
  logDiagnostic,
  getRecentDiagnostics,
} from "@/lib/errors";

describe("Error Management & Diagnostics System", () => {
  it("generates unique 10-character formatted trace IDs (ERR-xxxxxx)", () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();

    expect(id1).toMatch(/^ERR-[2-9A-Z]{6}$/);
    expect(id2).toMatch(/^ERR-[2-9A-Z]{6}$/);
    expect(id1).not.toBe(id2);
  });

  it("constructs AppError with safe user message and technical details", () => {
    const error = new AppError("Service unavailable", {
      code: "PROVIDER_RATE_LIMITED",
      technicalDetails: { status: 429, endpoint: "https://api.example.com" },
    });

    expect(error.message).toBe("Service unavailable");
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.traceId).toMatch(/^ERR-/);
    expect(error.technicalDetails?.status).toBe(429);
    expect(error.isAppError).toBe(true);
  });

  it("logs diagnostics and records entries in the circular buffer", () => {
    const testError = new Error("Connection timed out");
    const entry = logDiagnostic(testError, {
      action: "test:network",
      target: "db-cluster",
    });

    expect(entry.traceId).toMatch(/^ERR-/);
    expect(entry.action).toBe("test:network");
    expect(entry.userMessage).toBe("Connection timed out");
    expect(entry.technicalDetails?.target).toBe("db-cluster");

    const recent = getRecentDiagnostics();
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0].traceId).toBe(entry.traceId);
  });

  it("survives circular caller context without masking the original error", () => {
    const circular: Record<string, unknown> = { action: "test:circular" };
    circular.self = circular;
    let entry: ReturnType<typeof logDiagnostic> | undefined;
    expect(() => {
      entry = logDiagnostic(
        new Error("original"),
        circular as { action: string },
      );
    }).not.toThrow();
    expect(entry?.userMessage).toBe("original");
    expect(entry?.action).toBe("test:circular");
    // Stored entry stays wire-safe for the admin diagnostics action.
    expect(entry?.technicalDetails).toMatchObject({
      action: "test:circular",
      _unserializable: "technicalDetails omitted",
    });
    expect(() => JSON.stringify(getRecentDiagnostics())).not.toThrow();
  });

  describe("extractErrorMessage (shared, C3)", () => {
    it("joins PocketBase field-level validation messages", () => {
      const err = {
        data: {
          data: {
            quoteText: { message: "must not be empty" },
            rating: { message: "must be 1-5" },
          },
        },
      };
      expect(extractErrorMessage(err, "fallback")).toBe(
        "quoteText: must not be empty, rating: must be 1-5",
      );
    });

    it("falls back to the top-level message when no field errors exist", () => {
      expect(extractErrorMessage({ message: "boom" }, "fallback")).toBe("boom");
      expect(
        extractErrorMessage({ data: { message: "nested" } }, "fallback"),
      ).toBe("nested");
    });

    it("uses the supplied fallback for unknown/empty errors", () => {
      expect(extractErrorMessage(null, "An error occurred")).toBe(
        "An error occurred",
      );
      expect(extractErrorMessage({}, "An error occurred")).toBe(
        "An error occurred",
      );
      expect(extractErrorMessage("just a string", "An error occurred")).toBe(
        "An error occurred",
      );
    });
  });
});
