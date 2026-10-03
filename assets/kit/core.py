"""Shared materials and mesh helpers for the asset kit.

Blender is Z up and assets face -Y, which the glTF exporter turns into Y up,
facing +Z. Every helper returns the new object, parented under `parent`, with
its pivot at `origin` (relative to the parent).
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- materials

# name -> (hex color, roughness). Theme modules may add their own colors with
# `colors(...)`; prefix theme-only names so modules cannot clash.
PALETTE = {
    "clawd": ("#D97757", 0.55),
    "clawd_dark": ("#B85C3F", 0.6),
    "eye": ("#1D1B1A", 0.3),
    "wood": ("#E3BF94", 0.6),
    "wood_dark": ("#B98B5E", 0.6),
    "white": ("#F5F0E8", 0.55),
    "cream": ("#EAE0D0", 0.6),
    "charcoal": ("#34323B", 0.45),
    "slate": ("#6C7A89", 0.6),
    "steel": ("#B9C2CC", 0.35),
    "sky": ("#9DB8C9", 0.55),
    "teal": ("#6FA8A0", 0.75),
    "teal_dark": ("#568C85", 0.75),
    "red": ("#D2584F", 0.45),
    "mustard": ("#E5B94E", 0.6),
    "leaf": ("#6DAE6A", 0.65),
    "leaf_dark": ("#4F9160", 0.65),
    "pot": ("#D9896A", 0.7),
    "coffee": ("#4A2F25", 0.3),
    "plum": ("#8E6C9E", 0.6),
    "paper": ("#FBF8F1", 0.8),
    "key": ("#CFC8BC", 0.6),
    # Shared by the themes.
    "terracotta": ("#C8734F", 0.8),
    "sage": ("#A9C2A0", 0.7),
    "moss": ("#7E9C5B", 0.75),
    "stone": ("#B7B2AA", 0.85),
    "stone_dark": ("#8E8982", 0.85),
    "water": ("#5FA3B8", 0.12),
    "sand": ("#E9D6AE", 0.9),
    "driftwood": ("#CDB89A", 0.75),
    "navy": ("#2F4A6B", 0.55),
    "coral": ("#EE7C6B", 0.55),
    "aqua": ("#6CC8C4", 0.5),
    "sunny": ("#F4CF5D", 0.55),
    "straw": ("#E2C27F", 0.85),
    "bamboo": ("#CDA867", 0.6),
    "copper": ("#C47A4A", 0.3),
    "plaid": ("#B8433A", 0.8),
    "forest": ("#3F6E4E", 0.7),
    "snow": ("#F4F6F8", 0.6),
    "metal": ("#4A515E", 0.35),
    "neon": ("#4FE0E6", 0.3),
    "neon_pink": ("#FF6FB5", 0.3),
    "violet": ("#8B78D8", 0.55),
    "grow": ("#E05FD0", 0.4),
    "glass": ("#CFE6F2", 0.05),
    "ginger": ("#E39A55", 0.7),
    "pink": ("#F2A7B5", 0.6),
    "gold": ("#E8B84A", 0.3),
}

_materials = {}


def colors(**entries):
    """Adds palette entries: colors(name=("#hex", roughness), ...)."""
    PALETTE.update(entries)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (alpha,)


def material(name, emission=0.0, alpha=1.0):
    key = (name, emission, alpha)
    if key in _materials:
        return _materials[key]
    hex_color, roughness = PALETTE[name]
    mat = bpy.data.materials.new(name if emission == 0 and alpha == 1 else f"{name}_fx")
    try:
        mat.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = hex_rgba(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = hex_rgba(hex_color)
        bsdf.inputs["Emission Strength"].default_value = emission
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    mat.diffuse_color = hex_rgba(hex_color, alpha)
    _materials[key] = mat
    return mat


def _mat(mat):
    return material(mat) if isinstance(mat, str) else mat


# ----------------------------------------------------------------- geometry


def _finish(bm, name, mat, parent, origin, smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        mesh.shade_smooth()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = origin
    obj.parent = parent
    mesh.materials.append(mat)
    if smooth:
        # Keeps large flat faces flat while the bevels stay soft.
        mod = obj.modifiers.new("normals", "WEIGHTED_NORMAL")
        mod.keep_sharp = False
        mod.weight = 100
    return obj


def box(name, size, center, mat, parent, radius=0.02, origin=(0, 0, 0), segments=3):
    """Rounded box. `center` is relative to `origin`, which becomes the pivot."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    r = min(radius, min(size) * 0.49)
    if r > 0:
        bmesh.ops.bevel(
            bm, geom=bm.edges[:], offset=r, offset_type="OFFSET", segments=segments, profile=0.5, affect="EDGES"
        )
    return _finish(bm, name, _mat(mat), parent, origin, smooth=r > 0)


def cyl(name, r1, r2, height, base, mat, parent, radius=0.0, origin=(0, 0, 0), segments=28):
    """Cylinder or cone frustum standing on `base` (relative to `origin`)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r1, radius2=r2, depth=height)
    bmesh.ops.translate(bm, vec=Vector(base) + Vector((0, 0, height / 2)), verts=bm.verts)
    if radius > 0:
        rim = [e for f in bm.faces if len(f.verts) > 4 for e in f.edges]
        bmesh.ops.bevel(bm, geom=rim, offset=radius, offset_type="OFFSET", segments=3, profile=0.5, affect="EDGES")
    return _finish(bm, name, _mat(mat), parent, origin)


def blob(name, radius, center, scale, mat, parent, origin=(0, 0, 0), subdivisions=3):
    """Ellipsoid: an icosphere of `radius` scaled by `scale`, centered at `center` (relative to `origin`)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return _finish(bm, name, _mat(mat), parent, origin)


def quad(name, width, height, center, mat, parent, origin=(0, 0, 0), tilt=0.0):
    """Upright UV-mapped quad facing -Y, used for screens the client textures."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    hw, hh = width / 2, height / 2
    corners = [(-hw, 0, -hh), (hw, 0, -hh), (hw, 0, hh), (-hw, 0, hh)]
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    verts = [bm.verts.new(c) for c in corners]
    face = bm.faces.new(verts)
    for loop, coord in zip(face.loops, uvs):
        loop[uv].uv = coord
    if tilt:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(tilt, 3, "X"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return _finish(bm, name, _mat(mat), parent, origin, smooth=False)


def disc(name, radius, center, mat, parent, origin=(0, 0, 0), segments=48):
    """Upright UV-mapped disc facing -Y (a round screen or window pane)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    verts = []
    coords = []
    for i in range(segments):
        a = i / segments * math.tau
        verts.append(bm.verts.new((math.cos(a) * radius, 0, math.sin(a) * radius)))
        coords.append((math.cos(a) * 0.5 + 0.5, math.sin(a) * 0.5 + 0.5))
    face = bm.faces.new(verts)
    for loop, coord in zip(face.loops, coords):
        loop[uv].uv = coord
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return _finish(bm, name, _mat(mat), parent, origin, smooth=False)


def rod(name, start, end, radius, mat, parent, origin=(0, 0, 0), radius_end=None, segments=12):
    """A cylinder (or tapered cone when `radius_end` is set) running from `start` to `end`."""
    a, b = Vector(start), Vector(end)
    axis = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius if radius_end is None else radius_end,
        depth=axis.length,
    )
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix()
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
    return _finish(bm, name, _mat(mat), parent, origin)


def torus(name, major, minor, center, mat, parent, origin=(0, 0, 0), upright=False, segments=32, sides=12, arc=1.0):
    """A ring lying flat in XY, or standing facing -Y when `upright`. `arc` < 1 leaves an open ring."""
    bm = bmesh.new()
    closed = arc >= 1.0
    count = segments if closed else segments + 1
    rings = []
    for i in range(count):
        u = i / segments * math.tau * arc
        ring = []
        for j in range(sides):
            v = j / sides * math.tau
            d = major + minor * math.cos(v)
            ring.append(bm.verts.new((d * math.cos(u), d * math.sin(u), minor * math.sin(v))))
        rings.append(ring)
    for i in range(segments if closed else count - 1):
        r0, r1 = rings[i], rings[(i + 1) % count]
        for j in range(sides):
            bm.faces.new((r0[j], r1[j], r1[(j + 1) % sides], r0[(j + 1) % sides]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if upright:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return _finish(bm, name, _mat(mat), parent, origin)


def lathe(name, profile, mat, parent, origin=(0, 0, 0), center=(0, 0, 0), segments=28, cap=True):
    """Spins a profile of (radius, z) points, bottom to top, around Z: pots, cups, domes, canopies."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(segments):
            a = i / segments * math.tau
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    if cap:
        for ring, (r, _) in ((rings[0], profile[0]), (rings[-1], profile[-1])):
            if r > 1e-4:
                bm.faces.new(ring)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return _finish(bm, name, _mat(mat), parent, origin)


def mesh(name, verts, faces, mat, parent, origin=(0, 0, 0), smooth=False):
    """A mesh from raw vertex and face lists, for shapes the other helpers cannot make."""
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, name, _mat(mat), parent, origin, smooth=smooth)


def root(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    return obj
