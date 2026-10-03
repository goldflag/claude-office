import * as THREE from "three/webgpu";
import { rng } from "./surfaces.ts";
import type { ViewId } from "./themes.ts";

// What the windows look out on: one wide panorama per theme, painted on a
// canvas a few times a second, with each window showing its own slice.

const W = 1024;
const H = 320;
const FPS = 10;

type Ctx = CanvasRenderingContext2D;
type Painter = (c: Ctx, t: number, n: number) => void;

const mixHex = (a: string, b: string, k: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;

/** Day to dusk to night, for skies that blush at sunset. */
const dusk = (day: string, eve: string, night: string, n: number) => (n < 0.5 ? mixHex(day, eve, n * 2) : mixHex(eve, night, (n - 0.5) * 2));

function sky(c: Ctx, top: string, bottom: string, to = H) {
  const g = c.createLinearGradient(0, 0, 0, to);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, W, to);
}

function glow(c: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.globalAlpha = alpha;
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.globalAlpha = 1;
}

function disc(c: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
}

const wrap = (x: number) => ((x % W) + W) % W;

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
}

function starfield(seed: number, count: number, maxY: number): Star[] {
  const rand = rng(seed);
  return Array.from({ length: count }, () => ({ x: rand() * W, y: rand() * maxY, r: 0.6 + rand() * 1.1, phase: rand() * 10 }));
}

function stars(c: Ctx, list: Star[], t: number, alpha: number) {
  if (alpha <= 0.01) return;
  c.fillStyle = "#FFFFFF";
  for (const s of list) {
    c.globalAlpha = alpha * (0.55 + 0.45 * Math.sin(t * 1.7 + s.phase));
    c.fillRect(s.x, s.y, s.r * 1.6, s.r * 1.6);
  }
  c.globalAlpha = 1;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  speed: number;
}

function cloudList(seed: number, count: number): Cloud[] {
  const rand = rng(seed);
  return Array.from({ length: count }, () => ({ x: rand() * W, y: 30 + rand() * 80, s: 0.7 + rand() * 0.7, speed: 4 + rand() * 6 }));
}

function clouds(c: Ctx, list: Cloud[], t: number, color: string, alpha: number) {
  if (alpha <= 0.01) return;
  c.globalAlpha = alpha;
  c.fillStyle = color;
  for (const cl of list) {
    const x = wrap(cl.x + t * cl.speed);
    for (const dx of [0, -W]) {
      const s = cl.s;
      c.beginPath();
      c.ellipse(x + dx, cl.y, 40 * s, 13 * s, 0, 0, Math.PI * 2);
      c.ellipse(x + dx - 18 * s, cl.y - 8 * s, 20 * s, 14 * s, 0, 0, Math.PI * 2);
      c.ellipse(x + dx + 14 * s, cl.y - 12 * s, 24 * s, 17 * s, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

/** A ridge line across the panorama, as a filled silhouette. */
function ridge(c: Ctx, seed: number, base: number, amp: number, color: string, jag = false) {
  const rand = rng(seed);
  const peaks = Array.from({ length: 9 }, () => rand());
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) {
    const u = (x / W) * 8;
    const i = Math.floor(u);
    const f = u - i;
    const a = peaks[i % 8]!;
    const b = peaks[(i + 1) % 8]!;
    const k = jag ? Math.abs(f - 0.5) * 2 : (1 - Math.cos(f * Math.PI)) / 2;
    const h = jag ? Math.max(a, b) * (1 - k) + Math.min(a, b) * k : a + (b - a) * k;
    c.lineTo(x, base - h * amp);
  }
  c.lineTo(W, H);
  c.fill();
}

// ------------------------------------------------------------------ painters

function city(): Painter {
  const sky1 = starfield(11, 70, 150);
  const cl = cloudList(12, 6);
  const rand = rng(13);
  const far = Array.from({ length: 30 }, (_, i) => ({ x: i * 36 + rand() * 10, w: 30 + rand() * 18, h: 50 + rand() * 70 }));
  const near = Array.from({ length: 18 }, (_, i) => ({
    x: i * 58 + rand() * 14,
    w: 44 + rand() * 20,
    h: 70 + rand() * 90,
    lit: Array.from({ length: 40 }, () => rand()),
  }));
  return (c, t, n) => {
    sky(c, mixHex("#8EC3EE", "#1A2150", n), mixHex("#E6F2FB", "#4C4F88", n));
    stars(c, sky1, t, n);
    disc(c, 800, 70, 26, "#FFE9A8", 1 - n);
    glow(c, 800, 70, 70, "rgba(255,240,190,0.7)", 1 - n);
    disc(c, 220, 60, 17, "#F4EED8", n);
    clouds(c, cl, t, "#FFFFFF", (1 - n) * 0.9);
    for (const b of far) {
      c.fillStyle = mixHex("#A9BED6", "#2D3468", n);
      c.fillRect(b.x, H - 60 - b.h, b.w, b.h + 60);
    }
    for (const b of near) {
      c.fillStyle = mixHex("#7F97B6", "#20274F", n);
      c.fillRect(b.x, H - 20 - b.h, b.w, b.h + 20);
      let k = 0;
      for (let y = H - b.h; y < H - 30; y += 14) {
        for (let x = b.x + 6; x < b.x + b.w - 8; x += 11) {
          const on = b.lit[k++ % b.lit.length]! > 0.45;
          c.fillStyle = on && n > 0.3 ? `rgba(255,214,120,${n})` : `rgba(255,255,255,${0.25 * (1 - n)})`;
          c.fillRect(x, y, 5, 7);
        }
      }
    }
    // A plane blinking across the night.
    if (n > 0.4) {
      const x = wrap(t * 22);
      disc(c, x, 40 + Math.sin(t * 0.3) * 6, 2, Math.sin(t * 6) > 0 ? "#FF6B6B" : "#FFFFFF", n);
    }
    c.fillStyle = mixHex("#8DB07E", "#22304A", n);
    c.fillRect(0, H - 22, W, 22);
  };
}

function garden(): Painter {
  const sk = starfield(21, 60, 140);
  const cl = cloudList(22, 5);
  const rand = rng(23);
  const trees = Array.from({ length: 14 }, () => ({ x: rand() * W, s: 0.7 + rand() * 0.7, far: rand() > 0.5 }));
  const flowers = Array.from({ length: 90 }, () => ({ x: rand() * W, y: H - rand() * 70, c: ["#F6A7C1", "#FFE27A", "#FFFFFF", "#C9A7F2"][Math.floor(rand() * 4)]! }));
  const flies = Array.from({ length: 30 }, () => ({ x: rand() * W, y: 150 + rand() * 150, p: rand() * 10 }));
  return (c, t, n) => {
    sky(c, mixHex("#A9DBF5", "#11283A", n), mixHex("#EAF7EE", "#2B4A4F", n));
    stars(c, sk, t, n);
    disc(c, 760, 74, 24, "#FFEFA0", 1 - n);
    glow(c, 760, 74, 70, "rgba(255,245,200,0.7)", 1 - n);
    disc(c, 250, 64, 16, "#F4EED8", n);
    clouds(c, cl, t, "#FFFFFF", (1 - n) * 0.9);
    ridge(c, 24, 210, 70, mixHex("#A7D69A", "#2A4738", n));
    for (const tr of trees.filter((x) => x.far)) tree(c, tr.x, 200, tr.s * 0.8, mixHex("#7DB86F", "#21402E", n), n);
    ridge(c, 25, 268, 50, mixHex("#7EBF71", "#1F3B2A", n));
    for (const tr of trees.filter((x) => !x.far)) tree(c, tr.x, 262, tr.s, mixHex("#5FA35A", "#1A3325", n), n);
    for (const f of flowers) {
      c.fillStyle = f.c;
      c.globalAlpha = 1 - n * 0.8;
      c.fillRect(f.x, f.y, 3, 3);
    }
    c.globalAlpha = 1;
    for (const f of flies) {
      const a = n * Math.max(0, Math.sin(t * 1.3 + f.p));
      glow(c, f.x + Math.sin(t * 0.5 + f.p) * 10, f.y + Math.cos(t * 0.7 + f.p) * 6, 7, "rgba(230,255,140,1)", a);
    }
  };
}

function tree(c: Ctx, x: number, base: number, s: number, color: string, n: number) {
  c.fillStyle = mixHex("#8A6545", "#2A2420", n);
  c.fillRect(x - 3 * s, base - 22 * s, 6 * s, 24 * s);
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, base - 32 * s, 16 * s, 0, Math.PI * 2);
  c.arc(x - 10 * s, base - 24 * s, 11 * s, 0, Math.PI * 2);
  c.arc(x + 10 * s, base - 25 * s, 12 * s, 0, Math.PI * 2);
  c.fill();
}

function snow(): Painter {
  const sk = starfield(31, 90, 160);
  const rand = rng(32);
  const flakes = Array.from({ length: 160 }, () => ({ x: rand() * W, y: rand() * H, v: 14 + rand() * 22, p: rand() * 10, r: 1 + rand() * 1.6 }));
  const pines = Array.from({ length: 40 }, () => ({ x: rand() * W, s: 0.6 + rand() * 0.8, far: rand() > 0.55 }));
  return (c, t, n) => {
    sky(c, mixHex("#B9D5EC", "#0D1430", n), mixHex("#EEF4F8", "#2A3362", n));
    stars(c, sk, t, n);
    // Northern lights on clear nights.
    if (n > 0.3) {
      for (let band = 0; band < 3; band++) {
        c.globalAlpha = (n - 0.3) * 0.5;
        const g = c.createLinearGradient(0, 30, 0, 150);
        g.addColorStop(0, "rgba(120,255,190,0)");
        g.addColorStop(0.5, band === 1 ? "rgba(120,220,255,0.8)" : "rgba(110,255,170,0.8)");
        g.addColorStop(1, "rgba(120,255,190,0)");
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, 150);
        for (let x = 0; x <= W; x += 16) c.lineTo(x, 70 + band * 18 + Math.sin(x / 120 + t * 0.4 + band * 2) * 26);
        for (let x = W; x >= 0; x -= 16) c.lineTo(x, 110 + band * 18 + Math.sin(x / 140 + t * 0.35 + band) * 22);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    disc(c, 820, 70, 22, "#FFF6D6", 1 - n);
    disc(c, 180, 58, 15, "#F4EED8", n);
    ridge(c, 33, 210, 120, mixHex("#C6D4E4", "#3A4472", n), true);
    // Snow caps: the same ridge again, lighter, clipped to its upper part.
    c.save();
    c.beginPath();
    c.rect(0, 0, W, 150);
    c.clip();
    ridge(c, 33, 210, 120, mixHex("#FFFFFF", "#AEB6DC", n), true);
    c.restore();
    for (const p of pines.filter((x) => x.far)) pine(c, p.x, 240, p.s * 0.7, mixHex("#5E8A72", "#1E3238", n), n);
    ridge(c, 34, 280, 30, mixHex("#F3F6F9", "#8F98C6", n));
    for (const p of pines.filter((x) => !x.far)) pine(c, p.x, 290, p.s, mixHex("#3F6E4E", "#16282B", n), n);
    c.fillStyle = mixHex("#FFFFFF", "#A7AFD8", n);
    for (const f of flakes) {
      const y = (f.y + t * f.v) % H;
      const x = wrap(f.x + Math.sin(t * 0.8 + f.p) * 10);
      c.fillRect(x, y, f.r * 1.5, f.r * 1.5);
    }
  };
}

function pine(c: Ctx, x: number, base: number, s: number, color: string, n: number) {
  c.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    const w = (26 - k * 6) * s;
    const top = base - (18 + k * 16) * s - 14 * s;
    c.beginPath();
    c.moveTo(x - w, base - k * 16 * s);
    c.lineTo(x + w, base - k * 16 * s);
    c.lineTo(x, top);
    c.fill();
  }
  c.fillStyle = mixHex("#FFFFFF", "#B7BFE2", n);
  c.beginPath();
  c.moveTo(x - 6 * s, base - 50 * s);
  c.lineTo(x + 6 * s, base - 50 * s);
  c.lineTo(x, base - 62 * s);
  c.fill();
}

function space(): Painter {
  const sk = starfield(41, 260, H);
  const rand = rng(42);
  const nebulae = Array.from({ length: 5 }, () => ({ x: rand() * W, y: rand() * H, r: 90 + rand() * 120, hue: rand() > 0.5 ? "120,90,220" : "60,190,210" }));
  return (c, t, n) => {
    sky(c, mixHex("#0B1233", "#04061A", n), mixHex("#1B1446", "#0A0826", n));
    for (const nb of nebulae) glow(c, nb.x, nb.y, nb.r, `rgba(${nb.hue},0.35)`, 1 - n * 0.4);
    stars(c, sk, t, 1);
    // A ringed planet turning slowly.
    const px = 690;
    const py = 190;
    const pr = 100;
    c.save();
    c.translate(px, py);
    c.rotate(-0.35);
    c.strokeStyle = "rgba(230,200,255,0.55)";
    c.lineWidth = 7;
    c.beginPath();
    c.ellipse(0, 0, pr * 1.75, pr * 0.42, 0, Math.PI, Math.PI * 2);
    c.stroke();
    c.restore();
    c.save();
    c.beginPath();
    c.arc(px, py, pr, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "#8B78D8";
    c.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    const bands = ["#A08DE6", "#7562C4", "#B9A4F0", "#6B57B5", "#9C86E0"];
    for (let i = 0; i < 9; i++) {
      c.fillStyle = bands[i % bands.length]!;
      const y = py - pr + i * 24 + Math.sin(t * 0.2 + i) * 3;
      c.beginPath();
      for (let x = -pr; x <= pr; x += 10) c.lineTo(px + x, y + Math.sin(x / 30 + t * 0.5 + i) * 4);
      for (let x = pr; x >= -pr; x -= 10) c.lineTo(px + x, y + 12 + Math.sin(x / 26 + t * 0.4 + i) * 4);
      c.fill();
    }
    const shade = c.createLinearGradient(px - pr, py - pr, px + pr, py + pr);
    shade.addColorStop(0.35, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(5,5,30,0.75)");
    c.fillStyle = shade;
    c.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    c.restore();
    c.save();
    c.translate(px, py);
    c.rotate(-0.35);
    c.strokeStyle = "rgba(235,210,255,0.75)";
    c.lineWidth = 7;
    c.beginPath();
    c.ellipse(0, 0, pr * 1.75, pr * 0.42, 0, 0, Math.PI);
    c.stroke();
    c.restore();
    // A little moon, and now and then a comet.
    const a = t * 0.05;
    disc(c, 260 + Math.cos(a) * 60, 90 + Math.sin(a) * 18, 14, "#D8DCEC");
    disc(c, 255 + Math.cos(a) * 60, 86 + Math.sin(a) * 18, 4, "#B7BCD3");
    const k = (t % 24) / 3;
    if (k < 1) {
      const x = 100 + k * 800;
      const y = 40 + k * 120;
      const g = c.createLinearGradient(x - 90, y - 14, x, y);
      g.addColorStop(0, "rgba(160,230,255,0)");
      g.addColorStop(1, "rgba(220,250,255,0.9)");
      c.strokeStyle = g;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x - 90, y - 14);
      c.lineTo(x, y);
      c.stroke();
      disc(c, x, y, 3, "#FFFFFF");
    }
  };
}

function ocean(): Painter {
  const sk = starfield(51, 80, 150);
  const cl = cloudList(52, 5);
  const rand = rng(53);
  const waves = Array.from({ length: 70 }, () => ({ x: rand() * W, y: 196 + rand() * 120, w: 10 + rand() * 26, v: 6 + rand() * 10 }));
  const gulls = Array.from({ length: 4 }, () => ({ x: rand() * W, y: 60 + rand() * 60, v: 14 + rand() * 10, p: rand() * 10 }));
  const horizon = 190;
  return (c, t, n) => {
    sky(c, dusk("#7FCBEE", "#F2A56E", "#1C1D48", n), dusk("#DDF3FA", "#F9DDA2", "#4A3F7B", n), horizon);
    stars(c, sk, t, Math.max(0, n - 0.5) * 2);
    // The sun sinks toward the horizon as evening comes.
    const sunY = 60 + Math.min(1, n * 1.6) * 140;
    if (n < 0.75) {
      glow(c, 640, sunY, 90, "rgba(255,220,150,0.8)", 1 - n);
      disc(c, 640, sunY, 26 + n * 10, dusk("#FFF2B0", "#FF9A5A", "#FF7A5A", n));
    }
    disc(c, 300, 60, 15, "#F4EED8", Math.max(0, n - 0.5) * 2);
    clouds(c, cl, t, dusk("#FFFFFF", "#FFD2B0", "#5A4F8A", n), 0.85 * (1 - n * 0.6));
    const sea = c.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, dusk("#3AA6C9", "#E0896A", "#232A5C", n));
    sea.addColorStop(1, dusk("#1D7DA6", "#7A5A8A", "#141A40", n));
    c.fillStyle = sea;
    c.fillRect(0, horizon, W, H - horizon);
    // The sun's (or the moon's) path on the water.
    for (let y = horizon + 4; y < H; y += 7) {
      const w = 18 + (y - horizon) * 0.5;
      c.fillStyle = n < 0.75 ? `rgba(255,230,170,${0.35 * (1 - n)})` : `rgba(240,235,210,${(n - 0.5) * 0.35})`;
      c.fillRect((n < 0.75 ? 640 : 300) - w / 2 + Math.sin(t * 2 + y) * 4, y, w, 2);
    }
    c.fillStyle = `rgba(255,255,255,${0.5 - n * 0.3})`;
    for (const wv of waves) {
      const x = wrap(wv.x + t * wv.v);
      c.fillRect(x, wv.y + Math.sin(t * 1.5 + wv.x) * 1.5, wv.w * (0.5 + (wv.y - horizon) / 140), 2);
    }
    // A sailboat bobbing past.
    const bx = wrap(t * 9 + 200);
    const by = horizon + 26 + Math.sin(t * 1.4) * 2;
    c.fillStyle = dusk("#FFFFFF", "#FFE8D0", "#9A94C8", n);
    c.beginPath();
    c.moveTo(bx, by - 46);
    c.lineTo(bx, by - 6);
    c.lineTo(bx + 26, by - 8);
    c.fill();
    c.beginPath();
    c.moveTo(bx - 3, by - 40);
    c.lineTo(bx - 3, by - 8);
    c.lineTo(bx - 18, by - 8);
    c.fill();
    c.fillStyle = dusk("#D2584F", "#B04A48", "#3A2E5A", n);
    c.beginPath();
    c.moveTo(bx - 22, by - 6);
    c.lineTo(bx + 30, by - 6);
    c.lineTo(bx + 22, by + 2);
    c.lineTo(bx - 16, by + 2);
    c.fill();
    // Gulls by day.
    c.strokeStyle = `rgba(60,70,90,${1 - n})`;
    c.lineWidth = 2;
    for (const g of gulls) {
      const x = wrap(g.x + t * g.v);
      const y = g.y + Math.sin(t * 0.8 + g.p) * 8;
      const flap = Math.sin(t * 7 + g.p) * 4;
      c.beginPath();
      c.moveTo(x - 9, y - flap);
      c.quadraticCurveTo(x - 4, y - 5, x, y);
      c.quadraticCurveTo(x + 4, y - 5, x + 9, y - flap);
      c.stroke();
    }
  };
}

const PAINTERS: Record<ViewId, () => Painter> = { city, garden, snow, space, ocean };

/** The theme's animated view, and a texture per window showing part of it. */
export class WindowView {
  private canvas = document.createElement("canvas");
  private ctx: Ctx;
  private paint: Painter;
  private textures: THREE.CanvasTexture[] = [];
  private nextDraw = 0;

  constructor(view: ViewId) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.paint = PAINTERS[view]();
    this.paint(this.ctx, 0, 0);
  }

  /** A texture for one pane of the given aspect, looking at the panorama from `u` (0..1) across. */
  texture(u: number, aspect: number): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // glTF puts the UV origin at the top left.
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set((aspect * H) / W, 1);
    tex.offset.x = u;
    this.textures.push(tex);
    return tex;
  }

  /** Lets go of every window's texture, before the room is rebuilt with new ones. */
  releaseTextures() {
    for (const tex of this.textures) tex.dispose();
    this.textures = [];
  }

  update(t: number, night: number) {
    if (t < this.nextDraw) return;
    this.nextDraw = t + 1 / FPS;
    this.paint(this.ctx, t, night);
    for (const tex of this.textures) tex.needsUpdate = true;
  }

  dispose() {
    this.releaseTextures();
  }
}
