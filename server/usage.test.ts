import { expect, test } from "bun:test";
import { applyUsageLine, countTokens, parseLimits, totalTokens } from "./usage.ts";

const line = (id: string, at: string, usage: object, type = "assistant") =>
  JSON.stringify({ type, timestamp: at, message: { id, usage } });

test("tokens are what was sent and received, without cache reads", () => {
  expect(countTokens({ input_tokens: 2, output_tokens: 193, cache_creation_input_tokens: 21410, cache_read_input_tokens: 25166 })).toBe(21605);
  expect(countTokens(undefined)).toBe(0);
});

test("a message streamed in several updates is counted once, at its last size", () => {
  const messages = new Map();
  const at = "2026-10-03T08:00:00Z";
  applyUsageLine(messages, line("m1", at, { input_tokens: 10, output_tokens: 5 }));
  applyUsageLine(messages, line("m1", at, { input_tokens: 10, output_tokens: 90 }));
  applyUsageLine(messages, line("m2", at, { input_tokens: 1, output_tokens: 1 }, "user"));
  applyUsageLine(messages, "not json but it says \"usage\" and \"assistant\"");
  expect([...messages.values()].map((m) => m.tokens)).toEqual([100]);
});

test("windows slide, and a message copied into a resumed session's file is not counted twice", () => {
  const now = Date.parse("2026-10-03T12:00:00");
  const msg = (hoursAgo: number, tokens: number) => ({ at: now - hoursAgo * 3600_000, tokens });
  const a = { offset: 0, carry: "", messages: new Map([["m1", msg(1, 100)], ["m2", msg(30, 1000)], ["m3", msg(24 * 8, 5)]]) };
  const b = { offset: 0, carry: "", messages: new Map([["m1", msg(1, 100)]]) };
  const total = totalTokens([a, b], now);
  expect(total.fiveHours).toBe(100);
  expect(total.week).toBe(1100);
  expect(total.today).toBe(100);
});

test("plan limits are read from the usage reply, and an empty reply is no reading", () => {
  const limits = parseLimits({
    five_hour: { utilization: 28, resets_at: "2026-10-03T13:00:00.449451+00:00" },
    seven_day: { utilization: 130, resets_at: null },
    seven_day_opus: null,
  });
  expect(limits?.fiveHour).toEqual({ percent: 28, resetsAt: Date.parse("2026-10-03T13:00:00.449451+00:00") });
  expect(limits?.sevenDay).toEqual({ percent: 100, resetsAt: null });
  expect(parseLimits({ five_hour: null, seven_day: null })).toBeNull();
  expect(parseLimits(null)).toBeNull();
});
