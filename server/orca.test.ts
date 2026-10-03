import { expect, test } from "bun:test";
import { looksLikeDialog } from "../shared/terminal.ts";

const promptBox = [
  "⏺ All 14 tests pass.",
  "",
  "────────────────────────────────",
  "❯ ",
  "────────────────────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
];

test("an empty prompt box is safe to type into", () => {
  expect(looksLikeDialog(promptBox)).toBe(false);
  expect(looksLikeDialog([...promptBox.slice(0, 3), "❯ fix the 2. item in the list", ...promptBox.slice(4)])).toBe(false);
});

test("a permission prompt is recognized, since Enter there would approve it", () => {
  const screen = [
    "Bash command",
    "  rm -rf node_modules",
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. Yes, and don't ask again for rm commands",
    "  3. No, and tell Claude what to do differently (esc)",
  ];
  expect(looksLikeDialog(screen)).toBe(true);
});

test("a question menu is recognized", () => {
  const screen = ["Which library should we use?", "❯ 1. date-fns", "  2. dayjs", "Enter to select · ↑/↓ to navigate · Esc to cancel"];
  expect(looksLikeDialog(screen)).toBe(true);
});

test("a dialog that has scrolled far up the screen no longer counts", () => {
  const old = ["Do you want to proceed?", "❯ 1. Yes", ...Array.from({ length: 30 }, (_, i) => `output line ${i}`), ...promptBox];
  expect(looksLikeDialog(old)).toBe(false);
});
