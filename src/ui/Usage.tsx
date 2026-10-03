import type { LimitUsage, UsageSnapshot } from "../../shared/types.ts";
import { ago, tokens } from "../describe.ts";
import { useNow } from "./useNow.ts";

function Meter({ label, limit, now }: { label: string; limit: LimitUsage; now: number }) {
  const percent = Math.round(limit.percent);
  const level = percent >= 90 ? "high" : percent >= 70 ? "warn" : "ok";
  return (
    <div className="meter" data-level={level}>
      <div className="meter-row">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{percent}%</span>
        {limit.resetsAt && (
          <span className="meter-reset">{limit.resetsAt > now ? `resets in ${ago(now, limit.resetsAt)}` : "resetting"}</span>
        )}
      </div>
      <div
        className="meter-track"
        role="progressbar"
        aria-label={`${label} limit used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="meter-fill" style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

/** How much of Claude Code's plan is used, and what that came to in tokens. */
export function Usage({ usage }: { usage: UsageSnapshot | undefined }) {
  const now = useNow(30_000);
  if (!usage) return null;
  const { limits, tokens: counted } = usage;

  return (
    <section className="usage" aria-label="Claude Code usage">
      <p className="usage-title">Claude Code usage</p>
      {limits?.fiveHour && <Meter label="5-hour" limit={limits.fiveHour} now={now} />}
      {limits?.sevenDay && <Meter label="Week" limit={limits.sevenDay} now={now} />}
      <p className="usage-tokens" title="Tokens sent and received, counted from your session files. Cache reads are not included.">
        {counted ? (
          <>
            <b>{tokens(counted.fiveHours)}</b> in 5h · <b>{tokens(counted.today)}</b> today · <b>{tokens(counted.week)}</b> in 7d
          </>
        ) : (
          "Counting tokens…"
        )}
      </p>
    </section>
  );
}
