"""ezvtuber-rt: Real-time virtual tuber animation library.

A high-performance library for real-time virtual tuber animation powered by
TensorRT and ONNX. Supports THA3, RIFE frame interpolation, and super-resolution.

Main Components:
    - CoreTRT: TensorRT-accelerated inference pipeline (NVIDIA GPUs)
    - CoreORT: ONNX Runtime inference pipeline (AMD/Intel GPUs, CPU)
    - THA: Talking Head Anime model wrapper
    - RIFE: Real-time frame interpolation
    - SR: Super-resolution model wrapper
    - Cacher: Memory and disk caching system
"""

__version__ = "0.1.0"
__author__ = "zpeng11"
__license__ = "MIT"

import os
EZVTB_DATA = os.path.join(os.path.dirname(__file__),'..', "data")
def init_model_path(custom_path: str):
    """Initialize model data path.

    Args:
        custom_path: Custom path to model data directory.
    """
    global EZVTB_DATA
    EZVTB_DATA = custom_path
__all__ = ["init_model_path"]

# Import main classes for easy access
try:
    import os
    from ezvtb_rt.trt_utils import cudaSetDevice
    device_id = int(os.environ.get('EZVTB_DEVICE_ID', '0'))
    cudaSetDevice(device_id)
    import pycuda.autoinit  # Ensure PyCUDA is initialized for TensorRT
    from ezvtb_rt.core_trt import CoreTRT
    __all__.append("CoreTRT")
except ImportError:
    print("TensorRT or PyCUDA not available, CoreTRT disabled.")
    # TensorRT not available
    __all__ = []

from ezvtb_rt.core_ort import CoreORT
__all__.append("CoreORT")

# Note: C++ extensions (rgba_utils, ffmpeg_codec) are not built by default.
# They are available in ezvtb_rt/cpp/ for optional manual building if needed.