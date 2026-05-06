type Env = {};

type ProjectInfo = {
  id: string; // 5-digit numeric string
  name: string;
  created_at: string; // ISO
};

const NAME_PREFIX = "name:";
const ID_PREFIX = "id:";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

function random5(): string {
  // 10000..99999
  const n = 10000 + Math.floor(Math.random() * 90000);
  return String(n);
}

export class ProjectRegistry implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "POST" && pathname === "/create") {
      return this.create(url);
    }

    if (request.method === "GET" && pathname === "/lookup") {
      const name = url.searchParams.get("name");
      if (!name) return json({ error: "missing name" }, { status: 400 });
      return this.lookupByName(name);
    }

    return json({ error: "not found" }, { status: 404 });
  }

  private async lookupByName(nameRaw: string): Promise<Response> {
    const name = normalizeName(nameRaw);
    const existingId = (await this.state.storage.get<string>(`${NAME_PREFIX}${name}`)) ?? null;
    if (!existingId) return json({ project: null });
    const info = (await this.state.storage.get<ProjectInfo>(`${ID_PREFIX}${existingId}`)) ?? null;
    return json({ project: info });
  }

  private async create(url: URL): Promise<Response> {
    const nameRaw = url.searchParams.get("name") ?? "";
    const name = normalizeName(nameRaw);
    if (!name) return json({ error: "empty name" }, { status: 400 });

    // If already exists, return it (idempotent).
    const existingId = (await this.state.storage.get<string>(`${NAME_PREFIX}${name}`)) ?? null;
    if (existingId) {
      const info = (await this.state.storage.get<ProjectInfo>(`${ID_PREFIX}${existingId}`)) ?? null;
      return json({ project: info });
    }

    // Try a few times to avoid collisions.
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = random5();
      const idKey = `${ID_PREFIX}${id}`;
      const taken = await this.state.storage.get(idKey);
      if (taken) continue;

      const info: ProjectInfo = { id, name, created_at: nowIso() };

      // Atomicity: best-effort with SQLite DO; collisions are extremely unlikely after checks.
      await this.state.storage.put(idKey, info);
      await this.state.storage.put(`${NAME_PREFIX}${name}`, id);

      return json({ project: info });
    }

    return json({ error: "failed to allocate id" }, { status: 500 });
  }
}

