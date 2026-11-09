"""把 room.glb 用 Blender 內建的 Draco 重新壓縮（幾何資料）。
用法：Blender -b --factory-startup -P web/blender/compress_glb.py -- <輸入.glb> <輸出.glb>
"""
import sys

import bpy

src, dst = sys.argv[sys.argv.index("--") + 1 :][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_image_format="JPEG",
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_texcoord_quantization=14,
    export_draco_normal_quantization=8,
    export_lights=False,
    export_cameras=False,
)
print("壓縮完成：", dst)
