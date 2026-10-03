import { useEffect, useRef, useState } from "react";
import { THEMES, type ThemeId } from "../scene/themes.ts";

function Swatch({ colors }: { colors: [string, string, string] }) {
  return (
    <span className="swatch" aria-hidden="true">
      {colors.map((c) => (
        <span key={c} style={{ background: c }} />
      ))}
    </span>
  );
}

/** A button naming the office's theme, opening a menu of the others. */
export function ThemePicker({ theme, onChange }: { theme: ThemeId; onChange(id: ThemeId): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Esc closes the menu before it reaches the office, which would close the popover.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".theme-button")?.focus();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={root}>
      <button
        className="plain-button theme-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Swatch colors={current.swatch} />
        {current.name}
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Office theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === theme}
              onClick={() => {
                onChange(t.id);
                setOpen(false);
              }}
            >
              <Swatch colors={t.swatch} />
              <span className="theme-name">{t.name}</span>
              <span className="theme-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
