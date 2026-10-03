import type { FloorStyle, WallStyle } from "./themes.ts";

// Seamless patterns painted on canvases, each covering 2 × 2 world units.

const PX = 256;

/** Deterministic random numbers, so a theme's floor looks the same every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = PX;
  return [c, c.getContext("2d")!];
}

/** Planks running along X, `rows` per 2 units, seams staggered and wrapped so the tile repeats. */
function planks(c: CanvasRenderingContext2D, rows: number, colors: string[], seam: string, rand: () => number, nails: boolean) {
  const h = PX / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rand() * PX * 0.5;
    while (x < PX) {
      const len = PX * (0.45 + rand() * 0.5);
      c.fillStyle = colors[Math.floor(rand() * colors.length)]!;
      for (const dx of [0, PX]) c.fillRect(x + dx, r * h, len, h);
      // A little grain.
      c.strokeStyle = "rgba(0,0,0,0.05)";
      c.lineWidth = 1;
      for (let g = 0; g < 2; g++) {
        const gy = r * h + h * (0.3 + rand() * 0.4);
        c.beginPath();
        c.moveTo(x + 4, gy);
        c.lineTo(x + len - 4, gy + (rand() - 0.5) * 2);
        c.stroke();
      }
      c.fillStyle = seam;
      for (const dx of [0, PX]) c.fillRect(x + len + dx - 1, r * h, 2, h);
      if (nails) {
        c.fillStyle = "rgba(0,0,0,0.18)";
        for (const dx of [0, PX]) {
          c.fillRect(x + dx + 5, r * h + h * 0.3, 2, 2);
          c.fillRect(x + dx + 5, r * h + h * 0.65, 2, 2);
        }
      }
      x += len;
    }
    c.fillStyle = seam;
    c.fillRect(0, r * h, PX, 1.5);
  }
}

export function paintFloor(style: FloorStyle, colors: string[], seam: string): HTMLCanvasElement {
  const [cv, c] = canvas();
  const rand = rng(style.length * 977 + 13);
  switch (style) {
    case "check": {
      c.fillStyle = colors[0]!;
      c.fillRect(0, 0, PX, PX);
      c.fillStyle = colors[1]!;
      c.fillRect(0, 0, PX / 2, PX / 2);
      c.fillRect(PX / 2, PX / 2, PX / 2, PX / 2);
      break;
    }
    case "terracotta": {
      const n = 4;
      const s = PX / n;
      c.fillStyle = seam;
      c.fillRect(0, 0, PX, PX);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          c.fillStyle = colors[Math.floor(rand() * colors.length)]!;
          c.beginPath();
          c.roundRect(i * s + 2.5, j * s + 2.5, s - 5, s - 5, 4);
          c.fill();
          c.fillStyle = "rgba(255,255,255,0.08)";
          c.fillRect(i * s + 6, j * s + 6, s - 12, 4);
        }
      }
      break;
    }
    case "planks":
      planks(c, 8, colors, seam, rand, false);
      break;
    case "deck":
      planks(c, 6, colors, seam, rand, true);
      break;
    case "plating": {
      const s = PX / 2;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          c.fillStyle = colors[(i + j) % colors.length]!;
          c.fillRect(i * s, j * s, s, s);
          // Raised grip dots on every panel.
          c.fillStyle = "rgba(255,255,255,0.05)";
          for (let y = 10; y < s - 6; y += 12) {
            for (let x = 10 + ((y / 12) % 2) * 6; x < s - 6; x += 12) c.fillRect(i * s + x, j * s + y, 3, 3);
          }
          c.fillStyle = "rgba(255,255,255,0.22)";
          for (const [x, y] of [
            [7, 7],
            [s - 9, 7],
            [7, s - 9],
            [s - 9, s - 9],
          ] as const) {
            c.beginPath();
            c.arc(i * s + x + 1, j * s + y + 1, 2.2, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
      c.fillStyle = seam;
      for (const p of [0, s]) {
        c.fillRect(p - 1.5, 0, 3, PX);
        c.fillRect(0, p - 1.5, PX, 3);
      }
      c.fillRect(PX - 1.5, 0, 1.5, PX);
      c.fillRect(0, PX - 1.5, PX, 1.5);
      break;
    }
  }
  return cv;
}

export function paintWall(style: WallStyle, color: string, accent: string): HTMLCanvasElement | null {
  if (style === "plain") return null;
  const [cv, c] = canvas();
  const rand = rng(style.length * 131 + 7);
  c.fillStyle = color;
  c.fillRect(0, 0, PX, PX);
  switch (style) {
    case "trellis": {
      // A white garden lattice, diamonds half a unit across.
      c.strokeStyle = accent;
      c.globalAlpha = 0.85;
      c.lineWidth = 5;
      const step = PX / 4;
      for (let k = -4; k <= 8; k++) {
        c.beginPath();
        c.moveTo(k * step, 0);
        c.lineTo(k * step + PX, PX);
        c.stroke();
        c.beginPath();
        c.moveTo(k * step, PX);
        c.lineTo(k * step + PX, 0);
        c.stroke();
      }
      c.globalAlpha = 1;
      break;
    }
    case "logs": {
      const rows = 8;
      const h = PX / rows;
      for (let r = 0; r < rows; r++) {
        const g = c.createLinearGradient(0, r * h, 0, (r + 1) * h);
        g.addColorStop(0, accent);
        g.addColorStop(0.35, color);
        g.addColorStop(0.7, color);
        g.addColorStop(1, accent);
        c.fillStyle = g;
        c.fillRect(0, r * h, PX, h);
        c.fillStyle = "rgba(60,35,15,0.55)";
        c.fillRect(0, (r + 1) * h - 2, PX, 2);
        // The odd knot.
        if (rand() > 0.4) {
          const x = rand() * PX;
          c.strokeStyle = "rgba(90,55,25,0.35)";
          c.lineWidth = 1.5;
          c.beginPath();
          c.ellipse(x, r * h + h / 2, 5, 3, 0, 0, Math.PI * 2);
          c.stroke();
        }
      }
      break;
    }
    case "shiplap": {
      const rows = 10;
      const h = PX / rows;
      for (let r = 0; r < rows; r++) {
        c.fillStyle = "rgba(0,0,0,0.08)";
        c.fillRect(0, r * h, PX, 2);
        c.fillStyle = "rgba(255,255,255,0.5)";
        c.fillRect(0, r * h + 2, PX, 1);
      }
      break;
    }
    case "panels": {
      const s = PX / 2;
      for (let i = 0; i < 2; i++) {
        c.fillStyle = i % 2 ? accent : color;
        c.fillRect(i * s + 3, 3, s - 6, PX - 6);
        c.fillStyle = "rgba(255,255,255,0.06)";
        c.fillRect(i * s + 14, 30, s - 28, 50);
        c.fillStyle = "rgba(0,0,0,0.25)";
        c.fillRect(i * s + 14, PX - 70, s - 28, 3);
        c.fillRect(i * s + 14, PX - 60, s - 28, 3);
      }
      c.fillStyle = "rgba(0,0,0,0.4)";
      c.fillRect(0, 0, PX, 3);
      for (const x of [0, s]) c.fillRect(x, 0, 3, PX);
      break;
    }
  }
  return cv;
}

export type WainscotStyle = "plain" | "brick" | "stone" | "beadboard" | "plate";

export function paintWainscot(style: WainscotStyle, color: string): HTMLCanvasElement | null {
  if (style === "plain") return null;
  const [cv, c] = canvas();
  const rand = rng(style.length * 53 + 3);
  c.fillStyle = color;
  c.fillRect(0, 0, PX, PX);
  const shade = (k: number) => `rgba(${k > 0 ? "255,255,255" : "0,0,0"},${Math.abs(k)})`;
  switch (style) {
    case "brick": {
      const rows = 8;
      const h = PX / rows;
      const w = PX / 4;
      for (let r = 0; r < rows; r++) {
        for (let i = -1; i < 5; i++) {
          const x = i * w + (r % 2) * (w / 2);
          c.fillStyle = shade((rand() - 0.5) * 0.16);
          c.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        }
        c.fillStyle = "rgba(255,240,225,0.55)";
        c.fillRect(0, r * h, PX, 2);
        for (let i = 0; i < 5; i++) c.fillRect(i * w + (r % 2) * (w / 2), r * h, 2, h);
      }
      break;
    }
    case "stone": {
      const rows = 4;
      const h = PX / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rand() * 40;
        while (x < PX) {
          const w = 40 + rand() * 50;
          c.fillStyle = shade((rand() - 0.5) * 0.22);
          for (const dx of [0, PX]) {
            c.beginPath();
            c.roundRect(x + dx + 2, r * h + 2, w - 4, h - 4, 10);
            c.fill();
          }
          x += w;
        }
        c.fillStyle = "rgba(0,0,0,0.2)";
        c.fillRect(0, r * h, PX, 2);
      }
      break;
    }
    case "beadboard": {
      for (let x = 0; x < PX; x += PX / 16) {
        c.fillStyle = "rgba(0,0,0,0.16)";
        c.fillRect(x, 0, 2, PX);
        c.fillStyle = "rgba(255,255,255,0.12)";
        c.fillRect(x + 2, 0, 1, PX);
      }
      break;
    }
    case "plate": {
      c.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 2; i++) c.fillRect(i * (PX / 2) + 4, 4, PX / 2 - 8, PX - 8);
      c.fillStyle = "rgba(255,210,80,0.5)";
      for (let x = -PX; x < PX * 2; x += 36) {
        c.beginPath();
        c.moveTo(x, PX);
        c.lineTo(x + 18, PX);
        c.lineTo(x + 18 + 40, PX - 40);
        c.lineTo(x + 40, PX - 40);
        c.fill();
      }
      c.fillStyle = "rgba(0,0,0,0.3)";
      c.fillRect(0, PX - 42, PX, 2);
      break;
    }
  }
  return cv;
}
