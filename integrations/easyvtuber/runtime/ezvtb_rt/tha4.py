"""THA4 TensorRT implementation aligned with THA3 interfaces.

Provides both a simple non-caching pipeline and an optimized caching
pipeline that reuses the compressed VRAM cacher defined in `vram_cache.py`.
"""

from ezvtb_rt.trt_utils import *
from ezvtb_rt.trt_engine import TRTEngine, HostDeviceMem
from ezvtb_rt.vram_cache import VRAMCacher
from typing import List, Optional


class THA4EnginesSimple:
    """Minimal THA4 pipeline for benchmarking (no caching)."""

    def __init__(self, model_dir: str):
        TRT_LOGGER.log(TRT_LOGGER.INFO, "Creating THA4 simple engines")
        self.decomposer = TRTEngine(join(model_dir, "decomposer.onnx"), 1)
        self.combiner = TRTEngine(join(model_dir, "combiner.onnx"), 4)
        self.morpher = TRTEngine(join(model_dir, "morpher.onnx"), 3)
        self.body_morpher = TRTEngine(join(model_dir, "body_morpher.onnx"), 2)
        self.upscaler = TRTEngine(join(model_dir, "upscaler.onnx"), 4)

        # Allocate IO buffers
        self.decomposer.configure_in_out_tensors()
        self.combiner.configure_in_out_tensors()
        self.morpher.configure_in_out_tensors()
        self.body_morpher.configure_in_out_tensors()
        self.upscaler.configure_in_out_tensors()

        self.stream = cuda.Stream()

    def setImage(self, img: np.ndarray) -> None:
        assert (
            len(img.shape) == 3
            and img.shape[0] == 512
            and img.shape[1] == 512
            and img.shape[2] == 4
            and img.dtype == np.uint8
        )
        self.decomposer.syncInfer([img])

    def inference(self, pose: np.ndarray) -> np.ndarray:
        eyebrow_pose = pose[:, :12]
        face_pose = pose[:, 12 : 12 + 27]
        rotation_pose = pose[:, 12 + 27 :]

        np.copyto(self.combiner.inputs[3].host, eyebrow_pose)
        self.combiner.inputs[3].htod(self.stream)
        np.copyto(self.morpher.inputs[2].host, face_pose)
        self.morpher.inputs[2].htod(self.stream)
        np.copyto(self.body_morpher.inputs[1].host, rotation_pose)
        self.body_morpher.inputs[1].htod(self.stream)
        np.copyto(self.upscaler.inputs[3].host, rotation_pose)
        self.upscaler.inputs[3].htod(self.stream)

        self.combiner.inputs[0].bridgeFrom(self.decomposer.outputs[2], self.stream)
        self.combiner.inputs[1].bridgeFrom(self.decomposer.outputs[0], self.stream)
        self.combiner.inputs[2].bridgeFrom(self.decomposer.outputs[1], self.stream)
        self.combiner.asyncKickoff(self.stream)

        self.morpher.inputs[0].bridgeFrom(self.decomposer.outputs[2], self.stream)
        self.morpher.inputs[1].bridgeFrom(self.combiner.outputs[0], self.stream)
        self.morpher.asyncKickoff(self.stream)

        self.body_morpher.inputs[0].bridgeFrom(self.morpher.outputs[1], self.stream)
        self.body_morpher.asyncKickoff(self.stream)

        self.upscaler.inputs[0].bridgeFrom(self.morpher.outputs[0], self.stream)
        self.upscaler.inputs[1].bridgeFrom(self.body_morpher.outputs[0], self.stream)
        self.upscaler.inputs[2].bridgeFrom(self.body_morpher.outputs[1], self.stream)
        self.upscaler.asyncKickoff(self.stream)

        self.upscaler.outputs[1].dtoh(self.stream)
        self.stream.synchronize()
        return self.upscaler.outputs[1].host


class THA4Engines:
    """Optimized THA4 pipeline using TRTEngine and compressed VRAM caching."""

    def __init__(self, model_dir: str, vram_cache_size: float = 1.0, use_eyebrow: bool = True):
        TRT_LOGGER.log(TRT_LOGGER.INFO, "Creating THA4 engines")
        self.decomposer = TRTEngine(join(model_dir, "decomposer.onnx"), 1)
        self.combiner = TRTEngine(join(model_dir, "combiner.onnx"), 4)
        self.morpher = TRTEngine(join(model_dir, "morpher.onnx"), 3)
        self.body_morpher = TRTEngine(join(model_dir, "body_morpher.onnx"), 2)
        self.upscaler = TRTEngine(join(model_dir, "upscaler.onnx"), 4)

        self.decomposer.configure_in_out_tensors()
        self.combiner.configure_in_out_tensors()
        self.morpher.configure_in_out_tensors()
        self.body_morpher.configure_in_out_tensors()
        self.upscaler.configure_in_out_tensors()

        self.use_eyebrow = use_eyebrow
        self.stream = cuda.Stream()
        self.cachestream = cuda.Stream()

        self.cacher = (
            VRAMCacher(max_size_gb=vram_cache_size, stream=self.cachestream)
            if vram_cache_size > 0.0
            else None
        )

        self.finishedMorpher = cuda.Event()
        self.finishedCombiner = cuda.Event()
        self.finishedFetch = cuda.Event()

    def setImage(self, img: np.ndarray, sync: bool) -> None:
        assert (
            len(img.shape) == 3
            and img.shape[0] == 512
            and img.shape[1] == 512
            and img.shape[2] == 4
            and img.dtype == np.uint8
        )

        np.copyto(self.decomposer.inputs[0].host, img)
        self.decomposer.inputs[0].htod(self.stream)
        self.decomposer.asyncKickoff(self.stream)

        if not self.use_eyebrow:
            self.combiner.inputs[3].host[:, :] = 0.0
            self.combiner.inputs[3].htod(self.stream)
            self.combiner.inputs[0].bridgeFrom(self.decomposer.outputs[2], self.stream)
            self.combiner.inputs[1].bridgeFrom(self.decomposer.outputs[0], self.stream)
            self.combiner.inputs[2].bridgeFrom(self.decomposer.outputs[1], self.stream)
            self.combiner.asyncKickoff(self.stream)

        if sync:
            self.stream.synchronize()

    def syncSetImage(self, img: np.ndarray) -> None:
        self.setImage(img, sync=True)

    def asyncSetImage(self, img: np.ndarray) -> None:
        self.setImage(img, sync=False)

    def asyncInfer(self, pose: np.ndarray, stream: Optional[cuda.Stream] = None) -> None:
        stream = stream if stream is not None else self.stream

        eyebrow_pose = pose[:, :12]
        face_pose = pose[:, 12 : 12 + 27]
        rotation_pose = pose[:, 12 + 27 :]

        np.copyto(self.body_morpher.inputs[1].host, rotation_pose)
        self.body_morpher.inputs[1].htod(stream)
        np.copyto(self.upscaler.inputs[3].host, rotation_pose)
        self.upscaler.inputs[3].htod(stream)

        morpher_hash = hash(str(pose[0, :12 + 27]))
        morpher_cached = None if self.cacher is None else self.cacher.get(morpher_hash)
        combiner_hash = hash(str(pose[0, :12]))
        combiner_cached = None
        if self.use_eyebrow and self.cacher is not None:
            combiner_cached = self.cacher.get(combiner_hash)

        self.cachestream.synchronize()

        if morpher_cached is not None:
            cuda.memcpy_dtod_async(
                self.body_morpher.inputs[0].device,
                morpher_cached[1].device,
                self.body_morpher.inputs[0].host.nbytes,
                stream,
            )
            cuda.memcpy_dtod_async(
                self.upscaler.inputs[0].device,
                morpher_cached[0].device,
                self.upscaler.inputs[0].host.nbytes,
                stream,
            )

            self.body_morpher.asyncKickoff(stream)

            self.upscaler.inputs[1].bridgeFrom(self.body_morpher.outputs[0], stream)
            self.upscaler.inputs[2].bridgeFrom(self.body_morpher.outputs[1], stream)
            self.upscaler.asyncKickoff(stream)

        elif combiner_cached is not None or not self.use_eyebrow:
            if self.use_eyebrow and combiner_cached is not None:
                cuda.memcpy_dtod_async(
                    self.morpher.inputs[1].device,
                    combiner_cached[0].device,
                    self.morpher.inputs[1].host.nbytes,
                    stream,
                )
            else:
                self.morpher.inputs[1].bridgeFrom(self.combiner.outputs[0], stream)

            np.copyto(self.morpher.inputs[2].host, face_pose)
            self.morpher.inputs[2].htod(stream)
            self.morpher.inputs[0].bridgeFrom(self.decomposer.outputs[2], stream)
            self.morpher.asyncKickoff(stream)
            self.finishedMorpher.record(stream)

            self.body_morpher.inputs[0].bridgeFrom(self.morpher.outputs[1], stream)
            self.body_morpher.asyncKickoff(stream)

            self.upscaler.inputs[0].bridgeFrom(self.morpher.outputs[0], stream)
            self.upscaler.inputs[1].bridgeFrom(self.body_morpher.outputs[0], stream)
            self.upscaler.inputs[2].bridgeFrom(self.body_morpher.outputs[1], stream)
            self.upscaler.asyncKickoff(stream)

            if self.cacher is not None:
                self.cachestream.wait_for_event(self.finishedMorpher)
                self.cacher.put(morpher_hash, [self.morpher.outputs[0], self.morpher.outputs[1]])

        else:
            np.copyto(self.morpher.inputs[2].host, face_pose)
            self.morpher.inputs[2].htod(stream)
            np.copyto(self.combiner.inputs[3].host, eyebrow_pose)
            self.combiner.inputs[3].htod(stream)

            self.combiner.inputs[0].bridgeFrom(self.decomposer.outputs[2], stream)
            self.combiner.inputs[1].bridgeFrom(self.decomposer.outputs[0], stream)
            self.combiner.inputs[2].bridgeFrom(self.decomposer.outputs[1], stream)
            self.combiner.asyncKickoff(stream)
            self.finishedCombiner.record(stream)

            self.morpher.inputs[0].bridgeFrom(self.decomposer.outputs[2], stream)
            self.morpher.inputs[1].bridgeFrom(self.combiner.outputs[0], stream)
            self.morpher.asyncKickoff(stream)
            self.finishedMorpher.record(stream)

            self.body_morpher.inputs[0].bridgeFrom(self.morpher.outputs[1], stream)
            self.body_morpher.asyncKickoff(stream)

            self.upscaler.inputs[0].bridgeFrom(self.morpher.outputs[0], stream)
            self.upscaler.inputs[1].bridgeFrom(self.body_morpher.outputs[0], stream)
            self.upscaler.inputs[2].bridgeFrom(self.body_morpher.outputs[1], stream)
            self.upscaler.asyncKickoff(stream)

            if self.cacher is not None and self.use_eyebrow:
                self.cachestream.wait_for_event(self.finishedCombiner)
                self.cacher.put(combiner_hash, [self.combiner.outputs[0]])

            if self.cacher is not None:
                self.cachestream.wait_for_event(self.finishedMorpher)
                self.cacher.put(morpher_hash, [self.morpher.outputs[0], self.morpher.outputs[1]])

        self.upscaler.outputs[1].dtoh(stream)
        self.finishedFetch.record(stream)

    def getOutputMem(self) -> HostDeviceMem:
        return self.upscaler.outputs[1]

    def syncAndGetOutput(self) -> np.ndarray:
        self.finishedFetch.synchronize()
        return self.upscaler.outputs[1].host


# Backwards-compatible alias
THA4 = THA4Engines
