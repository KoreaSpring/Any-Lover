from ezvtb_rt.trt_utils import *
from ezvtb_rt.trt_engine import TRTEngine, HostDeviceMem
from ezvtb_rt.vram_cache import VRAMCacher
import asyncio
from typing import Tuple, Optional

# THASimple - A basic implementation of THA core using TensorRT
# Used primarily for benchmarking performance on different platforms
class THA3EnginesSimple():
    def __init__(self, model_dir):
        TRT_LOGGER.log(TRT_LOGGER.INFO, 'Creating Engines')
        self.decomposer = TRTEngine(join(model_dir, 'decomposer.onnx'), 1)
        self.combiner = TRTEngine(join(model_dir, 'combiner.onnx'), 4)
        self.morpher = TRTEngine(join(model_dir, 'morpher.onnx'), 4)
        self.rotator = TRTEngine(join(model_dir, 'rotator.onnx'), 2)
        self.editor = TRTEngine(join(model_dir, 'editor.onnx'), 4)
        self.decomposer.configure_in_out_tensors()
        self.combiner.configure_in_out_tensors()
        self.morpher.configure_in_out_tensors()
        self.rotator.configure_in_out_tensors()
        self.editor.configure_in_out_tensors()
        self.stream = cuda.Stream()
    
    def setImage(self, img:np.ndarray):
        """Set input image and prepare for processing
        Args:
            img (np.ndarray): Input image array (512x512x4 RGBA format)
        """
        assert(len(img.shape) == 3 and 
               img.shape[0] == 512 and 
               img.shape[1] == 512 and 
               img.shape[2] == 4   and
               img.dtype == np.uint8)
        self.decomposer.syncInfer([img])

    def inference(self, pose:np.ndarray) -> np.ndarray:
        # Put pose data into respective engines
        eyebrow_pose = pose[:, :12]
        face_pose = pose[:,12:12+27]
        rotation_pose = pose[:,12+27:]
        np.copyto(self.combiner.inputs[3].host, eyebrow_pose)
        self.combiner.inputs[3].htod(self.stream)
        np.copyto(self.morpher.inputs[2].host, face_pose)
        self.morpher.inputs[2].htod(self.stream)
        np.copyto(self.rotator.inputs[1].host, rotation_pose)
        self.rotator.inputs[1].htod(self.stream)
        np.copyto(self.editor.inputs[3].host, rotation_pose)
        self.editor.inputs[3].htod(self.stream)

        self.combiner.inputs[0].bridgeFrom(self.decomposer.outputs[2], self.stream)
        self.combiner.inputs[1].bridgeFrom(self.decomposer.outputs[0], self.stream)
        self.combiner.inputs[2].bridgeFrom(self.decomposer.outputs[1], self.stream)
        self.combiner.asyncKickoff(self.stream)

        self.morpher.inputs[0].bridgeFrom(self.decomposer.outputs[2], self.stream)
        self.morpher.inputs[1].bridgeFrom(self.combiner.outputs[0], self.stream)
        self.morpher.inputs[3].bridgeFrom(self.combiner.outputs[1], self.stream)
        self.morpher.asyncKickoff(self.stream)

        self.rotator.inputs[0].bridgeFrom(self.morpher.outputs[1], self.stream)
        self.rotator.asyncKickoff(self.stream)

        self.editor.inputs[0].bridgeFrom(self.morpher.outputs[0], self.stream)
        self.editor.inputs[1].bridgeFrom(self.rotator.outputs[0], self.stream)
        self.editor.inputs[2].bridgeFrom(self.rotator.outputs[1], self.stream)
        self.editor.asyncKickoff(self.stream)
        self.editor.outputs[1].dtoh(self.stream)
        self.stream.synchronize()
        return self.editor.outputs[1].host


class THA3Engines():
    """Optimized THA implementation using TRTEngine with GPU memory caching
    
    Attributes:
        combiner_cacher (VRAMCacher): Cache for eyebrow combination results (compressed)
        morpher_cacher (VRAMCacher): Cache for face morphing results (compressed)
        streams (cuda.Stream): Dedicated CUDA streams for different operations
        events (cuda.Event): Synchronization events for pipeline stages
    """
    def __init__(self, model_dir, vram_cache_size:float = 1.0, use_eyebrow:bool = True):
        """Initialize THA3Engines with model directory and caching configuration
        Args:
            model_dir (str): Directory containing TensorRT engine files
            vram_cache_size (float): Total GPU memory allocated for caching (in GB)
            use_eyebrow (bool): Enable eyebrow pose processing
        """
        TRT_LOGGER.log(TRT_LOGGER.INFO, 'Creating Engines')
        self.decomposer = TRTEngine(join(model_dir, 'decomposer.onnx'), 1)
        self.combiner = TRTEngine(join(model_dir, 'combiner.onnx'), 4)
        self.morpher = TRTEngine(join(model_dir, 'morpher.onnx'), 4)
        self.rotator = TRTEngine(join(model_dir, 'rotator.onnx'), 2)
        self.editor = TRTEngine(join(model_dir, 'editor.onnx'), 4)
        self.decomposer.configure_in_out_tensors()
        self.combiner.configure_in_out_tensors()
        self.morpher.configure_in_out_tensors()
        self.rotator.configure_in_out_tensors()
        self.editor.configure_in_out_tensors()
        
        self.use_eyebrow = use_eyebrow
        
        # Create CUDA streams
        self.stream = cuda.Stream()  # Main stream for setImage and inference
        self.cachestream = cuda.Stream()  # Async cache writes
        
        # Setup single VRAMCacher with compressed storage (size in GB)
        self.cacher = VRAMCacher(
            max_size_gb=vram_cache_size,
            stream=self.cachestream
        ) if vram_cache_size > 0.0 else None
        
        # Create CUDA events for synchronization
        self.finishedMorpher = cuda.Event()
        self.finishedCombiner = cuda.Event()
        self.finishedFetch = cuda.Event()
    
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
        
        np.copyto(self.decomposer.inputs[0].host, img)
        self.decomposer.inputs[0].htod(self.stream)
        self.decomposer.asyncKickoff(self.stream)
        
        if not self.use_eyebrow:
            # Pre-run combiner with zero eyebrow pose when eyebrow is disabled
            self.combiner.inputs[3].host[:,:] = 0.0
            self.combiner.inputs[3].htod(self.stream)
            # Bridge decomposer outputs to combiner inputs
            self.combiner.inputs[0].bridgeFrom(self.decomposer.outputs[2], self.stream)
            self.combiner.inputs[1].bridgeFrom(self.decomposer.outputs[0], self.stream)
            self.combiner.inputs[2].bridgeFrom(self.decomposer.outputs[1], self.stream)
            self.combiner.asyncKickoff(self.stream)
        if sync:
            self.stream.synchronize()

    def syncSetImage(self, img:np.ndarray):
        self.setImage(img, sync=True)
    
    def asyncSetImage(self, img:np.ndarray):
        self.setImage(img, sync=False)

    def asyncInfer(self, pose:np.ndarray, stream=None):
        """Execute full inference pipeline with pose data and caching
        Args:
            pose (np.ndarray): Combined pose parameters array containing:
                - eyebrow_pose: First 12 elements
                - face_pose: Next 27 elements 
                - rotation_pose: Remaining elements
            stream: Optional CUDA stream to use. If None, uses self.stream
        """
        # Use provided stream or default to self.stream
        stream = stream if stream is not None else self.stream
        
        eyebrow_pose = pose[:, :12]
        face_pose = pose[:, 12:12+27]
        rotation_pose = pose[:, 12+27:]

        # Upload rotation pose (always needed)
        np.copyto(self.rotator.inputs[1].host, rotation_pose)
        self.rotator.inputs[1].htod(stream)
        np.copyto(self.editor.inputs[3].host, rotation_pose)
        self.editor.inputs[3].htod(stream)

        # Compute hashes for cache lookup
        morpher_hash = hash(str(pose[0, :12+27]))
        morpher_cached = None if self.cacher is None else self.cacher.get(morpher_hash)
        combiner_hash = hash(str(pose[0, :12]))
        if self.use_eyebrow:
            combiner_cached = None if self.cacher is None else self.cacher.get(combiner_hash)
        else:
            combiner_cached = None

        self.cachestream.synchronize()

        if morpher_cached is not None:
            # Path 1: Morpher results are cached - skip combiner and morpher
            # morpher_cached[0] = face_morphed_full, morpher_cached[1] = face_morphed_half
            cuda.memcpy_dtod_async(
                self.rotator.inputs[0].device, morpher_cached[1].device,
                self.rotator.inputs[0].host.nbytes, stream
            )
            cuda.memcpy_dtod_async(
                self.editor.inputs[0].device, morpher_cached[0].device,
                self.editor.inputs[0].host.nbytes, stream
            )
            self.rotator.asyncKickoff(stream)
            # Bridge rotator outputs to editor
            self.editor.inputs[1].bridgeFrom(self.rotator.outputs[0], stream)
            self.editor.inputs[2].bridgeFrom(self.rotator.outputs[1], stream)
            self.editor.asyncKickoff(stream)

        elif combiner_cached is not None or not self.use_eyebrow:
            # Path 2: Combiner results are cached (or eyebrow disabled) - skip combiner only
            if self.use_eyebrow:
                # Copy cached combiner outputs to morpher inputs
                # combiner_cached[0] = eyebrow_image, combiner_cached[1] = morpher_decoded
                cuda.memcpy_dtod_async(
                    self.morpher.inputs[1].device, combiner_cached[0].device,
                    self.morpher.inputs[1].host.nbytes, stream
                )
                cuda.memcpy_dtod_async(
                    self.morpher.inputs[3].device, combiner_cached[1].device,
                    self.morpher.inputs[3].host.nbytes, stream
                )
            else:
                # Bridge from combiner outputs (pre-computed in setImage)
                self.morpher.inputs[1].bridgeFrom(self.combiner.outputs[0], stream)
                self.morpher.inputs[3].bridgeFrom(self.combiner.outputs[1], stream)
            
            # Prepare face pose input
            np.copyto(self.morpher.inputs[2].host, face_pose)
            self.morpher.inputs[2].htod(stream)
            
            # Bridge decomposer output to morpher
            self.morpher.inputs[0].bridgeFrom(self.decomposer.outputs[2], stream)
            
            # Execute morpher
            self.morpher.asyncKickoff(stream)
            self.finishedMorpher.record(stream)
            
            # Execute rotator and editor
            self.rotator.inputs[0].bridgeFrom(self.morpher.outputs[1], stream)
            self.rotator.asyncKickoff(stream)
            
            self.editor.inputs[0].bridgeFrom(self.morpher.outputs[0], stream)
            self.editor.inputs[1].bridgeFrom(self.rotator.outputs[0], stream)
            self.editor.inputs[2].bridgeFrom(self.rotator.outputs[1], stream)
            self.editor.asyncKickoff(stream)

            # Cache morpher results (compress and store)
            if self.cacher is not None:
                self.cachestream.wait_for_event(self.finishedMorpher)
                self.cacher.put(morpher_hash, [self.morpher.outputs[0], self.morpher.outputs[1]])

        else:
            # Path 3: No cache hits - execute full pipeline
            # Prepare pose inputs
            np.copyto(self.morpher.inputs[2].host, face_pose)
            self.morpher.inputs[2].htod(stream)
            np.copyto(self.combiner.inputs[3].host, eyebrow_pose)
            self.combiner.inputs[3].htod(stream)

            # Bridge decomposer outputs to combiner
            self.combiner.inputs[0].bridgeFrom(self.decomposer.outputs[2], stream)
            self.combiner.inputs[1].bridgeFrom(self.decomposer.outputs[0], stream)
            self.combiner.inputs[2].bridgeFrom(self.decomposer.outputs[1], stream)
            
            # Execute combiner
            self.combiner.asyncKickoff(stream)
            self.finishedCombiner.record(stream)

            # Bridge to morpher and execute
            self.morpher.inputs[0].bridgeFrom(self.decomposer.outputs[2], stream)
            self.morpher.inputs[1].bridgeFrom(self.combiner.outputs[0], stream)
            self.morpher.inputs[3].bridgeFrom(self.combiner.outputs[1], stream)
            self.morpher.asyncKickoff(stream)
            self.finishedMorpher.record(stream)

            # Execute rotator and editor
            self.rotator.inputs[0].bridgeFrom(self.morpher.outputs[1], stream)
            self.rotator.asyncKickoff(stream)
            
            self.editor.inputs[0].bridgeFrom(self.morpher.outputs[0], stream)
            self.editor.inputs[1].bridgeFrom(self.rotator.outputs[0], stream)
            self.editor.inputs[2].bridgeFrom(self.rotator.outputs[1], stream)
            self.editor.asyncKickoff(stream)
            if self.cacher is not None:
                # Cache combiner results (compress and store)
                self.cachestream.wait_for_event(self.finishedCombiner)
                self.cacher.put(combiner_hash, [self.combiner.outputs[0], self.combiner.outputs[1]])

                # Cache morpher results (compress and store)
                self.cachestream.wait_for_event(self.finishedMorpher)
                self.cacher.put(morpher_hash, [self.morpher.outputs[0], self.morpher.outputs[1]])

        # Fetch output on stream (serial with inference)
        self.editor.outputs[1].dtoh(stream)
        self.finishedFetch.record(stream)
    
    def getOutputMem(self) -> HostDeviceMem:
        """Get output HostDeviceMem for further processing
        Returns:
            HostDeviceMem: Output memory buffer on GPU
        """
        return self.editor.outputs[1]

    def syncAndGetOutput(self) -> np.ndarray:
        """Retrieve processed results from GPU
        Returns:
            np.ndarray: Output image array
        """
        self.finishedFetch.synchronize()
        return self.editor.outputs[1].host
