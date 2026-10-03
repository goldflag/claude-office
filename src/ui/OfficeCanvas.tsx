import { type RefObject, useEffect, useRef, useState } from "react";
import type { OfficeSnapshot } from "../../shared/types.ts";
import { OfficeScene, type TimeMode } from "../scene/Office.ts";
import type { ThemeId } from "../scene/themes.ts";

interface Props {
  snapshot: OfficeSnapshot | null;
  timeMode: TimeMode;
  theme: ThemeId;
  sceneRef: RefObject<OfficeScene | null>;
  /** True while something covers the whole office, so it need not be drawn. */
  paused: boolean;
  /** Whether the roster board covers part of the view. */
  board: boolean;
  onSelect(id: string | null): void;
}

/** Mounts the three.js office and feeds it snapshots. */
export function OfficeCanvas({ snapshot, timeMode, theme, sceneRef, paused, board, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ snapshot, timeMode, theme, paused, onSelect });
  latest.current = { snapshot, timeMode, theme, paused, onSelect };
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let scene: OfficeScene | null = null;
    OfficeScene.create(host.current!, { onSelect: (id) => latest.current.onSelect(id), board, theme: latest.current.theme })
      .then((created) => {
        if (cancelled) return created.dispose();
        scene = created;
        sceneRef.current = created;
        created.setTimeMode(latest.current.timeMode);
        created.setTheme(latest.current.theme);
        created.setPaused(latest.current.paused);
        if (latest.current.snapshot) created.setSnapshot(latest.current.snapshot);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [sceneRef, board]);

  useEffect(() => {
    if (snapshot) sceneRef.current?.setSnapshot(snapshot);
  }, [snapshot, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setTimeMode(timeMode);
  }, [timeMode, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setTheme(theme);
  }, [theme, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setPaused(paused);
  }, [paused, sceneRef]);

  return (
    <div ref={host} className="office" role="img" aria-label="3D office showing each Claude agent at a desk">
      {error && (
        <div className="notice" role="alert">
          The 3D office could not start: {error}. Try a recent Chrome, Edge or Safari.
        </div>
      )}
    </div>
  );
}
