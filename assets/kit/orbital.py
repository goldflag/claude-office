"""Assets for the orbital theme: a snug space station with portholes, neon and a pet drone."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .core import blob, box, colors, cyl, disc, lathe, material, mesh, quad, rod, root, torus
from .office import beanbag, couch

colors(
    orbital_space=("#1B2350", 0.2),
    orbital_screen=("#1A1F2E", 0.15),
    # Neon twins, so the parts the client may pulse own their material.
    orbital_header=("#4FE0E6", 0.3),
    orbital_bulb=("#4FE0E6", 0.3),
    orbital_eye=("#4FE0E6", 0.3),
)

GLOW = 2.0


def _glow(name, strength=GLOW):
    return material(name, emission=strength)


# ------------------------------------------------------------------ helpers


def _xf(obj, matrix):
    """Bakes a 4x4 transform into an object's mesh (around the object's own origin)."""
    obj.data.transform(matrix)
    return obj


def _rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 4, axis)


def _at(offset):
    return Matrix.Translation(Vector(offset))


def _align(start, end):
    """Takes +Z from the origin onto the segment start -> end."""
    a, b = Vector(start), Vector(end)
    q = Vector((0, 0, 1)).rotation_difference((b - a).normalized())
    return Matrix.Translation(a) @ q.to_matrix().to_4x4()


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


def _shell(name, radii, center, aim, open_deg, thickness, mat, parent, rings=12, segs=32):
    """A hollow ellipsoid with a round opening `open_deg` wide (half angle) around `aim`."""
    bm = bmesh.new()
    q = Vector((0, 0, 1)).rotation_difference(Vector(aim).normalized()).to_matrix()
    t0 = math.radians(open_deg)

    def surface(scale):
        rows = []
        for i in range(rings):
            t = t0 + (math.pi - t0) * i / rings
            row = []
            for k in range(segs):
                p = k / segs * math.tau
                u = q @ Vector((math.sin(t) * math.cos(p), math.sin(t) * math.sin(p), math.cos(t)))
                row.append(bm.verts.new(Vector(center) + Vector((u.x * scale[0], u.y * scale[1], u.z * scale[2]))))
            rows.append(row)
        u = q @ Vector((0, 0, -1))
        pole = bm.verts.new(Vector(center) + Vector((u.x * scale[0], u.y * scale[1], u.z * scale[2])))
        return rows, pole

    outer, opole = surface(radii)
    inner, ipole = surface([r - thickness for r in radii])
    for rows, pole, flip in ((outer, opole, False), (inner, ipole, True)):
        for r0, r1 in zip(rows, rows[1:]):
            for k in range(segs):
                j = (k + 1) % segs
                f = (r0[k], r1[k], r1[j], r0[j])
                bm.faces.new(tuple(reversed(f)) if flip else f)
        last = rows[-1]
        for k in range(segs):
            f = (last[k], pole, last[(k + 1) % segs])
            bm.faces.new(tuple(reversed(f)) if flip else f)
    for k in range(segs):
        j = (k + 1) % segs
        bm.faces.new((outer[0][k], outer[0][j], inner[0][j], inner[0][k]))
    return _from_bm(name, bm, mat, parent)


# ------------------------------------------------------------------- assets


def build_porthole():
    r = root("Porthole")
    # The rim runs from the wall plane (y = 0) out to y = -0.12.
    prof = _rounded([(0.50, 0.0), (0.50, 0.105), (0.62, 0.105), (0.62, 0.0)], 0.03, steps=2)
    _xf(lathe("Porthole_Rim", prof + prof[:1], "steel", r, segments=48, cap=False), _rot("X", 90))
    _xf(_ring("Porthole_Lip", 0.50, 0.545, 0.0, 0.12, "white", r, bevel=0.012, segments=48), _rot("X", 90))
    bolts = []
    for i in range(8):
        a = math.radians(22.5 + i * 45)
        b = cyl(f"Porthole_Bolt{i}", 0.026, 0.022, 0.02, (0, 0, 0), "metal", None, radius=0.008, segments=12)
        _xf(b, _at((math.cos(a) * 0.578, -0.1, math.sin(a) * 0.578)) @ _rot("X", 90))
        bolts.append(b)
    _join("Porthole_Bolts", bolts, "metal", r)
    torus("Porthole_Seal", 0.5, 0.012, (0, -0.07, 0), "charcoal", r, upright=True, segments=48, sides=6)
    disc("Porthole_Glass", 0.5, (0, -0.07, 0), _glow("orbital_space", 1.0), r)
    return r


def _plant(kind, x, z, leaves, extras):
    """One hydroponic plant at (x, tray surface z); appends throwaway parts to the lists."""
    y = -0.03
    if kind == 0:  # lettuce heads
        for i in range(4):
            a = i * math.tau / 4 + 0.4
            leaves[0].append(
                blob("_t", 0.045, (x + math.cos(a) * 0.035, y + math.sin(a) * 0.03, z + 0.045), (1, 1, 0.8), "leaf", None, subdivisions=2)
            )
        leaves[1].append(blob("_t", 0.045, (x, y, z + 0.075), (1, 1, 0.9), "sage", None, subdivisions=2))
    elif kind == 1:  # basil: a rosette of upright leaves around a bud
        for j in range(5):
            leaf = blob("_t", 0.055, (0, 0, 0.05), (0.55, 0.26, 1.0), "leaf_dark", None, subdivisions=2)
            _xf(leaf, _at((x, y, z)) @ _rot("Z", j * 72 + 20) @ _rot("X", 32))
            leaves[1 if j % 2 else 0].append(leaf)
        leaves[1].append(blob("_t", 0.03, (x, y, z + 0.06), (1, 1, 1.3), "leaf_dark", None, subdivisions=2))
    else:  # cherry tomatoes
        for i, (dx, dy, dz, s) in enumerate(((0, 0, 0.09, 0.055), (-0.04, 0.01, 0.06, 0.04), (0.04, -0.005, 0.065, 0.042))):
            leaves[1].append(blob("_t", s, (x + dx, y + dy, z + dz), (1, 1, 0.9), "leaf_dark", None, subdivisions=2))
        for dx, dz in ((-0.025, 0.07), (0.03, 0.1), (0.012, 0.045)):
            extras.append(blob("_t", 0.019, (x + dx, y - 0.045, z + dz), (1, 1, 1), "red", None, subdivisions=2))


def build_hydroponics():
    r = root("Hydroponics")
    W, D, H = 1.20, 0.45, 1.45
    for i, x in enumerate((-W / 2 + 0.03, W / 2 - 0.03)):
        box(f"Hydroponics_Side{i}", (0.06, D, H), (x, 0, H / 2), "white", r, radius=0.025)
    box("Hydroponics_Top", (W - 0.02, D, 0.05), (0, 0, H - 0.025), "white", r, radius=0.02)
    box("Hydroponics_Back", (W - 0.1, 0.025, H - 0.06), (0, D / 2 - 0.025, H / 2), "steel", r, radius=0.006)
    box("Hydroponics_Plinth", (W - 0.1, D - 0.05, 0.07), (0, 0, 0.035), "slate", r, radius=0.015)
    # Water reservoir and its feed pipe.
    box("Hydroponics_Tank", (0.62, 0.30, 0.16), (-0.18, 0.0, 0.15), "white", r, radius=0.03)
    box("Hydroponics_TankWindow", (0.40, 0.02, 0.06), (-0.18, -0.152, 0.15), _glow("water", 0.4), r, radius=0.008)
    cyl("Hydroponics_Pump", 0.06, 0.06, 0.12, (0.32, 0.0, 0.07), "slate", r, radius=0.015)
    rod("Hydroponics_Pipe", (0.32, 0.12, 0.15), (0.32, 0.12, 1.17), 0.016, "steel", r)
    for i in range(3):
        z = 0.35 + 0.4 * i
        box(f"Hydroponics_Shelf{i}", (W - 0.1, D - 0.07, 0.02), (0, 0.0, z - 0.08), "steel", r, radius=0.006)
        box(f"Hydroponics_Tray{i}", (W - 0.18, 0.30, 0.07), (0, -0.03, z - 0.035), "white", r, radius=0.022)
        box(f"Hydroponics_Water{i}", (W - 0.26, 0.24, 0.012), (0, -0.03, z - 0.004), "water", r, radius=0.004, segments=1)
        leaves, extras, cups = ([], []), [], []
        for k in range(5):
            x = -0.40 + 0.2 * k
            cups.append(cyl("_t", 0.034, 0.03, 0.014, (x, -0.03, z - 0.002), "charcoal", None, segments=12))
            _plant(i, x, z, leaves, extras)
        _join(f"Hydroponics_Cups{i}", cups, "charcoal", r)
        _join(f"Hydroponics_Leaves{i}", leaves[0], "leaf", r)
        _join(f"Hydroponics_Greens{i}", leaves[1], ("sage", "leaf_dark", "leaf_dark")[i], r)
        if extras:
            _join(f"Hydroponics_Fruit{i}", extras, "red", r)
        # The grow light hangs under the shelf above; its origin is its own center.
        top = (z + 0.4 - 0.09) if i < 2 else (H - 0.05)
        lz = top - 0.045
        box(f"Hydroponics_Light{i}", (W - 0.22, 0.06, 0.036), (0, 0, 0), _glow("grow"), r, radius=0.014, segments=2, origin=(0, -0.13, lz))
        hangers = [box("_t", (0.02, 0.02, 0.03), (x, -0.12, top - 0.015), "steel", None, radius=0.004, segments=1) for x in (-0.42, 0.42)]
        _join(f"Hydroponics_Hangers{i}", hangers, "steel", r)
    return r


def build_telescope():
    r = root("Telescope")
    L = 0.70
    a = Vector((0, -0.30, 0.60))
    tilt = math.asin(0.35 / L)
    axis = Vector((0, math.cos(tilt), math.sin(tilt)))
    up = Vector((0, -math.sin(tilt), math.cos(tilt)))
    b = a + axis * L
    m = _align(a, b)
    # Tube: white, a wider dew shield at the far end, a lens set into it.
    tube = [(0, 0), (0.058, 0), (0.058, 0.50), (0.07, 0.50), (0.07, L), (0.055, L), (0.055, L - 0.03), (0, L - 0.03)]
    _xf(lathe("Telescope_Tube", _rounded(tube, 0.01, closed=False), "white", r, segments=24), m)
    _xf(lathe("Telescope_Lens", [(0, L - 0.029), (0.055, L - 0.029)], _glow("sky", 1.0), r, segments=24), m)
    _xf(_ring("Telescope_Band", 0.057, 0.064, 0.40, 0.46, "clawd", r, bevel=0.004, segments=24), m)
    _xf(_ring("Telescope_Focuser", 0.057, 0.062, 0.02, 0.06, "charcoal", r, bevel=0.004, segments=24), m)
    eyepiece = [(0, -0.085), (0.027, -0.085), (0.027, -0.05), (0.018, -0.045), (0.018, 0.005), (0, 0.005)]
    _xf(lathe("Telescope_Eyepiece", _rounded(eyepiece, 0.006, closed=False), "charcoal", r, segments=16), m)
    # Finder scope riding on top.
    f0 = a + axis * 0.16 + up * 0.095
    finder = [(0, 0), (0.018, 0), (0.018, 0.12), (0.024, 0.13), (0.024, 0.19), (0, 0.19)]
    _xf(lathe("Telescope_Finder", _rounded(finder, 0.005, closed=False), "steel", r, segments=16), _align(f0, f0 + axis))
    for i, s in enumerate((0.05, 0.14)):
        p = a + axis * (0.16 + s)
        rod(f"Telescope_FinderPost{i}", p + up * 0.05, p + up * 0.08, 0.008, "charcoal", r)
    # Cradle rings and the mount head.
    for i, s in enumerate((0.24, 0.44)):
        c = a + axis * s
        _xf(torus(f"Telescope_Cradle{i}", 0.064, 0.011, (0, 0, 0), "charcoal", r, segments=24, sides=8), _align(c, c + axis))
    mid = a + axis * 0.34
    head = mid - up * 0.085
    _xf(box("Telescope_Saddle", (0.05, 0.05, 0.26), (0, 0, 0), "metal", r, radius=0.012), _align(head, head + axis))
    cyl("Telescope_Post", 0.03, 0.03, head.z - 0.6, (0, head.y, 0.6), "metal", r)
    cyl("Telescope_Head", 0.065, 0.06, 0.05, (0, head.y, 0.57), "metal", r, radius=0.012)
    # Tripod.
    legs, feet, struts = [], [], []
    for i, ang in enumerate((90, 210, 330)):
        d = Vector((math.cos(math.radians(ang)), math.sin(math.radians(ang)), 0))
        top = Vector((0, head.y, 0.58)) + d * 0.04
        foot = Vector((0, head.y, 0.0)) + d * 0.34
        legs.append(rod("_t", top, foot + Vector((0, 0, 0.02)), 0.017, "steel", None, radius_end=0.013))
        feet.append(blob("_t", 0.022, foot + Vector((0, 0, 0.0167)), (1, 1, 0.75), "charcoal", None, subdivisions=2))
        s = 0.25 / 0.58
        struts.append(rod("_t", Vector((0, head.y, 0.25)) + d * 0.1, Vector((0, head.y, 0.25)) + d * (0.04 + 0.30 * (1 - s)), 0.007, "metal", None))
    _join("Telescope_Legs", legs, "steel", r)
    _join("Telescope_Feet", feet, "charcoal", r)
    _join("Telescope_Struts", struts, "metal", r)
    cyl("Telescope_Tray", 0.11, 0.11, 0.016, (0, head.y, 0.243), "metal", r, radius=0.006)
    return r


def build_air_hockey():
    r = root("AirHockeyTable")
    W, D, TOP = 1.30, 0.74, 0.50
    for i, (x, y) in enumerate(((-0.55, -0.27), (0.55, -0.27), (-0.55, 0.27), (0.55, 0.27))):
        box(f"AirHockeyTable_Leg{i}", (0.08, 0.08, 0.32), (x, y, 0.16), "metal", r, radius=0.02)
    box("AirHockeyTable_Body", (W - 0.02, D - 0.02, 0.18), (0, 0, 0.39), "white", r, radius=0.035)
    box("AirHockeyTable_Stripe", (W - 0.01, D - 0.01, 0.03), (0, 0, 0.37), "violet", r, radius=0.012)
    box("AirHockeyTable_Field", (W - 0.08, D - 0.08, 0.03), (0, 0, TOP - 0.015), "navy", r, radius=0.006)
    # Neon rails, split at both ends for the goal slots.
    rw, rh, goal = 0.045, 0.055, 0.22
    rz = 0.48 + rh / 2
    rails = [box("_t", (W, rw, rh), (0, sy * (D / 2 - rw / 2), rz), "neon", None, radius=0.015, segments=2) for sy in (-1, 1)]
    piece = (D - 2 * rw - goal) / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            rails.append(box("_t", (rw, piece, rh), (sx * (W / 2 - rw / 2), sy * (goal / 2 + piece / 2), rz), "neon", None, radius=0.015, segments=2))
    _join("AirHockeyTable_Rim", rails, _glow("neon"), r)
    slots = []
    for sx in (-1, 1):
        slots.append(box("_t", (rw + 0.004, goal, 0.03), (sx * (W / 2 - rw / 2), 0, TOP - 0.012), "eye", None, radius=0.006))
        slots.append(box("_t", (0.012, goal, 0.05), (sx * (W / 2 - 0.004), 0, 0.445), "eye", None, radius=0.004))
    _join("AirHockeyTable_Goals", slots, "eye", r)
    lines = [box("_t", (0.014, D - 0.12, 0.004), (0, 0, TOP + 0.001), "neon", None, radius=0.0)]
    lines.append(torus("_t", 0.11, 0.0065, (0, 0, TOP), "neon", None, segments=40, sides=6))
    _join("AirHockeyTable_Lines", lines, _glow("neon"), r)
    creases = []
    for sx in (-1, 1):
        c = torus("_t", 0.15, 0.006, (0, 0, 0), "neon_pink", None, segments=20, sides=6, arc=0.5)
        _xf(c, _at((sx * (W / 2 - rw), 0, TOP)) @ _rot("Z", -90 if sx < 0 else 90))
        creases.append(c)
    _join("AirHockeyTable_Creases", creases, _glow("neon_pink", 1.5), r)
    for i, (x, y, col) in enumerate(((-0.42, 0.06, "neon_pink"), (0.40, -0.08, "sunny"))):
        parts = [
            cyl("_t", 0.05, 0.046, 0.022, (x, y, TOP), col, None, radius=0.008),
            cyl("_t", 0.018, 0.018, 0.035, (x, y, TOP + 0.02), col, None),
            blob("_t", 0.026, (x, y, TOP + 0.065), (1, 1, 0.9), col, None, subdivisions=2),
        ]
        _join(f"AirHockeyTable_Mallet{i}", parts, col, r)
    cyl("AirHockeyTable_Puck", 0.032, 0.032, 0.012, (0.16, 0.1, TOP), "charcoal", r, radius=0.004)
    return r


def build_vending_machine():
    r = root("VendingMachine")
    W, D, H = 0.70, 0.55, 1.50
    front, inner = -D / 2 + 0.02, -0.17
    fy = (front + inner + 0.01) / 2
    fd = inner + 0.01 - front
    for i, (x, y) in enumerate(((-0.29, -0.21), (0.29, -0.21), (-0.29, 0.21), (0.29, 0.21))):
        cyl(f"VendingMachine_Foot{i}", 0.03, 0.03, 0.04, (x, y, 0), "charcoal", r)
    box("VendingMachine_Body", (W - 0.016, D / 2 - inner, H - 0.04), (0, (D / 2 + inner) / 2, 0.04 + (H - 0.04) / 2), "white", r, radius=0.04)
    for i, sx in enumerate((-1, 1)):
        box(f"VendingMachine_Panel{i}", (0.012, 0.34, 1.18), (sx * (W / 2 - 0.008), 0.07, 0.76), "slate", r, radius=0.006)
    # The front frame around the window (white), and the control column (slate).
    wx0, wx1, wz0, wz1 = -0.30, 0.13, 0.42, 1.28
    frame = [
        box("_t", (W, fd, H - wz1), (0, fy, (wz1 + H) / 2), "white", None, radius=0.03),
        box("_t", (wx1 + W / 2, fd, wz0 - 0.04), ((wx1 - W / 2) / 2, fy, (wz0 + 0.04) / 2), "white", None, radius=0.03),
        box("_t", (wx0 + W / 2 + 0.002, fd, wz1 - wz0 + 0.02), ((wx0 - W / 2) / 2, fy, (wz0 + wz1) / 2), "white", None, radius=0.015),
    ]
    _join("VendingMachine_Frame", frame, "white", r)
    box("VendingMachine_Column", (W / 2 - wx1, fd, wz1 - 0.04), ((wx1 + W / 2) / 2, fy, (wz1 + 0.04) / 2), "slate", r, radius=0.025)
    cx = (wx0 + wx1) / 2
    ww = wx1 - wx0
    box("VendingMachine_Inside", (ww + 0.01, 0.012, wz1 - wz0 + 0.01), (cx, inner - 0.004, (wz0 + wz1) / 2), "orbital_screen", r, radius=0.0)
    # Snacks on four shelves.
    palette = ("red", "mustard", "aqua", "violet", "coral", "leaf", "neon_pink", "sunny", "clawd", "sky")
    shelves, snacks = [], {}
    for row in range(4):
        z = wz0 + 0.015 + row * 0.215
        shelves.append(box("_t", (ww, 0.07, 0.012), (cx, inner - 0.038, z - 0.006), "steel", None, radius=0.003, segments=1))
        for k in range(4):
            x = cx + (k - 1.5) * 0.105
            col = palette[(row * 3 + k * 2) % len(palette)]
            if row == 0:
                part = cyl("_t", 0.03, 0.03, 0.11, (x, inner - 0.045, z), col, None, radius=0.008, segments=14)
            elif row == 1:
                part = box("_t", (0.085, 0.045, 0.15), (x, inner - 0.045, z + 0.075), col, None, radius=0.02, segments=2)
            elif row == 2:
                part = box("_t", (0.08, 0.05, 0.11 + 0.02 * (k % 2)), (x, inner - 0.045, z + 0.055 + 0.01 * (k % 2)), col, None, radius=0.01, segments=2)
            else:
                part = box("_t", (0.075, 0.035, 0.13), (x, inner - 0.045, z + 0.065), col, None, radius=0.012, segments=2)
            snacks.setdefault(col, []).append(part)
    _join("VendingMachine_Shelves", shelves, "steel", r)
    for i, (col, parts) in enumerate(sorted(snacks.items())):
        _join(f"VendingMachine_Snack{i}", parts, col, r)
    quad("VendingMachine_Glass", ww, wz1 - wz0, (cx, front + 0.008, (wz0 + wz1) / 2), material("glass", alpha=0.3), r)
    # Controls on the column.
    colx = (wx1 + W / 2) / 2
    box("VendingMachine_Display", (0.15, 0.014, 0.06), (colx, front - 0.004, 1.16), _glow("neon"), r, radius=0.006)
    keys = []
    for kr in range(4):
        for kc in range(3):
            keys.append(box("_t", (0.034, 0.014, 0.028), (colx + (kc - 1) * 0.045, front - 0.004, 1.06 - kr * 0.04), "white", None, radius=0.006, segments=1))
    _join("VendingMachine_Keypad", keys, "white", r)
    box("VendingMachine_CoinSlot", (0.06, 0.014, 0.08), (colx, front - 0.004, 0.78), "charcoal", r, radius=0.01)
    box("VendingMachine_CardReader", (0.08, 0.014, 0.05), (colx, front - 0.004, 0.66), "aqua", r, radius=0.01)
    box("VendingMachine_Flap", (0.36, 0.016, 0.12), (cx, front - 0.004, 0.22), "slate", r, radius=0.012)
    box("VendingMachine_FlapHandle", (0.14, 0.02, 0.02), (cx, front - 0.01, 0.26), "steel", r, radius=0.008)
    box("VendingMachine_Header", (W - 0.08, 0.018, 0.075), (0, front - 0.004, (wz1 + H) / 2), _glow("orbital_header"), r, radius=0.012)
    return r


def build_pod_chair():
    r = root("PodChair")
    lathe(
        "PodChair_Pedestal",
        _rounded([(0, 0), (0.24, 0), (0.24, 0.03), (0.09, 0.06), (0.055, 0.13), (0.05, 0.24), (0, 0.24)], 0.012, closed=False),
        "steel",
        r,
        segments=32,
    )
    aim = (0, -math.cos(math.radians(22)), math.sin(math.radians(22)))
    center = (0, 0.03, 0.70)
    radii = (0.375, 0.37, 0.48)
    _shell("PodChair_Shell", radii, center, aim, 60, 0.05, "white", r)
    lining = [x - 0.054 for x in radii]
    _shell("PodChair_Lining", lining, center, aim, 66, 0.03, "neon", r)
    blob("PodChair_Seat", 0.2, (0, -0.01, 0.335), (1.0, 0.95, 0.23), "neon", r)
    blob("PodChair_Pillow", 0.13, (0, 0.17, 0.62), (1.3, 0.45, 1.0), "violet", r)
    return r


def build_sofa_orbital():
    return couch("SofaOrbital", frame="white", cushion="aqua", pillow="violet", feet="metal")


def build_beanbag_violet():
    return beanbag("BeanbagViolet", "violet")


def build_drone():
    r = root("Drone")
    box("Drone_Body", (0.24, 0.20, 0.14), (0, 0, 0.07), "white", r, radius=0.045, segments=4)
    box("Drone_Band", (0.245, 0.205, 0.025), (0, 0, 0.03), "slate", r, radius=0.012)
    box("Drone_Face", (0.17, 0.02, 0.085), (0, -0.095, 0.08), "orbital_screen", r, radius=0.008)
    eyes = [box("_t", (0.024, 0.01, 0.042), (x, 0, 0), "neon", None, radius=0.01) for x in (-0.042, 0.042)]
    _join("Drone_Eye", eyes, _glow("orbital_eye"), r, origin=(0, -0.106, 0.08))
    arms, motors, guards = [], [], []
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        c = Vector((sx * 0.17, sy * 0.14, 0.0))
        arms.append(rod("_t", (sx * 0.08, sy * 0.06, 0.10), (c.x, c.y, 0.115), 0.014, "white", None))
        motors.append(cyl("_t", 0.024, 0.02, 0.035, (c.x, c.y, 0.098), "metal", None, radius=0.006, segments=14))
        guards.append(torus("_t", 0.074, 0.007, (c.x, c.y, 0.145), "white", None, segments=28, sides=6))
        # The rotor spins about its own center: blades plus a faint blur disc.
        blades = [box("_t", (0.125, 0.022, 0.005), (0, 0, 0), "charcoal", None, radius=0.0024)]
        _xf(blades[0], _rot("Z", 30 + 50 * i))
        blades.append(cyl("_t", 0.012, 0.012, 0.012, (0, 0, -0.006), "charcoal", None, segments=10))
        rotor = _join(f"Drone_Rotor{i}", blades, "charcoal", r, origin=(c.x, c.y, 0.145))
        cyl(f"Drone_Rotor{i}_Blur", 0.064, 0.064, 0.002, (0, 0, -0.001), material("steel", alpha=0.3), rotor, segments=24)
    _join("Drone_Arms", arms, "white", r)
    _join("Drone_Motors", motors, "metal", r)
    _join("Drone_Guards", guards, "white", r)
    rod("Drone_Antenna", (0.05, 0.03, 0.135), (0.065, 0.045, 0.21), 0.005, "steel", r)
    blob("Drone_AntennaTip", 0.014, (0.065, 0.045, 0.214), (1, 1, 1), _glow("neon_pink", 1.5), r, subdivisions=2)
    return r


def build_hat_antenna():
    r = root("Hat_Antenna")
    lathe("Hat_Antenna_Base", _rounded([(0, 0), (0.05, 0), (0.05, 0.012), (0.022, 0.032), (0, 0.034)], 0.008, closed=False), "metal", r, segments=24)
    # A springy coil, then a straight stalk up to the bulb.
    coil = []
    turns, z0, z1, rad = 5, 0.03, 0.115, 0.012
    for k in range(turns * 10 + 1):
        t = k / (turns * 10)
        a = t * turns * math.tau
        coil.append((math.cos(a) * rad * (1 - 0.4 * t), math.sin(a) * rad * (1 - 0.4 * t), z0 + (z1 - z0) * t))
    coil.append((0, 0, z1 + 0.01))
    coil.append((0, 0, 0.165))
    _sweep("Hat_Antenna_Stalk", coil, 0.0045, "steel", r, sides=6)
    blob("Hat_Antenna_Bulb", 0.035, (0, 0, 0), (1, 1, 1), _glow("orbital_bulb"), r, origin=(0, 0, 0.165))
    return r


def build_mini_rocket():
    r = root("MiniRocket")
    body = [(0, 0.016), (0.02, 0.016), (0.028, 0.03), (0.031, 0.055), (0.029, 0.08), (0.024, 0.1), (0, 0.1)]
    lathe("MiniRocket_Body", _rounded(body, 0.006, closed=False), "white", r, segments=20)
    nose = [(0, 0.096), (0.025, 0.096), (0.022, 0.11), (0.014, 0.127), (0.004, 0.139), (0, 0.14)]
    lathe("MiniRocket_Nose", _rounded(nose, 0.004, closed=False), "red", r, segments=20)
    _ring("MiniRocket_Stripe", 0.0285, 0.0315, 0.072, 0.08, "red", r, bevel=0.0015, segments=20)
    lathe("MiniRocket_Nozzle", [(0, 0.004), (0.016, 0.004), (0.012, 0.012), (0.014, 0.02), (0, 0.02)], "metal", r, segments=14)
    fins = []
    outline = [(0.022, 0.066), (0.022, 0.018), (0.05, 0.0), (0.053, 0.006), (0.046, 0.026)]
    for ang in (90, 210, 330):
        f = _prism("_t", outline, 0.008, "red", None, bevel=0.002)
        _xf(f, _rot("Z", ang))
        fins.append(f)
    _join("MiniRocket_Fins", fins, "red", r)
    torus("MiniRocket_WindowRim", 0.012, 0.0032, (0, -0.0295, 0.058), "steel", r, upright=True, segments=16, sides=6)
    disc("MiniRocket_Window", 0.0115, (0, -0.0305, 0.058), _glow("aqua", 0.6), r, segments=16)
    return r


def build_globe():
    r = root("Globe")
    stand = [(0, 0), (0.038, 0), (0.038, 0.008), (0.012, 0.016), (0.006, 0.02), (0.006, 0.048), (0, 0.048)]
    lathe("Globe_Stand", _rounded(stand, 0.004, closed=False), "metal", r, segments=20)
    blob("Globe_Planet", 0.04, (0, 0, 0.087), (1, 1, 1), "violet", r)
    blob("Globe_Spot", 0.013, (0.022, -0.028, 0.098), (1, 0.5, 0.75), "plum", r, subdivisions=2)
    ring = _ring("Globe_Ring", 0.052, 0.07, -0.0015, 0.0015, "aqua", r, bevel=0.001, segments=32)
    _xf(ring, _at((0, 0, 0.087)) @ _rot("Y", 16) @ _rot("X", -24))
    blob("Globe_Moon", 0.009, (-0.06, -0.03, 0.118), (1, 1, 1), "sunny", r, subdivisions=2)
    return r


BUILDERS = [
    build_porthole,
    build_hydroponics,
    build_telescope,
    build_air_hockey,
    build_vending_machine,
    build_pod_chair,
    build_sofa_orbital,
    build_beanbag_violet,
    build_drone,
    build_hat_antenna,
    build_mini_rocket,
    build_globe,
]
