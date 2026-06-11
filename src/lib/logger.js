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
    this.updated = [];
    this.closed = [];
    this.skipped = [];
    this.failed = [];
  }
  recordCreated(jobId, itemId) {
    this.created.push({ jobId, itemId });
    log.info("created draft", { jobId, itemId });
  }
  recordUpdated(jobId, itemId, fields) {
    this.updated.push({ jobId, itemId, fields });
    log.info("updated item (staged, not published)", { jobId, itemId, fields });
  }
  recordClosed(jobId, itemId) {
    this.closed.push({ jobId, itemId });
    log.info("closed item (staged, not published)", { jobId, itemId });
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
  // A "hold" is a skip caused by an unresolved required Option (recorded with an
  // `unmapped` list), as opposed to a benign "no changes" skip. Holds need a human,
  // so they are surfaced separately for the cron to warn/fail on.
  heldJobs() {
    return this.skipped.filter(
      (s) => Array.isArray(s.reason?.unmapped) && s.reason.unmapped.length > 0,
    );
  }
  summary() {
    const held = this.heldJobs();
    return {
      created: this.created.length,
      updated: this.updated.length,
      closed: this.closed.length,
      skipped: this.skipped.length,
      held: held.length,
      failed: this.failed.length,
      details: {
        created: this.created,
        updated: this.updated,
        closed: this.closed,
        skipped: this.skipped,
        held,
        failed: this.failed,
      },
    };
  }
}
