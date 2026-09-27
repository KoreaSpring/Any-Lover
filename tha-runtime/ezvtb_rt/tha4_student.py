"""THA4 Student Model (Mode 14) TensorRT Implementation
Two-stage inference architecture:
- face_morpher: SIREN network for face morphing (only needs pose)
- body_morpher: Multi-scale SIREN for full-body transformation
"""
import os
import numpy as np
import pycuda.driver as cuda
from collections import OrderedDict

from ezvtb_rt.trt_utils import *
from ezvtb_rt.trt_engine import HostDeviceMem, TRTEngine
from ezvtb_rt.vram_cache import VRAMCacher

class THA4StudentEngines():
    """THA4 Student Model (Mode 14) TensorRT implementation
    
    Two-stage SIREN-based inference:
    - Stage 1: Face Morpher - generates 128x128 face from pose only
    - Stage 2: Body Morpher - transforms full 512x512 image using face output
    
    Attributes:
        face_morpher_cacher (VRAMCacher): Cache for face morphing results
        streams (cuda.Stream): Dedicated CUDA streams for operations
        events (cuda.Event): Synchronization events
    """
    def __init__(self, model_dir, vram_cache_size: float = 1.0):
        """Initialize THA4 Student with model directory and caching
        
        Args:
            model_dir: Directory containing TensorRT engine files
            vram_cache_size: Total GPU memory for caching (MB)
        """
        TRT_LOGGER.log(TRT_LOGGER.INFO, 'Creating Engines')
        self.face_morpher = TRTEngine(join(model_dir, 'face_morpher.onnx'), 1)
        self.face_morpher.configure_in_out_tensors()
        self.body_morpher = TRTEngine(join(model_dir, 'body_morpher.onnx'), 3)
        self.body_morpher.configure_in_out_tensors()

        # Create CUDA streams
        self.stream = cuda.Stream()  # Main stream for setImage and inference
        self.cachestream = cuda.Stream()  # Async cache writes
        
        # Setup single VRAMCacher with compressed storage (size in GB)
        self.cacher = VRAMCacher(
            max_size_gb=vram_cache_size,
            stream=self.cachestream
        ) if vram_cache_size > 0.0 else None

        # Create CUDA events for synchronization
        self.finishedFaceMorpher = cuda.Event()
        self.finishedFetchRes = cuda.Event()
    
    def setImage(self, img:np.ndarray, sync:bool):
        """Set input image and prepare for processing
        Args:
            img (np.ndarray): Input image array (512x512x4 RGBA format)
        """
        assert(len(img.shape) == 3 and 
               img.shape[0] == 512 and 
               img.shape[1] == 512 and 
               img.shape[2] == 4 and
               img.dtype == np.uint8)
        
        np.copyto(self.body_morpher.inputs[0].host, img)
        self.body_morpher.inputs[0].htod(self.stream)
        if sync:
            self.stream.synchronize()

    def syncSetImage(self, img:np.ndarray):
        self.setImage(img, sync=True)
    
    def asyncSetImage(self, img:np.ndarray):
        self.setImage(img, sync=False)
    
    def asyncInfer(self, pose:np.ndarray, stream=None):
        stream = stream if stream is not None else self.stream
        face_pose = pose[:, :39]
        
        # Copy pose to GPU
        np.copyto(self.face_morpher.inputs[0].host, face_pose)
        self.face_morpher.inputs[0].htod(stream)
        np.copyto(self.body_morpher.inputs[2].host, pose)
        self.body_morpher.inputs[2].htod(stream)
        
        # Stage 1: Face Morpher (pose only, generates 128x128 face)
        face_pose_hash = hash(str(face_pose))
        face_cached = None if self.cacher is None else \
            self.cacher.get(face_pose_hash)
        face_cached = face_cached[0] if face_cached is not None else None
        
        self.cachestream.synchronize()

        if face_cached is not None:
            # Use cached result - copy from cache to input buffer (D2D)
            cuda.memcpy_dtod_async(
                self.body_morpher.inputs[1].device,
                face_cached.device,
                self.body_morpher.inputs[1].host.nbytes,
                stream)
        else:
            # Run inference and cache result
            self.face_morpher.asyncKickoff(stream)
            self.finishedFaceMorpher.record(stream)
            
            if self.cacher is not None:
                self.cachestream.wait_for_event(self.finishedFaceMorpher)
                self.cacher.put(face_pose_hash, [self.face_morpher.outputs[0]])
        
            self.body_morpher.inputs[1].bridgeFrom(self.face_morpher.outputs[0], stream)

        self.body_morpher.asyncKickoff(stream)
        self.body_morpher.outputs[1].dtoh(stream)
        self.finishedFetchRes.record(stream)

    def getOutputMem(self) -> HostDeviceMem:
        """Get output HostDeviceMem for further processing
        Returns:
            HostDeviceMem: Output memory buffer on GPU
        """
        return self.body_morpher.outputs[1]

    def syncAndGetOutput(self) -> np.ndarray:
        """Retrieve processed results from GPU
        Returns:
            np.ndarray: Output image array
        """
        self.finishedFetchRes.synchronize()
        return self.body_morpher.outputs[1].host