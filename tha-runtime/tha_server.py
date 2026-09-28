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
print(f"[tha_server] loading model (char={CHAR}, fps={FPS}, rife={USE_RIFE}, codec={CODEC})")
core = CoreORT(tha_model_version="v3", tha_model_seperable=True, tha_model_fp16=True,
               rife_model_enable=False, sr_model_enable=False,
               vram_cache_size=0.0, cache_max_giga=1.0, use_eyebrow=True)
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

rife = None
if USE_RIFE:
    _rife_path = os.path.join(HERE, "data", "models", "rife", "rife_x2_fp16.onnx")
    if os.path.isfile(_rife_path):
        rife = createORTSession(_rife_path, 0)
        print("[tha_server] RIFE x2 loaded (service-layer 3-dim uint8 interface)")
    else:
        print("[tha_server] RIFE model missing (not bundled); interpolation disabled")

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
            sep, half = PRESET_MAP[preset]
            if not _preset_model_exists(sep, half):
                print(f"[tha_server] preset {preset} model missing (need HQ download)")
            else:
                try:
                    core = CoreORT(tha_model_version="v3", tha_model_seperable=sep, tha_model_fp16=half,
                                   rife_model_enable=False, sr_model_enable=False,
                                   vram_cache_size=0.0, cache_max_giga=1.0, use_eyebrow=True)
                    core.setImage(current_pose_image)
                    core.inference([np.zeros((1, 45), dtype=np.float32)])
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
        cur = np.asarray(core.inference([pose]))[0]  # (512,512,4) uint8 BGRA

        out_frames = []
        if rife is not None and prev_frame is not None:
            res = rife.run(None, {"tha_img_0": prev_frame, "tha_img_1": cur})
            out_frames.append(res[0])  # 插值中间帧
            out_frames.append(cur)     # 当前帧
        else:
            out_frames.append(cur)
        prev_frame = cur

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
        # 方向级注视跟随：{type:gazeTarget, yaw, pitch}（度），来自摄像头感知。
        # 优先级高于 mode；超时自动回落程序化游移（见 update_gaze）。
        try:
            yaw = float(obj.get("yaw", 0.0))
            pitch = float(obj.get("pitch", 0.0))
        except Exception:
            return
        set_gaze_follow(yaw, pitch, time.perf_counter())


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
    async with websockets.serve(handler, "127.0.0.1", PORT, max_size=None):
        print(f"[tha_server] WebSocket serving at ws://127.0.0.1:{PORT}")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        stop_flag["v"] = True
