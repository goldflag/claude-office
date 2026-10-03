"""Assets for the seaside theme: surfboards, a tiki juice bar, deck chairs and a beach crab."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .core import blob, box, colors, cyl, lathe, material, mesh, rod, root, torus

colors(
    seaside_coconut=("#7A5034", 0.75),
    seaside_lens=("#1E2533", 0.08),
    seaside_thatch=("#C9A35E", 0.9),
)


# ------------------------------------------------------------------ helpers


def _xf(obj, matrix):
    """Bakes a 4x4 transform into an object's mesh (around the object's own origin)."""
    obj.data.transform(matrix)
    return obj


def _rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 4, axis)


def _at(offset):
    return Matrix.Translation(Vector(offset))


def _join(name, parts, mat, parent, origin=(0, 0, 0), smooth=True):
    """Merges throwaway parts (built in the final object's local space) into one mesh."""
    verts, faces = [], []
    for p in parts:
        m = p.matrix_basis.copy()
        base = len(verts)
        verts.extend(tuple(m @ v.co) for v in p.data.vertices)
        faces.extend(tuple(base + i for i in poly.vertices) for poly in p.data.polygons)
        data = p.data
        bpy.data.objects.remove(p, do_unlink=True)
        bpy.data.meshes.remove(data)
    return mesh(name, verts, faces, mat, parent, origin, smooth=smooth)


def _from_bm(name, bm, mat, parent, origin=(0, 0, 0), smooth=True):
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    return mesh(name, verts, faces, mat, parent, origin, smooth=smooth)


def _rounded(points, radius, steps=3, closed=True):
    """Rounds the corners of a polyline of 2D points (keeps the ends of an open one)."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    out = []
    for i, p in enumerate(pts):
        if not closed and i in (0, n - 1):
            out.append((p.x, p.y))
            continue
        a, b = pts[i - 1], pts[(i + 1) % n]
        q1 = p + (a - p).normalized() * min(radius, (a - p).length / 2)
        q2 = p + (b - p).normalized() * min(radius, (b - p).length / 2)
        for k in range(steps + 1):
            t = k / steps
            c = (1 - t) ** 2 * q1 + 2 * (1 - t) * t * p + t**2 * q2
            out.append((c.x, c.y))
    return out


def _ring(name, r_in, r_out, z0, z1, mat, parent, bevel=0.01, segments=28):
    """A closed rounded ring around Z (a band, a washer or a rim)."""
    prof = _rounded([(r_in, z0), (r_out, z0), (r_out, z1), (r_in, z1)], bevel, steps=2)
    return lathe(name, prof + prof[:1], mat, parent, segments=segments, cap=False)


def _sweep(name, path, radius, mat, parent, origin=(0, 0, 0), sides=8, radii=None):
    """A round tube following a polyline; `radii` tapers it point by point."""
    pts = [Vector(p) for p in path]
    bm = bmesh.new()
    t0 = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    n = t0.cross(ref).normalized()
    rings = []
    for i, p in enumerate(pts):
        t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        t.normalize()
        n = (n - t * n.dot(t)).normalized()
        b = t.cross(n)
        rad = radius if radii is None else radii[i]
        rings.append(
            [bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * rad) for a in (k / sides * math.tau for k in range(sides))]
        )
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            j = (k + 1) % sides
            bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    return _from_bm(name, bm, mat, parent, origin)


def _prism(name, outline, thickness, mat, parent, origin=(0, 0, 0), bevel=0.0):
    """Extrudes a 2D outline drawn in XZ by `thickness` along Y (centered on y = 0)."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -thickness / 2, z)) for x, z in outline]
    back = [bm.verts.new((x, thickness / 2, z)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel:
        edges = [e for e in bm.edges if any(len(f.verts) > 4 for f in e.link_faces)]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=2, profile=0.5, affect="EDGES")
    return _from_bm(name, bm, mat, parent, origin)


def _loft(name, sections, mat, parent, origin=(0, 0, 0), segs=16, power=2.0):
    """Stacks superellipse rings (z, rx, ry) along Z; a ring of zero size closes an end to a point."""
    bm = bmesh.new()
    rings = []
    for z, rx, ry in sections:
        if rx < 1e-5 or ry < 1e-5:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        ring = []
        for k in range(segs):
            a = k / segs * math.tau
            c, s = math.cos(a), math.sin(a)
            ring.append(
                bm.verts.new((rx * math.copysign(abs(c) ** (2 / power), c), ry * math.copysign(abs(s) ** (2 / power), s), z))
            )
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        if len(r0) == 1 and len(r1) > 1:
            for k in range(segs):
                bm.faces.new((r0[0], r1[(k + 1) % segs], r1[k]))
        elif len(r1) == 1 and len(r0) > 1:
            for k in range(segs):
                bm.faces.new((r0[k], r0[(k + 1) % segs], r1[0]))
        elif len(r0) > 1:
            for k in range(segs):
                bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k]))
    for ring in (rings[0], rings[-1]):
        if len(ring) > 1:
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _from_bm(name, bm, mat, parent, origin)


def _spline(points, per=6):
    """Catmull-Rom through the points, `per` samples per span."""
    pts = [Vector(p) for p in points]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2 = pts[max(i - 1, 0)], pts[i], pts[i + 1]
        p3 = pts[min(i + 2, len(pts) - 1)]
        for k in range(per):
            t = k / per
            out.append(
                0.5
                * (
                    2 * p1
                    + (p2 - p0) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                    + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t
                )
            )
    out.append(pts[-1])
    return out


# ------------------------------------------------------------------- assets


def _board_sections(length, width, thick, n=22):
    out = [(-0.012, 0.0, 0.0)]
    for i in range(n + 1):
        t = 0.5 - 0.5 * math.cos(math.pi * i / n)
        u = (t - 0.42) / 0.58 if t >= 0.42 else (0.42 - t) / 0.42 * 0.85
        w = math.sqrt(max(0.0, 1 - u * u))
        out.append((t * length, width / 2 * w, thick / 2 * (0.35 + 0.65 * w)))
    return out


def build_surfboard_rack():
    r = root("SurfboardRack")
    # A low wood rack the boards stand in, plus a rail on the wall they lean on.
    box("SurfboardRack_Base", (1.10, 0.28, 0.06), (0, -0.03, 0.03), "wood", r, radius=0.015)
    box("SurfboardRack_Lip", (1.10, 0.04, 0.12), (0, -0.15, 0.08), "wood_dark", r, radius=0.015)
    pegs = [box("_t", (0.045, 0.045, 0.22), (x, -0.15, 0.11), "wood", None, radius=0.015, segments=2) for x in (-0.53, -0.185, 0.185, 0.53)]
    _join("SurfboardRack_Pegs", pegs, "wood", r)
    box("SurfboardRack_Rail", (1.10, 0.045, 0.07), (0, 0.19, 1.40), "wood", r, radius=0.018)
    lean = 8.0
    for i, (x, col) in enumerate(((-0.37, "coral"), (0.0, "aqua"), (0.37, "sunny"))):
        length = (1.62, 1.68, 1.64)[i]
        secs = _board_sections(length, 0.30, 0.06)
        place = _at((x, -0.05, 0.06)) @ _rot("X", -lean)
        _xf(_loft(f"SurfboardRack_Board{i}", secs, col, r, segs=18, power=2.4), place)
        stripe = [(z, min(0.022, rx * 0.4), ry + 0.0035) for z, rx, ry in secs if 0.03 * length < z < 0.97 * length]
        stripe = [(stripe[0][0] - 0.01, 0, 0), *stripe, (stripe[-1][0] + 0.01, 0, 0)]
        _xf(_loft(f"SurfboardRack_Stripe{i}", stripe, "white", r, segs=12, power=6.0), place)
    return r


def build_lifebuoy():
    r = root("Lifebuoy")
    R, tube, y0 = 0.165, 0.055, -0.072
    halves = ([], [])
    for i in range(8):
        seg = torus("_t", R, tube, (0, 0, 0), "red", None, upright=True, segments=6, sides=14, arc=1 / 8)
        halves[i % 2].append(_xf(seg, _at((0, y0, 0)) @ _rot("Y", 22.5 + i * 45)))
    _join("Lifebuoy_Red", halves[1], "red", r)
    _join("Lifebuoy_White", halves[0], "white", r)
    # A rope looping round the outside between four lashings.
    rope = []
    for k in range(4):
        a0 = math.radians(45 + 90 * k)
        path = []
        for j in range(13):
            a = a0 + math.radians(90) * j / 12
            rad = R + tube + 0.004 + 0.035 * math.sin(math.pi * j / 12)
            path.append((math.cos(a) * rad, y0 + 0.004 * math.sin(math.pi * j / 12), math.sin(a) * rad))
        rope.append(_sweep("_t", path, 0.007, "straw", None, sides=6))
        c = Vector((math.cos(a0) * R, y0, math.sin(a0) * R))
        tangent = Vector((-math.sin(a0), 0, math.cos(a0)))
        lash = torus("_t", tube + 0.004, 0.008, (0, 0, 0), "straw", None, segments=16, sides=6)
        q = Vector((0, 0, 1)).rotation_difference(tangent)
        _xf(lash, Matrix.Translation(c) @ q.to_matrix().to_4x4())
        rope.append(lash)
    _join("Lifebuoy_Rope", rope, "straw", r)
    rod("Lifebuoy_Peg", (0, 0, 0.09), (0, -0.14, 0.09), 0.012, "wood_dark", r)
    blob("Lifebuoy_PegKnob", 0.018, (0, -0.145, 0.09), (1, 0.7, 1), "wood_dark", r, subdivisions=2)
    return r


def _teeth(parts_out, start, end, count, hang, length, width, thick, seed=0):
    """Straw fringe: tapered teeth along start->end, hanging along `hang`."""
    a, b = Vector(start), Vector(end)
    along = (b - a).normalized()
    hang = Vector(hang).normalized()
    side = along.cross(hang).normalized()
    verts, faces = [], []
    for i in range(count):
        c = a + (b - a) * ((i + 0.5) / count)
        ln = length * (0.82 + 0.3 * (((i + seed) * 7) % 5) / 4)
        tip = c + hang * ln + along * (0.01 * (((i + seed) * 3) % 3 - 1))
        base = len(verts)
        for s in (-1, 1):
            verts.append(c - along * width / 2 + side * s * thick / 2)
            verts.append(c + along * width / 2 + side * s * thick / 2)
            verts.append(tip + side * s * thick * 0.15)
        faces += [
            (base, base + 1, base + 2),
            (base + 3, base + 5, base + 4),
            (base, base + 3, base + 4, base + 1),
            (base + 1, base + 4, base + 5, base + 2),
            (base + 2, base + 5, base + 3, base),
        ]
    parts_out.append((verts, faces))


def _merge_raw(name, raws, mat, parent, origin=(0, 0, 0), matrix=None, smooth=False):
    verts, faces = [], []
    for vs, fs in raws:
        base = len(verts)
        verts.extend(tuple(matrix @ Vector(v)) if matrix else tuple(v) for v in vs)
        faces.extend(tuple(base + i for i in f) for f in fs)
    return mesh(name, verts, faces, mat, parent, origin, smooth=smooth)


def build_juice_bar():
    r = root("JuiceBar")
    TOP = 0.78
    box("JuiceBar_Cabinet", (1.36, 0.42, 0.73), (0, 0.03, 0.365), "wood_dark", r, radius=0.02)
    # Bamboo cladding across the front and both sides.
    poles, nodes = [], []
    n = 21
    for i in range(n):
        x = -0.68 + 1.36 * i / (n - 1)
        poles.append(cyl("_t", 0.032, 0.032, 0.73, (x, -0.212, 0.0), "bamboo", None, segments=10))
        for zn in (0.22 + 0.04 * (i % 3), 0.5 - 0.03 * (i % 2)):
            nodes.append(cyl("_t", 0.036, 0.036, 0.016, (x, -0.212, zn), "wood", None, segments=10))
    for sx in (-1, 1):
        for k in range(7):
            y = -0.17 + 0.068 * k
            poles.append(cyl("_t", 0.032, 0.032, 0.73, (sx * 0.712, y, 0.0), "bamboo", None, segments=10))
            for zn in (0.26 + 0.04 * (k % 2), 0.52):
                nodes.append(cyl("_t", 0.036, 0.036, 0.016, (sx * 0.712, y, zn), "wood", None, segments=10))
    # Back posts up to the awning.
    for sx in (-1, 1):
        poles.append(cyl("_t", 0.04, 0.04, 1.76, (sx * 0.70, 0.235, 0.0), "bamboo", None, segments=12))
        for zn in (0.95, 1.25, 1.55):
            nodes.append(cyl("_t", 0.045, 0.045, 0.02, (sx * 0.70, 0.235, zn), "wood", None, segments=12))
    poles.append(rod("_t", (-0.72, 0.235, 1.72), (0.72, 0.235, 1.72), 0.03, "bamboo", None))
    _join("JuiceBar_Bamboo", poles, "bamboo", r)
    _join("JuiceBar_BambooNodes", nodes, "wood_dark", r)
    box("JuiceBar_Top", (1.50, 0.55, 0.05), (0, 0, TOP - 0.025), "wood", r, radius=0.018)
    # Straw thatch awning, 1.7 x 0.8, sloping down toward -Y, in three fringed tiers.
    slope = 16.7
    place = _at((0, -0.07, 1.70)) @ _rot("X", slope)
    _xf(box("JuiceBar_Thatch", (1.7, 0.8, 0.07), (0, 0, 0), "straw", r), place)
    tiers, rolls = [], []
    # Shingled skirts, each resting on the slab with its top end tucked under a bundled roll.
    for k, y in enumerate((0.36, 0.10, -0.16)):
        hang = (0, -math.cos(math.radians(10)), -math.sin(math.radians(10)))
        _teeth(tiers, (-0.87, y, 0.08), (0.87, y, 0.08), 28, hang, 0.27, 0.068, 0.02, seed=k)
        rolls.append(rod("_t", (-0.87, y + 0.01, 0.08), (0.87, y + 0.01, 0.08), 0.028, "straw", None, segments=10))
    _teeth(tiers, (-0.87, -0.385, 0.03), (0.87, -0.385, 0.03), 28, (0, -0.25, -1), 0.15, 0.068, 0.022, seed=5)
    for sx in (-1, 1):
        _teeth(tiers, (sx * 0.855, 0.40, 0.03), (sx * 0.855, -0.40, 0.03), 12, (sx * 0.25, 0, -1), 0.11, 0.07, 0.02, seed=3)
    _merge_raw("JuiceBar_Fringe", tiers, "seaside_thatch", r, matrix=place)
    _xf(_join("JuiceBar_ThatchRolls", rolls, "straw", r), place)
    # On the counter: a blender, two coconut cups and a pineapple.
    bx, by = -0.48, 0.04
    box("JuiceBar_BlenderBase", (0.13, 0.13, 0.085), (bx, by, TOP + 0.0425), "white", r, radius=0.025)
    blob("JuiceBar_BlenderButton", 0.014, (bx, by - 0.066, TOP + 0.045), (1, 0.6, 1), "red", r, subdivisions=2)
    jar = [(0, TOP + 0.085), (0.045, TOP + 0.085), (0.058, TOP + 0.24), (0.062, TOP + 0.25), (0, TOP + 0.25)]
    lathe("JuiceBar_BlenderJar", jar, material("glass", alpha=0.3), r, center=(bx, by, 0), segments=20)
    lathe("JuiceBar_Smoothie", [(0, TOP + 0.09), (0.042, TOP + 0.09), (0.051, TOP + 0.19), (0, TOP + 0.19)], "pink", r, center=(bx, by, 0), segments=20)
    cyl("JuiceBar_BlenderLid", 0.065, 0.065, 0.025, (bx, by, TOP + 0.245), "charcoal", r, radius=0.008, segments=20)
    for i, (x, y, straw) in enumerate(((-0.13, -0.1, "coral"), (0.12, -0.06, "aqua"))):
        blob(f"JuiceBar_Coconut{i}", 0.06, (x, y, TOP + 0.05), (1, 1, 0.85), "seaside_coconut", r)
        cyl(f"JuiceBar_CoconutTop{i}", 0.034, 0.034, 0.008, (x, y, TOP + 0.093), "white", r, segments=16)
        _sweep(f"JuiceBar_Straw{i}", [(x - 0.005, y, TOP + 0.07), (x + 0.005, y, TOP + 0.17), (x + 0.012, y, TOP + 0.185), (x + 0.045, y - 0.01, TOP + 0.2)], 0.0065, straw, r, sides=8)
    ux, uy = 0.12, -0.06
    rod("JuiceBar_UmbrellaStick", (ux - 0.02, uy + 0.01, TOP + 0.08), (ux - 0.045, uy + 0.02, TOP + 0.2), 0.003, "wood", r)
    canopy = lathe("JuiceBar_UmbrellaTop", [(0, 0.022), (0.022, 0.012), (0.045, 0.0), (0.001, 0.0)], "sunny", r, segments=8)
    _xf(canopy, _at((ux - 0.045, uy + 0.02, TOP + 0.195)) @ _rot("Y", -14))
    px, py = 0.48, 0.04
    blob("JuiceBar_Pineapple", 0.06, (px, py, TOP + 0.078), (1, 1, 1.3), "mustard", r)
    crown = []
    for k in range(7):
        a = k * math.tau / 7
        out = 0.03 if k % 2 else 0.018
        hgt = 0.1 if k % 2 else 0.12
        crown.append(rod("_t", (px, py, TOP + 0.14), (px + math.cos(a) * out, py + math.sin(a) * out, TOP + 0.14 + hgt), 0.016, "leaf_dark", None, radius_end=0.002, segments=6))
    _join("JuiceBar_PineappleLeaves", crown, "leaf_dark", r)
    return r


def _beam(a, b, w, h, mat, radius=0.012):
    a, b = Vector(a), Vector(b)
    part = box("_t", (w, (b - a).length, h), (0, 0, 0), mat, None, radius=radius, segments=2)
    q = Vector((0, 1, 0)).rotation_difference((b - a).normalized())
    return _xf(part, Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4())


def _strip(path, x0, x1, thick):
    """A flat band through a (y, z) path between x0 and x1, as raw verts and faces."""
    pts = [Vector((0, p[0], p[1])) if len(p) == 2 else Vector(p) for p in path]
    n = len(pts)
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = Vector((0, -t.z, t.y))
        for x in (x0, x1):
            for s in (-0.5, 0.5):
                verts.append((x, p.y + nrm.y * thick * s, p.z + nrm.z * thick * s))
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        faces += [(a + 1, a + 3, b + 3, b + 1), (a, b, b + 2, a + 2), (a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3)]
    e = 4 * (n - 1)
    faces += [(0, 2, 3, 1), (e, e + 1, e + 3, e + 2)]
    return verts, faces


def build_deck_chair():
    r = root("DeckChair")
    frame = []
    for sx in (-1, 1):
        x = sx * 0.275
        frame.append(_beam((x, -0.10, 0.0095), (x, 0.46, 0.88), 0.04, 0.035, "wood"))  # back rail
        frame.append(_beam((x, -0.44, 0.0015), (x, -0.40, 0.45), 0.04, 0.035, "wood"))  # front leg
        frame.append(_beam((x, -0.43, 0.40), (x, 0.12, 0.33), 0.035, 0.035, "wood"))  # seat rail
        frame.append(_beam((x, 0.21, 0.50), (x, 0.46, 0.008), 0.04, 0.035, "wood"))  # rear leg
    for y, z in ((0.452, 0.87), (-0.405, 0.43)):
        frame.append(rod("_t", (-0.30, y, z), (0.30, y, z), 0.02, "wood", None))
    for y, z in ((-0.432, 0.1), (0.41, 0.1)):
        frame.append(rod("_t", (-0.29, y, z), (0.29, y, z), 0.014, "wood", None))
    _join("DeckChair_Frame", frame, "wood", r)
    path = _spline(
        [(0, -0.405, 0.452), (0, -0.33, 0.38), (0, -0.20, 0.30), (0, -0.06, 0.268), (0, 0.06, 0.28), (0, 0.16, 0.35),
         (0, 0.25, 0.48), (0, 0.33, 0.62), (0, 0.40, 0.75), (0, 0.448, 0.892)],
        per=4,
    )
    edges = [-0.25 + 0.1 * k for k in range(6)]
    for col, ks in (("coral", (0, 2, 4)), ("white", (1, 3))):
        _merge_raw(f"DeckChair_Sling{col.capitalize()}", [_strip(path, edges[k], edges[k + 1], 0.014) for k in ks], col, r, smooth=True)
    return r


def _canopy_panels(R, apex, drop, thick, panels=8, A=6, M=7, inner=0.05):
    """Raw meshes for the umbrella panels; even panels in the first list, odd in the second."""
    out = ([], [])
    for p in range(panels):
        top, bot = [], []
        for i in range(M + 1):
            rn = inner + (1 - inner) * i / M
            for j in range(A + 1):
                u = j / A
                a = (p + u) * math.tau / panels
                puff = math.sin(math.pi * u)
                rho = R * rn * (1 - 0.05 * puff * rn**4)
                z = apex - drop * rn**1.15 + 0.03 * puff * math.sin(math.pi * min(1.0, rn * 1.1))
                top.append((math.cos(a) * rho, math.sin(a) * rho, z))
                bot.append((math.cos(a) * rho, math.sin(a) * rho, z - thick))
        verts = top + bot
        nb = len(top)
        idx = lambda i, j: i * (A + 1) + j  # noqa: E731
        faces = []
        for i in range(M):
            for j in range(A):
                q = (idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j))
                faces.append(q)
                faces.append(tuple(nb + v for v in reversed(q)))
        for j in range(A):  # the hem
            a, b = idx(M, j), idx(M, j + 1)
            faces.append((a, b, nb + b, nb + a))
        out[p % 2].append((verts, faces))
    return out


def build_beach_umbrella():
    r = root("BeachUmbrella")
    base = _rounded([(0, 0), (0.22, 0), (0.22, 0.035), (0.12, 0.08), (0.045, 0.105), (0, 0.105)], 0.02, closed=False)
    lathe("BeachUmbrella_Base", base, "aqua", r, segments=32)
    rod("BeachUmbrella_Pole", (0, 0, 0.09), (0, 0, 1.65), 0.022, "white", r)
    _ring("BeachUmbrella_Joint", 0.018, 0.03, 0.80, 0.87, "coral", r, bevel=0.008, segments=16)
    cyl("BeachUmbrella_Runner", 0.035, 0.035, 0.05, (0, 0, 1.26), "white", r, radius=0.01, segments=16)
    coral, white = _canopy_panels(0.95, 1.66, 0.30, 0.016)
    _merge_raw("BeachUmbrella_PanelsCoral", coral, "coral", r, smooth=True)
    _merge_raw("BeachUmbrella_PanelsWhite", white, "white", r, smooth=True)
    ribs = []
    for k in range(8):
        a = k * math.tau / 8
        rho = 0.62
        ribs.append(rod("_t", (0, 0, 1.30), (math.cos(a) * rho, math.sin(a) * rho, 1.66 - 0.30 * (rho / 0.95) ** 1.15 - 0.022), 0.007, "white", None, segments=6))
    _join("BeachUmbrella_Ribs", ribs, "white", r)
    blob("BeachUmbrella_Finial", 0.04, (0, 0, 1.68), (1, 1, 0.8), "white", r, subdivisions=2)
    return r


def _frond(base, phi, length, width, rise, droop, n=16):
    d = Vector((math.cos(phi), math.sin(phi), 0))
    side = Vector((-math.sin(phi), math.cos(phi), 0))
    up = Vector((0, 0, 1))
    verts, faces = [], []
    for i in range(n + 1):
        s = i / n
        c = Vector(base) + d * (length * s) + up * (length * (rise * s - droop * s * s))
        w = width * math.sin(math.pi * s**0.8) ** 0.8
        hw = w * (1.0 if i % 2 == 0 else 0.55)
        verts += [c + side * hw - up * hw * 0.45, c + up * 0.012 * (w / width), c - side * hw - up * hw * 0.45]
    for i in range(n):
        a, b = 3 * i, 3 * (i + 1)
        faces += [(a, a + 1, b + 1, b), (a + 1, a + 2, b + 2, b + 1)]
    return verts, faces


def build_palm_plant():
    r = root("PalmPlant")
    pot = _rounded([(0, 0), (0.17, 0), (0.22, 0.38), (0.225, 0.41), (0.198, 0.41), (0.19, 0.36), (0, 0.36)], 0.012, closed=False)
    lathe("PalmPlant_Pot", pot, "white", r, segments=28)
    _ring("PalmPlant_Band", 0.182, 0.208, 0.2, 0.25, "aqua", r, bevel=0.008, segments=28)
    cyl("PalmPlant_Soil", 0.195, 0.195, 0.02, (0, 0, 0.35), "coffee", r, segments=24)
    # A curving, ringed trunk of stacked flared segments.
    p0, p1, p2, p3 = (Vector(v) for v in ((0, 0, 0.34), (0, 0, 0.95), (0.05, 0.015, 1.42), (0.11, 0.04, 1.78)))
    bez = [(1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t**3 * p3 for t in (k / 10 for k in range(11))]
    segs = []
    for k in range(10):
        rad = 0.062 - 0.0018 * k
        segs.append(rod("_t", bez[k], bez[k + 1] + (bez[k + 1] - bez[k]) * 0.04, rad * 0.85, "wood_dark", None, radius_end=rad * 1.12, segments=12))
    _join("PalmPlant_Trunk", segs, "wood_dark", r)
    crown = bez[-1] + Vector((0, 0, 0.02))
    blob("PalmPlant_Crown", 0.065, crown, (1, 1, 0.8), "leaf_dark", r, subdivisions=2)
    fronds = ([], [])
    for k in range(7):
        phi = math.radians(k * 360 / 7 + 12)
        length = 0.62 + 0.06 * ((k * 2) % 3 - 1)
        fronds[k % 2].append(_frond(crown + Vector((0, 0, 0.02)), phi, length, 0.12, 0.6, 1.05 + 0.1 * (k % 3)))
    _merge_raw("PalmPlant_Fronds", fronds[0], "leaf", r, smooth=True)
    _merge_raw("PalmPlant_FrondsDark", fronds[1], "leaf_dark", r, smooth=True)
    nuts = [blob("_t", 0.048, crown + Vector((math.cos(a) * 0.06, math.sin(a) * 0.06, -0.07)), (1, 1, 1.05), "seaside_coconut", None, subdivisions=2) for a in (-1.9, -0.9)]
    _join("PalmPlant_Coconuts", nuts, "seaside_coconut", r)
    return r


def build_beach_paddle():
    r = root("BeachPaddle")
    box("BeachPaddle_Handle", (0.026, 0.018, 0.085), (0, 0, 0.0425), "wood_dark", r, radius=0.008)
    box("BeachPaddle_Grip", (0.031, 0.023, 0.05), (0, 0, 0.03), "coral", r, radius=0.009)
    outline = _rounded([(-0.055, 0.07), (0.055, 0.07), (0.055, 0.20), (-0.055, 0.20)], 0.04, steps=4)
    _prism("BeachPaddle_Blade", outline, 0.012, "wood", r, bevel=0.003)
    dot = cyl("BeachPaddle_Dot", 0.028, 0.028, 0.004, (0, 0, 0), "coral", r, segments=20)
    _xf(dot, _at((0, -0.004, 0.14)) @ _rot("X", 90))
    return r


def build_crab():
    r = root("Crab")
    blob("Crab_Body", 0.11, (0, 0, 0.10), (1.0, 0.16 / 0.22, 0.08 / 0.22), "red", r)
    spots = [blob("_t", 0.016, (x, y, 0.1335), (1, 1, 0.3), "coral", None, subdivisions=2) for x, y in ((-0.04, 0.02), (0.045, 0.015), (0.0, 0.045))]
    _join("Crab_Spots", spots, "coral", r)
    cheeks = [blob("_t", 0.013, (sx * 0.056, -0.067, 0.098), (1, 0.35, 0.7), "pink", None, subdivisions=2) for sx in (-1, 1)]
    _join("Crab_Cheeks", cheeks, "pink", r)
    smile = torus("Crab_Smile", 0.014, 0.0032, (0, 0, 0), "eye", r, upright=True, segments=10, sides=6, arc=0.5)
    _xf(smile, _at((0, -0.077, 0.104)) @ _rot("Y", 180))
    stalks, balls, pupils = [], [], []
    for sx in (-1, 1):
        stalks.append(rod("_t", (sx * 0.032, -0.04, 0.125), (sx * 0.045, -0.052, 0.19), 0.008, "red", None))
        balls.append(blob("_t", 0.021, (sx * 0.045, -0.054, 0.2), (1, 1, 1), "white", None, subdivisions=2))
        pupils.append(blob("_t", 0.0105, (sx * 0.047, -0.072, 0.203), (1, 0.6, 1.1), "eye", None, subdivisions=2))
    _join("Crab_Stalks", stalks, "red", r)
    _join("Crab_Eyes", balls, "white", r)
    _join("Crab_Pupils", pupils, "eye", r)
    for side, sx in (("L", -1), ("R", 1)):
        # Claw: pivot at the shoulder, reaching forward (-Y) with a pincer.
        claw = _sweep(f"Crab_Claw{side}", [(0, 0, 0), (sx * 0.03, -0.035, -0.012), (sx * 0.045, -0.075, 0.0)], 0.015, "red", r, origin=(sx * 0.095, -0.045, 0.095), sides=8)
        blob(f"Crab_Claw{side}_Hand", 0.038, (sx * 0.05, -0.11, 0.006), (0.85, 1.0, 0.75), "red", claw)
        jaws = [
            rod("_t", (sx * 0.048, -0.13, 0.016), (sx * 0.056, -0.185, 0.026), 0.016, "red", None, radius_end=0.004, segments=8),
            rod("_t", (sx * 0.05, -0.13, -0.006), (sx * 0.054, -0.17, -0.014), 0.011, "red", None, radius_end=0.003, segments=8),
        ]
        _join(f"Crab_Claw{side}_Pincer", jaws, "coral", claw)
        for i, (y, dy) in enumerate(((-0.02, -0.03), (0.015, 0.0), (0.048, 0.035))):
            path = [(0, 0, 0), (sx * 0.075, dy * 0.5, 0.03), (sx * 0.118, dy, -0.083)]
            _sweep(f"Crab_Leg{side}{i}", path, 0.012, "red", r, origin=(sx * 0.085, y, 0.085), sides=7, radii=(0.013, 0.011, 0.005))
    return r


def build_hat_straw():
    r = root("Hat_Straw")
    brim = _rounded([(0, 0), (0.34, 0), (0.36, 0.014), (0.345, 0.024), (0.3, 0.018), (0, 0.018)], 0.008, closed=False)
    lathe("Hat_Straw_Brim", brim, "straw", r, segments=32)
    crown = _rounded([(0, 0.015), (0.17, 0.015), (0.168, 0.09), (0.15, 0.125), (0.08, 0.137), (0, 0.137)], 0.03, closed=False)
    lathe("Hat_Straw_Crown", crown, "straw", r, segments=28)
    stitches = [torus("_t", rad, 0.0035, (0, 0, 0.019), "bamboo", None, segments=32, sides=4) for rad in (0.23, 0.29)]
    _join("Hat_Straw_Stitch", stitches, "bamboo", r)
    _ring("Hat_Straw_Ribbon", 0.164, 0.175, 0.018, 0.058, "coral", r, bevel=0.005, segments=32)
    bow = [
        blob("_t", 0.03, (0.17, -0.025, 0.045), (0.45, 1.0, 0.65), "coral", None, subdivisions=2),
        blob("_t", 0.03, (0.17, 0.03, 0.045), (0.45, 1.0, 0.65), "coral", None, subdivisions=2),
        blob("_t", 0.014, (0.18, 0.002, 0.04), (0.8, 1, 1), "coral", None, subdivisions=2),
    ]
    _join("Hat_Straw_Bow", bow, "coral", r)
    return r


def build_hat_sunglasses():
    r = root("Hat_Sunglasses")
    def plate(w, h, rad, t, mat, x, y):
        outline = _rounded([(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)], rad, steps=3)
        return _xf(_prism("_t", outline, t, mat, None, bevel=0.003), _at((x, y, 0)))

    frames = [plate(0.152, 0.108, 0.04, 0.016, "coral", sx * 0.135, 0.003) for sx in (-1, 1)]
    frames.append(box("_t", (0.13, 0.012, 0.018), (0, 0.003, 0.024), "coral", None, radius=0.005))
    _join("Hat_Sunglasses_Frame", frames, "coral", r)
    lenses = [plate(0.13, 0.09, 0.032, 0.02, "seaside_lens", sx * 0.135, 0.0) for sx in (-1, 1)]
    _join("Hat_Sunglasses_Lenses", lenses, "seaside_lens", r)
    glints = [box("_t", (0.022, 0.004, 0.012), (sx * 0.135 - 0.03, -0.0105, 0.022), "white", None, radius=0.002, segments=1) for sx in (-1, 1)]
    _join("Hat_Sunglasses_Glint", glints, "white", r)
    return r


def build_seashell():
    r = root("Seashell")
    R, rays, A, M = 0.037, 7, 28, 6
    hinge_y = 0.016
    t0, t1 = math.radians(-78), math.radians(78)

    def top(i, j):
        rn = 0.12 + 0.88 * i / M
        u = j / A
        th = t0 + (t1 - t0) * u
        rho = R * rn * (1 + 0.05 * math.cos(math.tau * rays * u) * rn)
        ridge = 0.0028 * rn * (0.5 + 0.5 * math.cos(math.tau * rays * u))
        z = 0.002 + 0.017 * math.sqrt(max(0.0, 1 - rn**2.2)) * (0.65 + 0.35 * math.cos(th)) + ridge
        return (math.sin(th) * rho, hinge_y - math.cos(th) * rho, z)

    tv = [[top(i, j) for j in range(A + 1)] for i in range(M + 1)]
    parts = {"cream": ([], [], {}), "pink": ([], [], {})}

    def vid(part, i, j):
        vs, _, ids = parts[part]
        if (i, j) not in ids:
            ids[(i, j)] = len(vs)
            vs.append(tv[i][j])
        return ids[(i, j)]

    for i in range(M):
        for j in range(A):
            part = "pink" if int(j / A * rays) % 2 else "cream"
            parts[part][1].append((vid(part, i, j), vid(part, i + 1, j), vid(part, i + 1, j + 1), vid(part, i, j + 1)))
    # Walls and a flat underside close the cream part.
    cream_v, cream_f, _ = parts["cream"]
    loop = [(i, 0) for i in range(M + 1)] + [(M, j) for j in range(1, A + 1)]
    loop += [(i, A) for i in range(M - 1, -1, -1)] + [(0, j) for j in range(A - 1, 0, -1)]
    # (Own vertices, so the walls do not bend the dome's smooth normals.)
    n = len(loop)
    tops = len(cream_v)
    cream_v.extend(tv[i][j] for i, j in loop)
    base = len(cream_v)
    cream_v.extend((tv[i][j][0], tv[i][j][1], 0.0) for i, j in loop)
    for k in range(n):
        k2 = (k + 1) % n
        cream_f.append((tops + k2, tops + k, base + k, base + k2))
    cream_f.append(tuple(base + k for k in range(n)))
    pink_v, pink_f, _ = parts["pink"]
    mesh("Seashell_Shell", cream_v, cream_f, "cream", r, smooth=True)
    mesh("Seashell_Rays", pink_v, pink_f, "pink", r, smooth=True)
    box("Seashell_Hinge", (0.026, 0.012, 0.008), (0, hinge_y + 0.006, 0.004), "pink", r, radius=0.003, segments=2)
    return r


def build_pail():
    r = root("Pail")
    prof = _rounded([(0, 0), (0.034, 0), (0.045, 0.056), (0.048, 0.06), (0.041, 0.06), (0.036, 0.042), (0, 0.042)], 0.003, closed=False)
    lathe("Pail_Bucket", prof, "aqua", r, segments=24)
    lathe("Pail_Sand", [(0, 0.053), (0.02, 0.051), (0.039, 0.044), (0.0385, 0.04), (0, 0.04)], "sand", r, segments=20)
    handle = torus("Pail_Handle", 0.047, 0.0028, (0, 0, 0), "sunny", r, upright=True, segments=16, sides=6, arc=0.5)
    _xf(handle, _at((0, 0, 0.054)) @ _rot("X", -22))
    lugs = [blob("_t", 0.006, (sx * 0.046, 0, 0.054), (1, 1, 1), "sunny", None, subdivisions=2) for sx in (-1, 1)]
    _join("Pail_Lugs", lugs, "sunny", r)
    tilt = _at((0.012, 0.004, 0.044)) @ _rot("Y", 18) @ _rot("X", 10)
    spade = [
        box("_t", (0.024, 0.005, 0.026), (0, 0, 0.004), "coral", None, radius=0.002, segments=1),
        rod("_t", (0, 0, 0.015), (0, 0, 0.07), 0.0035, "coral", None, segments=6),
        box("_t", (0.018, 0.007, 0.007), (0, 0, 0.072), "coral", None, radius=0.003, segments=1),
    ]
    for p in spade:
        _xf(p, tilt)
    _join("Pail_Spade", spade, "coral", r)
    return r


BUILDERS = [
    build_surfboard_rack,
    build_lifebuoy,
    build_juice_bar,
    build_deck_chair,
    build_beach_umbrella,
    build_palm_plant,
    build_beach_paddle,
    build_crab,
    build_hat_straw,
    build_hat_sunglasses,
    build_seashell,
    build_pail,
]
