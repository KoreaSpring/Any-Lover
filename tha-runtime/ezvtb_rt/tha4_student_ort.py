"""THA4 Student Model (Mode 14) ONNX Runtime Implementation
Two-stage inference architecture with DirectML GPU acceleration
"""
import os
import onnxruntime as ort
import numpy as np
from ezvtb_rt.ort_utils import createORTSession

class THA4StudentORTSessions:
    """THA4 Student Model ONNX Runtime implementation with DirectML GPU support
    
    Two-stage SIREN-based inference:
    - Stage 1: Face Morpher - generates 128x128 face from pose only
    - Stage 2: Body Morpher - transforms full 512x512 image
    
    Attributes:
        face_morpher: ONNX Runtime session for face generation
        body_morpher: ONNX Runtime session for body transformation
        face_cache: Cache for face morphing results based on pose hash
    """
    
    def __init__(self, model_dir: str, device_id: int = 0):
        """Initialize THA4 Student ONNX Runtime sessions
        
        Args:
            model_dir: Directory containing ONNX model files
            device_id: GPU device ID (default: 0)
        
        Raises:
            ValueError: If DirectML GPU provider not available
        """
        self.model_dir = model_dir
        self.device_id = device_id
        self.dtype = np.float32  # Student model is FP32 only
        self.device = 'dml'
        
        # Check for DirectML support
        available_providers = ort.get_available_providers()
        if 'DmlExecutionProvider' not in available_providers:
            raise ValueError(
                'DirectML not available. Available providers: ' +
                str(available_providers)
            )
        
        print('THA4 Student Model using DmlExecutionProvider')
        
        # Load Face Morpher session (pose only -> 128x128 face)
        face_morpher_path = os.path.join(model_dir, 'face_morpher.onnx')
        self.face_morpher = createORTSession(
            face_morpher_path, 
            device_id=device_id
        )
        
        # Load Body Morpher session (image + face + pose -> output)
        body_morpher_path = os.path.join(model_dir, 'body_morpher.onnx')
        self.body_morpher = createORTSession(
            body_morpher_path,
            device_id=device_id
        )
    
        if device_id == 0:
            # Create GPU memory buffers using OrtValues
            # Face Morpher outputs: [1, 4, 128, 128]
            self.face_morphed_buffer = ort.OrtValue.ortvalue_from_shape_and_type(
                (1, 4, 128, 128), self.dtype, self.device
            )
            # Body Morpher inputs/outputs
            self.input_image_buffer = ort.OrtValue.ortvalue_from_shape_and_type(
                (512, 512, 4), np.uint8, self.device
            )
            self.pose_buffer = ort.OrtValue.ortvalue_from_shape_and_type(
                (1, 45), self.dtype, self.device
            )
            self.result_buffer = ort.OrtValue.ortvalue_from_shape_and_type(
                (1, 4, 512, 512), self.dtype, self.device
            )
            self.cv_result_buffer = ort.OrtValue.ortvalue_from_shape_and_type(
                (512, 512, 4), np.uint8, self.device
            )
            
            # Setup IO binding for body_morpher for faster execution
            self.body_binding = self.body_morpher.io_binding()
            self.body_binding.bind_ortvalue_input(
                'input_image', self.input_image_buffer
            )
            self.body_binding.bind_ortvalue_input(
                'face_morphed', self.face_morphed_buffer
            )
            self.body_binding.bind_ortvalue_input(
                'pose', self.pose_buffer
            )
            self.body_binding.bind_ortvalue_output(
                'result', self.result_buffer
            )
            self.body_binding.bind_ortvalue_output(
                'cv_result', self.cv_result_buffer
            )
        else:
            self.input_image = np.zeros((512, 512, 4), dtype=np.uint8)
    
    def update_image(self, img: np.ndarray):
        """Set input image for processing
        
        Args:
            img: Input image [512, 512, 4] in BGRA format
        
        Raises:
            ValueError: If image is not valid format
        """
        if len(img.shape) != 3 or img.shape != (512, 512, 4) or img.dtype != np.uint8:
            raise ValueError(
                f'Image must be (512, 512, 4) BGRA, got {img.shape}'
            )

        if self.device_id == 0:
            self.input_image_buffer.update_inplace(img)
        else:
            self.input_image = img

    
    def inference(self, pose: np.ndarray) -> np.ndarray:
        """Run inference with pose data
        
        Two-stage pipeline:
        1. Face Morpher: generates 128x128 face from pose only
        2. Body Morpher: transforms full body using face result
        
        Args:
            pose: Pose parameters [1, 45]
                - 0-11: eyebrow parameters
                - 12-38: face expression parameters
                - 39-44: rotation parameters
        
        Returns:
            Output image [512, 512, 4] in RGBA uint8 format
        """
        # Convert pose to FP32 if needed
        pose_fp32 = pose.astype(np.float32)
        
        face_morphed = self.face_morpher.run(
            None,
            {'pose': pose_fp32[:,:39]}
        )[0]
        
        if self.device_id == 0:
            # Update buffers for body morpher
            self.face_morphed_buffer.update_inplace(face_morphed)
            self.pose_buffer.update_inplace(pose_fp32)
            
            # Run body morpher with IO binding
            self.body_morpher.run_with_iobinding(self.body_binding)
            
            return self.cv_result_buffer.numpy()
        else:
            return self.body_morpher.run(None, {
                'input_image': self.input_image,
                'face_morphed': face_morphed,
                'pose': pose_fp32
            })[1]