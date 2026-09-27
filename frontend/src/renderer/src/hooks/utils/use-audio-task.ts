/* eslint-disable func-names */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { audioManager } from '@/utils/audio-manager';
import { toaster } from '@/components/ui/toaster';
import { useWebSocket } from '@/context/websocket-context';
import { DisplayText } from '@/services/websocket-service';
import { useLive2DExpression } from '@/hooks/canvas/use-live2d-expression';
import { useRenderMode } from '@/context/render-mode-context';
import { thaDriver } from '@/utils/tha-driver';
import * as LAppDefine from '../../../WebSDK/src/lappdefine';

// Simple type alias for Live2D model
type Live2DModel = any;

interface AudioTaskOptions {
  audioBase64: string
  volumes: number[]
  sliceLength: number
  displayText?: DisplayText | null
  expressions?: string[] | number[] | null
  speaker_uid?: string
  forwarded?: boolean
}

/**
 * Custom hook for handling audio playback tasks with Live2D lip sync
 */
export const useAudioTask = () => {
  const { t } = useTranslation();
  const { aiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setSubtitleText } = useSubtitle();
  const { appendResponse, appendAIMessage } = useChatHistory();
  const { sendMessage } = useWebSocket();
  const { setExpression } = useLive2DExpression();
  const { renderMode } = useRenderMode();

  // State refs to avoid stale closures
  const stateRef = useRef({
    aiState,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
    renderMode,
  });

  // Note: currentAudioRef and currentModelRef are now managed by the global audioManager

  stateRef.current = {
    aiState,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
    renderMode,
  };

  /**
   * Stop current audio playback and lip sync (delegates to global audioManager)
   */
  const stopCurrentAudioAndLipSync = useCallback(() => {
    audioManager.stopCurrentAudioAndLipSync();
  }, []);

  /**
   * THA 渲染模式下的音频播放 + 口型驱动。
   * 不依赖 Live2D：播放 TTS 音频，同时用 requestAnimationFrame 按播放进度
   * 从后端提供的 volumes(0..1, 每 sliceLength ms 一个) 取当前音量，发给 THA 服务驱动嘴部。
   */
  const playThaAudio = (
    audioDataUrl: string,
    volumes: number[],
    sliceLength: number,
    expressions: string[] | number[] | null,
    resolve: () => void,
  ): void => {
    // 表情：把 LLM 情绪标签(后端给的 emotionMap 索引)发给 THA 服务合成表情基底
    if (expressions && expressions.length > 0) {
      const first = expressions[0];
      const idx = typeof first === 'number' ? first : parseInt(String(first), 10);
      if (!Number.isNaN(idx)) thaDriver.sendExpressionByIndex(idx);
    }

    const audio = new Audio(audioDataUrl);
    // 复用全局 audioManager，使中断/停止逻辑对 THA 同样生效（model 传 null）
    audioManager.setCurrentAudio(audio, null);

    let finished = false;
    let rafId = 0;

    const stopDriveLoop = (): void => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const cleanup = (): void => {
      stopDriveLoop();
      thaDriver.resetMouth();
      audioManager.clearCurrentAudio(audio);
      if (!finished) {
        finished = true;
        resolve();
      }
    };

    const driveLoop = (): void => {
      // 被中断/停止则收尾
      if (stateRef.current.aiState === 'interrupted' || !audioManager.hasCurrentAudio()) {
        cleanup();
        return;
      }
      const slice = sliceLength > 0 ? sliceLength : 20;
      const idx = Math.floor((audio.currentTime * 1000) / slice);
      const v = volumes.length > 0 ? volumes[Math.min(idx, volumes.length - 1)] : 0;
      thaDriver.sendMouth(v);
      rafId = requestAnimationFrame(driveLoop);
    };

    audio.addEventListener('canplaythrough', () => {
      if (stateRef.current.aiState === 'interrupted' || !audioManager.hasCurrentAudio()) {
        cleanup();
        return;
      }
      audio.play().catch((err) => {
        console.error('[THA] audio play error:', err);
        cleanup();
      });
      rafId = requestAnimationFrame(driveLoop);
    });
    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);
    audio.load();
  };

  /**
   * Handle audio playback with Live2D lip sync
   */
  const handleAudioPlayback = (options: AudioTaskOptions): Promise<void> => new Promise((resolve) => {
    const {
      aiState: currentAiState,
      setSubtitleText: updateSubtitle,
      appendResponse: appendText,
      appendAIMessage: appendAI,
    } = stateRef.current;

    // Skip if already interrupted
    if (currentAiState === 'interrupted') {
      console.warn('Audio playback blocked by interruption state.');
      resolve();
      return;
    }

    const { audioBase64, displayText, expressions, forwarded, volumes, sliceLength } = options;
    const currentRenderMode = stateRef.current.renderMode;

    // Update display text
    if (displayText) {
      appendText(displayText.text);
      appendAI(displayText.text, displayText.name, displayText.avatar);
      if (audioBase64) {
        updateSubtitle(displayText.text);
      }
      if (!forwarded) {
        sendMessage({
          type: "audio-play-start",
          display_text: displayText,
          forwarded: true,
        });
      }
    }

    try {
      // Process audio if available
      if (audioBase64) {
        const audioDataUrl = `data:audio/wav;base64,${audioBase64}`;

        // THA 渲染模式：不走 Live2D，改为播放音频 + 按后端提供的 volumes 时序
        // 驱动 THA 服务的嘴部（sendMouth）。volumes 已归一化到 0..1，每 sliceLength ms 一个。
        if (currentRenderMode === 'tha') {
          playThaAudio(audioDataUrl, volumes || [], sliceLength || 20, expressions || null, resolve);
          return;
        }

        // Get Live2D manager and model
        const live2dManager = (window as any).getLive2DManager?.();
        if (!live2dManager) {
          console.error('Live2D manager not found');
          resolve();
          return;
        }

        const model = live2dManager.getModel(0);
        if (!model) {
          console.error('Live2D model not found at index 0');
          resolve();
          return;
        }
        console.log('Found model for audio playback');

        if (!model._wavFileHandler) {
          console.warn('Model does not have _wavFileHandler for lip sync');
        } else {
          console.log('Model has _wavFileHandler available');
        }

        // Set expression if available
        const lappAdapter = (window as any).getLAppAdapter?.();
        if (lappAdapter && expressions?.[0] !== undefined) {
          setExpression(
            expressions[0],
            lappAdapter,
            `Set expression to: ${expressions[0]}`,
          );
        }

        // Start talk motion
        if (LAppDefine && LAppDefine.PriorityNormal) {
          console.log("Starting random 'Talk' motion");
          model.startRandomMotion(
            "Talk",
            LAppDefine.PriorityNormal,
          );
        } else {
          console.warn("LAppDefine.PriorityNormal not found - cannot start talk motion");
        }

        // Setup audio element
        const audio = new Audio(audioDataUrl);
        
        // Register with global audio manager IMMEDIATELY after creating audio
        audioManager.setCurrentAudio(audio, model);
        let isFinished = false;

        const cleanup = () => {
          audioManager.clearCurrentAudio(audio);
          if (!isFinished) {
            isFinished = true;
            resolve();
          }
        };

        // Enhance lip sync sensitivity
        const lipSyncScale = 2.0;

        audio.addEventListener('canplaythrough', () => {
          // Check for interruption before playback
          if (stateRef.current.aiState === 'interrupted' || !audioManager.hasCurrentAudio()) {
            console.warn('Audio playback cancelled due to interruption or audio was stopped');
            cleanup();
            return;
          }

          console.log('Starting audio playback with lip sync');
          audio.play().catch((err) => {
            console.error("Audio play error:", err);
            cleanup();
          });

          // Setup lip sync
          if (model._wavFileHandler) {
            if (!model._wavFileHandler._initialized) {
              console.log('Applying enhanced lip sync');
              model._wavFileHandler._initialized = true;

              const originalUpdate = model._wavFileHandler.update.bind(model._wavFileHandler);
              model._wavFileHandler.update = function (deltaTimeSeconds: number) {
                const result = originalUpdate(deltaTimeSeconds);
                // @ts-ignore
                this._lastRms = Math.min(2.0, this._lastRms * lipSyncScale);
                return result;
              };
            }

            if (audioManager.hasCurrentAudio()) {
              model._wavFileHandler.start(audioDataUrl);
            } else {
              console.warn('WavFileHandler start skipped - audio was stopped');
            }
          }
        });

        audio.addEventListener('ended', () => {
          console.log("Audio playback completed");
          cleanup();
        });

        audio.addEventListener('error', (error) => {
          console.error("Audio playback error:", error);
          cleanup();
        });

        audio.load();
      } else {
        resolve();
      }
    } catch (error) {
      console.error('Audio playback setup error:', error);
      toaster.create({
        title: `${t('error.audioPlayback')}: ${error}`,
        type: "error",
        duration: 2000,
      });
      resolve();
    }
  });

  // Handle backend synthesis completion
  useEffect(() => {
    let isMounted = true;

    const handleComplete = async () => {
      await audioTaskQueue.waitForCompletion();
      if (isMounted && backendSynthComplete) {
        stopCurrentAudioAndLipSync();
        // THA 模式：整轮播放结束后闭嘴 + 表情回 neutral，避免表情/口型卡住
        if (stateRef.current.renderMode === 'tha') {
          thaDriver.resetMouth();
          thaDriver.sendExpression('neutral');
        }
        sendMessage({ type: "frontend-playback-complete" });
        setBackendSynthComplete(false);
      }
    };

    handleComplete();

    return () => {
      isMounted = false;
    };
  }, [backendSynthComplete, sendMessage, setBackendSynthComplete, stopCurrentAudioAndLipSync]);

  /**
   * Add a new audio task to the queue
   */
  const addAudioTask = async (options: AudioTaskOptions) => {
    const { aiState: currentState } = stateRef.current;

    if (currentState === 'interrupted') {
      console.log('Skipping audio task due to interrupted state');
      return;
    }

    console.log(`Adding audio task ${options.displayText?.text} to queue`);
    audioTaskQueue.addTask(() => handleAudioPlayback(options));
  };

  return {
    addAudioTask,
    appendResponse,
    stopCurrentAudioAndLipSync,
  };
};
