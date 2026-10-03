// The one binary inside the menu bar app. It is the office server, or the hook
// installer when OFFICE_TASK=hooks, so the app carries a single Bun runtime.
if (process.env.OFFICE_TASK === "hooks") await import("../scripts/hooks.ts");
else await import("../server/index.ts");
