"""Builds the Claude Office asset kit and exports it as one GLB.

Run headless:  blender -b -P assets/build_assets.py

Options go after `--`:
  --preview [path]     also render an overview image (default assets/preview/kit.png)
  --only a,b           build only these kit modules (office is always built)
  --out path           write the GLB somewhere other than public/models/office.glb

The assets live in assets/kit: `office` is the original studio kit, and each
theme adds its own module. Every asset is a named root Empty at the origin with
its meshes parented under it, so the client can clone a root by name. Blender
is Z up and assets face -Y, which the glTF exporter turns into Y up, facing +Z.
"""

import importlib
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from kit.core import material  # noqa: E402

OUT = os.path.join(HERE, "..", "public", "models", "office.glb")
PREVIEW = os.path.join(HERE, "preview", "kit.png")
MODULES = ["office", "studio", "greenhouse", "lodge", "orbital", "seaside"]


# ------------------------------------------------------------------- output


def footprint(obj):
    """World-space bounding box of everything under an asset root."""
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for child in obj.children_recursive:
        if child.type != "MESH":
            continue
        for corner in child.bound_box:
            p = child.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def render_preview(roots, path, hidden=()):
    """Lays the kit out in a labelled grid and renders one overview image."""
    for r in hidden:
        for o in (r, *r.children_recursive):
            o.hide_render = True
    bpy.context.view_layer.update()
    sizes = []
    for r in roots:
        lo, hi = footprint(r)
        sizes.append(max(hi.x - lo.x, hi.y - lo.y, 0.4) if lo.x != math.inf else 0.4)
    cell = min(2.6, max(sizes) + 0.5)
    cols = max(1, math.ceil(math.sqrt(len(roots) * 1.4)))
    rows = math.ceil(len(roots) / cols)
    labels = []
    for i, r in enumerate(roots):
        x, y = (i % cols) * cell, -(i // cols) * cell
        wall = r.name in ("Window", "Clock") or r.name.startswith(("Wall", "Porthole", "Lifebuoy", "Wreath", "HangingPlant"))
        r.location = (x, y, 1.0 if wall else 0.0)
        curve = bpy.data.curves.new(f"label_{r.name}", "FONT")
        curve.body = r.name
        curve.size = 0.16
        curve.align_x = "CENTER"
        label = bpy.data.objects.new(f"label_{r.name}", curve)
        label.location = (x, y - cell * 0.42, 0.01)
        label.data.materials.append(material("charcoal"))
        bpy.context.scene.collection.objects.link(label)
        labels.append(label)

    scene = bpy.context.scene
    center = Vector(((cols - 1) * cell / 2, -(rows - 1) * cell / 2, 0.4))

    bpy.ops.mesh.primitive_plane_add(size=200, location=(center.x, center.y, -0.001))
    ground = bpy.context.object
    ground.data.materials.append(material("sky"))

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(cols * cell, rows * cell * 1.5) * 1.02
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = center + Vector((0, -16, 14))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 2.0
    sun_data.angle = math.radians(12)
    sun = bpy.data.objects.new("Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(8), math.radians(35))

    world = bpy.data.worlds.new("World")
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.9, 0.93, 1.0, 1)
    bg.inputs["Strength"].default_value = 0.45
    scene.world = world

    scene.render.resolution_x = 2000
    scene.render.resolution_y = 1400
    scene.render.filepath = path
    scene.view_settings.view_transform = "Standard"
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = 24
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)

    for obj in (ground, cam, sun, *labels):
        bpy.data.objects.remove(obj, do_unlink=True)
    for r in roots:
        r.location = (0, 0, 0)
    for r in hidden:
        for o in (r, *r.children_recursive):
            o.hide_render = False


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    def option(flag, default=None):
        if flag not in argv:
            return default
        i = argv.index(flag)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else default

    only = option("--only")
    modules = MODULES if only is None else ["office", *[m for m in only.split(",") if m != "office"]]
    out = os.path.abspath(option("--out", OUT))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    roots = []
    preview_roots = []
    for name in modules:
        module = importlib.import_module(f"kit.{name}")
        built = [build() for build in module.BUILDERS]
        roots.extend(built)
        if only is None or name != "office":
            preview_roots.extend(built)

    # Blender renames a clashing object "Name.001", which the client could not find.
    clashes = sorted(o.name for o in bpy.data.objects if "." in o.name)
    if clashes:
        raise SystemExit(f"object names must be unique; prefix parts with their asset name: {clashes}")

    if "--preview" in argv:
        others = [r for r in roots if r not in preview_roots]
        render_preview(preview_roots, os.path.abspath(option("--preview", PREVIEW)), others)

    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print(f"exported {len(roots)} assets to {out}")


main()
