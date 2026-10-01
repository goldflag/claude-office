import { join, normalize } from "node:path";
import type { ServerWebSocket } from "bun";
import index from "../src/index.html";
import { DEFAULT_PORT, type OfficeSnapshot, type ServerMessage } from "../shared/types.ts";
import { Office } from "./office.ts";

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const TOPIC = "office";

const office = new Office();
office.start();

const message = (data: OfficeSnapshot): string => JSON.stringify({ type: "snapshot", data } satisfies ServerMessage);

/** Transcript snippets are private, so only pages served from this server may read them. */
function isLocal(req: Request): boolean {
  const allowed = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
  if (!allowed.has(req.headers.get("host") ?? "")) return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return allowed.has(new URL(origin).host);
  } catch {
    return false;
  }
}

const forbidden = () => new Response("forbidden", { status: 403 });

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  routes: {
    "/": index,
    "/api/snapshot": (req) => (isLocal(req) ? Response.json(office.current) : forbidden()),
    "/hook": {
      POST: async (req) => {
        if (!isLocal(req)) return forbidden();
        try {
          office.onHook(await req.json());
        } catch {
          // A malformed hook payload must never fail the hook that sent it.
        }
        return new Response(null, { status: 204 });
      },
    },
    "/ws": (req, server) => {
      if (!isLocal(req)) return forbidden();
      return server.upgrade(req) ? undefined : new Response("expected websocket", { status: 400 });
    },
    "/models/*": async (req) => {
      const rel = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^\/+/, "");
      const file = Bun.file(join(PUBLIC_DIR, rel));
      if (!rel.startsWith("models/") || !(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "cache-control": "no-cache" } });
    },
  },
  websocket: {
    open(ws: ServerWebSocket) {
      ws.subscribe(TOPIC);
      ws.send(message(office.current));
    },
    message() {},
  },
});

office.subscribe((snap) => server.publish(TOPIC, message(snap)));

console.log(`Claude Office is open at http://localhost:${PORT}`);
