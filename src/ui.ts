import type { AggregatedIssue, SentryEvent } from "./types";

function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
  });
}

function formatTimeOnly(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function isMuted(issue: AggregatedIssue): boolean {
  if (!issue.ignore_until) return false;
  const t = Date.parse(issue.ignore_until);
  return !Number.isNaN(t) && t > Date.now();
}

function isMessageIssue(issue: AggregatedIssue): boolean {
  return issue.exception_type === "Message";
}

export function renderPage(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
      :root {
        --background: 0 0% 100%;
        --foreground: 240 10% 3.9%;
        --card: 0 0% 100%;
        --card-foreground: 240 10% 3.9%;
        --primary: 240 5.9% 10%;
        --primary-foreground: 0 0% 98%;
        --muted: 240 4.8% 95.9%;
        --muted-foreground: 240 3.8% 46.1%;
        --border: 240 5.9% 90%;
        --radius: 0.5rem;
        --destructive: 0 84.2% 60.2%;
        --destructive-foreground: 0 0% 98%;
      }
      body { font-family: "Inter", sans-serif; }
    </style>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              border: "hsl(var(--border))",
              background: "hsl(var(--background))",
              foreground: "hsl(var(--foreground))",
              primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
              muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
              card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
              destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" }
            },
            borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" }
          }
        }
      }
    </script>
  </head>
  <body class="bg-background text-foreground min-h-screen antialiased flex flex-col">
    <header class="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
      <div class="container mx-auto px-6 h-14 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2 font-semibold text-primary">
          <i data-lucide="activity" class="w-5 h-5"></i>
          Micro Sentry
        </a>
        <div class="text-sm text-muted-foreground flex items-center gap-1">
          <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          System Online
        </div>
      </div>
    </header>
    <main class="flex-1 container mx-auto px-6 py-8">
      ${content}
    </main>
    <footer class="border-t border-border bg-background">
      <div class="container mx-auto px-6 py-6 text-xs text-muted-foreground">
        ${""}
      </div>
    </footer>
    <script>lucide.createIcons();</script>
  </body>
</html>`;
}

export function renderPageWithFooter(title: string, content: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
      :root {
        --background: 0 0% 100%;
        --foreground: 240 10% 3.9%;
        --card: 0 0% 100%;
        --card-foreground: 240 10% 3.9%;
        --primary: 240 5.9% 10%;
        --primary-foreground: 0 0% 98%;
        --muted: 240 4.8% 95.9%;
        --muted-foreground: 240 3.8% 46.1%;
        --border: 240 5.9% 90%;
        --radius: 0.5rem;
        --destructive: 0 84.2% 60.2%;
        --destructive-foreground: 0 0% 98%;
      }
      body { font-family: "Inter", sans-serif; }
    </style>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              border: "hsl(var(--border))",
              background: "hsl(var(--background))",
              foreground: "hsl(var(--foreground))",
              primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
              muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
              card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
              destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" }
            },
            borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" }
          }
        }
      }
    </script>
  </head>
  <body class="bg-background text-foreground min-h-screen antialiased flex flex-col">
    <header class="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
      <div class="container mx-auto px-6 h-14 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2 font-semibold text-primary">
          <i data-lucide="activity" class="w-5 h-5"></i>
          Micro Sentry
        </a>
        <div class="text-sm text-muted-foreground flex items-center gap-1">
          <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          System Online
        </div>
      </div>
    </header>
    <main class="flex-1 container mx-auto px-6 py-8">
      ${content}
    </main>
    <footer class="border-t border-border bg-background">
      <div class="container mx-auto px-6 py-6 text-xs text-muted-foreground">
        ${footer}
      </div>
    </footer>
    <script>lucide.createIcons();</script>
  </body>
</html>`;
}

export function renderProjectPicker(defaultProject: string): string {
  const content = `
    <div class="max-w-xl">
      <h1 class="text-2xl font-semibold tracking-tight mb-2">Open project</h1>
      <p class="text-sm text-muted-foreground mb-6">Enter a project id to view aggregated issues.</p>
      <form class="flex gap-2" action="/ui" method="get">
        <input name="project" value="${esc(defaultProject)}" class="flex-1 rounded-md border border-border px-3 py-2 text-sm" placeholder="project id (e.g. 1)" />
        <button class="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">Open</button>
      </form>
      <div class="mt-4">
        <a class="text-sm text-primary underline underline-offset-4" href="/ui/projects/new">Create a new project</a>
      </div>
    </div>`;
  return renderPage("Micro Sentry", content);
}

export function renderCreateProject(): string {
  const content = `
    <div class="max-w-xl">
      <h1 class="text-2xl font-semibold tracking-tight mb-2">Create project</h1>
      <p class="text-sm text-muted-foreground mb-6">Enter a name. The UI will allocate a unique 5-digit numeric id for Sentry DSN compatibility.</p>
      <form class="flex gap-2" action="/ui/projects/new" method="post">
        <input name="name" class="flex-1 rounded-md border border-border px-3 py-2 text-sm" placeholder="e.g. frontend" />
        <button class="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">Create</button>
      </form>
      <div class="mt-4">
        <a class="text-sm text-muted-foreground underline underline-offset-4" href="/ui">Back</a>
      </div>
    </div>`;
  return renderPage("Create project - Micro Sentry", content);
}

export function renderDashboard(projectId: string, issues: AggregatedIssue[], dsn: string): string {
  if (!issues.length) {
    const empty = `
      <div class="flex flex-col items-center justify-center h-64 border border-dashed border-border rounded-lg bg-muted/20">
        <i data-lucide="inbox" class="w-10 h-10 text-muted-foreground mb-4"></i>
        <h3 class="font-semibold text-lg">No issues found</h3>
        <p class="text-muted-foreground text-sm mt-1">Waiting for SDK to send events...</p>
      </div>`;
    return renderPageWithFooter(
      `Dashboard - ${projectId}`,
      empty,
      `<div><span class="font-semibold">SENTRY_DSN</span>: <span class="font-mono break-all">${esc(dsn)}</span></div>`,
    );
  }

  let rows = "";
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const isMsg = isMessageIssue(issue);
    const borderClass = i < issues.length - 1 ? "border-b border-border" : "";
    const muted = isMuted(issue);
    const mutedBadge = muted
      ? `<div class="flex items-center gap-1 bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
          <i data-lucide="bell-off" class="w-3 h-3"></i>
          muted until ${esc(formatTimeOnly(issue.ignore_until))}
        </div>`
      : "";

    const icon = isMsg
      ? `<i data-lucide="message-square" class="w-5 h-5 text-muted-foreground"></i>`
      : `<i data-lucide="alert-circle" class="w-5 h-5 text-destructive"></i>`;

    const countBadge = isMsg
      ? `<div class="flex items-center gap-1 bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
           <i data-lucide="hash" class="w-3 h-3"></i>
           ${issue.count} events
         </div>`
      : `<div class="flex items-center gap-1 bg-destructive/10 text-destructive text-xs font-medium px-2 py-0.5 rounded-full">
           <i data-lucide="trending-up" class="w-3 h-3"></i>
           ${issue.count} events
         </div>`;

    rows += `
      <a href="/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issue.id)}" class="flex items-start justify-between p-4 hover:bg-muted/50 transition-colors ${borderClass} group">
        <div class="flex gap-4">
          <div class="mt-1">
            ${icon}
          </div>
          <div>
            <div class="font-semibold text-primary group-hover:underline decoration-muted-foreground/50 underline-offset-4">${esc(issue.exception_type)}</div>
            <div class="text-sm text-muted-foreground mt-1 font-mono line-clamp-1">${esc(issue.exception_value)}</div>
          </div>
        </div>
        <div class="flex flex-col items-end gap-2 shrink-0 ml-4">
          ${countBadge}
          ${mutedBadge}
          <div class="text-xs text-muted-foreground flex items-center gap-1">
            <i data-lucide="clock" class="w-3 h-3"></i> ${esc(formatWhen(issue.last_seen))}
          </div>
        </div>
      </a>`;
  }

  const content = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Issues</h1>
        <div class="text-xs text-muted-foreground mt-1">Project: <span class="font-mono">${esc(projectId)}</span></div>
      </div>
      <span class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold bg-muted/50 text-muted-foreground">
        Aggregated
      </span>
    </div>
    <div class="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div class="flex flex-col">
        ${rows}
      </div>
    </div>`;

  return renderPageWithFooter(
    `Dashboard - ${projectId}`,
    content,
    `<div><span class="font-semibold">SENTRY_DSN</span>: <span class="font-mono break-all">${esc(dsn)}</span></div>`,
  );
}

function extractFrames(latest: SentryEvent): Array<{ filename: string; func: string; lineno: string }> {
  const frames = latest.exception?.values?.[0]?.stacktrace?.frames ?? [];
  return [...frames].reverse().map((f) => ({
    filename: f.filename ?? "unknown file",
    func: f.function ?? "<module>",
    lineno: f.lineno != null ? String(f.lineno) : "?",
  }));
}

function normalizeTags(tags: SentryEvent["tags"]): Array<[string, string]> {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter((t): t is [string, string] => Array.isArray(t) && t.length === 2);
  return Object.entries(tags);
}

export function renderIssue(projectId: string, issue: AggregatedIssue, dsn: string): string {
  const latest = issue.payload ?? {};
  const platform = latest.platform ?? "unknown";
  const frames = extractFrames(latest);
  const tags = normalizeTags(latest.tags);
  const muted = isMuted(issue);
  const isMsg = isMessageIssue(issue);

  const buttons = `
    <div class="mt-4 flex flex-wrap gap-2 items-center">
      <form method="post" action="/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issue.id)}/ignore?minutes=15">
        <button class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 transition-colors">
          <span class="mr-2" aria-hidden="true">⏸</span> Игнорировать 15м
        </button>
      </form>
      <form method="post" action="/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issue.id)}/ignore?minutes=60">
        <button class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 transition-colors">
          <span class="mr-2" aria-hidden="true">⏸</span> Игнорировать 1ч
        </button>
      </form>
      <form method="post" action="/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issue.id)}/ignore?minutes=1440">
        <button class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 transition-colors">
          <span class="mr-2" aria-hidden="true">⏸</span> Игнорировать 24ч
        </button>
      </form>
      <form method="post" action="/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issue.id)}/unignore">
        <button class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 transition-colors">
          <span class="mr-2" aria-hidden="true">▶</span> Снять игнор
        </button>
      </form>
      <form method="post" action="/ui/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issue.id)}/delete" onsubmit="return confirm('Удалить issue? Это действие нельзя отменить.');">
        <button class="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity">
          <span class="mr-2" aria-hidden="true">🗑</span> Удалить
        </button>
      </form>
      <div class="text-xs text-muted-foreground">
        ${muted ? `Muted until: ${esc(formatWhen(issue.ignore_until))}` : "Not muted"}
      </div>
    </div>`;

  const header = `
    <div class="mb-6 flex items-center text-sm text-muted-foreground">
      <a href="/ui/${encodeURIComponent(projectId)}/" class="hover:text-foreground transition-colors flex items-center gap-1">
        <i data-lucide="arrow-left" class="w-4 h-4"></i> Back to issues
      </a>
    </div>

    <div class="rounded-lg border border-border bg-card shadow-sm mb-6">
      <div class="p-6">
        <div class="flex justify-between items-start mb-4">
          <div class="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold bg-muted/50 text-foreground capitalize">
            ${esc(platform)}
          </div>
          <div class="text-sm text-muted-foreground">ID: ${esc(issue.id)}</div>
        </div>
        <h1 class="text-3xl font-bold tracking-tight ${isMsg ? "text-primary" : "text-destructive"} mb-2">${esc(issue.exception_type)}</h1>
        <p class="font-mono text-sm bg-muted/50 p-3 rounded-md border border-border">${esc(issue.exception_value)}</p>
        ${buttons}
      </div>
    </div>`;

  let stack = "";
  if (frames.length) {
    let framesHtml = "";
    for (const f of frames) {
      framesHtml += `
        <div class="bg-[#161b22] border-b border-[#30363d] px-4 py-2 flex justify-between items-center text-xs font-mono text-[#8b949e]">
          <span>${esc(f.filename)} in <span class="text-[#d2a8ff]">${esc(f.func)}</span></span>
          <span>line ${esc(f.lineno)}</span>
        </div>`;
    }
    stack = `
      <h3 class="text-lg font-semibold tracking-tight mb-4 flex items-center gap-2">
        <i data-lucide="code-2" class="w-5 h-5"></i> Stacktrace
      </h3>
      <div class="rounded-lg border border-border bg-[#0d1117] overflow-hidden mb-8 shadow-sm">
        ${framesHtml}
      </div>`;
  }

  let tagsHtml = "";
  if (tags.length) {
    let items = "";
    for (const [k, v] of tags) {
      items += `
        <div class="rounded-lg border border-border bg-card p-3 shadow-sm">
          <div class="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">${esc(k)}</div>
          <div class="text-sm font-medium truncate" title="${esc(v)}">${esc(v)}</div>
        </div>`;
    }
    tagsHtml = `
      <h3 class="text-lg font-semibold tracking-tight mb-4 flex items-center gap-2">
        <i data-lucide="tags" class="w-5 h-5"></i> Tags
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        ${items}
      </div>`;
  }

  return renderPageWithFooter(
    `${issue.exception_type} - ${projectId}`,
    header + stack + tagsHtml,
    `<div class="flex flex-col gap-1">
       <div><span class="font-semibold">Project</span>: <span class="font-mono">${esc(projectId)}</span></div>
       <div><span class="font-semibold">SENTRY_DSN</span>: <span class="font-mono break-all">${esc(dsn)}</span></div>
     </div>`,
  );
}

