export type DiagnosticEntry = {
  traceId: string;
  timestamp: string;
  code: string;
  action: string;
  userMessage: string;
  technicalDetails?: Record<string, unknown>;
  stack?: string;
};

// Circular in-memory buffer storing recent diagnostics for troubleshooting
const MAX_DIAGNOSTICS = 50;
const diagnosticHistory: DiagnosticEntry[] = [];

// Shared by the "use server" actions to surface readable PocketBase validation
// messages. Lived duplicated in progress.ts and schedules.ts (drift-prone); centralise here.
export function extractErrorMessage(
  err: unknown,
  fallback: string,
): string {
  const errObj = err as {
    data?: {
      message?: string;
      data?: Record<string, { message?: string }>;
    };
    message?: string;
  };
  if (errObj?.data?.data) {
    const fieldErrors = Object.entries(errObj.data.data)
      .map(([field, detail]) => `${field}: ${detail?.message || "Invalid"}`)
      .join(", ");
    if (fieldErrors) return fieldErrors;
  }
  return errObj?.data?.message || errObj?.message || fallback;
}

export function generateTraceId(): string {
  // 32-symbol alphabet (no 0/1/O confusion); indices from crypto randomness.
  // 2^32 % 32 === 0 so the modulo introduces no bias.
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const rand = crypto.getRandomValues(new Uint32Array(6));
  let id = "ERR-";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(rand[i] % chars.length);
  }
  return id;
}

export class AppError extends Error {
  readonly code: string;
  readonly traceId: string;
  readonly technicalDetails?: Record<string, unknown>;
  readonly isAppError = true;

  constructor(
    userMessage: string,
    options: {
      code: string;
      technicalDetails?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(userMessage);
    this.name = "AppError";
    this.code = options.code;
    this.traceId = generateTraceId();
    this.technicalDetails = options.technicalDetails;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export function logDiagnostic(
  error: unknown,
  context: { action: string; [key: string]: unknown },
): DiagnosticEntry {
  const isApp = error instanceof AppError;
  const traceId = isApp ? error.traceId : generateTraceId();
  const code = isApp ? error.code : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const rawDetails = isApp ? error.technicalDetails : { rawError: message };

  // Buffered entries cross a serialization boundary (admin diagnostics
  // server action), so never store unserializable details — and never let
  // console logging throw and mask the original error.
  let mergedDetails: Record<string, unknown> = {
    ...context,
    ...rawDetails,
  };
  let detailsJson: string;
  try {
    detailsJson = JSON.stringify(mergedDetails);
  } catch {
    mergedDetails = { _unserializable: "technicalDetails omitted" };
    if (typeof context.action === "string") {
      mergedDetails.action = context.action;
    }
    detailsJson = JSON.stringify(mergedDetails);
  }

  const entry: DiagnosticEntry = {
    traceId,
    timestamp: new Date().toISOString(),
    code,
    action: context.action,
    userMessage: message,
    technicalDetails: mergedDetails,
    stack,
  };

  // Push to circular history buffer
  diagnosticHistory.unshift(entry);
  if (diagnosticHistory.length > MAX_DIAGNOSTICS) {
    diagnosticHistory.pop();
  }

  // Structured logging to console
  console.error(
    `[HEPYENI_DIAGNOSTIC] ${entry.traceId} [${entry.code}] (${entry.action}): ${entry.userMessage}`,
    detailsJson,
  );

  return entry;
}

export function getRecentDiagnostics(): DiagnosticEntry[] {
  return [...diagnosticHistory];
}
