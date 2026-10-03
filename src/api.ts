import type { SendResult, TerminalView } from "../shared/types.ts";

export const isDemo = new URLSearchParams(location.search).has("demo");

type Reply<T> = { ok: true; result: T } | { ok: false; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let reply: Reply<T>;
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", "x-claude-office": "1" },
    });
    reply = (await res.json()) as Reply<T>;
  } catch {
    throw new Error("The office server did not answer. Check that it is still running.");
  }
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO_SCREEN = [
  "⏺ Bash(bun test checkout)",
  "  ⎿  14 pass, 0 fail",
  "",
  "⏺ The retry path no longer double-charges. I added a test that times out",
  "  the first attempt and checks that only one charge is created.",
  "",
  "────────────────────────────────────────────────────────────",
  "❯ ",
  "────────────────────────────────────────────────────────────",
  "  ⏵⏵ auto mode on",
];

/** Types a message into the agent's terminal as a new prompt. */
export async function sendMessage(id: string, text: string): Promise<SendResult> {
  if (isDemo) {
    await pause(500);
    return { started: true };
  }
  return call<SendResult>(`/api/agents/${id}/message`, { method: "POST", body: JSON.stringify({ text }) });
}

/** Brings the agent's terminal to the front in Orca. */
export async function openInOrca(id: string): Promise<void> {
  if (isDemo) return;
  await call<null>(`/api/agents/${id}/focus`, { method: "POST" });
}

export async function readTerminal(id: string): Promise<TerminalView> {
  if (isDemo) return { lines: DEMO_SCREEN };
  return call<TerminalView>(`/api/agents/${id}/terminal`);
}
