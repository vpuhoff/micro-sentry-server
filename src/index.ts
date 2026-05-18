import { SentryProject } from "./SentryProject";
import { ProjectRegistry } from "./ProjectRegistry";
import { renderCreateProject, renderDashboard, renderIssue, renderProjectPicker } from "./ui";
import { FAVICON_SVG } from "./favicon";

export { SentryProject };
export { ProjectRegistry };

type Env = {
  SENTRY_PROJECT: DurableObjectNamespace<SentryProject>;
  PROJECT_REGISTRY: DurableObjectNamespace<ProjectRegistry>;
};

function withCors(resp: Response, req: Request): Response {
  const origin = req.headers.get("origin") ?? "*";
  const headers = new Headers(resp.headers);

  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "origin");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", req.headers.get("access-control-request-headers") ?? "*");
  headers.set("access-control-max-age", "86400");

  // Preserve status codes (e.g. 303 redirects) when cloning.
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function getProjectStub(env: Env, projectId: string) {
  const id = env.SENTRY_PROJECT.idFromName(projectId);
  return env.SENTRY_PROJECT.get(id);
}

function getRegistryStub(env: Env) {
  const id = env.PROJECT_REGISTRY.idFromName("global");
  return env.PROJECT_REGISTRY.get(id);
}

async function readJson<T>(resp: Response): Promise<T> {
  const text = await resp.text();
  return JSON.parse(text) as T;
}

function isNumericProjectId(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

async function resolveProjectId(env: Env, raw: string): Promise<{ id: string; name?: string } | null> {
  const project = raw.trim();
  if (!project) return null;
  if (isNumericProjectId(project)) return { id: project };

  const registry = getRegistryStub(env);
  const resp = await registry.fetch(`https://do/lookup?name=${encodeURIComponent(project)}`);
  const data = await readJson<{ project: { id: string; name: string } | null }>(resp);
  if (!data.project) return null;
  return { id: data.project.id, name: data.project.name };
}

async function maybeDecompressGzip(req: Request): Promise<ArrayBuffer> {
  const ab = await req.arrayBuffer();
  const enc = req.headers.get("content-encoding")?.toLowerCase();
  if (enc !== "gzip") return ab;

  const ds = new DecompressionStream("gzip");
  const decompressed = new Response(new Blob([ab]).stream().pipeThrough(ds));
  return await decompressed.arrayBuffer();
}

function findNextLf(buf: Uint8Array, start: number): number {
  for (let i = start; i < buf.length; i++) {
    if (buf[i] === 0x0a) return i;
  }
  return -1;
}

function decodeUtf8(buf: Uint8Array): string {
  return new TextDecoder().decode(buf);
}

function extractEventFromEnvelope(body: ArrayBuffer): unknown | null {
  // Sentry envelope:
  // <envelope headers>\n
  // <item headers>\n
  // <payload bytes, length from item headers>\n
  //
  // We parse item headers and use `length` to slice payload reliably.
  const bytes = new Uint8Array(body);
  let pos = 0;

  // envelope headers line (ignore content)
  const envLf = findNextLf(bytes, pos);
  if (envLf === -1) return null;
  pos = envLf + 1;

  while (pos < bytes.length) {
    const hdrLf = findNextLf(bytes, pos);
    if (hdrLf === -1) break;

    const hdrLine = decodeUtf8(bytes.slice(pos, hdrLf)).trim();
    pos = hdrLf + 1;
    if (!hdrLine) continue;

    let hdr: any;
    try {
      hdr = JSON.parse(hdrLine);
    } catch {
      // Not a JSON header; give up and fallback to scan.
      break;
    }

    const type = String(hdr?.type ?? "");
    const length = Number(hdr?.length);
    if (!Number.isFinite(length) || length < 0) {
      // Without length we can't reliably skip; fallback to scan.
      break;
    }

    if (pos + length > bytes.length) break;
    const payloadBytes = bytes.slice(pos, pos + length);
    pos = pos + length;

    // optional trailing LF after payload
    if (pos < bytes.length && bytes[pos] === 0x0a) pos++;

    if (type === "event" || type === "transaction") {
      const payloadText = decodeUtf8(payloadBytes).trim();
      if (!payloadText) return null;
      try {
        return JSON.parse(payloadText);
      } catch {
        return null;
      }
    }
  }

  // Fallback: heuristic scan like old python version (best-effort).
  const text = decodeUtf8(bytes);
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as any;
      if (obj && typeof obj === "object") {
        if ("exception" in obj || "message" in obj || "event_id" in obj) return obj;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if ((path === "/favicon.svg" || path === "/favicon.ico") && request.method === "GET") {
      // Serve SVG for both; modern browsers will use /favicon.svg via <link rel="icon">.
      return withCors(
        new Response(FAVICON_SVG, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" } }),
        request,
      );
    }

    // Sentry-compatible ingest (store endpoint):
    // POST /api/{project_id}/store/
    const storeMatch = path.match(/^\/api\/([^/]+)\/store\/?$/);
    if (storeMatch && request.method === "POST") {
      const resolved = await resolveProjectId(env, storeMatch[1]);
      if (!resolved) return withCors(json({ error: "unknown project" }, { status: 404 }), request);
      const stub = getProjectStub(env, resolved.id);
      const resp = await stub.fetch("https://do/ingest", request);
      return withCors(resp, request);
    }

    // Optional compatibility with envelope endpoint from python version:
    // POST /api/{project_id}/envelope/
    const envMatch = path.match(/^\/api\/([^/]+)\/envelope\/?$/);
    if (envMatch && request.method === "POST") {
      const resolved = await resolveProjectId(env, envMatch[1]);
      if (!resolved) return withCors(json({ id: "unknown_project" }, { status: 404 }), request);
      const stub = getProjectStub(env, resolved.id);

      const body = await maybeDecompressGzip(request);
      const event = extractEventFromEnvelope(body);

      if (!event) {
        return withCors(json({ id: "ok" }), request);
      }

      const resp = await stub.fetch("https://do/ingest", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(event),
      });
      return withCors(resp, request);
    }

    // Read API for UI / debugging (JSON):
    // GET /api/{project_id}/issues
    // GET /api/{project_id}/issue/{issue_hash}
    const issuesMatch = path.match(/^\/api\/([^/]+)\/issues\/?$/);
    if (issuesMatch && request.method === "GET") {
      const resolved = await resolveProjectId(env, issuesMatch[1]);
      if (!resolved) return withCors(json({ error: "unknown project" }, { status: 404 }), request);
      const stub = getProjectStub(env, resolved.id);
      const resp = await stub.fetch(`https://do/issues${url.search}`);
      return withCors(resp, request);
    }

    const issueMatch = path.match(/^\/api\/([^/]+)\/issue\/([^/]+)\/?$/);
    if (issueMatch && request.method === "GET") {
      const resolved = await resolveProjectId(env, issueMatch[1]);
      if (!resolved) return withCors(json({ error: "unknown project" }, { status: 404 }), request);
      const projectId = resolved.id;
      const issueId = issueMatch[2];
      const stub = getProjectStub(env, projectId);
      const resp = await stub.fetch(`https://do/issue?id=${encodeURIComponent(issueId)}`);
      return withCors(resp, request);
    }

    // UI
    // GET /ui?project=1
    if (path === "/ui" && request.method === "GET") {
      const projectId = url.searchParams.get("project")?.trim() || "1";
      return withCors(new Response(renderProjectPicker(projectId), { headers: { "content-type": "text/html; charset=utf-8" } }), request);
    }

    // UI: create project
    // GET  /ui/projects/new
    // POST /ui/projects/new
    if (path === "/ui/projects/new" && request.method === "GET") {
      return withCors(
        new Response(renderCreateProject(), { headers: { "content-type": "text/html; charset=utf-8" } }),
        request,
      );
    }

    if (path === "/ui/projects/new" && request.method === "POST") {
      const form = await request.formData();
      const name = String(form.get("name") ?? "").trim();
      if (!name) {
        return withCors(new Response("Missing name", { status: 400 }), request);
      }

      const registry = getRegistryStub(env);
      const resp = await registry.fetch(`https://do/create?name=${encodeURIComponent(name)}`, { method: "POST" });
      const data = await readJson<{ project: { id: string; name: string } | null }>(resp);
      if (!data.project) return withCors(new Response("Failed to create project", { status: 500 }), request);

      const host = url.host;
      const scheme = url.protocol;
      const dsn = `${scheme}//public@${host}/${encodeURIComponent(data.project.id)}`;
      const uiUrl = `${scheme}//${host}/ui/${encodeURIComponent(data.project.id)}/`;

      const body = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project created</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white text-slate-900 min-h-screen">
  <div class="max-w-2xl mx-auto p-6">
    <h1 class="text-2xl font-semibold mb-2">Project created</h1>
    <p class="text-sm text-slate-600 mb-6">Name: <span class="font-mono">${name.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</span></p>
    <div class="rounded-lg border p-4 mb-4">
      <div class="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1">Project ID</div>
      <div class="font-mono">${data.project.id}</div>
    </div>
    <div class="rounded-lg border p-4 mb-4">
      <div class="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1">SENTRY_DSN</div>
      <div class="font-mono break-all">${dsn}</div>
    </div>
    <div class="rounded-lg border p-4 mb-6">
      <div class="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1">UI</div>
      <a class="text-blue-700 underline break-all" href="/ui/${data.project.id}/">${uiUrl}</a>
    </div>
    <a class="text-sm underline" href="/ui">Back</a>
  </div>
</body></html>`;

      return withCors(new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } }), request);
    }

    // GET /ui/{project}/
    const uiDash = path.match(/^\/ui\/([^/]+)\/?$/);
    if (uiDash && request.method === "GET") {
      const raw = uiDash[1];
      const resolved = await resolveProjectId(env, raw);
      if (!resolved) return withCors(new Response("Project not found", { status: 404 }), request);
      const projectId = resolved.id;
      if (!isNumericProjectId(raw)) {
        return withCors(
          new Response(null, { status: 303, headers: { location: `/ui/${encodeURIComponent(projectId)}/` } }),
          request,
        );
      }
      const stub = getProjectStub(env, projectId);
      const resp = await stub.fetch("https://do/issues?limit=200");
      const data = await readJson<{ issues: any[] }>(resp);
      const dsn = `${url.protocol}//public@${url.host}/${encodeURIComponent(projectId)}`;
      return withCors(
        new Response(renderDashboard(projectId, data.issues as any, dsn), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        request,
      );
    }

    // GET /ui/{project}/issue/{issue_hash}
    const uiIssue = path.match(/^\/ui\/([^/]+)\/issue\/([^/]+)\/?$/);
    if (uiIssue && request.method === "GET") {
      const raw = uiIssue[1];
      const resolved = await resolveProjectId(env, raw);
      if (!resolved) return withCors(new Response("Project not found", { status: 404 }), request);
      const projectId = resolved.id;
      if (!isNumericProjectId(raw)) {
        return withCors(
          new Response(null, {
            status: 303,
            headers: { location: `/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(uiIssue[2])}` },
          }),
          request,
        );
      }
      const issueId = uiIssue[2];
      const stub = getProjectStub(env, projectId);
      const resp = await stub.fetch(`https://do/issue?id=${encodeURIComponent(issueId)}`);
      const data = await readJson<{ issue: any | null }>(resp);
      if (!data.issue) {
        return withCors(new Response("Issue not found", { status: 404 }), request);
      }
      const dsn = `${url.protocol}//public@${url.host}/${encodeURIComponent(projectId)}`;
      return withCors(
        new Response(renderIssue(projectId, data.issue as any, dsn), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        request,
      );
    }

    // POST /ui/{project}/issue/{issue_hash}/ignore?minutes=...
    const uiIgnore = path.match(/^\/ui\/([^/]+)\/issue\/([^/]+)\/ignore\/?$/);
    if (uiIgnore && request.method === "POST") {
      const resolved = await resolveProjectId(env, uiIgnore[1]);
      if (!resolved) return withCors(new Response("Project not found", { status: 404 }), request);
      const projectId = resolved.id;
      const issueId = uiIgnore[2];
      const minutes = url.searchParams.get("minutes") ?? "60";
      const stub = getProjectStub(env, projectId);
      await stub.fetch(`https://do/ignore?id=${encodeURIComponent(issueId)}&minutes=${encodeURIComponent(minutes)}`, { method: "POST" });
      return withCors(new Response(null, { status: 303, headers: { location: `/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issueId)}` } }), request);
    }

    // POST /ui/{project}/issue/{issue_hash}/unignore
    const uiUnignore = path.match(/^\/ui\/([^/]+)\/issue\/([^/]+)\/unignore\/?$/);
    if (uiUnignore && request.method === "POST") {
      const resolved = await resolveProjectId(env, uiUnignore[1]);
      if (!resolved) return withCors(new Response("Project not found", { status: 404 }), request);
      const projectId = resolved.id;
      const issueId = uiUnignore[2];
      const stub = getProjectStub(env, projectId);
      await stub.fetch(`https://do/unignore?id=${encodeURIComponent(issueId)}`, { method: "POST" });
      return withCors(new Response(null, { status: 303, headers: { location: `/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issueId)}` } }), request);
    }

    // POST /ui/{project}/delete-all
    const uiDeleteAll = path.match(/^\/ui\/([^/]+)\/delete-all\/?$/);
    if (uiDeleteAll && request.method === "POST") {
      const resolved = await resolveProjectId(env, uiDeleteAll[1]);
      if (!resolved) return withCors(new Response("Project not found", { status: 404 }), request);
      const projectId = resolved.id;
      const stub = getProjectStub(env, projectId);
      await stub.fetch("https://do/delete-all", { method: "POST" });
      return withCors(
        new Response(null, { status: 303, headers: { location: `/ui/${encodeURIComponent(projectId)}/` } }),
        request,
      );
    }

    // POST /ui/{project}/issue/{issue_hash}/delete
    const uiDelete = path.match(/^\/ui\/([^/]+)\/issue\/([^/]+)\/delete\/?$/);
    if (uiDelete && request.method === "POST") {
      const resolved = await resolveProjectId(env, uiDelete[1]);
      if (!resolved) return withCors(new Response("Project not found", { status: 404 }), request);
      const projectId = resolved.id;
      const issueId = uiDelete[2];
      const stub = getProjectStub(env, projectId);
      await stub.fetch(`https://do/delete?id=${encodeURIComponent(issueId)}`, { method: "POST" });
      return withCors(
        new Response(null, { status: 303, headers: { location: `/ui/${encodeURIComponent(projectId)}/` } }),
        request,
      );
    }

    // Minimal landing page (helps to see it's alive).
    if (path === "/" && request.method === "GET") {
      return withCors(
        new Response(
          [
            "micro-sentry worker is running.",
            "Ingest: POST /api/{project_id}/store/",
            "List:   GET  /api/{project_id}/issues",
            "Get:    GET  /api/{project_id}/issue/{issue_hash}",
            "",
            "UI:     GET  /ui?project=1",
            "UI:     GET  /ui/{project_id}/",
          ].join("\n"),
          { headers: { "content-type": "text/plain; charset=utf-8" } },
        ),
        request,
      );
    }

    return withCors(json({ error: "not found" }, { status: 404 }), request);
  },
};

