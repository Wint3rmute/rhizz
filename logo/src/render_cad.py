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
BASELINE, X_HEIGHT, CAP = 0.0, -105.66, -142.19

INK = (0.07, 0.11, 0.2, 1)
GUIDE = (0.42, 0.55, 0.75, 1)
PAPER = (0.93, 0.955, 0.985, 1)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--svg", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--samples", type=int, default=16)
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--percent", type=int, default=100)
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


def construction(mark, coll):
    L = render3d.svg_to_local
    depth = render3d.FIT["depth"]
    lines = []
    # Bar axes, run past both dots.
    for a, b in MARK_EDGES:
        pa, pb = Vector(L(*mark_pt(a)[:2])), Vector(L(*mark_pt(b)[:2]))
        d = (pb - pa).normalized()
        lines.append([pa - d * 0.5, pb + d * 0.9])
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
    guides_object("Guides", lines, mark, depth + 0.002, 0.004, emission("Guide", GUIDE), coll)

    # Guide circles around each dot.
    circles = []
    for i in range(len(MARK_NODES)):
        x, y, r = mark_pt(i)
        c = Vector(L(x, y))
        rr = (Vector(L(x + r, y)) - c).length * (1.35 if i else 2.2)
        circles.append([c + Vector((math.cos(t), math.sin(t))) * rr
                        for t in (k * math.tau / 72 for k in range(73))])
    guides_object("Circles", circles, mark, depth + 0.002, 0.003, emission("Guide2", GUIDE), coll)


def freestyle(scene, exclude):
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    vl = scene.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(140)
    for ls in list(fs.linesets):
        fs.linesets.remove(ls)
    for name, vis, color, thick, dashed in (
        ("Visible", "VISIBLE", INK, 2.2, False),
        ("Hidden", "HIDDEN", GUIDE, 1.2, True),
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


def main():
    args = parse_args()
    scene = render3d.reset_scene()

    mark = render3d.import_mark(args.svg, 6.2, depth=0.6, bevel=0, first_point_svg=FIRST_POINT)
    mark.data.materials.clear()
    white = bpy.data.materials.new("Paper")
    white.use_nodes = True
    white.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (1, 1, 1, 1)
    white.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    mark.data.materials.append(white)
    # Rotate so the camera, below and to the left, sees the undersides.
    mark.rotation_euler = (math.radians(90), 0, math.radians(-28))
    mark.location = (0, 0, 0)

    coll = bpy.data.collections.new("Construction")
    scene.collection.children.link(coll)
    bpy.context.view_layer.update()
    construction(mark, coll)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 35
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (-2.5, -8.0, -3.2)
    cam.rotation_euler = (Vector((0.3, 0, 0.1)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 2.0
    so = bpy.data.objects.new("Sun", sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(40), math.radians(-30), 0)

    world = bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = PAPER
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0

    freestyle(scene, coll)
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


main()
