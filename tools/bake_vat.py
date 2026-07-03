"""
bake_vat.py — Blender Vertex Animation Texture (VAT) baker for the PS1 pipeline.

Bakes a rigged/skinned/shape-keyed character's *deformation* to textures so the runtime can
replay smooth motion with NO runtime skinning (see docs/prd/ps1-material-animation-extensions.md,
WS6). You keep rigging normally in Blender; this captures the final per-vertex positions/normals.

WHAT IT PRODUCES (data contract — must match src/scenes/ps1/vat.ts + the shader):
  <out>/<name>_vat_pos.exr   float, size V×F, texel(x=vertexId, y=frame) = OBJECT-LOCAL position (xyz)
  <out>/<name>_vat_nrm.exr   float, size V×F, texel = vertex normal (xyz, raw [-1,1])   [optional]
  <out>/<name>.vat.json      metadata: V, F, fps, frame range, space, encoding, texture names
  + a UV layer "vat_id" added to the mesh: u = (vertexIndex + 0.5)/V, v = 0.5
    (exports as the LAST TEXCOORD_n in glTF → the shader reads it as the vertex id)

RUNTIME MAPPING:
  frame f  -> texture row v = (f + 0.5) / F   (Blender image origin is bottom-left; row 0 = bottom)
  vertex i -> texture col u = (i + 0.5) / V   (via the vat_id UV)
  uFrame is fractional; sample rows floor(uFrame) & floor(uFrame)+1 and lerp for smooth playback.

HARD REQUIREMENTS:
  * Constant topology across all frames (NO remesh / dynamic subdiv / boolean / decimate mid-anim).
  * Apply every modifier EXCEPT the Armature before baking, so base-mesh vertex count/order ==
    evaluated vertex count/order (the script asserts this and aborts otherwise).

USAGE:
  1. Select the character mesh object (make it active).
  2. Set the scene frame range to the clip you want (or edit FRAME_START/END below).
  3. Run this script from Blender's Text Editor (Alt+P) or: blender file.blend --python tools/bake_vat.py
  4. Export the object as a STATIC GLB (animation OFF, armature excluded/at rest) — it will carry
     the original UV as TEXCOORD_0 and "vat_id" as TEXCOORD_1.
  5. Put the GLB + .exr + .vat.json under public/models/ and wire via vat.ts.

  For multiple clips: run once per clip with a different frame range + OUT_NAME (e.g. name_walk).
"""

import bpy
import os
import json
from array import array

# ------------------------------------------------------------------ config
OBJECT_NAME = None                 # None = use the active object
OUT_DIR = "//vat_bake"             # '//' = relative to the .blend file; change as needed
OUT_NAME = None                    # None = derive from object name
FRAME_START = None                 # None = scene.frame_start
FRAME_END = None                   # None = scene.frame_end
INCLUDE_NORMALS = True
ENCODING = "EXR"                   # "EXR" (float, exact — recommended) or "PNG16" (min/max remap)

# ------------------------------------------------------------------ helpers
def _abort(msg):
    raise RuntimeError("[bake_vat] " + msg)


def _make_image(name, width, height):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, width=width, height=height, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"  # raw data, never gamma-managed
    return img


def _save(img, filepath, file_format):
    img.filepath_raw = filepath
    img.file_format = file_format
    img.save()


# ------------------------------------------------------------------ main
def bake():
    scene = bpy.context.scene
    obj = bpy.data.objects.get(OBJECT_NAME) if OBJECT_NAME else bpy.context.active_object
    if obj is None or obj.type != "MESH":
        _abort("Select a MESH object (make it active), or set OBJECT_NAME.")

    name = OUT_NAME or obj.name.replace(" ", "_")
    out_dir = bpy.path.abspath(OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)

    f0 = scene.frame_start if FRAME_START is None else FRAME_START
    f1 = scene.frame_end if FRAME_END is None else FRAME_END
    F = f1 - f0 + 1
    if F < 2:
        _abort("Need at least 2 frames.")

    base_mesh = obj.data
    V = len(base_mesh.vertices)
    if V == 0:
        _abort("Mesh has no vertices.")

    # accumulate: pixels are row-major from the bottom; index = (frame*V + vertex)*4
    pos = array("f", [0.0]) * (V * F * 4)
    nrm = array("f", [0.0]) * (V * F * 4) if INCLUDE_NORMALS else None

    lo = [1e30, 1e30, 1e30]
    hi = [-1e30, -1e30, -1e30]

    depsgraph = bpy.context.evaluated_depsgraph_get()
    for fi, frame in enumerate(range(f0, f1 + 1)):
        scene.frame_set(frame)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        eval_obj = obj.evaluated_get(depsgraph)
        me = eval_obj.to_mesh()
        if len(me.vertices) != V:
            eval_obj.to_mesh_clear()
            _abort(
                f"Frame {frame}: evaluated vertex count {len(me.vertices)} != base {V}. "
                "Apply all modifiers except the Armature (topology must be constant)."
            )
        row = fi * V
        for i, v in enumerate(me.vertices):
            co = v.co  # object-local, fully deformed (armature/shape keys applied)
            b = (row + i) * 4
            pos[b] = co.x; pos[b + 1] = co.y; pos[b + 2] = co.z; pos[b + 3] = 1.0
            if co.x < lo[0]: lo[0] = co.x
            if co.y < lo[1]: lo[1] = co.y
            if co.z < lo[2]: lo[2] = co.z
            if co.x > hi[0]: hi[0] = co.x
            if co.y > hi[1]: hi[1] = co.y
            if co.z > hi[2]: hi[2] = co.z
            if nrm is not None:
                n = v.normal
                nrm[b] = n.x; nrm[b + 1] = n.y; nrm[b + 2] = n.z; nrm[b + 3] = 1.0
        eval_obj.to_mesh_clear()

    remap = None
    if ENCODING == "PNG16":
        # normalise positions into [0,1] using the global bounds; store bounds in the sidecar
        span = [max(hi[k] - lo[k], 1e-6) for k in range(3)]
        for p in range(V * F):
            b = p * 4
            pos[b] = (pos[b] - lo[0]) / span[0]
            pos[b + 1] = (pos[b + 1] - lo[1]) / span[1]
            pos[b + 2] = (pos[b + 2] - lo[2]) / span[2]
        if nrm is not None:  # normals [-1,1] -> [0,1]
            for p in range(V * F):
                b = p * 4
                nrm[b] = nrm[b] * 0.5 + 0.5
                nrm[b + 1] = nrm[b + 1] * 0.5 + 0.5
                nrm[b + 2] = nrm[b + 2] * 0.5 + 0.5
        remap = {"min": lo, "max": hi}

    fmt = "OPEN_EXR" if ENCODING == "EXR" else "PNG"
    ext = "exr" if ENCODING == "EXR" else "png"

    pos_img = _make_image(f"{name}_vat_pos", V, F)
    pos_img.pixels.foreach_set(pos)
    pos_path = os.path.join(out_dir, f"{name}_vat_pos.{ext}")
    if ENCODING == "PNG16":
        scene.render.image_settings.color_depth = "16"
    _save(pos_img, pos_path, fmt)

    nrm_name = None
    if nrm is not None:
        nrm_img = _make_image(f"{name}_vat_nrm", V, F)
        nrm_img.pixels.foreach_set(nrm)
        nrm_path = os.path.join(out_dir, f"{name}_vat_nrm.{ext}")
        _save(nrm_img, nrm_path, fmt)
        nrm_name = os.path.basename(nrm_path)

    # add the stable vertex-id UV to the BASE mesh (exports as the last TEXCOORD_n)
    uv_name = "vat_id"
    if uv_name in base_mesh.uv_layers:
        base_mesh.uv_layers.remove(base_mesh.uv_layers[uv_name])
    uvl = base_mesh.uv_layers.new(name=uv_name)
    inv = 1.0 / V
    for loop in base_mesh.loops:
        uvl.data[loop.index].uv = ((loop.vertex_index + 0.5) * inv, 0.5)

    meta = {
        "name": name,
        "vertexCount": V,
        "frameCount": F,
        "fps": scene.render.fps / scene.render.fps_base,
        "frameStart": f0,
        "frameEnd": f1,
        "space": "object-local",
        "encoding": ENCODING,
        "positionTexture": os.path.basename(pos_path),
        "normalTexture": nrm_name,
        "idUV": "vat_id (last TEXCOORD)",
        "remap": remap,  # null for EXR; {min,max} for PNG16
        "note": "row v=(f+0.5)/F from bottom; col u=(i+0.5)/V; sample floor/ceil(uFrame) and lerp",
    }
    with open(os.path.join(out_dir, f"{name}.vat.json"), "w") as fh:
        json.dump(meta, fh, indent=2)

    print(f"[bake_vat] OK  V={V} F={F}  -> {out_dir}")
    print(f"[bake_vat] pos={os.path.basename(pos_path)} nrm={nrm_name} meta={name}.vat.json")
    print("[bake_vat] Now export the object as a static GLB (anim off) — it carries 'vat_id' UV.")


if __name__ == "__main__":
    bake()
