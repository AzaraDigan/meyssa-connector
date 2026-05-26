// Minimal structured logger. Writes JSON lines to stdout/stderr, which Vercel
// captures in the function logs. The point is that failures are visible: every
// error and every per-job skip is logged with enough context to act on.

function emit(stream, level, message, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  stream.write(line + "\n");
}

export const log = {
  info: (message, fields) => emit(process.stdout, "info", message, fields),
  warn: (message, fields) => emit(process.stderr, "warn", message, fields),
  error: (message, fields) => emit(process.stderr, "error", message, fields),
};

// Accumulates a per-run summary so /api/sync can return a clear result and so a
// failed run is obvious in the logs rather than buried.
export class RunReport {
  constructor() {
    this.created = [];
    this.skipped = [];
    this.failed = [];
  }
  recordCreated(jobId, itemId) {
    this.created.push({ jobId, itemId });
    log.info("created draft", { jobId, itemId });
  }
  recordSkipped(jobId, reason) {
    this.skipped.push({ jobId, reason });
    log.warn("skipped job", { jobId, reason });
  }
  recordFailed(jobId, error) {
    const detail = error instanceof Error ? error.message : String(error);
    this.failed.push({ jobId, error: detail });
    log.error("failed job", { jobId, error: detail });
  }
  summary() {
    return {
      created: this.created.length,
      skipped: this.skipped.length,
      failed: this.failed.length,
      details: { created: this.created, skipped: this.skipped, failed: this.failed },
    };
  }
}
