import { expect, test } from "bun:test";
import { inferNeedsYou, toolActivity } from "./office.ts";
import { applyRecord, emptyState, summarizeTool } from "./transcript.ts";

const at = (s: number) => new Date(1_790_000_000_000 + s * 1000).toISOString();

const assistant = (s: number, content: unknown[], stop = "tool_use") => ({
  type: "assistant",
  timestamp: at(s),
  message: { model: "claude-opus-5-5", stop_reason: stop, usage: { input_tokens: 10, cache_read_input_tokens: 990 }, content },
});

const result = (s: number, id: string, isError = false) => ({
  type: "user",
  timestamp: at(s),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "boom" }] },
});

test("a tool call stays pending until its result arrives", () => {
  const state = emptyState();
  applyRecord(state, { type: "user", timestamp: at(0), message: { role: "user", content: "fix the tests" } }, { sidechain: false });
  applyRecord(state, assistant(1, [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "bun test" } }]), { sidechain: false });

  expect(state.lastPrompt).toBe("fix the tests");
  expect([...state.pending.keys()]).toEqual(["t1"]);
  expect(state.contextTokens).toBe(1000);
  expect(state.turnActive).toBe(true);

  applyRecord(state, result(4, "t1"), { sidechain: false });
  expect(state.pending.size).toBe(0);
  expect(state.lastTool?.call.name).toBe("Bash");
  expect(state.lastError).toBeNull();
});

test("a failed tool records an error and the turn ends on end_turn", () => {
  const state = emptyState();
  applyRecord(state, assistant(1, [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a/b/c.ts" } }]), { sidechain: false });
  applyRecord(state, result(2, "t1", true), { sidechain: false });
  expect(state.lastError).toBe(Date.parse(at(2)));
  expect(state.recent.at(-1)?.kind).toBe("error");

  applyRecord(state, assistant(3, [{ type: "text", text: "Done." }], "end_turn"), { sidechain: false });
  expect(state.turnActive).toBe(false);
});

test("subagent records are ignored by the main transcript and read by the subagent tail", () => {
  const record = { ...assistant(1, [{ type: "tool_use", id: "s1", name: "Grep", input: { pattern: "foo" } }]), isSidechain: true };
  const main = emptyState();
  applyRecord(main, record, { sidechain: false });
  expect(main.pending.size).toBe(0);

  const sub = emptyState();
  applyRecord(sub, record, { sidechain: true });
  expect(sub.pending.size).toBe(1);
});

test("harness-injected prompts do not replace the last thing you asked", () => {
  const state = emptyState();
  applyRecord(state, { type: "user", timestamp: at(0), message: { role: "user", content: "real question" } }, { sidechain: false });
  applyRecord(
    state,
    { type: "user", timestamp: at(1), message: { role: "user", content: "<task-notification>agent finished</task-notification>" } },
    { sidechain: false },
  );
  expect(state.lastPrompt).toBe("real question");
});

test("tools are summarized and mapped to an activity", () => {
  expect(summarizeTool("Edit", { file_path: "/repo/src/App.tsx" })).toBe("App.tsx");
  expect(summarizeTool("Bash", { command: "ls -la", description: "List files" })).toBe("List files");
  expect(summarizeTool("WebFetch", { url: "https://docs.stripe.com/api" })).toBe("docs.stripe.com");
  expect(toolActivity("Write")).toBe("writing");
  expect(toolActivity("Bash")).toBe("terminal");
  expect(toolActivity("Agent")).toBe("delegating");
  expect(toolActivity("mcp__blender__get_scene_info")).toBe("tool");
});

const pendingState = (...tools: [string, Record<string, unknown>][]) => {
  const state = emptyState();
  applyRecord(
    state,
    assistant(0, tools.map(([name, input], i) => ({ type: "tool_use", id: `t${i}`, name, input }))),
    { sidechain: false },
  );
  return state;
};
const later = (s: number) => Date.parse(at(s));
const noHooks = { hooksReporting: false, youngestShell: undefined };

test("an instant tool that has not returned is read as a permission prompt", () => {
  const state = pendingState(["Edit", { file_path: "/repo/a.ts" }]);
  expect(inferNeedsYou(state, later(1), noHooks)).toBeNull();
  expect(inferNeedsYou(state, later(5), noHooks)).toMatchObject({ reason: "permission", exact: false });
});

test("a Bash call is blocked only when no shell is running it", () => {
  const state = pendingState(["Bash", { command: "bun test" }]);
  expect(inferNeedsYou(state, later(60), { hooksReporting: false, youngestShell: 59 })).toBeNull();
  expect(inferNeedsYou(state, later(60), { hooksReporting: false, youngestShell: 4000 })).toMatchObject({ reason: "permission" });
  expect(inferNeedsYou(state, later(60), noHooks)).toMatchObject({ reason: "permission" });
});

test("calls queued behind a running command are not mistaken for prompts", () => {
  const state = pendingState(["Bash", { command: "sleep 60" }], ["Read", { file_path: "/repo/a.png" }]);
  expect(inferNeedsYou(state, later(30), { hooksReporting: false, youngestShell: 29 })).toBeNull();
});

test("questions are always reported, and hooks switch off the guessing", () => {
  expect(inferNeedsYou(pendingState(["AskUserQuestion", {}]), later(1), { hooksReporting: true, youngestShell: undefined })).toMatchObject({
    reason: "question",
    exact: true,
  });
  const edit = pendingState(["Edit", { file_path: "/repo/a.ts" }]);
  expect(inferNeedsYou(edit, later(30), { hooksReporting: true, youngestShell: undefined })).toBeNull();
});
