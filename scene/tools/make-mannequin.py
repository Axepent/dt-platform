"""Generate the rigid-joint mannequin with Blender.

From scene/:
    blender --background --factory-startup --python tools/make-mannequin.py
"""
from pathlib import Path

import bpy

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.length_unit = 'METERS'


def material(name, color, metallic=0.0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = result.diffuse_color
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = 0.48
    return result


shell = material('Matte silver shell', (0.56, 0.61, 0.65), 0.14)
joint = material('Graphite joints', (0.075, 0.092, 0.11), 0.22)

# Blender coordinates in metres. The mannequin faces -Y. Export maps -Y to +Z.
def place(obj, name, xyz, parent):
    obj.name = name
    obj.parent = parent
    if parent is None:
        obj.location = xyz
    else:
        obj.location = [value - origin for value, origin in zip(xyz, parent['pivot'])]
    return obj


def pivot(name, xyz, parent=None, element=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    place(obj, name, xyz, parent)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.055
    if element:
        obj['element'] = element
    # Temporary global coordinates for building local transforms.
    obj['pivot'] = xyz
    return obj


def shell_part(name, xyz, size, parent, surface=shell, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=rings)
    obj = place(bpy.context.object, name, xyz, parent)
    # Bake dimensions into vertices so rotation nodes have an identity scale.
    for vertex in obj.data.vertices:
        vertex.co.x *= size[0]
        vertex.co.y *= size[1]
        vertex.co.z *= size[2]
    obj.data.materials.append(surface)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


root = pivot('mannequin', (0, 0, 0))
pelvis = pivot('pelvis', (0, 0, 0.93), root)
torso = pivot('torso', (0, 0, 1.04), pelvis, 'torso')
head = pivot('head', (0, 0, 1.61), torso, 'head')
shell_part('pelvis-shell', (0, 0.014, 1.00), (0.161, 0.111, 0.102), pelvis)
shell_part('waist-joint', (0, 0.01, 1.075), (0.108, 0.088, 0.103), torso, joint)
shell_part('chest-shell', (0, 0, 1.335), (0.207, 0.116, 0.242), torso)
shell_part('abdomen-shell', (0, 0.008, 1.172), (0.138, 0.097, 0.128), torso)
shell_part('neck-joint', (0, 0, 1.586), (0.057, 0.060, 0.062), torso, joint)
shell_part('head-shell', (0, -0.016, 1.72), (0.098, 0.101, 0.128), head)

# Lab 2 has one scalar for each angle. Label the left limb pivots for
# telemetry and retain matching right-side pivots for independent posing.
def limb_pivot(name, side, xyz, parent):
    identifier = f'{name}.{side}'
    return pivot(identifier, xyz, parent, identifier if side == 'L' else None)


for side, sign in (('L', 1), ('R', -1)):
    arm_x = sign * 0.231
    leg_x = sign * 0.087
    shoulder = limb_pivot('shoulder', side, (arm_x, 0, 1.48), torso)
    elbow = limb_pivot('elbow', side, (arm_x, 0, 1.197), shoulder)
    hip = limb_pivot('hip', side, (leg_x, 0, 0.932), pelvis)
    knee = limb_pivot('knee', side, (leg_x, 0, 0.525), hip)

    shell_part(f'shoulder-joint.{side}', (arm_x, 0, 1.48),
               (0.066, 0.070, 0.071), shoulder, joint)
    shell_part(f'upper-arm.{side}', (arm_x, 0, 1.34),
               (0.055, 0.059, 0.138), shoulder)
    shell_part(f'elbow-joint.{side}', (arm_x, 0, 1.197),
               (0.044, 0.048, 0.049), elbow, joint)
    shell_part(f'forearm.{side}', (arm_x, 0, 1.073),
               (0.045, 0.049, 0.112), elbow)
    shell_part(f'hand.{side}', (arm_x, -0.005, 0.925),
               (0.041, 0.037, 0.061), elbow)
    shell_part(f'hip-joint.{side}', (leg_x, 0, 0.932),
               (0.069, 0.073, 0.073), hip, joint)
    shell_part(f'thigh.{side}', (leg_x, 0, 0.731),
               (0.066, 0.078, 0.198), hip)
    shell_part(f'knee-joint.{side}', (leg_x, 0, 0.525),
               (0.049, 0.056, 0.060), knee, joint)
    shell_part(f'shin.{side}', (leg_x, 0.008, 0.33),
               (0.057, 0.065, 0.183), knee)
    shell_part(f'ankle.{side}', (leg_x, 0.003, 0.129),
               (0.040, 0.053, 0.059), knee, joint)
    shell_part(f'foot.{side}', (leg_x, -0.059, 0.059),
               (0.057, 0.123, 0.059), knee)

for obj in bpy.context.scene.objects:
    if 'pivot' in obj:
        del obj['pivot']

output = Path(__file__).resolve().parents[1] / 'models' / 'mannequin.glb'
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', export_yup=True, export_extras=True,
)
