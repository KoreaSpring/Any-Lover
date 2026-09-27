from PIL import Image
import numpy as np
from scipy.interpolate import interp1d


def resize_to_512_center(img, fill_color=(0, 0, 0, 0)):

    # 计算缩放比例
    original_width, original_height = img.size
    ratio = min(512 / original_width, 512 / original_height)

    # 等比缩放
    new_size = (int(original_width * ratio), int(original_height * ratio))
    resized_img = img.resize(new_size, Image.LANCZOS)  # 高质量缩放算法

    # 创建新画布
    canvas = Image.new(img.mode, (512, 512), fill_color)

    # 计算粘贴位置（居中）
    paste_position = (
        (512 - new_size[0]) // 2,
        (512 - new_size[1]) // 2
    )

    # 合并图像（保持透明度）
    canvas.paste(resized_img, paste_position)


    return canvas

def apply_color_curves(img, curves):
    """
    对图像应用颜色曲线调整
    :param input_path: 输入图像路径
    :param output_path: 输出图像路径
    :param curves: 曲线配置字典，格式为：
        {
            'rgb': [(x1, y1), (x2, y2), ...],  # 全局通道曲线
            'r': [(x1, y1), (x2, y2), ...],    # 红色通道曲线
            'g': [(x1, y1), (x2, y2), ...],    # 绿色通道曲线
            'b': [(x1, y1), (x2, y2), ...]     # 蓝色通道曲线
        }
    """
    if img.mode == 'P':
        img = img.convert('RGB')

    # 分离通道
    channels = list(img.split())

    # 处理每个颜色通道
    for ch_idx, ch_name in enumerate(['r', 'g', 'b','a']):
        # 合并全局和通道特定曲线
        combined_points = []
        if 'rgb' in curves and not ch_name=='a':
            combined_points.extend(curves['rgb'])
        if ch_name in curves:
            combined_points.extend(curves[ch_name])

        if not combined_points:
            continue

        # 生成LUT
        points = sorted(combined_points, key=lambda x: x[0])
        xs, ys = zip(*points)

        # 自动选择插值方式
        interpolation_kind = 'quadratic' if len(points) >= 3 else 'linear'
        interpolator = interp1d(
            xs, ys,
            kind=interpolation_kind,
            bounds_error=False,
            fill_value=(ys[0], ys[-1])
        )

        # 创建查找表
        x_range = np.arange(256)
        y_new = interpolator(x_range)
        y_new = np.clip(y_new, 0, 255).astype(np.uint8)
        lut = y_new.tolist()

        # 应用LUT
        channels[ch_idx] = channels[ch_idx].point(lut)

        # 合并通道并保存
        merged_channels = channels
        img_out = Image.merge(img.mode, merged_channels)

        return img_out


        # 使用示例
if __name__ == "__main__":
        # S型曲线增强对比度
        curves = {
            'a': [
                (60, 0),
                (127, 127),
                (170, 255)
            ]
        }

        # 红色通道增强中间调
        # curves = {
        #     'r': [
        #         (0, 0),
        #         (127, 160),
        #         (255, 255)
        #     ]
        # }
        img = Image.open('input.png')
        # img = apply_color_curves(img, curves)
        img = resize_to_512_center(img)

        img.save('output.png')