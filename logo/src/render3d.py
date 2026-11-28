# render3d.py — cinematic 3D render of the Rhizome mark (Blender, Cycles).
#
# Imports a generated SVG (the lockup renders/molecule/lockup-ref.svg or the
# bare mark molecule-ref.svg), extrudes and bevels it into a glossy solid, and lights it with three coloured
# spotlights cutting through volumetric fog.
#
#   blender --background --factory-startup --python logo/src/render3d.py -- \
#       --svg logo/renders/molecule/lockup-ref.svg --out out.png \
#       [--samples 64] [--res 1920x1080] [--percent 100]

import argparse
import math
import sys

import bpy
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt, interpolate_bezier


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--svg", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--percent", type=int, default=100)
    p.add_argument("--blend", default="", help="also save the scene as .blend")
    p.add_argument("--width", type=float, default=6.2, help="logo width in scene units")
    p.add_argument("--exposure", type=float, default=0.8)
    p.add_argument("--fog", type=float, default=0.02, help="fog density, 0 disables")
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def _outline(spline, steps=10):
    """Sampled 2D polygon of a closed bezier spline (curve-local units)."""
    pts = spline.bezier_points
    poly = []
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        seg = interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, steps)
        poly.extend(Vector((p.x, p.y)) for p in seg[:-1])
    # Drop the duplicate closing point left by subpaths that end on their start.
    clean = [p for i, p in enumerate(poly) if (p - poly[i - 1]).length > 1e-7]
    return clean


def _winding(pt, polys):
    """Nonzero winding number of pt against every contour together."""
    x, y = pt
    wn = 0
    for poly in polys:
        for a, b in zip(poly, poly[1:] + poly[:1]):
            if a.y <= y < b.y and (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0:
                wn += 1
            elif b.y <= y < a.y and (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0:
                wn -= 1
    return wn


def nonzero_fill(polys):
    """Triangulate contours with the SVG nonzero rule.

    The lockup's glyphs come straight from the font: some are built from
    overlapping contours, and the "e" is one self-overlapping contour whose
    crossbar loop forms the counter. Blender's curve fill is even-odd, so it
    punches holes in all of those. Instead: constrained-Delaunay triangulate
    every contour edge at once, then keep the triangles whose centroid has a
    nonzero winding number.
    """
    verts, edges = [], []
    for poly in polys:
        base = len(verts)
        verts.extend(poly)
        n = len(poly)
        edges.extend((base + i, base + (i + 1) % n) for i in range(n))
    out_verts, _, out_faces, *_ = delaunay_2d_cdt(verts, edges, [], 0, 1e-7)
    faces = []
    for f in out_faces:
        c = sum((out_verts[i] for i in f), Vector((0, 0))) / len(f)
        if _winding(c, polys) != 0:
            faces.append(f)
    return out_verts, faces


def solid_from_fill(name, verts2d, faces, depth):
    """Extrude a 2D triangulation into a closed solid of the given depth."""
    import bmesh

    bm = bmesh.new()
    bv = [bm.verts.new((v.x, v.y, 0.0)) for v in verts2d]
    for f in faces:
        try:
            bm.faces.new([bv[i] for i in f])
        except ValueError:
            pass  # duplicate face
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    # Merge the triangles into clean n-gon caps so bevels follow the outline only.
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts, edges=bm.edges)
    ext = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    moved = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, 0, depth))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


# Filled by import_mark: how SVG user units map into the solid's local frame
# (see svg_to_local), so other scripts can draw guides on the real geometry.
FIT = {}


def svg_to_local(x, y):
    """Map an SVG user-space point onto the logo solid's local XY plane."""
    u = FIT["u"]
    bx = FIT["anchor_blender"].x + (x - FIT["anchor_svg"][0]) * u
    by = FIT["anchor_blender"].y - (y - FIT["anchor_svg"][1]) * u
    return (Vector((bx, by)) - FIT["centre"]) * FIT["scale"]


def import_mark(svg_path, width, depth=0.12, bevel=0.018, first_point_svg=None):
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=svg_path)
    curves = [o for o in bpy.data.objects if o not in before and o.type == "CURVE"]
    if not curves:
        raise RuntimeError(f"no curves imported from {svg_path}")

    # Use the importer only as an SVG path parser: collect every subpath as a
    # sampled polygon in world space, then drop the curve objects.
    bpy.context.view_layer.update()
    if first_point_svg is not None:
        sp0 = curves[0].data.splines[0].bezier_points[0].co
        FIT["anchor_blender"] = (curves[0].matrix_world @ sp0).to_2d()
        FIT["anchor_svg"] = first_point_svg
        FIT["u"] = curves[0].matrix_world.to_scale().x * 0.0254 / 90
    polys = []
    for o in curves:
        m = o.matrix_world
        for sp in o.data.splines:
            poly = [(m @ Vector((p.x, p.y, 0))).to_2d() for p in _outline(sp)]
            if len(poly) >= 3:
                polys.append(poly)
        bpy.data.objects.remove(o)

    # Centre and normalise the width (the importer works at 1px = 1/90 in).
    xs = [p.x for poly in polys for p in poly]
    ys = [p.y for poly in polys for p in poly]
    centre = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2))
    s = width / (max(xs) - min(xs))
    polys = [[(p - centre) * s for p in poly] for poly in polys]
    FIT.update(centre=centre, scale=s, depth=depth)

    verts, faces = nonzero_fill(polys)
    mark = solid_from_fill("RhizomeMark", verts, faces, depth=depth)

    bpy.ops.object.select_all(action="DESELECT")
    mark.select_set(True)
    bpy.context.view_layer.objects.active = mark
    if bevel > 0:
        bev = mark.modifiers.new("Bevel", "BEVEL")
        bev.width = bevel
        bev.segments = 5
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(60)
        bev.harden_normals = True
        bpy.ops.object.modifier_apply(modifier=bev.name)
    bpy.ops.object.shade_smooth()
    # Keep flat faces crisp, bevels round.
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    except Exception:
        pass

    # Stand it up facing the camera (-Y), slightly turned for depth. The front
    # cap is at z=0 before rotation, so push it toward the camera.
    mark.rotation_euler = (math.radians(90), 0, math.radians(-7))
    mark.location = (0, 0, 2.2)
    return mark


def mark_material():
    m = bpy.data.materials.new("MarkGloss")
    m.use_nodes = True  # still needed before Blender 6
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    # Glossy white ceramic: the diffuse body takes on the coloured spotlights,
    # the clear coat adds crisp highlights on the bevels.
    bsdf.inputs["Base Color"].default_value = (0.85, 0.85, 0.88, 1)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.3
    for name in ("Coat Weight", "Clearcoat"):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = 0.6
    return m


def floor():
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    f = bpy.context.active_object
    m = bpy.data.materials.new("Floor")
    m.use_nodes = True  # still needed before Blender 6
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.012, 0.012, 0.015, 1)
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Metallic"].default_value = 0.0
    f.data.materials.append(m)
    return f


def fog_volume(density):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 5))
    v = bpy.context.active_object
    v.name = "Fog"
    v.scale = (30, 30, 10)
    m = bpy.data.materials.new("Fog")
    m.use_nodes = True  # still needed before Blender 6
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Anisotropy"].default_value = 0.35
    vol.inputs["Color"].default_value = (0.9, 0.9, 1.0, 1)

    # Break the fog up with noise so beams look wispy rather than flat.
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.35
    noise.inputs["Detail"].default_value = 4.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.25, 0.25, 0.25, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    mathn = nt.nodes.new("ShaderNodeMath")
    mathn.operation = "MULTIPLY"
    mathn.inputs[1].default_value = density
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mathn.inputs[0])
    nt.links.new(mathn.outputs[0], vol.inputs["Density"])
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    v.data.materials.append(m)
    return v


def spot(name, color, energy, loc, target, size_deg=28, blend=0.35):
    data = bpy.data.lights.new(name, type="SPOT")
    data.color = color
    data.energy = energy
    data.spot_size = math.radians(size_deg)
    data.spot_blend = blend
    data.shadow_soft_size = 0.15
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    direction = Vector(target) - Vector(loc)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def camera(target, focus):
    data = bpy.data.cameras.new("Cam")
    data.lens = 50
    data.dof.use_dof = True
    data.dof.focus_object = focus
    data.dof.aperture_fstop = 8.0
    cam = bpy.data.objects.new("Cam", data)
    bpy.context.collection.objects.link(cam)
    cam.location = (-0.3, -11.0, 1.5)
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def render_settings(scene, args):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.volume_step_rate = 2.0
    scene.cycles.volume_max_steps = 256
    scene.cycles.max_bounces = 6
    scene.cycles.volume_bounces = 1
    w, h = (int(x) for x in args.res.lower().split("x"))
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = args.percent
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX" if "AgX" in [
        i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items
    ] else "Filmic"
    try:
        scene.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    scene.render.filepath = args.out

    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.006, 0.005, 0.012, 1)
    scene.view_settings.exposure = args.exposure


def main():
    args = parse_args()
    scene = reset_scene()

    mark = import_mark(args.svg, args.width)
    mark.data.materials.clear()  # drop the importer's flat black SVG material
    mark.data.materials.append(mark_material())
    floor()
    if args.fog > 0:
        fog_volume(density=args.fog)

    target = (0, 0, 2.2)
    # Three colour key lights: cyan from upper left, magenta from upper right,
    # amber rim from behind. Beams cross through the fog over the mark.
    spot("Cyan", (0.1, 0.85, 1.0), 22000, (-7, -6, 7.5), (-1.6, 0, 2.0), 30)
    spot("Magenta", (1.0, 0.12, 0.6), 22000, (7, -5, 7), (1.6, 0, 2.4), 30)
    # Amber rim from high behind: lights the fog behind the logo and its edges
    # without shining straight into the lens.
    spot("Amber", (1.0, 0.5, 0.06), 12000, (-1.5, 6, 10), (0.3, 0.5, 0.0), 34)
    # Soft neutral fill from the camera side so the faces never go black.
    fill = bpy.data.lights.new("Fill", type="AREA")
    fill.energy = 1400
    fill.size = 6
    fill.color = (0.95, 0.92, 1.0)
    fo = bpy.data.objects.new("Fill", fill)
    bpy.context.collection.objects.link(fo)
    fo.location = (0, -9, 4.5)
    fo.visible_volume_scatter = False  # light the logo, not the fog
    fo.rotation_euler = (Vector(target) - fo.location).to_track_quat("-Z", "Y").to_euler()

    camera(target, mark)
    render_settings(scene, args)

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
