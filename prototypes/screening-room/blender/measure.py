import bpy, os, sys
from mathutils import Vector
root = sys.argv[sys.argv.index("--") + 1]
for name in sorted(os.listdir(root)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = os.path.join(root, name)
    g = next(f for f in os.listdir(folder) if f.endswith(".gltf"))
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, g))
    pts = [o.matrix_world @ Vector(c) for o in bpy.data.objects if o.type == "MESH" for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    # Blender 座標：x 寬、y 深（-y 是正面）、z 高
    print(f"MEASURE {name}: x {mn.x:.3f}..{mx.x:.3f}  y {mn.y:.3f}..{mx.y:.3f}  z {mn.z:.3f}..{mx.z:.3f}  meshes={sum(1 for o in bpy.data.objects if o.type=='MESH')}")
