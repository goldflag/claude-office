import * as THREE from "three/webgpu";
import { rng } from "./surfaces.ts";
import type { AmbientKind } from "./themes.ts";

// Small living things that drift about the room: fireflies at night and
// butterflies by day in the greenhouse, embers from the lodge fire, dust in
// the space station's air. And confetti, for a finished turn.

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export interface AmbientRoom {
  width: number;
  depth: number;
  /** Where the fire is, for embers. */
  fire: THREE.Vector3 | null;
}

interface Drifter {
  x: number;
  y: number;
  z: number;
  phase: number;
  speed: number;
}

class Swarm {
  readonly mesh: THREE.InstancedMesh;
  readonly items: Drifter[];

  constructor(count: number, radius: number, color: string, seed: number, opacity = 1) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 8, 6), material, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    const rand = rng(seed);
    this.items = Array.from({ length: count }, () => ({ x: rand(), y: rand(), z: rand(), phase: rand() * 100, speed: 0.6 + rand() * 0.8 }));
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

interface Butterfly {
  group: THREE.Group;
  wings: THREE.Mesh[];
  cx: number;
  cz: number;
  phase: number;
}

export class Ambient {
  readonly group = new THREE.Group();
  private fireflies: Swarm | null = null;
  private embers: Swarm | null = null;
  private motes: Swarm | null = null;
  private butterflies: Butterfly[] = [];
  private wingGeometry: THREE.ShapeGeometry | null = null;
  private bodyGeometry: THREE.CapsuleGeometry | null = null;
  private wingMaterials: THREE.Material[] = [];
  private room: AmbientRoom = { width: 15, depth: 10, fire: null };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(kinds: AmbientKind[]) {
    if (kinds.includes("fireflies")) {
      this.fireflies = new Swarm(40, 0.034, "#F2FF9A", 5);
      this.group.add(this.fireflies.mesh);
    }
    if (kinds.includes("embers")) {
      this.embers = new Swarm(18, 0.014, "#FFB25A", 6);
      this.group.add(this.embers.mesh);
    }
    if (kinds.includes("motes")) {
      this.motes = new Swarm(60, 0.012, "#A8F4FF", 7, 0.7);
      this.group.add(this.motes.mesh);
    }
    if (kinds.includes("butterflies")) {
      // One wing, lying flat and reaching out along +X from a body that runs along Z.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.004);
      shape.bezierCurveTo(0.02, 0.07, 0.1, 0.075, 0.095, 0.025);
      shape.bezierCurveTo(0.09, 0.0, 0.07, -0.008, 0.05, -0.008);
      shape.bezierCurveTo(0.065, -0.05, 0.025, -0.065, 0, -0.012);
      this.wingGeometry = new THREE.ShapeGeometry(shape, 8);
      this.wingGeometry.rotateX(-Math.PI / 2);
      this.bodyGeometry = new THREE.CapsuleGeometry(0.008, 0.05, 4, 8);
      this.bodyGeometry.rotateX(Math.PI / 2);
      const body = new THREE.MeshStandardMaterial({ color: "#3A3340", roughness: 0.6 });
      this.wingMaterials.push(body);
      const colors = ["#F59AB8", "#FFC94D", "#7DBBFF", "#B9A2F2", "#FF9D6B"];
      for (let i = 0; i < 5; i++) {
        const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 0.6 });
        this.wingMaterials.push(mat);
        const group = new THREE.Group();
        const wings = [0, 1].map((k) => {
          const wing = new THREE.Mesh(this.wingGeometry!, mat);
          wing.scale.x = k ? 1 : -1;
          group.add(wing);
          return wing;
        });
        group.add(new THREE.Mesh(this.bodyGeometry, body));
        this.butterflies.push({ group, wings, cx: 0, cz: 0, phase: i * 1.7 });
        this.group.add(group);
      }
    }
  }

  fit(room: AmbientRoom) {
    this.room = room;
    this.butterflies.forEach((b, i) => {
      b.cx = ((i + 0.6) / (this.butterflies.length + 0.2)) * room.width;
      b.cz = 1.2 + (i % 2) * 0.8;
    });
  }

  update(t: number, night: number) {
    const { width: W, depth: D } = this.room;

    if (this.fireflies) {
      const glow = Math.max(0, night - 0.25) / 0.75;
      this.fireflies.items.forEach((f, i) => {
        const blink = Math.max(0, Math.sin(t * f.speed * 2.2 + f.phase));
        const k = glow * blink;
        if (k < 0.02) return this.fireflies!.mesh.setMatrixAt(i, hidden);
        this.v.set(
          f.x * W + Math.sin(t * 0.21 * f.speed + f.phase) * 0.8,
          0.4 + f.y * 1.8 + Math.sin(t * 0.5 * f.speed + f.phase * 2) * 0.25,
          0.4 + f.z * (D - 0.8) + Math.cos(t * 0.17 * f.speed + f.phase) * 0.8,
        );
        this.m.compose(this.v, this.q.identity(), this.s.setScalar(k));
        this.fireflies!.mesh.setMatrixAt(i, this.m);
      });
      this.fireflies.mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.embers && this.room.fire) {
      const fire = this.room.fire;
      this.embers.items.forEach((e, i) => {
        const life = (t * 0.5 * e.speed + e.phase) % 1;
        this.v.set(
          fire.x + (e.x - 0.5) * 0.6 + Math.sin(t * 3 + e.phase) * 0.05,
          fire.y + life * 0.9,
          fire.z + (e.z - 0.5) * 0.15,
        );
        this.m.compose(this.v, this.q.identity(), this.s.setScalar((1 - life) * 1.2));
        this.embers!.mesh.setMatrixAt(i, this.m);
      });
      this.embers.mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.motes) {
      this.motes.items.forEach((m, i) => {
        this.v.set(
          (((m.x * W + t * 0.05 * m.speed) % W) + W) % W,
          0.3 + ((m.y * 2.4 + t * 0.03 * m.speed) % 2.4),
          0.3 + m.z * (D - 0.6) + Math.sin(t * 0.3 + m.phase) * 0.2,
        );
        this.m.compose(this.v, this.q.identity(), this.s.setScalar(0.6 + 0.4 * Math.sin(t * 2 + m.phase)));
        this.motes!.mesh.setMatrixAt(i, this.m);
      });
      this.motes.mesh.instanceMatrix.needsUpdate = true;
    }

    const day = 1 - night;
    for (const b of this.butterflies) {
      b.group.visible = day > 0.35;
      if (!b.group.visible) continue;
      const a = t * 0.35 + b.phase;
      b.group.position.set(
        b.cx + Math.sin(a) * 1.4,
        1.0 + Math.sin(a * 2.3) * 0.35 + Math.sin(t * 9 + b.phase) * 0.03,
        b.cz + Math.sin(a * 2) * 0.6,
      );
      b.group.rotation.y = Math.atan2(Math.cos(a) * 1.4, Math.cos(a * 2) * 1.2);
      // Wings beat from nearly flat to nearly closed above the back.
      const flap = 0.35 + Math.sin(t * 16 + b.phase) * 0.75;
      b.wings[0]!.rotation.z = -flap;
      b.wings[1]!.rotation.z = flap;
      b.group.scale.setScalar(Math.min(1, (day - 0.35) * 3));
    }
  }

  dispose() {
    this.fireflies?.dispose();
    this.embers?.dispose();
    this.motes?.dispose();
    this.wingGeometry?.dispose();
    this.bodyGeometry?.dispose();
    for (const m of this.wingMaterials) m.dispose();
  }
}

// ------------------------------------------------------------------ confetti

const CONFETTI = 360;
const BURST = 36;
const COLORS = ["#D97757", "#F4CF5D", "#6CC8C4", "#8B78D8", "#EE7C6B", "#9BE36B", "#FFFFFF"];

interface Flake {
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  r: THREE.Euler;
}

/** Bursts of paper confetti, shared by every desk. */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private flakes: Flake[] = [];
  private next = 0;
  /** Set while flakes are flying, so the frame after the last one lands still clears it. */
  private dirty = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);

  constructor() {
    const geometry = new THREE.PlaneGeometry(0.06, 0.035);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geometry, material, CONFETTI);
    this.mesh.frustumCulled = false;
    const color = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) {
      this.mesh.setMatrixAt(i, hidden);
      this.mesh.setColorAt(i, color.set(COLORS[i % COLORS.length]!));
      this.flakes.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), spin: new THREE.Vector3(), r: new THREE.Euler() });
    }
  }

  burst(at: THREE.Vector3) {
    for (let k = 0; k < BURST; k++) {
      const f = this.flakes[this.next]!;
      this.next = (this.next + 1) % CONFETTI;
      const a = Math.random() * Math.PI * 2;
      const out = 0.6 + Math.random() * 1.2;
      f.life = 1.6 + Math.random() * 0.8;
      f.p.copy(at);
      f.v.set(Math.cos(a) * out, 2.2 + Math.random() * 1.6, Math.sin(a) * out);
      f.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      f.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
  }

  update(dt: number) {
    let live = false;
    this.flakes.forEach((f, i) => {
      if (f.life <= 0) return;
      live = true;
      f.life -= dt;
      // Paper falls slowly: strong drag once it is on its way down.
      f.v.y -= 6 * dt;
      f.v.multiplyScalar(f.v.y < 0 ? Math.exp(-3.5 * dt) : 1);
      f.p.addScaledVector(f.v, dt);
      f.r.x += f.spin.x * dt;
      f.r.y += f.spin.y * dt;
      f.r.z += f.spin.z * dt;
      if (f.life <= 0 || f.p.y < 0.02) {
        f.life = 0;
        this.mesh.setMatrixAt(i, hidden);
        return;
      }
      this.m.compose(f.p, this.q.setFromEuler(f.r), this.s.setScalar(Math.min(1, f.life * 2)));
      this.mesh.setMatrixAt(i, this.m);
    });
    if (live || this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = live;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
