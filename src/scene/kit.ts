import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type AssetName =
  | "Clawd"
  | "Desk"
  | "Chair"
  | "Monitor"
  | "Keyboard"
  | "Mug"
  | "Paper"
  | "DeskLamp"
  | "PlantSmall"
  | "PlantBig"
  | "Couch"
  | "Beanbag"
  | "CoffeeBar"
  | "WaterCooler"
  | "FilingCabinet"
  | "Bookshelf"
  | "Window"
  | "Sign"
  | "Laptop"
  | "MiniDesk"
  | "Clock"
  | "CoffeeTable"
  | "Door";

/** The Blender-built asset kit: one GLB whose top-level nodes are cloned by name. */
export class Kit {
  private constructor(private readonly source: THREE.Object3D) {}

  static async load(url = "/models/office.glb"): Promise<Kit> {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return new Kit(gltf.scene);
  }

  /** Clones an asset. Geometry and materials are shared between clones. */
  make(name: AssetName): THREE.Object3D {
    const src = this.source.getObjectByName(name);
    if (!src) throw new Error(`asset ${name} is missing from office.glb; run "bun run assets"`);
    const clone = src.clone(true);
    clone.position.set(0, 0, 0);
    return clone;
  }
}

export function part<T extends THREE.Object3D = THREE.Mesh>(root: THREE.Object3D, name: string): T {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`part ${name} is missing`);
  return found as T;
}

/** Frame-rate independent approach toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

/** Stable 0..1 hash of a string, for per-agent variation that survives reloads. */
export function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
