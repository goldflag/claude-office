// Adds or removes the Claude Code hooks that report permission prompts to the
// office server. Usage: bun scripts/hooks.ts install | uninstall
//
// Only entries tagged with HOOK_MARKER are ever touched, and settings.json is
// backed up before each change.

import { copyFile, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { HOOK_MARKER } from "../server/office.ts";
import { DEFAULT_PORT } from "../shared/types.ts";

const SETTINGS = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");

// PermissionRequest and Notification raise "needs you"; the rest clear it.
const EVENTS: { name: string; perTool: boolean }[] = [
  { name: "PermissionRequest", perTool: true },
  { name: "Notification", perTool: false },
  { name: "PostToolUse", perTool: true },
  { name: "PostToolUseFailure", perTool: true },
  { name: "UserPromptSubmit", perTool: false },
  { name: "Stop", perTool: false },
];

// Fails silently and fast when the office is not running, and prints nothing,
// so it can never block a session or leak text into a prompt.
const COMMAND =
  `curl -s -o /dev/null --connect-timeout 0.3 -m 1 -X POST -H 'Content-Type: application/json' ` +
  `--data-binary @- "http://127.0.0.1:\${CLAUDE_OFFICE_PORT:-${DEFAULT_PORT}}/hook" 2>/dev/null || true # ${HOOK_MARKER}`;

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] };

const isOurs = (entry: HookEntry) => entry.hooks?.some((h) => h.command?.includes(HOOK_MARKER)) ?? false;

const action = process.argv[2];
if (action !== "install" && action !== "uninstall") {
  console.error("Usage: bun scripts/hooks.ts install | uninstall");
  process.exit(1);
}

let raw: string;
try {
  raw = await readFile(SETTINGS, "utf8");
} catch {
  raw = "{}";
}

let settings: { hooks?: Record<string, HookEntry[]> };
try {
  settings = JSON.parse(raw);
} catch (err) {
  console.error(`${SETTINGS} is not valid JSON, so nothing was changed: ${(err as Error).message}`);
  process.exit(1);
}

const hooks = (settings.hooks ??= {});
let changed = 0;

for (const event of EVENTS) {
  const entries = hooks[event.name] ?? [];
  const kept = entries.filter((e) => !isOurs(e));
  if (action === "install") {
    kept.push({
      ...(event.perTool ? { matcher: "*" } : {}),
      hooks: [{ type: "command", command: COMMAND, timeout: 2 }],
    });
    if (!entries.some(isOurs)) changed++;
  } else if (kept.length !== entries.length) {
    changed++;
  }
  if (kept.length > 0) hooks[event.name] = kept;
  else delete hooks[event.name];
}
if (Object.keys(hooks).length === 0) delete settings.hooks;

if (changed === 0) {
  console.log(action === "install" ? "The office hooks are already installed." : "No office hooks were installed.");
  process.exit(0);
}

if (raw !== "{}") {
  const backup = `${SETTINGS}.before-office-${action}`;
  await copyFile(SETTINGS, backup);
  console.log(`Backed up your settings to ${backup}`);
}
await writeFile(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
console.log(
  action === "install"
    ? `Installed office hooks for ${changed} events in ${SETTINGS}. New Claude Code sessions pick them up.`
    : `Removed the office hooks for ${changed} events from ${SETTINGS}.`,
);
