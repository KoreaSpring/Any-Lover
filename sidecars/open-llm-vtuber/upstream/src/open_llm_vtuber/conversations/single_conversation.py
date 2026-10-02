from typing import Union, List, Dict, Any, Optional
import asyncio
import json
from loguru import logger
import numpy as np

from .conversation_utils import (
    create_batch_input,
    process_agent_output,
    send_conversation_start_signals,
    process_user_input,
    finalize_conversation_turn,
    cleanup_conversation,
    EMOJI_LIST,
)
from .types import WebSocketSend
from .tts_manager import TTSTaskManager
from .stream_hooks import set_partial_text_emitter, reset_partial_text_emitter
from ..chat_history_manager import store_message
from ..service_context import ServiceContext

# Import necessary types from agent outputs
from ..agent.output_types import SentenceOutput, AudioOutput


async def process_single_conversation(
    context: ServiceContext,
    websocket_send: WebSocketSend,
    client_uid: str,
    user_input: Union[str, np.ndarray],
    images: Optional[List[Dict[str, Any]]] = None,
    session_emoji: str = np.random.choice(EMOJI_LIST),
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Process a single-user conversation turn

    Args:
        context: Service context containing all configurations and engines
        websocket_send: WebSocket send function
        client_uid: Client unique identifier
        user_input: Text or audio input from user
        images: Optional list of image data
        session_emoji: Emoji identifier for the conversation
        metadata: Optional metadata for special processing flags

    Returns:
        str: Complete response text
    """
    # Create TTSTaskManager for this conversation
    tts_manager = TTSTaskManager()
    full_response = ""  # Initialize full_response here

    try:
        # Send initial signals
        await send_conversation_start_signals(websocket_send)
        logger.info(f"New Conversation Chain {session_emoji} started!")

        # Process user input
        input_text = await process_user_input(
            user_input, context.asr_engine, websocket_send
        )

        # Create batch input
        batch_input = create_batch_input(
            input_text=input_text,
            images=images,
            from_name=context.character_config.human_name,
            metadata=metadata,
        )

        # Store user message (check if we should skip storing to history)
        skip_history = metadata and metadata.get("skip_history", False)
        if context.history_uid and not skip_history:
            store_message(
                conf_uid=context.character_config.conf_uid,
                history_uid=context.history_uid,
                role="human",
                content=input_text,
                name=context.character_config.human_name,
            )

        if skip_history:
            logger.debug("Skipping storing user input to history (proactive speak)")

        logger.info(f"User input: {input_text}")
        if images:
            logger.info(f"With {len(images)} images")

        # 注册 token 旁路回调：agent 逐 token 产出时，额外发送 partial-text 消息，
        # 让前端字幕流式显示。该通道独立于句子/音频通道，不影响 TTS 与最终字幕。
        loop = asyncio.get_running_loop()

        def _emit_partial(text: str) -> None:
            def _send() -> None:
                try:
                    asyncio.ensure_future(
                        websocket_send(json.dumps({"type": "partial-text", "text": text}))
                    )
                except Exception:
                    pass

            loop.call_soon_threadsafe(_send)

        emitter_token = set_partial_text_emitter(_emit_partial)
        try:
            # agent.chat yields Union[SentenceOutput, Dict[str, Any]]
            agent_output_stream = context.agent_engine.chat(batch_input)

            async for output_item in agent_output_stream:
                if (
                    isinstance(output_item, dict)
                    and output_item.get("type") == "tool_call_status"
                ):
                    # Handle tool status event: send WebSocket message
                    output_item["name"] = context.character_config.character_name
                    logger.debug(f"Sending tool status update: {output_item}")

                    await websocket_send(json.dumps(output_item))

                elif isinstance(output_item, (SentenceOutput, AudioOutput)):
                    # Handle SentenceOutput or AudioOutput
                    response_part = await process_agent_output(
                        output=output_item,
                        character_config=context.character_config,
                        live2d_model=context.live2d_model,
                        tts_engine=context.tts_engine,
                        websocket_send=websocket_send,  # Pass websocket_send for audio/tts messages
                        tts_manager=tts_manager,
                        translate_engine=context.translate_engine,
                    )
                    # Ensure response_part is treated as a string before concatenation
                    response_part_str = (
                        str(response_part) if response_part is not None else ""
                    )
                    full_response += response_part_str  # Accumulate text response
                else:
                    logger.warning(
                        f"Received unexpected item type from agent chat stream: {type(output_item)}"
                    )
                    logger.debug(f"Unexpected item content: {output_item}")

        except Exception as e:
            logger.exception(
                f"Error processing agent response stream: {e}"
            )  # Log with stack trace
            await websocket_send(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Error processing agent response: {str(e)}",
                    }
                )
            )
            # full_response will contain partial response before error
        finally:
            # token 流结束后注销旁路回调，避免影响后续会话
            reset_partial_text_emitter(emitter_token)
        # --- End processing agent response ---

        # Wait for any pending TTS tasks.
        # return_exceptions=True：个别 TTS/转码失败（如缺 ffmpeg）不冒泡为整段
        # 对话异常，避免误弹 "Conversation error"；这些失败已在 _process_tts 内退化为静音。
        if tts_manager.task_list:
            await asyncio.gather(*tts_manager.task_list, return_exceptions=True)
            await websocket_send(json.dumps({"type": "backend-synth-complete"}))

        await finalize_conversation_turn(
            tts_manager=tts_manager,
            websocket_send=websocket_send,
            client_uid=client_uid,
        )

        if context.history_uid and full_response:  # Check full_response before storing
            store_message(
                conf_uid=context.character_config.conf_uid,
                history_uid=context.history_uid,
                role="ai",
                content=full_response,
                name=context.character_config.character_name,
                avatar=context.character_config.avatar,
            )
            logger.info(f"AI response: {full_response}")

        return full_response  # Return accumulated full_response

    except asyncio.CancelledError:
        logger.info(f"🤡👍 Conversation {session_emoji} cancelled because interrupted.")
        raise
    except (AssertionError, ConnectionError, RuntimeError) as e:
        # 打断（interrupt）会让底层 WebSocket 进入关闭流程，此时向其发送剩余消息会
        # 触发 websockets 库的 AssertionError（_drain_helper）。这类异常源于连接状态，
        # 对话内容通常已成功生成，不应再向前端弹出 "Conversation error"（且消息体为空），
        # 也不应尝试再次发送（会二次抛错）。仅记录日志后正常结束。
        logger.warning(
            f"Conversation {session_emoji} ended while connection was closing: {type(e).__name__}"
        )
        return full_response
    except Exception as e:
        logger.error(f"Error in conversation chain: {e}")
        try:
            await websocket_send(
                json.dumps({"type": "error", "message": f"Conversation error: {str(e)}"})
            )
        except Exception as send_err:
            # 连接可能已关闭，发送失败不应掩盖原始错误
            logger.debug(f"Failed to send conversation error to client: {send_err}")
        raise
    finally:
        cleanup_conversation(tts_manager, session_emoji)
