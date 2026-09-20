"""Token 级流式文本旁路。

现有输出链路把 LLM token 聚合成整句后才随 audio 消息发给前端，字幕因此“整句跳出”。
本模块提供一个基于 ContextVar 的回调注入点：agent 在逐 token yield 时，若当前
会话设置了回调，则同步把 token 交给回调，由会话层额外发送 partial-text 消息，
实现视觉上的流式文本。该旁路完全独立于原有句子/音频通道，不影响 TTS 与最终字幕。
"""

from contextvars import ContextVar
from typing import Callable, Optional

# 当前会话的 token 回调；未设置时 emit 静默无操作
_partial_text_emitter: ContextVar[Optional[Callable[[str], None]]] = ContextVar(
    "partial_text_emitter", default=None
)


def set_partial_text_emitter(emitter: Optional[Callable[[str], None]]):
    """设置当前上下文的 token 回调，返回 token 以便调用方 reset。"""
    return _partial_text_emitter.set(emitter)


def reset_partial_text_emitter(token) -> None:
    """恢复到设置前的回调状态。"""
    try:
        _partial_text_emitter.reset(token)
    except Exception:
        pass


def emit_partial_text(text: str) -> None:
    """把一个 token/文本片段推送到前端（若已注册回调）。绝不抛出异常。"""
    if not text:
        return
    emitter = _partial_text_emitter.get()
    if emitter is None:
        return
    try:
        emitter(text)
    except Exception:
        # 流式仅为视觉增强，任何失败都不应影响主对话链路
        pass
