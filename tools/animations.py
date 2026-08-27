"""占位动画。绑在 rig_spec 的标准骨架上，猫狗共用。

文档 5.6 把 `idle` 列为优先级最高的一个：其他动画没做完也能先上线，
前端会退回 idle。所以这里先只做它。

幅度是这套动画里最容易做砸的地方——玩家看 idle 的时间最长，
幅度一大就让人烦躁。文档给的参考是呼吸起伏 3% 左右，这里照此执行。

所有循环动画用完整正弦周期驱动，首尾帧因此天然一致，不会跳帧。
"""

import math

import bpy

FPS = 30

# 幅度增益。1.0 是文档规定的正式值；调试时临时放大，
# 用来分辨「动画没生效」和「动了但看不出来」——这两种情况肉眼一模一样。
GAIN = 1.0


def set_gain(value):
    global GAIN
    GAIN = float(value)


def _clear_animation(arm_obj):
    if arm_obj.animation_data:
        arm_obj.animation_data_clear()


def _prepare_pose(arm_obj):
    """欧拉角比四元数好写小角度，且导出时会被采样成关键帧，不影响结果。"""
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)


def build_idle(arm_obj, duration=2.4):
    """默认待机：呼吸 + 轻微点头 + 尾巴摆动 + 耳朵抖动。

    尾巴三段用递增的相位延迟，摆起来是一条连续曲线而不是三节棍——
    这正是文档 5.4 对尾巴权重的要求，动画这边也要配合。
    """
    scene = bpy.context.scene
    scene.render.fps = FPS
    frames = int(round(duration * FPS))

    _clear_animation(arm_obj)
    _prepare_pose(arm_obj)

    action = bpy.data.actions.new("idle")
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = action

    pose = arm_obj.pose.bones

    for f in range(frames + 1):
        t = f / frames  # 0..1，正弦跑满一个周期，首尾帧自动一致
        phase = 2.0 * math.pi * t

        breath = math.sin(phase)
        # 胸腔起伏：沿骨骼轴向以外的两轴放大，3% 是文档给的参考值
        pose["spine_01"].scale = (1.0 + 0.030 * GAIN * breath, 1.0, 1.0 + 0.030 * GAIN * breath)
        pose["spine_02"].scale = (1.0 + 0.022 * GAIN * breath, 1.0, 1.0 + 0.022 * GAIN * breath)

        # 整体上下浮动。挂在 root 上，从任何角度都看得见——
        # 尾巴长在背面，正面视角完全被身体挡住，只靠它撑不起「活着」的感觉。
        # root 的骨骼 Y 轴就是世界的上方向，所以直接位移 y 即可。
        pose["root"].location = (0.0, 0.030 * GAIN * math.sin(phase - 0.9), 0.0)

        # 头颈比胸腔慢半拍，看起来才像被呼吸带动，而不是整体一起缩放
        neck_lag = math.sin(phase - 0.5)
        pose["neck"].rotation_euler = (math.radians(1.6 * GAIN) * neck_lag, 0.0, 0.0)

        # 头部左右转。骨骼的 +Y 指向子骨头（这里朝上），绕局部 Y 转就是「摇头」。
        # 正面视角下这是最显眼的动作——点头只改变头的高度，左右转会整个改变剪影。
        # 相位偏 2.1 弧度和呼吸错开，不至于像在打拍子。
        # 频率必须是周期的整数倍，取半个周期会让首尾帧对不上，循环时跳一下。
        shake = math.sin(phase + 2.1)
        pose["head"].rotation_euler = (
            math.radians(2.5 * GAIN) * neck_lag,
            math.radians(12.0 * GAIN) * shake,
            0.0,
        )

        # 尾巴左右摆，每段延迟 0.55 弧度，形成鞭子似的传导。
        # 幅度比呼吸大得多：文档 5.2 要求耳朵尾巴这类识别度高的部位做夸张。
        for i, bone in enumerate(("tail_01", "tail_02", "tail_03")):
            amp = math.radians((7.0 + 3.0 * i) * GAIN)
            pose[bone].rotation_euler = (0.0, 0.0, amp * math.sin(phase - 0.55 * i))

        # 耳朵一个周期里只抖一下，避免整段都在动显得神经质
        twitch = max(0.0, math.sin(phase * 2.0 - 1.2)) ** 3
        pose["ear_L"].rotation_euler = (math.radians(-4.0 * GAIN) * twitch, 0.0, 0.0)
        pose["ear_R"].rotation_euler = (math.radians(-4.0 * GAIN) * twitch, 0.0, 0.0)

        pose["root"].keyframe_insert(data_path="location", frame=f)
        for bone in ("spine_01", "spine_02"):
            pose[bone].keyframe_insert(data_path="scale", frame=f)
        for bone in ("neck", "head", "tail_01", "tail_02", "tail_03", "ear_L", "ear_R"):
            pose[bone].keyframe_insert(data_path="rotation_euler", frame=f)

    scene.frame_start = 0
    scene.frame_end = frames

    bpy.ops.object.mode_set(mode="OBJECT")
    return action


BUILDERS = {"idle": build_idle}
