import time
import json
import gzip
import hashlib
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

# --- Хранилище и логика (без изменений) ---
db = {}
SECONDS_IN_24H = 86400


async def cleanup_old_data():
    while True:
        now = time.time()
        for issue_id in list(db.keys()):
            db[issue_id]["timestamps"] = [
                ts for ts in db[issue_id]["timestamps"] if now - ts <= SECONDS_IN_24H
            ]
            if not db[issue_id]["timestamps"]:
                del db[issue_id]
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(cleanup_old_data())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.post("/api/{project_id}/envelope/")
async def ingest_error(project_id: str, request: Request):
    body = await request.body()
    if request.headers.get("content-encoding") == "gzip":
        body = gzip.decompress(body)

    text = body.decode("utf-8")
    event_payload = None

    for line in text.split("\n"):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            if "exception" in data or "message" in data:
                event_payload = data
                break
        except json.JSONDecodeError:
            pass

    if event_payload:
        exc_type = "Unknown Error"
        exc_value = "No description"
        if "exception" in event_payload and event_payload["exception"].get("values"):
            exc = event_payload["exception"]["values"][0]
            exc_type = exc.get("type", exc_type)
            exc_value = exc.get("value", exc_value)
        elif "message" in event_payload:
            exc_type = "Message"
            exc_value = event_payload["message"]

        fingerprint = f"{exc_type}:{exc_value}"
        issue_id = hashlib.md5(fingerprint.encode()).hexdigest()[:12]
        now = time.time()

        if issue_id not in db:
            db[issue_id] = {"type": exc_type, "value": exc_value, "timestamps": []}

        db[issue_id]["timestamps"].append(now)
        db[issue_id]["latest_event"] = event_payload
        db[issue_id]["last_seen"] = now

    return {"id": event_payload.get("event_id", "ignored") if event_payload else "ok"}


# --- UI: SHADCN ТЕМПЛЕЙТЫ ---

# Базовый HTML с подключением Tailwind, шрифта Inter и иконок Lucide
def render_page(title: str, content: str) -> str:
    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{title}</title>
        <!-- Font Inter -->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <!-- Tailwind CSS & Lucide Icons -->
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://unpkg.com/lucide@latest"></script>
        <style>
            :root {{
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
            }}
            body {{ font-family: 'Inter', sans-serif; }}
        </style>
        <script>
            tailwind.config = {{
                theme: {{
                    extend: {{
                        colors: {{
                            border: "hsl(var(--border))",
                            background: "hsl(var(--background))",
                            foreground: "hsl(var(--foreground))",
                            primary: {{ DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" }},
                            muted: {{ DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" }},
                            card: {{ DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" }},
                            destructive: {{ DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" }},
                        }},
                        borderRadius: {{ lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" }}
                    }}
                }}
            }}
        </script>
    </head>
    <body class="bg-background text-foreground min-h-screen antialiased flex flex-col">
        <!-- Header -->
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

        <!-- Main Content -->
        <main class="flex-1 container mx-auto px-6 py-8">
            {content}
        </main>

        <script>
            // Инициализация иконок
            lucide.createIcons();
        </script>
    </body>
    </html>
    """


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    if not db:
        content = """
        <div class="flex flex-col items-center justify-center h-64 border border-dashed border-border rounded-lg bg-muted/20">
            <i data-lucide="inbox" class="w-10 h-10 text-muted-foreground mb-4"></i>
            <h3 class="font-semibold text-lg">No issues found</h3>
            <p class="text-muted-foreground text-sm mt-1">Waiting for SDK to send events...</p>
        </div>
        """
        return render_page("Dashboard - Micro Sentry", content)

    sorted_issues = sorted(db.items(), key=lambda x: x[1]["last_seen"], reverse=True)

    # Стилизация списка под shadcn Table/Card
    content = """
    <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold tracking-tight">Issues</h1>
        <span class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold bg-muted/50 text-muted-foreground">
            Last 24 hours
        </span>
    </div>
    <div class="rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden">
        <div class="flex flex-col">
    """

    for i, (issue_id, data) in enumerate(sorted_issues):
        count = len(data["timestamps"])
        last_seen_dt = datetime.fromtimestamp(data["last_seen"]).strftime("%H:%M, %b %d")
        border_class = "border-b border-border" if i < len(sorted_issues) - 1 else ""

        content += f"""
        <a href="/issue/{issue_id}" class="flex items-start justify-between p-4 hover:bg-muted/50 transition-colors {border_class} group">
            <div class="flex gap-4">
                <div class="mt-1">
                    <i data-lucide="alert-circle" class="w-5 h-5 text-destructive"></i>
                </div>
                <div>
                    <div class="font-semibold text-primary group-hover:underline decoration-muted-foreground/50 underline-offset-4">{data['type']}</div>
                    <div class="text-sm text-muted-foreground mt-1 font-mono line-clamp-1">{data['value']}</div>
                </div>
            </div>
            <div class="flex flex-col items-end gap-2 shrink-0 ml-4">
                <div class="flex items-center gap-1 bg-destructive/10 text-destructive text-xs font-medium px-2 py-0.5 rounded-full">
                    <i data-lucide="trending-up" class="w-3 h-3"></i>
                    {count} events
                </div>
                <div class="text-xs text-muted-foreground flex items-center gap-1">
                    <i data-lucide="clock" class="w-3 h-3"></i> {last_seen_dt}
                </div>
            </div>
        </a>
        """
    content += "</div></div>"
    return render_page("Dashboard - Micro Sentry", content)


@app.get("/issue/{issue_id}", response_class=HTMLResponse)
async def issue_details(issue_id: str):
    if issue_id not in db:
        return HTMLResponse("Issue not found", status_code=404)

    data = db[issue_id]
    latest = data["latest_event"]
    platform = latest.get("platform", "unknown")

    # Шапка (Header Card)
    content = f"""
    <div class="mb-6 flex items-center text-sm text-muted-foreground">
        <a href="/" class="hover:text-foreground transition-colors flex items-center gap-1">
            <i data-lucide="arrow-left" class="w-4 h-4"></i> Back to issues
        </a>
    </div>

    <div class="rounded-lg border border-border bg-card shadow-sm mb-6">
        <div class="p-6">
            <div class="flex justify-between items-start mb-4">
                <div class="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold bg-muted/50 text-foreground capitalize">
                    {platform}
                </div>
                <div class="text-sm text-muted-foreground">ID: {issue_id}</div>
            </div>
            <h1 class="text-3xl font-bold tracking-tight text-destructive mb-2">{data['type']}</h1>
            <p class="font-mono text-sm bg-muted/50 p-3 rounded-md border border-border">{data['value']}</p>
        </div>
    </div>
    """

    # Stacktrace
    try:
        frames = latest["exception"]["values"][0]["stacktrace"]["frames"]
        content += """
        <h3 class="text-lg font-semibold tracking-tight mb-4 flex items-center gap-2">
            <i data-lucide="code-2" class="w-5 h-5"></i> Stacktrace
        </h3>
        <div class="rounded-lg border border-border bg-[#0d1117] overflow-hidden mb-8 shadow-sm">
        """

        for frame in reversed(frames):
            filename = frame.get("filename", "unknown file")
            func = frame.get("function", "<module>")
            lineno = frame.get("lineno", "?")

            content += f"""
            <div class="bg-[#161b22] border-b border-[#30363d] px-4 py-2 flex justify-between items-center text-xs font-mono text-[#8b949e]">
                <span>{filename} in <span class="text-[#d2a8ff]">{func}</span></span>
                <span>line {lineno}</span>
            </div>
            <div class="font-mono text-sm text-[#e6edf3] py-2 overflow-x-auto">
            """

            pre_context = frame.get("pre_context", [])
            context_line = frame.get("context_line")
            post_context = frame.get("post_context", [])

            if context_line:
                try:
                    lineno_int = int(lineno)
                except (TypeError, ValueError):
                    lineno_int = None

                for i, line in enumerate(pre_context):
                    ln = (
                        str(lineno_int - len(pre_context) + i)
                        if lineno_int is not None
                        else ""
                    )
                    content += f'<div class="flex px-4 hover:bg-[#161b22]"><div class="w-10 text-right pr-4 text-[#6e7681] select-none">{ln}</div><div class="whitespace-pre">{line}</div></div>'

                content += f'<div class="flex px-4 bg-[#f8514926] border-l-2 border-[#f85149]"><div class="w-10 text-right pr-4 text-[#6e7681] select-none">{lineno}</div><div class="whitespace-pre">{context_line}</div></div>'

                for i, line in enumerate(post_context):
                    ln = str(lineno_int + i + 1) if lineno_int is not None else ""
                    content += f'<div class="flex px-4 hover:bg-[#161b22]"><div class="w-10 text-right pr-4 text-[#6e7681] select-none">{ln}</div><div class="whitespace-pre">{line}</div></div>'

            content += "</div>"
        content += "</div>"
    except KeyError:
        pass  # Нет stacktrace

    # Теги (Tags)
    tags = latest.get("tags", {})
    if tags:
        content += """
        <h3 class="text-lg font-semibold tracking-tight mb-4 flex items-center gap-2">
            <i data-lucide="tags" class="w-5 h-5"></i> Tags
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        """
        items = tags.items() if isinstance(tags, dict) else [t for t in tags if len(t) == 2]
        for k, v in items:
            content += f"""
            <div class="rounded-lg border border-border bg-card p-3 shadow-sm">
                <div class="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">{k}</div>
                <div class="text-sm font-medium truncate" title="{v}">{v}</div>
            </div>
            """
        content += "</div>"

    return render_page(f"{data['type']} - Micro Sentry", content)

