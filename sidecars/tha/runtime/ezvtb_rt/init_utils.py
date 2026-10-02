import onnx
import os
import ezvtb_rt

def check_exist_all_models():

    rife_types = ['x2','x3','x4']
    rife_dtypes = ['fp32','fp16']
    rife_list = []
    for rife_type in rife_types:
        for rife_dtype in rife_dtypes:
            onnx_file = os.path.join(ezvtb_rt.EZVTB_DATA, 'rife', f'rife_{rife_type}_{rife_dtype}.onnx')
            if not os.path.isfile(onnx_file):
                raise ValueError('Data is not prepared')
            onnx.checker.check_model(onnx_file)
            rife_list.append(onnx_file)

    real_esrgan_list = [os.path.join(ezvtb_rt.EZVTB_DATA,'Real-ESRGAN','exported_256_fp16.onnx'), os.path.join(ezvtb_rt.EZVTB_DATA,'Real-ESRGAN','exported_256_fp32.onnx')]
    waifu2x_list = [os.path.join(ezvtb_rt.EZVTB_DATA,'waifu2x','noise0_scale2x_fp16.onnx'), os.path.join(ezvtb_rt.EZVTB_DATA,'waifu2x','noise0_scale2x_fp32.onnx')]

    tha_types = ['seperable', 'standard']
    tha_dtypes = ['fp32', 'fp16']
    tha_components = ['combiner.onnx', 'decomposer.onnx','editor.onnx', 'morpher.onnx', 'rotator.onnx', 'merge.onnx', 'merge_no_eyebrow.onnx']
    tha_list = []
    for tha_type in tha_types:
        for tha_dtype in tha_dtypes:
            for tha_component in tha_components:
                onnx_file = os.path.join(ezvtb_rt.EZVTB_DATA, 'tha3', tha_type, tha_dtype, tha_component)
                if not os.path.isfile(onnx_file):
                    raise ValueError('Data is not prepared')
                onnx.checker.check_model(onnx_file)
                tha_list.append(onnx_file)

    tha4_list = []
    for tha4_component in ['body_morpher.onnx', 'combiner.onnx', 'decomposer.onnx', 'morpher.onnx', 'upscaler.onnx', 'merge.onnx', 'merge_no_eyebrow.onnx']:
        for dtype in ['fp32','fp16']:
            onnx_file = os.path.join(ezvtb_rt.EZVTB_DATA, 'tha4', dtype, tha4_component)
            if not os.path.isfile(onnx_file):
                raise ValueError('Data is not prepared')
            onnx.checker.check_model(onnx_file)
            tha4_list.append(onnx_file)
    return rife_list + tha_list + real_esrgan_list + waifu2x_list + tha4_list

def merge_graph_all(tha_dir:str, seperable:bool):
    try:
        onnx.checker.check_model(os.path.join(tha_dir, 'merge_all.onnx'))
        return
    except:
        pass
    #merge all models into one
    decomposer = onnx.load(os.path.join(tha_dir, 'decomposer.onnx'))
    decomposer = onnx.compose.add_prefix(decomposer,'decomposer_')
    combiner = onnx.load(os.path.join(tha_dir, 'combiner.onnx'))
    combiner = onnx.compose.add_prefix(combiner,'combiner_')
    morpher = onnx.load(os.path.join(tha_dir, 'morpher.onnx'))
    morpher = onnx.compose.add_prefix(morpher,'morpher_')
    rotator = onnx.load(os.path.join(tha_dir, 'rotator.onnx'))
    rotator = onnx.compose.add_prefix(rotator,'rotator_')
    editor = onnx.load(os.path.join(tha_dir, 'editor.onnx'))
    editor = onnx.compose.add_prefix(editor,'editor_')
    if not seperable:
        decoded_cut = ('combiner_/face_morpher/downsample_blocks.3/downsample_blocks.3.2/Relu_output_0', 'morpher_/face_morpher/downsample_blocks.3/downsample_blocks.3.2/Relu_output_0')
    else:
        decoded_cut = ('combiner_/face_morpher/body/downsample_blocks.3/downsample_blocks.3.3/Relu_output_0', 'morpher_/face_morpher/body/downsample_blocks.3/downsample_blocks.3.3/Relu_output_0')
    
    merged = onnx.compose.merge_models(rotator, editor, [("rotator_full_warped_image", 'editor_rotated_warped_image'),
                                            ("rotator_full_grid_change", 'editor_rotated_grid_change')], outputs=['editor_cv_result'])
    merged = onnx.compose.merge_models(morpher, merged, [('morpher_face_morphed_full', 'editor_morphed_image'), 
                                                         ('morpher_face_morphed_half', 'rotator_face_morphed_half')])
    merged = onnx.compose.merge_models(combiner, merged, [('combiner_eyebrow_image', 'morpher_im_morpher_crop'), 
                                                         decoded_cut])
    merged = onnx.compose.merge_models(decomposer, merged, [('decomposer_background_layer', 'combiner_eyebrow_background_layer'), 
                                                            ('decomposer_eyebrow_layer', "combiner_eyebrow_layer"),
                                                            ('decomposer_image_prepared', 'combiner_image_prepared'),
                                                            ('decomposer_image_prepared', 'morpher_image_prepared')])
    onnx.save_model(merged, os.path.join(tha_dir, 'merge_all.onnx'))

def merge_graph(tha_dir:str, seperable:bool, use_eyebrow:bool = True):
    try:
        onnx.checker.check_model(os.path.join(tha_dir, 'merge.onnx' if use_eyebrow else 'merge_no_eyebrow.onnx'))
        return
    except:
        pass
    #Merge models except for decomposer
    combiner = onnx.load(os.path.join(tha_dir, 'combiner.onnx'))
    combiner = onnx.compose.add_prefix(combiner,'combiner_')
    morpher = onnx.load(os.path.join(tha_dir, 'morpher.onnx'))
    morpher = onnx.compose.add_prefix(morpher,'morpher_')
    rotator = onnx.load(os.path.join(tha_dir, 'rotator.onnx'))
    rotator = onnx.compose.add_prefix(rotator,'rotator_')
    editor = onnx.load(os.path.join(tha_dir, 'editor.onnx'))
    editor = onnx.compose.add_prefix(editor,'editor_')
    if not seperable:
        decoded_cut = ('combiner_/face_morpher/downsample_blocks.3/downsample_blocks.3.2/Relu_output_0', 'morpher_/face_morpher/downsample_blocks.3/downsample_blocks.3.2/Relu_output_0')
    else:
        decoded_cut = ('combiner_/face_morpher/body/downsample_blocks.3/downsample_blocks.3.3/Relu_output_0', 'morpher_/face_morpher/body/downsample_blocks.3/downsample_blocks.3.3/Relu_output_0')
    
    merged = onnx.compose.merge_models(rotator, editor, [("rotator_full_warped_image", 'editor_rotated_warped_image'),
                                            ("rotator_full_grid_change", 'editor_rotated_grid_change')], outputs=['editor_cv_result'])
    merged = onnx.compose.merge_models(morpher, merged, [('morpher_face_morphed_full', 'editor_morphed_image'), 
                                                         ('morpher_face_morphed_half', 'rotator_face_morphed_half')])
    
    if use_eyebrow:
        merged = onnx.compose.merge_models(combiner, merged, [('combiner_eyebrow_image', 'morpher_im_morpher_crop'), 
                                                         decoded_cut])
    onnx.save_model(merged, os.path.join(tha_dir, 'merge.onnx' if use_eyebrow else 'merge_no_eyebrow.onnx'))

def merge_graph_tha4(tha4_dir: str, use_eyebrow: bool = True):
    """Merge THA4 ONNX models into a single graph for optimized execution
    
    Args:
        tha4_dir: Directory containing THA4 ONNX models
        use_eyebrow: Whether to include eyebrow processing
    """
    merge_filename = 'merge.onnx' if use_eyebrow else 'merge_no_eyebrow.onnx'
    try:
        onnx.checker.check_model(os.path.join(tha4_dir, merge_filename))
        return
    except:
        pass
    
    # Load all THA4 models
    combiner = onnx.load(os.path.join(tha4_dir, 'combiner.onnx'))
    combiner = onnx.compose.add_prefix(combiner, 'combiner_')
    
    morpher = onnx.load(os.path.join(tha4_dir, 'morpher.onnx'))
    morpher = onnx.compose.add_prefix(morpher, 'morpher_')
    
    body_morpher = onnx.load(os.path.join(tha4_dir, 'body_morpher.onnx'))
    body_morpher = onnx.compose.add_prefix(body_morpher, 'body_morpher_')
    
    upscaler = onnx.load(os.path.join(tha4_dir, 'upscaler.onnx'))
    upscaler = onnx.compose.add_prefix(upscaler, 'upscaler_')
    
    # Merge from back to front
    # upscaler <- body_morpher
    merged = onnx.compose.merge_models(
        body_morpher, upscaler,
        [
            ("body_morpher_half_res_posed_image", 'upscaler_half_res_posed_image'),
            ("body_morpher_half_res_grid_change", 'upscaler_half_res_grid_change')
        ],
        outputs=['upscaler_cv_result'])
    
    # morpher <- merged (body_morpher + upscaler)
    merged = onnx.compose.merge_models(
        morpher, merged,
        [
            ('morpher_face_morphed_full', 'upscaler_rest_image'),
            ('morpher_face_morphed_half', 'body_morpher_face_morphed_half')
        ])
    
    # combiner <- merged (morpher + body_morpher + upscaler)
    if use_eyebrow:
        merged = onnx.compose.merge_models(
            combiner, merged,
            [('combiner_eyebrow_image', 'morpher_im_morpher_crop')])
    
    onnx.save_model(merged, os.path.join(tha4_dir, merge_filename))