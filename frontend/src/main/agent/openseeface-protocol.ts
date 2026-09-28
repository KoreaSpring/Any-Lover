// OpenSeeFace UDP 包解析（纯函数，独立可测）。
//
// 协议（已对 facetracker.py 的打包代码实测确认；默认端口 11573，UDP，little-endian）：
//   单脸数据包关键字段偏移（struct.pack，小端）：
//     0   double  now            时间戳
//     8   int32   id             脸 ID
//     12  float   width
//     16  float   height
//     20  float   eye_blink[0]   右眼开合
//     24  float   eye_blink[1]   左眼开合
//     28  uint8   success        是否检测到脸
//     29  float   pnp_error
//     33  float×4 quaternion XYZW 头部旋转四元数（备用）
//     49  float×3 euler X/Y/Z    头部欧拉角 → 视线跟随主用
//     61  float×3 translation    头部平移（备用）
//     73+ landmarks/confidence + current_features（本阶段不解析）
//
//   OpenSeeFace 惯例：euler[0]=pitch（上下）、euler[1]=yaw（左右）、euler[2]=roll（倾斜）。
//   注意：欧拉角在 OSF 中通常以 0~360 表示，需归一到 [-180,180]；具体方向/符号在实现联调时
//   对着摄像头实测校准（见 gaze-pipeline 的 mirrorYaw 与符号处理）。

export const OPENSEEFACE_DEFAULT_PORT = 11573;

/** 从 UDP 包解析出的、视线跟随所需的最小信息。 */
export interface OpenSeeFacePose {
  faceId: number;
  success: boolean;
  /** 上下（度，已归一到 [-180,180]）。 */
  pitch: number;
  /** 左右（度，已归一到 [-180,180]）。 */
  yaw: number;
  /** 倾斜（度）。 */
  roll: number;
  /** [右, 左] 眼开合 0..1。 */
  blink: [number, number];
  pnpError: number;
}

/** 单脸包头最小长度：解析到 euler 需要至少 61 字节。 */
const MIN_PACKET_LEN = 61;

/** 把 OSF 的角度归一到 [-180, 180]。 */
function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * 解析一个 OpenSeeFace UDP 数据包，取视线跟随所需字段。
 * 包长不足或非有效结构时返回 null（调用方忽略该帧）。
 */
export function parseOpenSeeFacePacket(buf: Buffer): OpenSeeFacePose | null {
  if (buf.length < MIN_PACKET_LEN) return null;
  try {
    const faceId = buf.readInt32LE(8);
    const blinkRight = buf.readFloatLE(20);
    const blinkLeft = buf.readFloatLE(24);
    const success = buf.readUInt8(28) !== 0;
    const pnpError = buf.readFloatLE(29);
    // euler XYZ 从偏移 49 起，3 个 float
    const eulerX = buf.readFloatLE(49); // pitch
    const eulerY = buf.readFloatLE(53); // yaw
    const eulerZ = buf.readFloatLE(57); // roll

    return {
      faceId,
      success,
      pitch: normalizeDeg(eulerX),
      yaw: normalizeDeg(eulerY),
      roll: normalizeDeg(eulerZ),
      blink: [clamp01(blinkRight), clamp01(blinkLeft)],
      pnpError,
    };
  } catch {
    return null;
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
