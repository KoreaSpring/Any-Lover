"""阶段2 验证用：独立 THA 服务。
- 加载 CoreORT(THA v3 seperable fp16 + eyebrow)，THA 单帧走 core（关 core 内置 rife，避免 4 维 bug）
- 服务层可选自己调 RIFE 插帧（正确的 3 维 uint8 接口）
- 内置 idle pose 生成器：定时眨眼 + 呼吸 + 嘴巴周期张合 + 头部微动
- WebSocket 把每帧编码成 PNG(带 alpha) 推给浏览器

用法:
  python tha_server.py               # 默认 lambda_00, 30fps, rife off, png
  set SC_RIFE=1 & python tha_server.py   # 开服务层 RIFE x2
环境变量: THA_CHAR, THA_FPS, THA_PORT, SC_RIFE, THA_CODEC(png|jpeg)
"""
import os, sys, io, time, math, asyncio, threading, json
import numpy as np
import cv2

HERE = os.path.dirname(os.path.realpath(__file__))
# 独立运行时：ezvtb_rt 直接位于 HERE 下；兼容旧结构(HERE/ezvtuber-rt/ezvtb_rt)。
if HERE not in sys.path:
    sys.path.insert(0, HERE)
_legacy = os.path.join(HERE, "ezvtuber-rt")
if os.path.isdir(_legacy) and _legacy not in sys.path:
    sys.path.append(_legacy)
import ezvtb_rt
ezvtb_rt.init_model_path(os.path.join(HERE, "data", "models"))

# 让 rembg 使用随包的抠图模型（data/rembg），避免首次抠图时联网下载 ~350MB。
# 必须在 rembg 被使用(new_session)前设置；这里在 import preprocess_image 前设好。
os.environ.setdefault("U2NET_HOME", os.path.join(HERE, "data", "rembg"))
from ezvtb_rt.core_ort import CoreORT
from ezvtb_rt.ort_utils import createORTSession

import websockets

from preprocess_image import preprocess

CHAR = os.environ.get("THA_CHAR", "lambda_00")
FPS = float(os.environ.get("THA_FPS", "30"))
PORT = int(os.environ.get("THA_PORT", "12395"))
USE_RIFE = os.environ.get("SC_RIFE", "0") == "1"
CODEC = os.environ.get("THA_CODEC", "png").lower()
IDLE_MOUTH = os.environ.get("THA_IDLE_MOUTH", "0") == "1"  # 无外部驱动时嘴自测张合(调试)


def _env_flag(name, default="0"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def _env_float(name, default):
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return float(default)


def _env_int(name, default):
    try:
        return int(float(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return int(default)


# ---------------- EasyVTuber 能力总开关（经 tha-manager 由 ANYLOVER_THA_* 透传） ----------------
# 后端选择：auto(优先 TensorRT，不可用回退 DirectML/ORT) / trt / ort
THA_BACKEND = os.environ.get("THA_BACKEND", "auto").strip().lower()
# THA 模型版本：v3 / v4 / v4_student（v4 系列需另下载模型，缺失自动回退 v3）
THA_VERSION = os.environ.get("THA_VERSION", "v3").strip().lower()
# 项1 RIFE 插帧倍率：0/1=关，2/3/4=对应倍率。优先于旧的 SC_RIFE(=x2)。
RIFE_SCALE = _env_int("THA_RIFE", 2 if USE_RIFE else 0)
RIFE_FP16 = _env_flag("THA_RIFE_FP16", "1")
# 项5 超分：off / waifu2x / realesrgan / anime4k。默认 off（显著增显卡占用）。
THA_SR = os.environ.get("THA_SR", "off").strip().lower()
SR_FP16 = _env_flag("THA_SR_FP16", "1")
# 项3 缓存：显存缓存(GB) + 内存磁盘缓存(GB) + 输入量化步长(0 关)。
VRAM_CACHE = _env_float("THA_VRAM_CACHE", 0.0)
RAM_CACHE = _env_float("THA_RAM_CACHE", 1.0)
# 输入量化：把 pose 分量四舍五入到该步长的整数倍，相近姿态命中同一缓存。0=关。
QUANT_STEP = _env_float("THA_QUANT", 0.0)
# 项6 iFacialMocap：ip:port（默认空=关）。开启后由 UDP 面捕驱动 pose。
IFM_ADDR = os.environ.get("THA_IFM", "").strip()

# ---------------- 情绪 → pose 映射 ----------------
# 45 维绝对索引（依据 tha4 pose_parameters.py 顺序，与 tha3/mouse_client 布局一致）：
# eyebrow(0-11): troubled_l/r=0,1 angry=2,3 lowered=4,5 raised=6,7 happy=8,9 serious=10,11
# eye/iris/mouth(12-38): eye_wink=12,13 eye_happy_wink=14,15 eye_surprised=16,17
#   eye_relaxed=18,19 eye_unimpressed=20,21 eye_raised_lower_eyelid=22,23
#   iris_small=24,25 mouth_aaa=26 iii=27 uuu=28 eee=29 ooo=30 delta=31
#   mouth_lowered_corner=32,33 mouth_raised_corner=34,35 mouth_smirk=36
#   iris_rotation_x=37 iris_rotation_y=38
# pose(39-44): head_x=39 head_y=40 neck_z=41 body_y=42 body_z=43 breathing=44
IDX = {
    "eyebrow_troubled": (0, 1), "eyebrow_angry": (2, 3), "eyebrow_lowered": (4, 5),
    "eyebrow_raised": (6, 7), "eyebrow_happy": (8, 9), "eyebrow_serious": (10, 11),
    "eye_wink": (12, 13), "eye_happy_wink": (14, 15), "eye_surprised": (16, 17),
    "eye_relaxed": (18, 19), "iris_small": (24, 25),
    "mouth_aaa": (26,), "mouth_ooo": (30,),
    "mouth_lowered_corner": (32, 33), "mouth_raised_corner": (34, 35),
    "head_y": (40,),
}


def _set(arr, key, value):
    for i in IDX[key]:
        arr[i] = value


def make_emotion_pose(name):
    """返回 45 维情绪基底 pose（不含口型/idle，这些在合成时叠加）。见 integration.md §4。"""
    a = [0.0] * 45
    if name == "happy":
        _set(a, "eyebrow_happy", 0.8); _set(a, "eye_happy_wink", 0.3); _set(a, "mouth_raised_corner", 0.6)
    elif name == "surprised":
        _set(a, "eyebrow_raised", 0.9); _set(a, "eye_surprised", 0.8); _set(a, "iris_small", 0.4); _set(a, "mouth_ooo", 0.4)
    elif name == "angry":
        _set(a, "eyebrow_angry", 0.9); _set(a, "eye_relaxed", 0.2); _set(a, "mouth_lowered_corner", 0.3)
    elif name == "shy":
        _set(a, "eyebrow_troubled", 0.4); _set(a, "eye_relaxed", 0.4); _set(a, "mouth_raised_corner", 0.2)
    elif name == "sad":
        _set(a, "eyebrow_troubled", 0.8); _set(a, "eyebrow_lowered", 0.3); _set(a, "mouth_lowered_corner", 0.5); _set(a, "head_y", -0.1)
    # neutral / 未知: 全 0
    return a


EMOTIONS = ("neutral", "happy", "surprised", "angry", "shy", "sad")
EMOTION_POSES = {name: make_emotion_pose(name) for name in EMOTIONS}


# ---------------- pose 生成 ----------------
def make_idle_pose(t, mouth=0.0, idle_mouth=False, expr_pose=None, gaze=(0.0, 0.0, 0.0, 0.0)):
    """按 mouse_client 的 45 维布局生成 idle pose：
    eyebrow(12) + mouth_eye(27) + pose(6)
    mouth: 外部口型驱动值(0..1)，来自 TTS 音量包络，叠加到 mouth_eye[14]
    idle_mouth: 无外部驱动时是否用周期性张合自测(调试用)"""
    eyebrow = [0.0] * 12
    mouth_eye = [0.0] * 27
    pose = [0.0] * 6

    # 眨眼：每 4s 眨一次，持续 0.25s，sin^2 曲线
    blink_interval, blink_dur = 4.0, 0.25
    phase = t % blink_interval
    if phase < blink_dur:
        eye_close = math.sin(phase / blink_dur * math.pi) ** 2
    else:
        eye_close = 0.0
    mouth_eye[2] = eye_close
    mouth_eye[3] = eye_close

    # 嘴巴：优先用外部口型驱动值；无驱动且开了自测则周期张合
    if mouth > 0.0:
        mouth_eye[14] = min(1.5, mouth * 1.5)
    elif idle_mouth:
        m = (math.sin(t / 2.5 * 2 * math.pi) * 0.5 + 0.5)
        mouth_eye[14] = m * 1.2

    # 呼吸：6s 周期正弦
    breath = math.sin(t / 6.0 * math.pi)
    pose[5] = breath

    # 头部微动(小幅正弦，避免僵尸脸) + 注视游移(gaze：对话时朝不同方向看)
    gh_x, gh_y, gi_x, gi_y = gaze
    pose[0] = math.sin(t / 5.0 * 2 * math.pi) * 0.04 + gh_x   # 俯仰(head_x)
    pose[1] = math.sin(t / 7.0 * 2 * math.pi) * 0.05 + gh_y   # 摇头(head_y)
    mouth_eye[25] = max(-1.0, min(1.0, gi_x))                 # iris_rotation_x 视线左右
    mouth_eye[26] = max(-1.0, min(1.0, gi_y))                 # iris_rotation_y 视线上下

    arr = np.array(eyebrow + mouth_eye + pose, dtype=np.float32)
    # 叠加情绪基底（表情维度与口型/idle 维度基本不冲突；重叠处相加后裁剪）
    if expr_pose is not None:
        arr = arr + np.asarray(expr_pose, dtype=np.float32)
        np.clip(arr, -1.0, 1.5, out=arr)
    return arr.reshape(1, 45)


# ---------------- 模型加载 ----------------
# 后端选择（项2）：auto 优先 TensorRT(CoreTRT，仅 N 卡+已装 pycuda/tensorrt)，不可用回退
# DirectML(CoreORT，通吃 N/A/I 卡)。ezvtb_rt.__init__ 已按依赖可用性决定是否导出 CoreTRT。
_CoreTRT = getattr(ezvtb_rt, "CoreTRT", None)


def _resolve_backend():
    """返回 (core_class, backend_name)。auto 时优先可用的 TRT，否则 ORT。"""
    if THA_BACKEND == "ort":
        return CoreORT, "ort(directml)"
    if THA_BACKEND == "trt":
        if _CoreTRT is None:
            print("[tha_server] THA_BACKEND=trt 但 TensorRT 不可用，回退 DirectML/ORT")
            return CoreORT, "ort(directml,trt-unavailable)"
        return _CoreTRT, "trt"
    # auto
    if _CoreTRT is not None:
        return _CoreTRT, "trt(auto)"
    return CoreORT, "ort(directml,auto)"


def _resolve_version():
    """校验 THA 版本对应模型是否存在，缺失则回退 v3。返回 (version, seperable_default)。"""
    md = os.path.join(HERE, "data", "models")
    if THA_VERSION == "v4":
        if os.path.isdir(os.path.join(md, "tha4")):
            return "v4", False
        print("[tha_server] THA_VERSION=v4 但未找到 tha4 模型，回退 v3")
    elif THA_VERSION == "v4_student":
        if os.path.isdir(os.path.join(md, "tha4_student")):
            return "v4_student", False
        print("[tha_server] THA_VERSION=v4_student 但未找到 tha4_student 模型，回退 v3")
    return "v3", True


def _rife_available(scale, fp16):
    if scale < 2:
        return False
    p = os.path.join(HERE, "data", "models", "rife",
                     f"rife_x{scale}_{'fp16' if fp16 else 'fp32'}.onnx")
    if os.path.isfile(p):
        return True
    print(f"[tha_server] RIFE 模型缺失({p})，插帧禁用")
    return False


def _sr_config():
    """返回 (sr_enable, sr_scale, sr_fp16, sr_a4k)。模型缺失则关闭。"""
    md = os.path.join(HERE, "data", "models")
    if THA_SR in ("", "off", "0", "none"):
        return False, 2, SR_FP16, False
    if THA_SR == "anime4k":
        return True, 2, SR_FP16, True
    if THA_SR == "waifu2x":
        p = os.path.join(md, "waifu2x", f"noise0_scale2x_{'fp16' if SR_FP16 else 'fp32'}.onnx")
        if os.path.isfile(p):
            return True, 2, SR_FP16, False
        print(f"[tha_server] waifu2x 模型缺失({p})，超分禁用")
    elif THA_SR == "realesrgan":
        # 注意：仓库里 x4 fp32 文件名为 exported_256.onnx，与代码期望的 exported_256_fp32.onnx 不符，
        # 故 realesrgan 强制走 fp16(exported_256_fp16.onnx 存在)，避免加载失败。
        p = os.path.join(md, "Real-ESRGAN", "exported_256_fp16.onnx")
        if os.path.isfile(p):
            return True, 4, True, False
        print(f"[tha_server] Real-ESRGAN 模型缺失({p})，超分禁用")
    else:
        print(f"[tha_server] 未知 THA_SR={THA_SR}，超分禁用")
    return False, 2, SR_FP16, False


# 实际生效配置（供 producer 决定是否走多帧插帧路径）
_backend_class, _backend_name = _resolve_backend()
_version, _version_seperable = _resolve_version()
_rife_scale = RIFE_SCALE if _rife_available(RIFE_SCALE, RIFE_FP16) else 0
_sr_enable, _sr_scale, _sr_fp16, _sr_a4k = _sr_config()
# RIFE 走服务层(producer 自管 prev_frame 调独立 rife session)，不开 core 内置 rife：
# core 内置 rife 单帧接口历史上有 4 维 bug，服务层 3 维 uint8 接口已验证稳定。
# core 仍负责 SR 与缓存。
_use_core_rife = False

print(f"[tha_server] config: backend={_backend_name} version={_version} "
      f"rife=x{_rife_scale if _rife_scale else 0} sr={THA_SR if _sr_enable else 'off'} "
      f"vram_cache={VRAM_CACHE}GB ram_cache={RAM_CACHE}GB quant={QUANT_STEP} ifm={IFM_ADDR or 'off'}")


def build_core(seperable, fp16):
    """按当前全局配置构建推理核心。seperable/fp16 来自性能预设(仅 v3 有意义)。"""
    return _backend_class(
        tha_model_version=_version,
        tha_model_seperable=seperable,
        tha_model_fp16=fp16,
        rife_model_enable=_use_core_rife,
        rife_model_scale=_rife_scale if _use_core_rife else 2,
        rife_model_fp16=RIFE_FP16,
        sr_model_enable=_sr_enable,
        sr_model_scale=_sr_scale,
        sr_model_fp16=_sr_fp16,
        sr_a4k=_sr_a4k,
        vram_cache_size=VRAM_CACHE,
        cache_max_giga=RAM_CACHE,
        use_eyebrow=True,
    )


print(f"[tha_server] loading model (char={CHAR}, fps={FPS}, codec={CODEC})")
core = build_core(_version_seperable, True)
img = cv2.imread(os.path.join(HERE, "data", "images", f"{CHAR}.png"), cv2.IMREAD_UNCHANGED)
if img is None:
    raise SystemExit(f"character image not found: data/images/{CHAR}.png")
if img.shape[2] == 3:
    img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
core.setImage(img)
core.inference([np.zeros((1, 45), dtype=np.float32)])  # warmup

# 记录当前立绘（BGRA），供切换性能预设重建 core 后重新 setImage 用。
current_pose_image = img

# 性能预设 → (seperable, fp16)：
#   low=seperable/fp16(随包) medium=seperable/fp32 high=standard/fp16 ultra=standard/fp32
PRESET_MAP = {
    "low": (True, True),
    "medium": (True, False),
    "high": (False, True),
    "ultra": (False, False),
}


def _preset_model_exists(seperable, half):
    """该预设对应的 THA 模型是否已下载（高画质包提供 medium/high/ultra）。"""
    t = "seperable" if seperable else "standard"
    dt = "fp16" if half else "fp32"
    return os.path.isfile(os.path.join(HERE, "data", "models", "tha3", t, dt, "merge.onnx"))


def quantize_pose(pose):
    """项3 输入量化：把 pose 分量四舍五入到 QUANT_STEP 的整数倍，让相近姿态命中同一缓存，
    提高缓存命中率、长时间使用显著降低显卡占用。QUANT_STEP=0 时原样返回（不量化）。
    注意：量化会牺牲一点动作平滑度，步长越大命中率越高但越"顿"。"""
    if QUANT_STEP <= 0.0:
        return pose
    q = np.round(np.asarray(pose, dtype=np.float32) / QUANT_STEP) * QUANT_STEP
    return q.astype(np.float32)


# 注视(gaze)参数：按对话状态调整视线/头部游移的换向间隔与幅度，让角色"看起来有意识"。
#   interval: 换注视目标的间隔(秒，实际带随机)；head_amp: 头部游移幅度；iris_amp: 眼球游移幅度
GAZE_PARAMS = {
    "idle": {"interval": 4.0, "head": 0.06, "iris": 0.25},        # 空闲：偶尔缓慢瞟向别处
    "active": {"interval": 1.3, "head": 0.14, "iris": 0.5},       # 说话/思考：视线活跃游移
    "listening": {"interval": 3.0, "head": 0.04, "iris": 0.18},   # 听：偏注视，小幅
}
# gaze 运行时状态：目标(head_x,head_y,iris_x,iris_y)、当前(插值)、下次换向时刻
_gaze = {
    "target": [0.0, 0.0, 0.0, 0.0],
    "cur": [0.0, 0.0, 0.0, 0.0],
    "next_t": 0.0,
}
GAZE_LERP = 0.08  # 注视插值步长(越小越平滑)

# 方向级注视跟随（follow）：由摄像头感知（OpenSeeFace 头部朝向经主进程规则化后）下发。
# 优先级高于程序化 mode：有新鲜的 follow 目标时，用它作为注视方向，绕过随机游移；
# 超过 _GAZE_FOLLOW_TTL 秒没有新目标则自动回落到程序化 mode（优雅降级）。
_gaze_follow = {
    "target": [0.0, 0.0, 0.0, 0.0],  # head_x, head_y, iris_x, iris_y（已归一）
    "ts": -1.0,                       # 最近一次收到 follow 目标的时刻(perf_counter)
}
_GAZE_FOLLOW_TTL = 1.0  # follow 目标有效期(秒)；超时回落程序化游移
# yaw/pitch(度) → pose 归一化幅度的映射系数（头部小幅、眼球较大幅）
_GAZE_HEAD_PER_DEG = 0.006
_GAZE_IRIS_PER_DEG = 0.03


def set_gaze_follow(yaw_deg, pitch_deg, now):
    """接收方向级注视目标（度）。把 yaw/pitch 映射到 head/iris 归一幅度并记录时刻。"""
    hx = max(-0.2, min(0.2, yaw_deg * _GAZE_HEAD_PER_DEG))
    hy = max(-0.2, min(0.2, pitch_deg * _GAZE_HEAD_PER_DEG))
    ix = max(-1.0, min(1.0, yaw_deg * _GAZE_IRIS_PER_DEG))
    iy = max(-1.0, min(1.0, pitch_deg * _GAZE_IRIS_PER_DEG))
    _gaze_follow["target"] = [hx, hy, ix, iy]
    _gaze_follow["ts"] = now


# ---------------- 项6 iFacialMocap（可选，发烧友）----------------
# iPhone 结构光面捕，经 iFacialMocap App 以 UDP 文本协议发送 52 条 ARKit blendshape + 头部姿态。
# 默认关闭（需 iPhone + 购买 App + 同局域网，门槛高）；设 THA_IFM=ip:port 开启。
# 协议：形如 "blendShapeName-value|...=head#x,y,z|..."，value 0..100。我们只取驱动桌宠所需的少量通道。
_ifm = {
    "ts": -1.0,            # 最近有效包时刻(perf_counter)
    "pose45": None,        # 由 blendshape 映射出的 45 维 pose（叠加用）
    "head": [0.0, 0.0],    # head_x(俯仰), head_y(摇头) 归一
    "iris": [0.0, 0.0],    # 视线 x,y 归一
}
_IFM_TTL = 0.5  # iFM 包有效期(秒)；超时回落程序化


def _ifm_parse(text):
    """解析 iFacialMocap UDP 文本，返回 (blendshapes:dict[str,float 0..1], head_deg:[pitch,yaw,roll]) 或 None。"""
    try:
        bs = {}
        head = [0.0, 0.0, 0.0]
        # 包用 '|' 分隔条目；blendshape 条目形如 name-value（value 0..100），
        # 头部条目形如 =head#pitch,yaw,roll（不同版本略有差异，做容错）。
        for seg in text.replace("=", "|").split("|"):
            seg = seg.strip()
            if not seg:
                continue
            if seg.lower().startswith("head#") or seg.lower().startswith("head"):
                nums = seg.split("#")[-1].split(",")
                try:
                    head = [float(nums[0]), float(nums[1]), float(nums[2])]
                except (IndexError, ValueError):
                    pass
                continue
            if "-" in seg:
                k, _, v = seg.rpartition("-")
                try:
                    bs[k.strip()] = max(0.0, min(1.0, float(v) / 100.0))
                except ValueError:
                    pass
        return bs, head
    except Exception:
        return None


def _ifm_to_pose(bs, head):
    """把 ARKit blendshapes + 头部角度映射到 45 维 THA pose（取驱动桌宠最有感的通道）。"""
    a = [0.0] * 45
    g = bs.get
    # 眨眼：ARKit eyeBlink_L/R → eye_wink(12,13)
    a[12] = g("eyeBlink_L", 0.0)
    a[13] = g("eyeBlink_R", 0.0)
    # 嘴：jawOpen → mouth_aaa(26)；mouthFunnel/Pucker → mouth_ooo(30)
    a[26] = min(1.5, g("jawOpen", 0.0) * 1.5)
    a[30] = max(g("mouthFunnel", 0.0), g("mouthPucker", 0.0))
    # 微笑：mouthSmile_L/R → mouth_raised_corner(34,35)
    a[34] = g("mouthSmile_L", 0.0)
    a[35] = g("mouthSmile_R", 0.0)
    # 皱眉：browDown_L/R → eyebrow_angry(2,3)；raise → eyebrow_raised(6,7)
    a[2] = g("browDown_L", 0.0)
    a[3] = g("browDown_R", 0.0)
    a[6] = g("browInnerUp", 0.0)
    a[7] = g("browInnerUp", 0.0)
    # 头部：pitch/yaw(度) → head_x(39)/head_y(40)，小幅缩放
    pitch, yaw = head[0], head[1]
    a[39] = max(-1.0, min(1.0, pitch / 30.0))
    a[40] = max(-1.0, min(1.0, yaw / 30.0))
    # 视线：eyeLook 左右上下合成 → iris_rotation(37,38)
    a[37] = g("eyeLookOut_L", 0.0) - g("eyeLookIn_L", 0.0)
    a[38] = g("eyeLookUp_L", 0.0) - g("eyeLookDown_L", 0.0)
    return np.asarray(a, dtype=np.float32)


def _ifm_listener():
    """iFacialMocap UDP 接收线程：监听本地端口，解析并写入 _ifm。THA_IFM=ip:port，端口默认 49983。"""
    import socket
    try:
        port = int(IFM_ADDR.rsplit(":", 1)[-1]) if ":" in IFM_ADDR else 49983
    except ValueError:
        port = 49983
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("0.0.0.0", port))
        sock.settimeout(1.0)
        print(f"[tha_server] iFacialMocap UDP 监听 0.0.0.0:{port}")
    except OSError as e:
        print(f"[tha_server] iFacialMocap 监听失败：{e}")
        return
    while not stop_flag["v"]:
        try:
            data, _ = sock.recvfrom(65535)
        except socket.timeout:
            continue
        except OSError:
            break
        parsed = _ifm_parse(data.decode("utf-8", "ignore"))
        if parsed is None:
            continue
        bs, head = parsed
        pose45 = _ifm_to_pose(bs, head)
        _ifm["pose45"] = pose45
        _ifm["ts"] = time.perf_counter()
    try:
        sock.close()
    except OSError:
        pass


def ifm_active(now):
    """iFM 是否有新鲜数据（在有效期内）。"""
    return _ifm["ts"] >= 0 and (now - _ifm["ts"]) <= _IFM_TTL


# 项7 wink：来自 OpenSeeFace model 4 的单眼闭合度 [右,左](0..1)。新鲜时覆盖程序化眨眼，
# 支持真人单眼眨眼。超过 TTL 无更新则回落到程序化定时眨眼（见 make_idle_pose）。
_wink = {"r": 0.0, "l": 0.0, "ts": -1.0}
_WINK_TTL = 0.5


def set_wink(right_close, left_close, now):
    _wink["r"] = max(0.0, min(1.0, right_close))
    _wink["l"] = max(0.0, min(1.0, left_close))
    _wink["ts"] = now


def wink_active(now):
    return _wink["ts"] >= 0 and (now - _wink["ts"]) <= _WINK_TTL


def update_gaze(mode, now):
    """更新注视：优先用新鲜的 follow 目标（摄像头视线跟随）；否则按当前模式随机游移。
    每帧向目标平滑插值。返回 (head_x,head_y,iris_x,iris_y)。"""
    following = _gaze_follow["ts"] >= 0 and (now - _gaze_follow["ts"]) <= _GAZE_FOLLOW_TTL
    if following:
        tgt = _gaze_follow["target"]
    else:
        p = GAZE_PARAMS.get(mode, GAZE_PARAMS["idle"])
        if now >= _gaze["next_t"]:
            import random
            _gaze["target"] = [
                (random.random() * 2 - 1) * p["head"],
                (random.random() * 2 - 1) * p["head"],
                (random.random() * 2 - 1) * p["iris"],
                (random.random() * 2 - 1) * p["iris"],
            ]
            # 间隔带 ±40% 随机，避免机械节奏
            _gaze["next_t"] = now + p["interval"] * (0.6 + random.random() * 0.8)
        tgt = _gaze["target"]
    cur = _gaze["cur"]
    for i in range(4):
        cur[i] += (tgt[i] - cur[i]) * GAZE_LERP
    return tuple(cur)

# 项1 服务层 RIFE：producer 自管 prev_frame 调独立 rife session，插 1 中间帧(x2)。
# 桌宠常驻场景 x2 足够：等效用一半的 THA 推理换取翻倍输出帧，显著降显卡占用。
# 仅在未开 SR 时生效（SR 会放大帧尺寸，与 512 输入的独立 rife 不兼容）。
rife = None
if _rife_scale >= 2 and not _sr_enable:
    _rife_path = os.path.join(HERE, "data", "models", "rife",
                              f"rife_x2_{'fp16' if RIFE_FP16 else 'fp32'}.onnx")
    if os.path.isfile(_rife_path):
        rife = createORTSession(_rife_path, int(os.environ.get("EZVTB_DEVICE_ID", "0")))
        print(f"[tha_server] service-layer RIFE x2 loaded ({'fp16' if RIFE_FP16 else 'fp32'})")
    else:
        print(f"[tha_server] RIFE 模型缺失({_rife_path})，插帧禁用")
elif _rife_scale >= 2 and _sr_enable:
    print("[tha_server] 已开 SR，服务层 RIFE 禁用（避免尺寸冲突）")

print("[tha_server] model ready")


def encode(frame_bgra):
    """frame: (512,512,4) uint8 BGRA -> bytes"""
    if CODEC == "jpeg":
        # JPEG 无 alpha，转 BGR
        bgr = cv2.cvtColor(frame_bgra, cv2.COLOR_BGRA2BGR)
        ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    else:
        # PNG 带 alpha，OpenCV imencode 需要 BGRA
        ok, buf = cv2.imencode(".png", frame_bgra)
    if not ok:
        return None
    return buf.tobytes()


# 共享最新帧（生产者线程算，WS 协程发）
# mouth_val/mouth_ts: 外部口型驱动值 + 其时间戳；超过 mouth_ttl 秒无更新则视为说话结束，嘴归零。
state = {
    "frames": [],
    "gen_fps": 0.0,
    "t0": time.perf_counter(),
    "mouth_val": 0.0,
    "mouth_ts": 0.0,
    # 情绪：target 为目标基底 pose(45)，cur 为当前插值后的 pose(45)，逐帧向 target 逼近
    "expr_target": np.zeros(45, dtype=np.float32),
    "expr_cur": np.zeros(45, dtype=np.float32),
    "expr_name": "neutral",
    # 待热切换的新立绘(已处理为 512x512 BGRA np.uint8)；producer 线程在推理前应用，避免并发
    "pending_image": None,
    "char_name": CHAR,
    # 待切换的性能预设(low/medium/high/ultra)；producer 线程重建 core
    "pending_preset": None,
    "preset_name": "low",
    # 注视模式：idle(空闲偶尔瞟) / active(说话思考时视线活跃游移) / listening(听时偏注视)
    "gaze_mode": "idle",
    # 立绘处理进度：最新一条 + 递增序号（sender 按序号变化回发给各连接，去重）
    "last_progress": None,
    "progress_seq": 0,
}


def push_progress(stage, message, percent=-1):
    """立绘处理进度：记录最新一条并递增序号，由 handler 的 sender 协程回发给客户端。"""
    with lock:
        state["last_progress"] = json.dumps(
            {"type": "setImageProgress", "stage": stage, "message": message, "percent": percent}
        )
        state["progress_seq"] += 1
mouth_ttl = 0.25  # 口型信号有效期(秒)，超时无新值则闭嘴
EXPR_LERP = 0.15  # 情绪插值步长(每帧)，越小过渡越平滑
lock = threading.Lock()
stop_flag = {"v": False}


def current_mouth():
    """读取有效的外部口型值：超时则归零，避免说话结束后卡在张嘴。"""
    with lock:
        val = state["mouth_val"]
        ts = state["mouth_ts"]
    if val <= 0.0:
        return 0.0
    if (time.perf_counter() - ts) > mouth_ttl:
        return 0.0
    return val


def producer():
    global core, current_pose_image
    prev_frame = None
    last = time.perf_counter()
    interval = 1.0 / FPS
    fps_t = time.perf_counter(); fps_n = 0
    while not stop_flag["v"]:
        # 切换性能预设：在 producer 线程内重建 core（改精度/模型），保持当前立绘。
        with lock:
            preset = state["pending_preset"]
            state["pending_preset"] = None
        if preset is not None and preset in PRESET_MAP:
            if _version != "v3":
                # v4 系列没有 seperable/standard 之分，性能预设不适用，忽略。
                print(f"[tha_server] preset ignored (version={_version} 不支持预设切换)")
            else:
                sep, half = PRESET_MAP[preset]
                if not _preset_model_exists(sep, half):
                    print(f"[tha_server] preset {preset} model missing (need HQ download)")
                else:
                    try:
                        core = build_core(sep, half)
                        core.setImage(current_pose_image)
                        core.inference([quantize_pose(np.zeros((1, 45), dtype=np.float32))])
                        prev_frame = None
                        print(f"[tha_server] preset applied: {preset} (seperable={sep}, fp16={half})")
                    except Exception as e:
                        print(f"[tha_server] preset apply failed: {e}")

        # 热切换立绘：在 producer 线程内应用，避免与推理并发
        with lock:
            pend = state["pending_image"]
            state["pending_image"] = None
        if pend is not None:
            try:
                core.setImage(pend)
                current_pose_image = pend  # 记录当前立绘，供后续预设重建复用
                prev_frame = None  # 重置 RIFE 前帧，避免跨立绘插帧串图
                print("[tha_server] setImage applied (hot-swap)")
                push_progress("done", "立绘已切换", 100)
            except Exception as e:
                print(f"[tha_server] setImage failed: {e}")
                push_progress("error", f"应用立绘失败：{e}", -1)

        now = time.perf_counter()
        t = now - state["t0"]
        # 情绪插值过渡：expr_cur 逐帧向 expr_target 逼近，避免表情突变
        with lock:
            target = state["expr_target"]
            state["expr_cur"] = state["expr_cur"] + (target - state["expr_cur"]) * EXPR_LERP
            expr_now = state["expr_cur"].copy()
            gaze_mode = state["gaze_mode"]
        gaze_now = update_gaze(gaze_mode, now)
        pose = make_idle_pose(t, mouth=current_mouth(), idle_mouth=IDLE_MOUTH, expr_pose=expr_now, gaze=gaze_now)
        # 项7：有新鲜 wink 数据(OpenSeeFace model 4)时，用真人单眼闭合覆盖程序化眨眼。
        if wink_active(now):
            pose[0, 12] = _wink["r"]  # eye_wink 右
            pose[0, 13] = _wink["l"]  # eye_wink 左
        # 项6 iFacialMocap：有新鲜面捕数据时，用其 45 维 pose 作为主驱动（叠加情绪基底），
        # 覆盖程序化 idle/gaze，获得真人面捕的实时表情。超时自动回落（见 ifm_active）。
        if IFM_ADDR and ifm_active(now) and _ifm["pose45"] is not None:
            pose = (_ifm["pose45"] + expr_now).reshape(1, 45)
            np.clip(pose, -1.0, 1.5, out=pose)
        # 项3 输入量化：量化后再喂模型，使相近姿态命中同一缓存（QUANT_STEP=0 时不变）。
        pose = quantize_pose(pose)
        cur = np.asarray(core.inference([pose]))[0]  # SR 关:(512,512,4)；SR 开:(1024/2048,...,4) uint8 BGRA

        out_frames = []
        # 服务层 RIFE 仅在未开 SR 时生效：SR 会放大帧尺寸，与独立 rife(512 输入)不兼容。
        if rife is not None and not _sr_enable and prev_frame is not None:
            res = rife.run(None, {"tha_img_0": prev_frame, "tha_img_1": cur})
            out_frames.append(res[0])  # 插值中间帧
            out_frames.append(cur)     # 当前帧
        else:
            out_frames.append(cur)
        prev_frame = cur if not _sr_enable else None

        encoded = [encode(f) for f in out_frames]
        encoded = [e for e in encoded if e is not None]
        with lock:
            state["frames"] = encoded

        fps_n += 1
        if now - fps_t >= 1.0:
            state["gen_fps"] = fps_n / (now - fps_t)
            fps_n = 0; fps_t = now
            print(f"[tha_server] gen INFER/S ~= {state['gen_fps']:.1f}")

        # 帧率控制
        sleep = interval - (time.perf_counter() - now)
        if sleep > 0:
            time.sleep(sleep)


def _do_set_image(path, do_pre=True, name=None, model="isnet-anime"):
    """在独立线程做预处理并把结果放入 pending_image（producer 线程负责应用）。
    model: 抠图分割模型（isnet-anime 动漫 / u2net 写实半写实）。"""
    try:
        push_progress("start", "开始处理立绘…", 5)
        if do_pre:
            base = name or os.path.splitext(os.path.basename(path))[0]
            out = os.path.join(HERE, "data", "images", f"{base}_512.png")
            push_progress("cutout", "抠图去背景、居中处理中…", 30)
            rep = preprocess(path, out, do_rembg=True, model=model)
            if not rep.get("ok"):
                print(f"[tha_server] setImage preprocess failed: {rep.get('error')}")
                push_progress("error", f"处理失败：{rep.get('error')}", -1)
                return
            load_path = out
            if rep.get("warnings"):
                print(f"[tha_server] setImage warnings: {rep['warnings']}")
        else:
            load_path = path
        push_progress("encode", "处理完成，正在加载到模型…", 80)
        img = cv2.imread(load_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            print(f"[tha_server] setImage: cannot read {load_path}")
            push_progress("error", "无法读取处理后的图片", -1)
            return
        if img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
        with lock:
            state["pending_image"] = img
            if name:
                state["char_name"] = name
        push_progress("loading", "即将应用到角色…", 90)
        print(f"[tha_server] setImage queued: {load_path}")
    except Exception as e:
        print(f"[tha_server] setImage error: {e}")
        push_progress("error", f"处理出错：{e}", -1)


def apply_control(msg):
    """处理来自客户端的控制消息(JSON)：
    {"type":"mouth","value":0.0..1.0}  口型驱动（来自 TTS 音量包络）
    其它类型（如 expression）后续阶段扩展。"""
    try:
        obj = json.loads(msg)
    except Exception:
        return
    if not isinstance(obj, dict):
        return
    mtype = obj.get("type")
    if mtype == "mouth":
        try:
            v = float(obj.get("value", 0.0))
        except Exception:
            v = 0.0
        v = max(0.0, min(1.0, v))
        with lock:
            state["mouth_val"] = v
            state["mouth_ts"] = time.perf_counter()
    elif mtype == "expression":
        name = str(obj.get("name", "neutral")).lower()
        base = EMOTION_POSES.get(name)
        if base is None:
            base = EMOTION_POSES["neutral"]
            name = "neutral"
        with lock:
            state["expr_target"] = np.asarray(base, dtype=np.float32)
            state["expr_name"] = name
    elif mtype == "setImage":
        # 热切换立绘：{type:setImage, path, preprocess(默认True), name?}
        # 预处理(抠图等)耗时，放独立线程，避免阻塞 WS 事件循环；完成后写 pending_image。
        path = obj.get("path")
        if not path:
            return
        do_pre = obj.get("preprocess", True)
        name = obj.get("name")
        model = obj.get("model", "isnet-anime")
        threading.Thread(target=_do_set_image, args=(path, do_pre, name, model), daemon=True).start()
    elif mtype == "setPreset":
        preset = str(obj.get("preset", "low")).lower()
        if preset in PRESET_MAP:
            with lock:
                state["pending_preset"] = preset
                state["preset_name"] = preset
    elif mtype == "gaze":
        # 注视模式：idle / active(说话思考) / listening(听)。前端按对话状态下发，驱动视线游移。
        mode = str(obj.get("mode", "idle")).lower()
        if mode not in GAZE_PARAMS:
            mode = "idle"
        with lock:
            state["gaze_mode"] = mode
    elif mtype == "gazeTarget":
        # 方向级注视跟随：{type:gazeTarget, yaw, pitch, blink?}（度），来自摄像头感知。
        # 优先级高于 mode；超时自动回落程序化游移（见 update_gaze）。
        # 项7：blink=[右,左] 眼开合(0..1，来自 OpenSeeFace model 4)，1=睁开 0=闭合，
        # 转成 eye_wink(闭合度) 覆盖程序化眨眼，支持真人单眼 wink。
        try:
            yaw = float(obj.get("yaw", 0.0))
            pitch = float(obj.get("pitch", 0.0))
        except (TypeError, ValueError):
            return
        set_gaze_follow(yaw, pitch, time.perf_counter())
        blink = obj.get("blink")
        if isinstance(blink, (list, tuple)) and len(blink) == 2:
            try:
                # OpenSeeFace eye_blink：1=睁 0=闭；eye_wink 相反(闭合度)，故取 1-开合。
                set_wink(1.0 - float(blink[0]), 1.0 - float(blink[1]), time.perf_counter())
            except (TypeError, ValueError):
                pass


async def handler(ws):
    print("[tha_server] client connected")
    interval = 1.0 / (FPS * (2 if rife is not None else 1))
    last_sent = None

    async def sender():
        nonlocal last_sent
        sent_seq = 0
        while True:
            # 先回发最新进度（按序号变化去重，text 消息；帧连接会忽略 text）
            with lock:
                seq = state["progress_seq"]
                prog = state["last_progress"]
                frames = list(state["frames"])
            if seq != sent_seq and prog is not None:
                sent_seq = seq
                try:
                    await ws.send(prog)
                except Exception:
                    pass
            for fb in frames:
                await ws.send(fb)
            last_sent = frames
            await asyncio.sleep(interval)

    async def receiver():
        # 文本消息=控制(口型/表情)；二进制忽略。
        async for msg in ws:
            if isinstance(msg, (bytes, bytearray)):
                continue
            apply_control(msg)

    try:
        await asyncio.gather(sender(), receiver())
    except websockets.ConnectionClosed:
        print("[tha_server] client disconnected")
    except Exception as e:
        print(f"[tha_server] handler error: {e}")


async def main():
    th = threading.Thread(target=producer, daemon=True)
    th.start()
    # 项6 iFacialMocap：仅在显式配置 THA_IFM 时启动 UDP 面捕接收线程（默认不启）。
    if IFM_ADDR:
        threading.Thread(target=_ifm_listener, daemon=True).start()
    async with websockets.serve(handler, "127.0.0.1", PORT, max_size=None):
        print(f"[tha_server] WebSocket serving at ws://127.0.0.1:{PORT}")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        stop_flag["v"] = True
