# render_cad.py — "architectural breakdown" render of the Rhizome lockup.
#
# The lockup as a deep extruded solid seen from below, drawn as CAD line art
# (Freestyle edges on a pale blueprint background) with construction lines
# laid over the real geometry: bar axes, guide circles, type guides.
#
#   blender --background --factory-startup --python logo/src/render_cad.py -- \
#       --svg logo/renders/molecule/lockup-ref.svg --out out.png [--percent 50]

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render3d  # noqa: E402  (shares the SVG -> nonzero-filled solid code)

# --- lockup geometry in SVG user units --------------------------------------
# The mark is referenceGraph() from molecule.mjs (512 box), placed by the
# lockup's <g transform="translate(-10.76 -185.82) scale(0.4482)">.
MARK_T = (-10.76, -185.82, 0.4482)
MARK_NODES = [  # (x, y, r) in the 512 box; index 0 is the hub
    (313.1, 233.0, 15.0),
    (326.4, 109.0, 39.6),
    (168.9, 200.7, 39.6),
    (62.6, 269.6, 39.6),
    (166.8, 367.6, 39.6),
    (447.3, 302.9, 39.6),
    (324.3, 404.1, 39.6),
]
MARK_EDGES = [(0, 1), (0, 2), (2, 3), (0, 4), (0, 5), (5, 6)]
FIRST_POINT = (303.74 * MARK_T[2] + MARK_T[0], 197.33 * MARK_T[2] + MARK_T[1])
# Wordmark (Roboto Bold outlines): baseline, x-height and cap height.
WORD_X = (280.36, 1041.20)
GLYPH_X = [280.36, 404.57, 517.27, 563.56, 661.51, 777.33, 945.20]  # left edges
BASELINE, X_HEIGHT, CAP = 0.0, -105.66, -142.19

# Colour schemes: "blueprint" (navy on pale blue) and "dark" (white ink on
# black, photocopied and worn, after the "A Thousand Plateaus" cover).
STYLES = {
    "blueprint": dict(ink=(0.07, 0.11, 0.2, 1), guide=(0.42, 0.55, 0.75, 1),
                      paper=(0.93, 0.955, 0.985, 1), face=(1, 1, 1, 1), sun=2.0),
    "dark": dict(ink=(0.95, 0.95, 0.93, 1), guide=(0.55, 0.55, 0.53, 1),
                 paper=(0.012, 0.012, 0.012, 1), face=(0.02, 0.02, 0.02, 1), sun=0.4),
}
INK = GUIDE = PAPER = None  # set from --style in main()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--svg", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--samples", type=int, default=16)
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--percent", type=int, default=100)
    p.add_argument("--style", choices=sorted(STYLES), default="blueprint")
    p.add_argument("--seed", type=int, default=7, help="seed for the worn-paper pass")
    return p.parse_args(argv)


def mark_pt(i):
    x, y, r = MARK_NODES[i]
    s = MARK_T[2]
    return x * s + MARK_T[0], y * s + MARK_T[1], r * s


def emission(name, rgba):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgba
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def guides_object(name, polylines, parent, z, radius, mat, coll):
    """Thin tubes along local-XY polylines, parented to the logo solid."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 1
    for pts in polylines:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, q in zip(sp.points, pts):
            p.co = (q[0], q[1], z, 1)
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    ob.parent = parent
    ob.data.materials.append(mat)
    ob.visible_shadow = False
    return ob


def guides_3d(name, polylines, parent, radius, mat, coll):
    """Tubes along local-XYZ polylines (for lines leaving the logo plane)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 1
    for pts in polylines:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, q in zip(sp.points, pts):
            p.co = (*q, 1)
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    ob.parent = parent
    ob.data.materials.append(mat)
    ob.visible_shadow = False
    return ob


def text(body, pos, angle, parent, z, mat, coll, size=0.09):
    cu = bpy.data.curves.new("Label", "FONT")
    cu.body = body
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "BOTTOM"
    ob = bpy.data.objects.new("Label", cu)
    coll.objects.link(ob)
    ob.parent = parent
    ob.location = (pos[0], pos[1], z)
    ob.rotation_euler = (0, 0, angle)
    ob.data.materials.append(mat)
    ob.visible_shadow = False
    return ob


def construction(mark, coll):
    L = render3d.svg_to_local
    depth = render3d.FIT["depth"]
    lines = []
    # Bar axes, run past both dots.
    for a, b in MARK_EDGES:
        pa, pb = Vector(L(*mark_pt(a)[:2])), Vector(L(*mark_pt(b)[:2]))
        d = (pb - pa).normalized()
        lines.append([pa - d * 0.25, pb + d * 0.45])
    # Type guides across the whole lockup and beyond.
    x0 = L(-60, 0).x
    x1 = L(WORD_X[1] + 80, 0).x
    for y in (BASELINE, X_HEIGHT, CAP):
        yl = L(0, y).y
        lines.append([(x0, yl), (x1, yl)])
    # Verticals at the wordmark's start and end.
    for x in WORD_X:
        xl = L(x, 0).x
        lines.append([(xl, L(0, 40).y), (xl, L(0, -200).y)])
    # Verticals at each glyph's left edge, short ticks above the cap line.
    for x in GLYPH_X[1:]:
        xl = L(x, 0).x
        lines.append([(xl, L(0, CAP - 18).y), (xl, L(0, CAP - 70).y)])
    # Horizontal and vertical lines through every dot centre.
    for i in range(1, len(MARK_NODES)):
        c = Vector(L(*mark_pt(i)[:2]))
        lines.append([(c.x - 0.12, c.y), (c.x + 0.12, c.y)])
        lines.append([(c.x, c.y - 0.12), (c.x, c.y + 0.12)])
    guides_object("Guides", lines, mark, depth + 0.002, 0.004, emission("Guide", GUIDE), coll)

    # Projection lines: from the dot centres straight back along the depth
    # axis, past the back face, as if extruding the plan into a section.
    proj = []
    for i in (0, 1, 3, 6):
        c = L(*mark_pt(i)[:2])
        proj.append([(c.x, c.y, depth + 0.6), (c.x, c.y, -1.6)])
    for x, y in ((WORD_X[0], CAP), (WORD_X[1], CAP), (WORD_X[1], BASELINE)):
        c = L(x, y)
        proj.append([(c.x, c.y, depth + 0.6), (c.x, c.y, -1.6)])
    guides_3d("Projection", proj, mark, 0.003, emission("Guide3", GUIDE), coll)

    # Dimension lines with end ticks and labels, as in a drawing sheet.
    dim = emission("Dim", INK)
    def dimension(a, b, offset, label, z=depth + 0.002):
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        n = Vector((-d.y, d.x)) * offset
        pa, pb = a + n, b + n
        t = Vector((-d.y, d.x)).normalized() * 0.07
        segs = [[pa, pb], [a, pa + n.normalized() * 0.05], [b, pb + n.normalized() * 0.05]]
        for q in (pa, pb):  # architectural slash ticks
            segs.append([q - (d + t / 0.07) * 0.05, q + (d + t / 0.07) * 0.05])
        guides_object("Dim", segs, mark, z, 0.003, dim, coll)
        mid = (pa + pb) / 2 + n.normalized() * 0.06
        text(label, mid, math.atan2(d.y, d.x), mark, z, dim, coll)

    left = L(mark_pt(3)[0] - mark_pt(3)[2], 0).x
    dimension((left, L(0, CAP).y), (L(WORD_X[1], 0).x, L(0, CAP).y), 0.55, "1052.57")
    dimension((L(WORD_X[1], 0).x, L(0, BASELINE).y), (L(WORD_X[1], 0).x, L(0, CAP).y), -0.45, "142.19")
    dimension((L(WORD_X[0], 0).x, L(0, BASELINE).y), (L(GLYPH_X[1], 0).x, L(0, BASELINE).y), -0.35, "124.21")
    r = (Vector(L(mark_pt(1)[0] + mark_pt(1)[2], 0)) - Vector(L(mark_pt(1)[0], 0))).length
    c1 = Vector(L(*mark_pt(1)[:2]))
    text("Ø 35.5", c1 + Vector((r * 1.5, r * 0.9)), 0, mark, depth + 0.002, dim, coll)


    # Guide circles around each dot.
    circles = []
    for i in range(len(MARK_NODES)):
        x, y, r = mark_pt(i)
        c = Vector(L(x, y))
        if i == 0:
            continue  # no circle at the hub: nothing sits at the centre
        rr = (Vector(L(x + r, y)) - c).length * 1.6
        circles.append([c + Vector((math.cos(t), math.sin(t))) * rr
                        for t in (k * math.tau / 72 for k in range(73))])
    guides_object("Circles", circles, mark, depth + 0.002, 0.003, emission("Guide2", GUIDE), coll)


def freestyle(scene, exclude, sketchy=False):
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    vl = scene.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(140)
    for ls in list(fs.linesets):
        fs.linesets.remove(ls)
    for name, vis, color, thick, dashed in (
        ("Visible", "VISIBLE", INK, 3.4, False),
        ("Hidden", "HIDDEN", GUIDE, 0.9, True),
    ):
        ls = fs.linesets.new(name)
        ls.select_by_visibility = True
        ls.visibility = vis
        ls.select_by_edge_types = True
        ls.select_silhouette = ls.select_border = ls.select_crease = True
        ls.select_by_collection = True
        ls.collection = exclude
        ls.collection_negation = "EXCLUSIVE"
        st = ls.linestyle
        st.color = color[:3]
        st.thickness = thick
        st.use_dashed_line = dashed
        if dashed:
            st.dash1, st.gap1 = 8, 6
        if sketchy:
            # Several wobbly passes per edge, running past the corners.
            st.chaining = "SKETCHY"
            st.rounds = 3
            st.geometry_modifiers.new("Overshoot", "BACKBONE_STRETCHER").backbone_length = 6
            noise = st.geometry_modifiers.new("Wobble", "PERLIN_NOISE_1D")
            noise.amplitude, noise.frequency = 0.9, 12


def main():
    args = parse_args()
    global INK, GUIDE, PAPER
    style = STYLES[args.style]
    INK, GUIDE, PAPER = style["ink"], style["guide"], style["paper"]
    scene = render3d.reset_scene()

    mark = render3d.import_mark(args.svg, 6.2, depth=0.22, bevel=0, first_point_svg=FIRST_POINT)
    mark.data.materials.clear()
    white = bpy.data.materials.new("Paper")
    white.use_nodes = True
    white.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = style["face"]
    white.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    mark.data.materials.append(white)
    # Rotate so the camera, below and to the left, sees the undersides.
    mark.rotation_euler = (math.radians(90), 0, math.radians(24))
    mark.location = (0, 0, 0)

    coll = bpy.data.collections.new("Construction")
    scene.collection.children.link(coll)
    bpy.context.view_layer.update()
    construction(mark, coll)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 35
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (-0.75, -6.9, -2.75)
    cam.rotation_euler = (Vector((-0.35, 0, 0.25)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = style["sun"]
    so = bpy.data.objects.new("Sun", sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(40), math.radians(-30), 0)

    world = bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = PAPER
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0

    freestyle(scene, coll, sketchy=args.style == "dark")
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "Standard"
    w, h = (int(v) for v in args.res.split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = args.percent
    scene.render.filepath = args.out
    bpy.ops.render.render(write_still=True)
    if args.style == "dark":
        worn(args.out, args.seed)


def _upsample(a, h, w):
    """Bilinear resize of a 2D array to (h, w)."""
    import numpy as np

    ys = np.linspace(0, a.shape[0] - 1, h)
    xs = np.linspace(0, a.shape[1] - 1, w)
    y0 = np.floor(ys).astype(int).clip(0, a.shape[0] - 2)
    x0 = np.floor(xs).astype(int).clip(0, a.shape[1] - 2)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    a00 = a[y0][:, x0]
    a01 = a[y0][:, x0 + 1]
    a10 = a[y0 + 1][:, x0]
    a11 = a[y0 + 1][:, x0 + 1]
    return (a00 * (1 - fx) + a01 * fx) * (1 - fy) + (a10 * (1 - fx) + a11 * fx) * fy


def _fbm(rng, h, w, base, octaves=4):
    """Fractal value noise in [0, 1]: stains, toner density."""
    import numpy as np

    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cells = base * 2 ** o
        out += amp * _upsample(rng.random((cells + 2, int(cells * w / h) + 2)), h, w)
        total += amp
        amp *= 0.5
    return out / total


def worn(path, seed):
    """Photocopied, stained, used-up look: grayscale, toner dropout in the
    lines, blotchy stains, grain, dust, scratches and a vignette."""
    import numpy as np

    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    rng = np.random.default_rng(seed)

    lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    # Toner dropout: bright ink breaks up where the copier ran thin.
    toner = _fbm(rng, h, w, 6) * 0.6 + rng.random((h, w)) * 0.4
    lum = lum * np.clip((toner - 0.18) * 2.4, 0.25, 1.0)
    # Hard photocopy contrast.
    lum = np.clip((lum - 0.04) * 1.35, 0, 1) ** 0.9

    # Stains: large soft blotches lifting the black, plus darker rings.
    stain = _fbm(rng, h, w, 3, octaves=5)
    lum += np.clip(stain - 0.55, 0, None) * 0.35
    ring = np.abs(_fbm(rng, h, w, 2, octaves=3) - 0.5) < 0.012
    lum += ring * 0.05

    # Grain and dust specks.
    lum += rng.normal(0, 0.035, (h, w))
    specks = rng.random((h, w)) > 0.9993
    lum[specks] = rng.uniform(0.5, 1.0, specks.sum())

    # Long hairline scratches and a few heavier ones.
    for _ in range(int(14 * w / 1920) + 6):
        x0, y0 = rng.uniform(0, w), rng.uniform(0, h)
        a = rng.uniform(0, math.tau)
        length = rng.uniform(0.1, 0.6) * w
        n = int(length)
        t = np.linspace(0, 1, n)
        xs = (x0 + np.cos(a) * length * t + np.sin(t * 9) * 3).astype(int)
        ys = (y0 + np.sin(a) * length * t).astype(int)
        ok = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h) & (rng.random(n) > 0.3)
        lum[ys[ok], xs[ok]] = np.maximum(lum[ys[ok], xs[ok]], rng.uniform(0.25, 0.7))

    # Vignette: copier edges fall off.
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    lum *= np.clip(1.15 - 0.45 * r ** 2, 0, 1)

    lum = np.clip(lum, 0, 1)
    px[..., 0] = px[..., 1] = px[..., 2] = lum
    px[..., 3] = 1
    img.pixels[:] = px.ravel()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


if __name__ == "__main__":
    main()
