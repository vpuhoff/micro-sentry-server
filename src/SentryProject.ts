import type { AggregatedIssue, SentryEvent } from "./types";

type Env = {};

type ListIssuesResponse = {
  project_id: string;
  issues: Array<AggregatedIssue>;
};

type GetIssueResponse = {
  project_id: string;
  issue: AggregatedIssue | null;
};

const ERR_PREFIX = "err:";
const META_LAST_ALARM_SET_AT = "__meta:last_alarm_set_at";

const SECONDS_IN_7D = 7 * 24 * 60 * 60;
const MS_IN_7D = SECONDS_IN_7D * 1000;
const MS_IN_24H = 24 * 60 * 60 * 1000;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function nowIso(): string {
  return new Date().toISOString();
}

function isIgnored(issue: AggregatedIssue, nowMs: number = Date.now()): boolean {
  const until = issue.ignore_until ? Date.parse(issue.ignore_until) : NaN;
  return !Number.isNaN(until) && until > nowMs;
}

function pickFrames(event: SentryEvent) {
  return event.exception?.values?.[0]?.stacktrace?.frames ?? [];
}

function stacktraceFingerprint(event: SentryEvent): string {
  const frames = pickFrames(event);
  if (!frames.length) return "no-frames";

  // Prefer the deepest in_app frame (closest to the crash site),
  // fallback to the last frame.
  const reversed = [...frames].reverse();
  const chosen = reversed.find((f) => f.in_app) ?? reversed[0];
  return [
    chosen.filename ?? "unknown_file",
    chosen.function ?? "unknown_func",
    chosen.lineno ?? "0",
    chosen.colno ?? "0",
  ].join(":");
}

function extractException(event: SentryEvent): { type: string; value: string } {
  const exc = event.exception?.values?.[0];
  if (exc?.type || exc?.value) {
    return {
      type: exc?.type ?? "Unknown Error",
      value: exc?.value ?? "No description",
    };
  }
  if (event.message) return { type: "Message", value: event.message };
  return { type: "Unknown Error", value: "No description" };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeIssueHash(event: SentryEvent): Promise<string> {
  const { type, value } = extractException(event);
  const st = stacktraceFingerprint(event);
  return sha256Hex(`${type}\n${value}\n${st}`);
}

async function maybeDecompressGzip(req: Request): Promise<ArrayBuffer> {
  const ab = await req.arrayBuffer();
  const enc = req.headers.get("content-encoding")?.toLowerCase();
  if (enc !== "gzip") return ab;

  // Cloudflare Workers supports DecompressionStream.
  const ds = new DecompressionStream("gzip");
  const decompressed = new Response(new Blob([ab]).stream().pipeThrough(ds));
  return await decompressed.arrayBuffer();
}

export class SentryProject implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "POST" && pathname === "/ingest") {
      return this.ingest(request);
    }

    if (request.method === "GET" && pathname === "/issues") {
      return this.listIssues(url);
    }

    if (request.method === "GET" && pathname === "/issue") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, { status: 400 });
      return this.getIssue(id);
    }

    if (request.method === "POST" && pathname === "/ignore") {
      const id = url.searchParams.get("id");
      const minutes = Number(url.searchParams.get("minutes") ?? "60");
      if (!id) return json({ error: "missing id" }, { status: 400 });
      return this.ignoreIssue(id, minutes);
    }

    if (request.method === "POST" && pathname === "/unignore") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, { status: 400 });
      return this.unignoreIssue(id);
    }

    if (request.method === "POST" && pathname === "/delete") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, { status: 400 });
      return this.deleteIssue(id);
    }

    if (request.method === "POST" && pathname === "/delete-all") {
      return this.deleteAllIssues();
    }

    return json({ error: "not found" }, { status: 404 });
  }

  private async ingest(request: Request): Promise<Response> {
    const body = await maybeDecompressGzip(request);
    let event: SentryEvent;
    try {
      event = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return json({ error: "invalid json" }, { status: 400 });
    }

    const issueHash = await computeIssueHash(event);
    const key = `${ERR_PREFIX}${issueHash}`;

    const existing = (await this.state.storage.get<AggregatedIssue>(key)) ?? null;
    const { type, value } = extractException(event);
    const now = nowIso();

    // Skip counting while muted.
    if (existing && isIgnored(existing)) {
      return json({ id: "ignored" });
    }

    const next: AggregatedIssue = existing
      ? {
          ...existing,
          exception_type: type,
          exception_value: value,
          count: existing.count + 1,
          last_seen: now,
          // keep ignore_until as-is
          payload: event,
        }
      : {
          id: issueHash,
          exception_type: type,
          exception_value: value,
          count: 1,
          first_seen: now,
          last_seen: now,
          ignore_until: null,
          payload: event,
        };

    await this.state.storage.put(key, next);
    await this.ensureAlarmIsScheduled();

    // Sentry store endpoint typically returns event_id, but for compatibility we also accept missing ids.
    return json({ id: event.event_id ?? issueHash });
  }

  private async ensureAlarmIsScheduled(): Promise<void> {
    const now = Date.now();
    const lastSetAt = (await this.state.storage.get<number>(META_LAST_ALARM_SET_AT)) ?? 0;

    // Set alarm at first write, or at most once per 24h.
    if (!lastSetAt || now - lastSetAt > MS_IN_24H) {
      await this.state.storage.setAlarm(now + MS_IN_7D);
      await this.state.storage.put(META_LAST_ALARM_SET_AT, now);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const cutoff = now - MS_IN_7D;

    // Iterate with prefix to avoid scanning meta keys.
    // DurableObjectStorage.list() returns a Map without cursor pagination; we page via startAfter.
    let startAfter: string | undefined = undefined;
    while (true) {
      const page = await this.state.storage.list<AggregatedIssue>({
        prefix: ERR_PREFIX,
        limit: 256,
        startAfter,
      });
      if (page.size === 0) break;

      let lastKey: string | undefined = undefined;
      for (const [key, issue] of page.entries()) {
        lastKey = key;
        const lastSeenMs = Date.parse(issue.last_seen);
        // Keep muted issues even if they have no recent events,
        // so a user can unmute later if desired.
        if (!Number.isNaN(lastSeenMs) && lastSeenMs < cutoff && !isIgnored(issue, now)) {
          await this.state.storage.delete(key);
        }
      }

      if (!lastKey || page.size < 256) break;
      startAfter = lastKey;
    }

    // Re-arm alarm for another 7d to keep cleanup alive.
    await this.state.storage.setAlarm(Date.now() + MS_IN_7D);
    await this.state.storage.put(META_LAST_ALARM_SET_AT, Date.now());
  }

  private async listIssues(url: URL): Promise<Response> {
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.max(1, Math.min(Number(limitRaw ?? "200") || 200, 500));

    const issues: AggregatedIssue[] = [];
    let startAfter: string | undefined = undefined;

    while (issues.length < limit) {
      const pageLimit = Math.min(256, limit - issues.length);
      const page = await this.state.storage.list<AggregatedIssue>({
        prefix: ERR_PREFIX,
        limit: pageLimit,
        startAfter,
      });

      if (page.size === 0) break;

      let lastKey: string | undefined = undefined;
      for (const [key, issue] of page.entries()) {
        lastKey = key;
        issues.push(issue);
      }

      if (!lastKey || page.size < pageLimit) break;
      startAfter = lastKey;
    }

    // Not-muted first, then by last_seen desc.
    issues.sort((a, b) => {
      const ai = isIgnored(a) ? 1 : 0;
      const bi = isIgnored(b) ? 1 : 0;
      if (ai !== bi) return ai - bi;
      return Date.parse(b.last_seen) - Date.parse(a.last_seen);
    });

    const res: ListIssuesResponse = {
      project_id: this.state.id.toString(),
      issues,
    };
    return json(res);
  }

  private async getIssue(id: string): Promise<Response> {
    const key = `${ERR_PREFIX}${id}`;
    const issue = (await this.state.storage.get<AggregatedIssue>(key)) ?? null;
    const res: GetIssueResponse = {
      project_id: this.state.id.toString(),
      issue,
    };
    return json(res);
  }

  private async ignoreIssue(id: string, minutesRaw: number): Promise<Response> {
    const key = `${ERR_PREFIX}${id}`;
    const issue = (await this.state.storage.get<AggregatedIssue>(key)) ?? null;
    if (!issue) return json({ ok: false, error: "not found" }, { status: 404 });

    const minutes = Math.max(1, Math.min(Math.floor(minutesRaw || 60), 60 * 24 * 30));
    const untilIso = new Date(Date.now() + minutes * 60_000).toISOString();

    const next: AggregatedIssue = { ...issue, ignore_until: untilIso };
    await this.state.storage.put(key, next);
    return json({ ok: true, ignore_until: untilIso });
  }

  private async unignoreIssue(id: string): Promise<Response> {
    const key = `${ERR_PREFIX}${id}`;
    const issue = (await this.state.storage.get<AggregatedIssue>(key)) ?? null;
    if (!issue) return json({ ok: false, error: "not found" }, { status: 404 });

    const next: AggregatedIssue = { ...issue, ignore_until: null };
    await this.state.storage.put(key, next);
    return json({ ok: true });
  }

  private async deleteIssue(id: string): Promise<Response> {
    const key = `${ERR_PREFIX}${id}`;
    const existed = await this.state.storage.delete(key);
    return json({ ok: true, existed });
  }

  private async deleteAllIssues(): Promise<Response> {
    let deleted = 0;
    let startAfter: string | undefined = undefined;

    while (true) {
      const page = await this.state.storage.list({
        prefix: ERR_PREFIX,
        limit: 256,
        startAfter,
      });
      if (page.size === 0) break;

      const keys: string[] = [];
      let lastKey: string | undefined = undefined;
      for (const [key] of page.entries()) {
        lastKey = key;
        keys.push(key);
      }

      if (keys.length) {
        await this.state.storage.delete(keys);
        deleted += keys.length;
      }

      if (!lastKey || page.size < 256) break;
      startAfter = lastKey;
    }

    return json({ ok: true, deleted });
  }
}

