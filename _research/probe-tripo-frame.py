import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = argv[0]
out = argv[1]

# clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
# world-space bounding box
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3)))
        mx = Vector((max(mx[i], w[i]) for i in range(3)))
center = (mn + mx) / 2
size = (mx - mn)
radius = max(size) * 0.5

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"

# render 4 views: front(-Y), back(+Y), left(-X), right(+X) plus top
def add_cam(name, dir_vec):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam)
    dist = radius * 3.2
    loc = center + dir_vec.normalized() * dist
    cam.location = loc
    # point at center
    direction = center - loc
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = 50
    return cam

# simple sun
light_data = bpy.data.lights.new("sun", type="SUN")
light_data.energy = 4.0
light = bpy.data.objects.new("sun", light_data)
scene.collection.objects.link(light)
light.rotation_euler = (math.radians(50), 0, math.radians(30))
# world bg
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

views = {
    "front": Vector((0, -1, 0.15)),
    "side":  Vector((1, -0.35, 0.15)),
}
for name, d in views.items():
    cam = add_cam(name, d)
    scene.camera = cam
    scene.render.filepath = out.replace(".png", f"_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("SAVED", scene.render.filepath)

print("bounds min", tuple(round(v,3) for v in mn), "max", tuple(round(v,3) for v in mx))
