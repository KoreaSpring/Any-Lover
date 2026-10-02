import sys
import os

import sherpa_onnx
import soundfile as sf
from loguru import logger
from .tts_interface import TTSInterface

current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)


class TTSEngine(TTSInterface):
    def __init__(
        self,
        vits_model=None,
        vits_lexicon="",
        vits_tokens="",
        vits_data_dir="",
        vits_dict_dir="",
        tts_rule_fsts="",
        max_num_sentences=2,
        sid=0,
        provider="cpu",
        num_threads=1,
        speed=1.0,
        debug=False,
        # [any-lover] Kokoro 支持（sherpa-onnx 1.13+）。model_type='kokoro' 时使用以下字段。
        model_type="vits",
        kokoro_model=None,
        kokoro_voices=None,
        kokoro_tokens=None,
        kokoro_data_dir=None,
        kokoro_lexicon=None,
    ):
        self.model_type = model_type or "vits"
        self.kokoro_model = kokoro_model or ""
        self.kokoro_voices = kokoro_voices or ""
        self.kokoro_tokens = kokoro_tokens or ""
        self.kokoro_data_dir = kokoro_data_dir or ""
        self.kokoro_lexicon = kokoro_lexicon or ""
        # [any-lover] 配置里的可选路径未填时为 None，而 sherpa-onnx 的 pybind 构造函数
        # 只接受 str，传 None 会报 "incompatible constructor arguments"，统一转成 ""。
        self.vits_model = vits_model
        self.vits_lexicon = vits_lexicon or ""
        self.vits_tokens = vits_tokens or ""
        self.vits_data_dir = vits_data_dir or ""
        self.vits_dict_dir = vits_dict_dir or ""
        self.tts_rule_fsts = tts_rule_fsts or ""
        self.max_num_sentences = max_num_sentences
        self.sid = sid  # Speaker ID
        self.provider = provider  # Computation provider (e.g., "cpu", "cuda")
        self.num_threads = num_threads
        self.speed = speed  # Speech speed
        self.debug = debug  # Debug mode flag

        self.file_extension = "wav"
        self.new_audio_dir = "cache"

        if not os.path.exists(self.new_audio_dir):
            os.makedirs(self.new_audio_dir)

        self.tts = self.initialize_tts()

    def initialize_tts(self):
        """
        Initialize the sherpa-onnx TTS engine.
        """
        # [any-lover] 按 model_type 构造 vits 或 kokoro 子配置
        if self.model_type == "kokoro":
            model_part = {
                "kokoro": sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=self.kokoro_model,
                    voices=self.kokoro_voices,
                    tokens=self.kokoro_tokens,
                    data_dir=self.kokoro_data_dir,
                    lexicon=self.kokoro_lexicon,
                )
            }
        else:
            model_part = {
                "vits": sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=self.vits_model or "",
                    lexicon=self.vits_lexicon,
                    data_dir=self.vits_data_dir,
                    dict_dir=self.vits_dict_dir,
                    tokens=self.vits_tokens,
                )
            }

        # Construct the configuration for the TTS engine
        tts_config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                **model_part,
                provider=self.provider,
                debug=self.debug,
                num_threads=self.num_threads,
            ),
            rule_fsts=self.tts_rule_fsts,
            max_num_sentences=self.max_num_sentences,
        )

        # Validate the configuration
        if not tts_config.validate():
            raise ValueError("Please check your sherpa-onnx TTS config")

        # Create and return the sherpa-onnx OfflineTts object
        return sherpa_onnx.OfflineTts(tts_config)

    def generate_audio(self, text, file_name_no_ext=None):
        """
        Generate speech audio file using sherpa-onnx TTS.

        Parameters:
            text (str): The text to speak.
            file_name_no_ext (str, optional): Name of the file without extension.

        Returns:
            str: The path to the generated audio file.
        """
        file_name = self.generate_cache_file_name(file_name_no_ext, self.file_extension)

        try:
            audio = self.tts.generate(text, sid=self.sid, speed=self.speed)

            if len(audio.samples) == 0:
                logger.error(
                    "Error in generating audios. Please read previous error messages."
                )
                return None

            sf.write(
                file_name,
                audio.samples,
                samplerate=audio.sample_rate,
                subtype="PCM_16",
            )

            return file_name

        except Exception as e:
            logger.critical(f"\nError: sherpa-onnx unable to generate audio: {e}")
            return None
