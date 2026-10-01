import * as THREE from "three/webgpu";
import type { Activity } from "../../shared/types.ts";

const W = 192;
const H = 120;

const CODE_COLORS = ["#7FD1B9", "#F2C879", "#E58A6B", "#9DB7F5", "#C8CDD6"];

/** Deterministic pseudo-random in 0..1 for stable procedural screen content. */
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A monitor face: a small canvas redrawn to show what the agent is doing. */
export class Screen {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private ctx: CanvasRenderingContext2D;
  private lastDraw = -1;
  private seed = Math.random() * 1000;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
  }

  /** Redraws at most ten times a second; screens do not need more. */
  draw(activity: Activity, t: number) {
    const frame = Math.floor(t * 10);
    if (frame === this.lastDraw) return;
    this.lastDraw = frame;
    const c = this.ctx;
    const s = this.seed;

    const fill = (color: string) => {
      c.fillStyle = color;
      c.fillRect(0, 0, W, H);
    };
    const bar = (x: number, y: number, w: number, h: number, color: string) => {
      c.fillStyle = color;
      c.beginPath();
      c.roundRect(x, y, w, h, h / 2);
      c.fill();
    };

    switch (activity) {
      case "writing": {
        fill("#232733");
        const scroll = t * 2.2;
        const first = Math.floor(scroll);
        for (let i = -1; i < 9; i++) {
          const line = first + i;
          const y = 10 + (i - (scroll - first)) * 13;
          const k = rnd(line + s);
          const indent = 10 + Math.floor(rnd(line * 3 + s) * 3) * 12;
          if (k > 0.78) {
            c.fillStyle = k > 0.9 ? "rgba(232,104,92,0.35)" : "rgba(98,196,140,0.35)";
            c.fillRect(0, y - 3, W, 12);
          }
          let x = indent;
          for (let j = 0; j < 3; j++) {
            const w = 14 + rnd(line * 7 + j + s) * 42;
            if (x + w > W - 8) break;
            bar(x, y, w, 6, CODE_COLORS[Math.floor(rnd(line + j * 5 + s) * CODE_COLORS.length)]!);
            x += w + 6;
          }
        }
        break;
      }
      case "terminal": {
        fill("#141a17");
        const step = Math.floor(t * 5);
        const rows = 7;
        for (let i = 0; i < rows; i++) {
          const line = step - (rows - 1 - i);
          const y = 12 + i * 15;
          const isPrompt = Math.floor(rnd(Math.floor(line / 3) + s) * 3) === ((line % 3) + 3) % 3;
          const w = (isPrompt ? 30 : 50) + rnd(line + s) * 90;
          if (isPrompt) bar(8, y, 7, 6, "#F2C879");
          bar(isPrompt ? 20 : 8, y, w, 6, isPrompt ? "#D8F3DC" : "#52B788");
        }
        if (frame % 6 < 3) {
          c.fillStyle = "#D8F3DC";
          c.fillRect(8, 12 + rows * 15 - 2, 9, 9);
        }
        break;
      }
      case "reading": {
        fill("#F3EEE2");
        for (let i = 0; i < 8; i++) {
          const w = 110 + rnd(i + s) * 60;
          bar(12, 12 + i * 13, i % 4 === 3 ? w * 0.5 : w, 5, "#B9B2A3");
        }
        const y = 9 + ((t * 0.9) % 8) * 13;
        c.fillStyle = "rgba(242,186,62,0.45)";
        c.fillRect(8, y, W - 16, 11);
        break;
      }
      case "web": {
        fill("#EAF1F8");
        c.fillStyle = "#C9D6E4";
        c.fillRect(0, 0, W, 20);
        bar(30, 6, W - 60, 8, "#FFFFFF");
        c.strokeStyle = "#4E8FD1";
        c.lineWidth = 3;
        const cx = W / 2;
        const cy = 68;
        const r = 30;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();
        const phase = (t * 0.5) % 1;
        for (const k of [phase, (phase + 0.5) % 1]) {
          c.beginPath();
          c.ellipse(cx, cy, r * Math.abs(Math.cos(k * Math.PI)), r, 0, 0, Math.PI * 2);
          c.stroke();
        }
        c.beginPath();
        c.moveTo(cx - r, cy);
        c.lineTo(cx + r, cy);
        c.stroke();
        break;
      }
      case "delegating": {
        fill("#2A2540");
        for (let i = 0; i < 8; i++) {
          const x = 22 + (i % 4) * 40;
          const y = 26 + Math.floor(i / 4) * 40;
          const on = (Math.sin(t * 3 + i * 1.7) + 1) / 2;
          c.fillStyle = `rgba(217,119,87,${0.3 + on * 0.7})`;
          c.beginPath();
          c.roundRect(x, y, 28, 22, 6);
          c.fill();
        }
        break;
      }
      case "tool": {
        fill("#26303A");
        for (let i = 0; i < 5; i++) {
          const p = (Math.sin(t * 2 + i) + 1) / 2;
          bar(16, 18 + i * 19, 40 + p * 110, 9, i % 2 ? "#8FB8DE" : "#7FD1B9");
        }
        break;
      }
      case "thinking": {
        fill("#2B2433");
        for (let i = 0; i < 3; i++) {
          const p = Math.max(0, Math.sin(t * 4 - i * 0.9));
          c.fillStyle = `rgba(232,138,107,${0.35 + p * 0.65})`;
          c.beginPath();
          c.arc(W / 2 + (i - 1) * 32, H / 2 - p * 8, 9 + p * 3, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case "waiting": {
        const on = frame % 10 < 6;
        fill(on ? "#FFC83D" : "#E8A91C");
        c.fillStyle = "#2B2110";
        c.beginPath();
        c.roundRect(W / 2 - 9, 20, 18, 52, 9);
        c.fill();
        c.beginPath();
        c.arc(W / 2, 92, 10, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case "done": {
        fill("#DFF3E4");
        c.strokeStyle = "#2F9E63";
        c.lineWidth = 12;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.beginPath();
        c.moveTo(62, 62);
        c.lineTo(86, 84);
        c.lineTo(132, 38);
        c.stroke();
        break;
      }
      case "idle": {
        fill("#1E2530");
        const x = Math.abs(((t * 22 + s) % (2 * (W - 36))) - (W - 36));
        const y = Math.abs(((t * 15 + s * 3) % (2 * (H - 26))) - (H - 26));
        c.fillStyle = "#D97757";
        c.beginPath();
        c.roundRect(x, y, 36, 26, 7);
        c.fill();
        c.fillStyle = "#1E2530";
        c.fillRect(x + 10, y + 8, 4, 9);
        c.fillRect(x + 22, y + 8, 4, 9);
        break;
      }
      default:
        fill("#12151B");
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}
