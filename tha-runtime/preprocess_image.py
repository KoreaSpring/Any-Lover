"""立绘预处理（面向动漫角色立绘）：把用户上传的图片加工成 THA 能吃的输入。
THA 硬性要求：512x512、带 alpha 透明通道的 PNG，单个角色、正面、背景已抠净、动漫画风。

pipeline: 读图 → 强转 RGBA → (可选抠图去背景) → resize_to_512_center 居中 → alpha 清理 → 质量校验。
返回处理后的 PIL Image 与一份报告(warnings/metrics)，供前端提示用户。

抠图(rembg)是可选的，缺库时自动跳过并给出提示，保证不装 rembg 也能跑基础流程。
"""
import os
import numpy as np
from PIL import Image

from src.utils.preprocess import resize_to_512_center

# rembg 可选：装了才启用自动抠图
try:
    from rembg import remove as _rembg_remove, new_session as _rembg_new_session
    _REMBG_AVAILABLE = True
except Exception:
    _REMBG_AVAILABLE = False

_rembg_sessions: dict = {}


def _get_rembg_session(model_name: str = "isnet-anime"):
    """按模型名缓存分割会话。
    - isnet-anime：动漫角色抠图效果好（默认）
    - u2net：通用/写实/半写实图更稳（3D 渲染、写实立绘用它）
    缺失则回退默认 u2net。"""
    if model_name not in _rembg_sessions:
        try:
            _rembg_sessions[model_name] = _rembg_new_session(model_name)
        except Exception:
            _rembg_sessions[model_name] = _rembg_new_session()
    return _rembg_sessions[model_name]


def _has_alpha_transparency(img: Image.Image) -> bool:
    """图是否已经带有效透明通道（存在透明像素）。"""
    if img.mode != "RGBA":
        return False
    a = np.asarray(img)[:, :, 3]
    return bool((a < 250).any())


def _alpha_foreground_ratio(img: Image.Image) -> float:
    """不透明像素占比（0..1），用于判断抠图是否合理。"""
    a = np.asarray(img.convert("RGBA"))[:, :, 3]
    return float((a > 20).mean())


def _clean_alpha_edges(img: Image.Image, low: int = 40, high: int = 200) -> Image.Image:
    """清理 alpha 边缘：近透明像素清零(避免边缘发黑)，近不透明拉满。线性拉伸中间段。"""
    arr = np.asarray(img.convert("RGBA")).copy()
    a = arr[:, :, 3].astype(np.float32)
    a = (a - low) / max(1, (high - low)) * 255.0
    a = np.clip(a, 0, 255)
    # 清零透明像素的 RGB，避免半透明边缘残留深色
    arr[:, :, 3] = a.astype(np.uint8)
    fully_transparent = arr[:, :, 3] == 0
    arr[fully_transparent, 0:3] = 0
    return Image.fromarray(arr, mode="RGBA")


def preprocess(
    input_path: str,
    output_path: str,
    do_rembg: bool = True,
    model: str = "isnet-anime",
) -> dict:
    """预处理一张图片为 512x512 RGBA 立绘。

    返回报告 dict:
      ok: 是否成功产出文件
      output_path
      original_size: [w,h]
      did_rembg: 是否实际抠了图
      foreground_ratio: 处理后前景占比
      warnings: [str,...] 给用户的提示
      error: 失败原因(仅失败时)
    """
    report = {
        "ok": False,
        "output_path": output_path,
        "original_size": None,
        "did_rembg": False,
        "foreground_ratio": None,
        "warnings": [],
        "error": None,
    }
    try:
        img = Image.open(input_path)
    except Exception as e:
        report["error"] = f"无法打开图片: {e}"
        return report

    report["original_size"] = list(img.size)
    had_alpha = _has_alpha_transparency(img.convert("RGBA") if img.mode != "RGBA" else img)

    img = img.convert("RGBA")

    # 1) 抠图去背景（可选）：原图没有透明通道时才需要
    if do_rembg and not had_alpha:
        if _REMBG_AVAILABLE:
            try:
                session = _get_rembg_session(model)
                img = _rembg_remove(img, session=session)
                img = img.convert("RGBA")
                report["did_rembg"] = True
            except Exception as e:
                report["warnings"].append(f"自动抠图失败，按原图处理: {e}")
        else:
            report["warnings"].append("未安装 rembg，跳过自动抠图；若图片自带纯色背景，建议先手动抠图")
    elif had_alpha:
        report["warnings"].append("图片已带透明背景，跳过自动抠图")

    # 2) 居中缩放到 512x512 透明画布
    img = resize_to_512_center(img)

    # 3) alpha 边缘清理
    img = _clean_alpha_edges(img)

    # 4) 质量校验
    ratio = _alpha_foreground_ratio(img)
    report["foreground_ratio"] = round(ratio, 3)
    if ratio < 0.02:
        report["warnings"].append("几乎检测不到角色前景，可能抠图失败或图片为空，请换一张")
    elif ratio > 0.95:
        report["warnings"].append("前景几乎占满画面，可能背景未抠净或图片过满，建议用单人正面、背景简单的图")
    if not _has_alpha_transparency(img):
        report["warnings"].append("处理后仍无透明背景，THA 需要透明背景，效果可能不佳")

    try:
        img.save(output_path)
        report["ok"] = True
    except Exception as e:
        report["error"] = f"保存失败: {e}"
    return report


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 3:
        print("usage: python preprocess_image.py <input> <output> [no-rembg]")
        sys.exit(1)
    do = "no-rembg" not in sys.argv[3:]
    rep = preprocess(sys.argv[1], sys.argv[2], do_rembg=do)
    print(json.dumps(rep, ensure_ascii=False, indent=2))
