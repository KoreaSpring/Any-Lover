/* eslint-disable @typescript-eslint/ban-ts-comment */
import { memo, useState, useRef } from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { FiChevronLeft, FiUpload, FiSettings } from 'react-icons/fi';
import { useThaConfig, ThaPerfPreset } from '@/context/tha-config-context';
import { thaDriver } from '@/utils/tha-driver';
import { toaster } from '@/components/ui/toaster';
import { FaceEmotionRunner } from '@/utils/face-emotion';
import { VoiceEmotionRunner } from '@/utils/voice-emotion';
import { IPC } from '@proto/ipc';
import { isHubDialogueEnabled, setHubDialogueEnabled } from '@/utils/hub-dialogue';

// THA 参数侧边面板（Windows / THA 模式）。展开态占满左侧一列（对标截图蓝圈），
// 含：立绘上传 + 抠图模型选择（动漫/写实）+ 当前立绘 + 性能预设 + 提示。
// 收起态缩成吸左边的小按钮。
const PRESETS: { value: ThaPerfPreset; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'ultra', label: '极高' },
];

type CutModel = 'isnet-anime' | 'u2net';

export const ThaSettingsPanel = memo((): JSX.Element => {
  const [collapsed, setCollapsed] = useState(true);
  const { currentImageName, setCurrentImageName, perfPreset, setPerfPreset } = useThaConfig();
  const [busy, setBusy] = useState(false);
  const [cutModel, setCutModel] = useState<CutModel>('isnet-anime');
  const [uploadProg, setUploadProg] = useState<{ percent: number; message: string } | null>(null);

  // 摄像头视线跟随（默认关，敏感能力需显式开启）。
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);

  // 桌面观察（定期采样屏幕形成记忆，默认关，比摄像头更敏感）。
  const [screenOn, setScreenOn] = useState(false);
  const [screenBusy, setScreenBusy] = useState(false);

  // 情绪识别共情（默认关，需主模型）。
  const [emotionOn, setEmotionOn] = useState(false);
  const [emotionBusy, setEmotionBusy] = useState(false);

  // 面部情绪（MediaPipe，renderer 本地，需摄像头，默认关）。
  const [faceOn, setFaceOn] = useState(false);
  const [faceBusy, setFaceBusy] = useState(false);
  const faceRunnerRef = useRef<FaceEmotionRunner | null>(null);

  const toggleFace = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    const next = !faceOn;
    setFaceBusy(true);
    try {
      if (next) {
        const runner = new FaceEmotionRunner((reading) => {
          // 上报主进程 → perception.emotion(source:'face') → EmotionState 融合。
          r?.send(IPC.agent.faceEmotion, reading);
        });
        await runner.start(); // 无摄像头/加载失败会抛错
        faceRunnerRef.current = runner;
        setFaceOn(true);
        toaster.create({ title: '已开启面部情绪', type: 'success', duration: 2000 });
      } else {
        faceRunnerRef.current?.stop();
        faceRunnerRef.current = null;
        setFaceOn(false);
        toaster.create({ title: '已关闭面部情绪', type: 'success', duration: 2000 });
      }
    } catch (e) {
      faceRunnerRef.current?.stop();
      faceRunnerRef.current = null;
      setFaceOn(false);
      toaster.create({
        title: '面部情绪不可用',
        description: `${e instanceof Error ? e.message : e}（需摄像头且可联网加载模型）`,
        type: 'warning',
        duration: 4000,
      });
    } finally {
      setFaceBusy(false);
    }
  };

  // 语音情绪（声学特征，renderer 本地，需麦克风，默认关）。
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const voiceRunnerRef = useRef<VoiceEmotionRunner | null>(null);

  const toggleVoice = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    const next = !voiceOn;
    setVoiceBusy(true);
    try {
      if (next) {
        const runner = new VoiceEmotionRunner((reading) => {
          r?.send(IPC.agent.voiceEmotion, reading);
        });
        await runner.start(); // 无麦克风/拒绝会抛错
        voiceRunnerRef.current = runner;
        setVoiceOn(true);
        toaster.create({ title: '已开启语音情绪', type: 'success', duration: 2000 });
      } else {
        voiceRunnerRef.current?.stop();
        voiceRunnerRef.current = null;
        setVoiceOn(false);
        toaster.create({ title: '已关闭语音情绪', type: 'success', duration: 2000 });
      }
    } catch (e) {
      voiceRunnerRef.current?.stop();
      voiceRunnerRef.current = null;
      setVoiceOn(false);
      toaster.create({
        title: '语音情绪不可用',
        description: `${e instanceof Error ? e.message : e}（需麦克风权限）`,
        type: 'warning',
        duration: 4000,
      });
    } finally {
      setVoiceBusy(false);
    }
  };

  const toggleEmotion = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    if (!r) return;
    const next = !emotionOn;
    setEmotionBusy(true);
    try {
      const res = await r.invoke('agent:emotion', { enabled: next });
      if (res?.ok) {
        setEmotionOn(next);
        toaster.create({
          title: next ? '已开启情绪共情' : '已关闭情绪共情',
          type: 'success',
          duration: 2000,
        });
      } else {
        setEmotionOn(false);
        toaster.create({
          title: '情绪共情不可用',
          description: res?.message || '需先配置主模型',
          type: 'warning',
          duration: 4000,
        });
      }
    } catch (e) {
      setEmotionOn(false);
      toaster.create({ title: `切换失败: ${e}`, type: 'error', duration: 3000 });
    } finally {
      setEmotionBusy(false);
    }
  };

  // 中枢对话（F-1）：开启后文字对话走中枢(注入记忆/画像/关系/情绪),默认关(走老后端)。纯本地开关。
  const [hubDialogueOn, setHubDialogueOn] = useState(isHubDialogueEnabled);
  const toggleHubDialogue = (): void => {
    const next = !hubDialogueOn;
    setHubDialogueOn(next);
    setHubDialogueEnabled(next);
    toaster.create({
      title: next ? '已切换到中枢对话' : '已切换回后端对话',
      description: next ? '文字对话将结合记忆/画像/关系/情绪（需配好主模型）' : undefined,
      type: 'success',
      duration: 2500,
    });
  };

  // 主动搭话（非对话时基于观察主动关心，默认关）。
  const [proactiveOn, setProactiveOn] = useState(false);
  const [proactiveBusy, setProactiveBusy] = useState(false);

  const toggleProactive = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    if (!r) return;
    const next = !proactiveOn;
    setProactiveBusy(true);
    try {
      const res = await r.invoke('agent:proactive', { enabled: next });
      if (res?.ok) {
        setProactiveOn(next);
        toaster.create({
          title: next ? '已开启主动搭话' : '已关闭主动搭话',
          type: 'success',
          duration: 2000,
        });
      } else {
        setProactiveOn(false);
        toaster.create({
          title: '主动搭话不可用',
          description: res?.message || '需先配置主模型',
          type: 'warning',
          duration: 4000,
        });
      }
    } catch (e) {
      setProactiveOn(false);
      toaster.create({ title: `切换失败: ${e}`, type: 'error', duration: 3000 });
    } finally {
      setProactiveBusy(false);
    }
  };

  // 记忆查看/清空。
  interface MemItem { id: string; ts: number; note: string; tags: string[]; count?: number }
  const [memExpanded, setMemExpanded] = useState(false);
  const [memItems, setMemItems] = useState<MemItem[]>([]);
  const [memLoading, setMemLoading] = useState(false);

  const loadMemory = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    if (!r) return;
    setMemLoading(true);
    try {
      const res = await r.invoke('agent:memory:recent', { limit: 30 });
      if (res?.ok) setMemItems(res.items || []);
    } catch {
      /* ignore */
    } finally {
      setMemLoading(false);
    }
  };

  const toggleMemory = async (): Promise<void> => {
    const next = !memExpanded;
    setMemExpanded(next);
    if (next) await loadMemory();
  };

  const clearMemory = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    if (!r) return;
    // 二次确认，避免误清。
    // eslint-disable-next-line no-alert
    if (!window.confirm('确定清空全部桌面观察记忆？此操作不可撤销。')) return;
    try {
      await r.invoke('agent:memory:clear');
      setMemItems([]);
      toaster.create({ title: '已清空记忆', type: 'success', duration: 2000 });
    } catch (e) {
      toaster.create({ title: `清空失败: ${e}`, type: 'error', duration: 3000 });
    }
  };

  // 关系 + 画像查看。
  interface RelView { familiarity: number; level: string; daysKnown: number; interactionCount: number }
  interface ProfileFact { key: string; value: string }
  const [relExpanded, setRelExpanded] = useState(false);
  const [rel, setRel] = useState<RelView | null>(null);
  const [profile, setProfile] = useState<ProfileFact[]>([]);

  const loadRelationship = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    if (!r) return;
    try {
      const res = await r.invoke('agent:relationship:get');
      if (res?.ok) {
        setRel(res.relationship || null);
        setProfile(res.profile || []);
      }
    } catch {
      /* ignore */
    }
  };

  const toggleRelationship = async (): Promise<void> => {
    const next = !relExpanded;
    setRelExpanded(next);
    if (next) await loadRelationship();
  };

  const toggleScreen = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    if (!r) return;
    const next = !screenOn;
    setScreenBusy(true);
    try {
      const res = await r.invoke('agent:screen', { enabled: next });
      if (res?.ok) {
        setScreenOn(next);
        toaster.create({
          title: next ? '已开启桌面观察' : '已关闭桌面观察',
          type: 'success',
          duration: 2000,
        });
      } else {
        setScreenOn(false);
        toaster.create({
          title: '桌面观察不可用',
          description: res?.message || '无法开启',
          type: 'warning',
          duration: 4000,
        });
      }
    } catch (e) {
      setScreenOn(false);
      toaster.create({ title: `切换失败: ${e}`, type: 'error', duration: 3000 });
    } finally {
      setScreenBusy(false);
    }
  };

  const toggleCamera = async (): Promise<void> => {
    const r = window.electron?.ipcRenderer;
    if (!r) return;
    const next = !cameraOn;
    setCameraBusy(true);
    try {
      const res = await r.invoke('agent:camera', { enabled: next });
      if (res?.ok) {
        setCameraOn(next);
        toaster.create({
          title: next ? '已开启摄像头视线跟随' : '已关闭摄像头视线跟随',
          type: 'success',
          duration: 2000,
        });
      } else {
        // 开启失败（无摄像头/无 facetracker/非 Windows）：保持关闭并提示。
        setCameraOn(false);
        toaster.create({
          title: '摄像头视线跟随不可用',
          description: res?.message || '未检测到摄像头或组件缺失',
          type: 'warning',
          duration: 4000,
        });
      }
    } catch (e) {
      setCameraOn(false);
      toaster.create({ title: `切换失败: ${e}`, type: 'error', duration: 3000 });
    } finally {
      setCameraBusy(false);
    }
  };

  const handleUpload = async (): Promise<void> => {
    if (!window.api?.pickThaImage) return;
    let res: { path: string } | undefined;
    try {
      res = await window.api.pickThaImage();
    } catch (e) {
      toaster.create({ title: `选图失败: ${e}`, type: 'error', duration: 2000 });
      return;
    }
    if (!res?.path) return;

    const base = res.path.replace(/\\/g, '/').split('/').pop() || 'custom';
    const name = base.replace(/\.[^.]+$/, '');

    setBusy(true);
    setUploadProg({ percent: 5, message: '开始处理立绘…' });

    // 订阅处理进度：done/error 时收尾。设超时兜底，避免卡在 busy。
    let unsub: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsub?.();
      setBusy(false);
      setUploadProg(null);
    }, 60000);
    unsub = thaDriver.onSetImageProgress((p) => {
      setUploadProg({ percent: p.percent, message: p.message });
      if (p.stage === 'done' || p.stage === 'error') {
        clearTimeout(timeout);
        unsub?.();
        setBusy(false);
        if (p.stage === 'done') setCurrentImageName(name);
        // 完成/失败提示后清除进度条
        setTimeout(() => setUploadProg(null), p.stage === 'done' ? 1200 : 3000);
        if (p.stage === 'error') {
          toaster.create({ title: p.message || '立绘处理失败', type: 'error', duration: 3000 });
        }
      }
    });

    thaDriver.sendSetImage(res.path, name, cutModel);
  };

  // 切换性能预设：low 随包可用；medium/high/ultra 需高画质模型包，未下载则提示去首启页下载。
  const handlePreset = async (p: ThaPerfPreset): Promise<void> => {
    setPerfPreset(p);
    const r = window.electron?.ipcRenderer;
    if (p !== 'low' && r) {
      try {
        const st = await r.invoke('tha:modelStatus');
        const tiers = st?.tiers || {};
        const ok = p === 'medium' ? tiers.medium : p === 'high' ? tiers.high : tiers.ultra;
        if (!ok) {
          toaster.create({
            title: '该画质需要高画质模型',
            description: '请重启应用，在首启页下载「桌宠高画质模型」后再使用中/高/极高画质',
            type: 'warning',
            duration: 4000,
          });
          return;
        }
      } catch {
        /* 查询失败则仍尝试下发 */
      }
    }
    thaDriver.sendPreset(p);
  };

  // 收起态：吸左边的小按钮
  if (collapsed) {
    return (
      <Box
        position="absolute"
        left="0"
        top="80px"
        zIndex={20}
        bg="blackAlpha.600"
        color="white"
        borderRightRadius="md"
        p="10px"
        cursor="pointer"
        style={{ pointerEvents: 'auto' }}
        onClick={() => setCollapsed(false)}
        title="VTuber 设置"
      >
        <FiSettings size={20} />
      </Box>
    );
  }

  // 展开态：占满左侧一列
  return (
    <Box
      position="absolute"
      left="0"
      top="0"
      bottom="0"
      zIndex={20}
      width={{ base: '80%', md: '340px' }}
      bg="rgba(20,20,24,0.86)"
      color="white"
      p="16px"
      overflowY="auto"
      style={{ pointerEvents: 'auto', backdropFilter: 'blur(6px)' }}
      display="flex"
      flexDirection="column"
      gap="16px"
    >
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Text fontSize="lg" fontWeight="bold">
          VTuber 设置
        </Text>
        <Box cursor="pointer" onClick={() => setCollapsed(true)} title="收起" p="4px">
          <FiChevronLeft size={20} />
        </Box>
      </Box>

      {/* 立绘上传 */}
      <Box>
        <Text fontSize="sm" color="whiteAlpha.700" mb="8px" fontWeight="semibold">
          立绘
        </Text>
        <Button size="md" width="100%" onClick={handleUpload} loading={busy} mb="8px">
          <FiUpload />
          上传立绘
        </Button>
        <Text fontSize="xs" color="whiteAlpha.600" mb="4px" truncate>
          当前：{currentImageName}
        </Text>
        {uploadProg && (
          <Box mt="6px">
            <Text fontSize="10px" color="whiteAlpha.700" mb="4px" truncate title={uploadProg.message}>
              {uploadProg.message}
            </Text>
            <Box height="6px" bg="whiteAlpha.300" borderRadius="3px" overflow="hidden">
              <Box
                height="100%"
                bg="#e98a6a"
                borderRadius="3px"
                transition="width 0.3s"
                width={uploadProg.percent < 0 ? '100%' : `${uploadProg.percent}%`}
                opacity={uploadProg.percent < 0 ? 0.5 : 1}
              />
            </Box>
          </Box>
        )}
      </Box>

      {/* 抠图模型 */}
      <Box>
        <Text fontSize="sm" color="whiteAlpha.700" mb="8px" fontWeight="semibold">
          抠图模型
        </Text>
        <Box display="flex" gap="8px">
          <Button
            size="sm"
            flex="1"
            variant={cutModel === 'isnet-anime' ? 'solid' : 'outline'}
            onClick={() => setCutModel('isnet-anime')}
          >
            动漫立绘
          </Button>
          <Button
            size="sm"
            flex="1"
            variant={cutModel === 'u2net' ? 'solid' : 'outline'}
            onClick={() => setCutModel('u2net')}
          >
            写实/3D
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500" mt="4px">
          动漫赛璐珞画风选「动漫立绘」；3D 渲染/写实/半写实图选「写实/3D」抠图更干净
        </Text>
      </Box>

      {/* 性能预设 */}
      <Box>
        <Text fontSize="sm" color="whiteAlpha.700" mb="8px" fontWeight="semibold">
          性能预设
        </Text>
        <Box display="flex" gap="8px">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              flex="1"
              variant={perfPreset === p.value ? 'solid' : 'outline'}
              onClick={() => handlePreset(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </Box>
      </Box>

      {/* 摄像头视线跟随（实验性，默认关；仅 Windows + 有摄像头时可用） */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            摄像头视线跟随
          </Text>
          <Button
            size="sm"
            variant={cameraOn ? 'solid' : 'outline'}
            loading={cameraBusy}
            onClick={toggleCamera}
          >
            {cameraOn ? '已开启' : '开启'}
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500">
          开启后桌宠视线会跟随你的头部朝向转动（仅识别朝向，不复制你的表情）。
          摄像头画面仅在本地处理、不上传、不录制；关闭即停止采集。
        </Text>
      </Box>

      {/* 桌面观察（定期采样屏幕形成记忆，实验性，默认关；比摄像头更敏感） */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            桌面观察
          </Text>
          <Button
            size="sm"
            variant={screenOn ? 'solid' : 'outline'}
            loading={screenBusy}
            onClick={toggleScreen}
          >
            {screenOn ? '已开启' : '开启'}
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500">
          开启后桌宠会每隔几分钟观察一次屏幕，记住你在做什么（如"在调代码"），让陪伴更贴近你的当下。
          画面仅在本地处理、不上传、不保存截图；密码/银行等敏感窗口自动跳过；关闭即停止。
        </Text>
      </Box>

      {/* 中枢对话（F-1，实验性，默认关；开启后文字对话结合记忆/画像/关系/情绪） */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            中枢对话（实验）
          </Text>
          <Button size="sm" variant={hubDialogueOn ? 'solid' : 'outline'} onClick={toggleHubDialogue}>
            {hubDialogueOn ? '已开启' : '开启'}
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500">
          开启后文字对话由中枢统筹，结合它对你的记忆、画像、关系与当下情绪来回应，更懂你。
          需先配好主模型；语音对话暂仍走原通道；关闭即回到原对话。
        </Text>
      </Box>

      {/* 情绪共情（实验性，默认关；需先配好主模型） */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            情绪共情
          </Text>
          <Button
            size="sm"
            variant={emotionOn ? 'solid' : 'outline'}
            loading={emotionBusy}
            onClick={toggleEmotion}
          >
            {emotionOn ? '已开启' : '开启'}
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500">
          开启后，桌宠会体察你话里的情绪，用贴合的表情与语气回应（识别情绪不复制表情）。
          需先配置主模型；关闭即停止。
        </Text>
      </Box>

      {/* 面部情绪（MediaPipe，需摄像头，默认关；与文字情绪一起融合） */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            面部情绪
          </Text>
          <Button
            size="sm"
            variant={faceOn ? 'solid' : 'outline'}
            loading={faceBusy}
            onClick={toggleFace}
          >
            {faceOn ? '已开启' : '开启'}
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500">
          开启后通过摄像头体察你的面部情绪，与话语情绪一起让桌宠更懂你的状态。
          仅本地实时识别、不录像不上传不保存画面；只取情绪不复制你的表情；关闭即停止采集。
        </Text>
      </Box>

      {/* 语音情绪（声学特征，需麦克风，默认关；主要体察情绪激动程度） */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            语音情绪
          </Text>
          <Button
            size="sm"
            variant={voiceOn ? 'solid' : 'outline'}
            loading={voiceBusy}
            onClick={toggleVoice}
          >
            {voiceOn ? '已开启' : '开启'}
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500">
          开启后从你说话的声调起伏体察情绪的激动程度，与话语内容一起判断你的状态。
          仅本地实时分析、不录音不上传不保存音频；只取情绪信号；关闭即停止采集。
        </Text>
      </Box>

      {/* 主动搭话（实验性，默认关；需先配好主模型） */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            主动搭话
          </Text>
          <Button
            size="sm"
            variant={proactiveOn ? 'solid' : 'outline'}
            loading={proactiveBusy}
            onClick={toggleProactive}
          >
            {proactiveOn ? '已开启' : '开启'}
          </Button>
        </Box>
        <Text fontSize="10px" color="whiteAlpha.500">
          开启后，桌宠会在你空闲时结合观察到的近况偶尔主动关心一句（有冷却，不频繁打扰）。
          需先配置主模型；关闭即停止。
        </Text>
      </Box>

      {/* 记忆查看/清空：桌宠记住的关于你的观察，透明可控 */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            记忆
          </Text>
          <Box display="flex" gap="6px">
            <Button size="sm" variant="outline" onClick={toggleMemory}>
              {memExpanded ? '收起' : '查看'}
            </Button>
            <Button size="sm" variant="outline" onClick={clearMemory} title="清空全部记忆">
              清空
            </Button>
          </Box>
        </Box>
        {memExpanded && (
          <Box maxHeight="180px" overflowY="auto" bg="blackAlpha.400" borderRadius="8px" p="8px">
            {memLoading ? (
              <Text fontSize="11px" color="whiteAlpha.500">加载中…</Text>
            ) : memItems.length === 0 ? (
              <Text fontSize="11px" color="whiteAlpha.500">暂无记忆（开启桌面观察后逐步积累）</Text>
            ) : (
              memItems.map((m) => (
                <Box key={m.id} mb="6px" pb="6px" borderBottom="1px solid rgba(255,255,255,0.08)">
                  <Text fontSize="11px" color="whiteAlpha.800" truncate title={m.note}>
                    {m.note}
                    {m.count && m.count > 1 ? ` ×${m.count}` : ''}
                  </Text>
                  <Text fontSize="9px" color="whiteAlpha.400">
                    {new Date(m.ts).toLocaleString()}
                    {m.tags?.length ? `  ·  ${m.tags.join('/')}` : ''}
                  </Text>
                </Box>
              ))
            )}
          </Box>
        )}
        <Text fontSize="10px" color="whiteAlpha.500" mt="4px">
          桌宠记住的关于你的观察，仅存文字摘要于本地，可随时清空。
        </Text>
      </Box>

      {/* 关系 + 画像：桌宠和你的关系温度、它记住的你的长期事实 */}
      <Box>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb="6px">
          <Text fontSize="sm" color="whiteAlpha.700" fontWeight="semibold">
            关系
          </Text>
          <Button size="sm" variant="outline" onClick={toggleRelationship}>
            {relExpanded ? '收起' : '查看'}
          </Button>
        </Box>
        {relExpanded && (
          <Box bg="blackAlpha.400" borderRadius="8px" p="8px">
            {rel ? (
              <Text fontSize="11px" color="whiteAlpha.800" mb="6px">
                {`关系：${rel.level}（熟悉度 ${Math.round(rel.familiarity * 100)}%）· 相识 ${Math.floor(rel.daysKnown)} 天 · 互动 ${rel.interactionCount} 次`}
              </Text>
            ) : (
              <Text fontSize="11px" color="whiteAlpha.500" mb="6px">暂无关系数据</Text>
            )}
            {profile.length > 0 && (
              <Box>
                <Text fontSize="10px" color="whiteAlpha.500" mb="3px">桌宠记住的你：</Text>
                {profile.map((f) => (
                  <Text key={f.key} fontSize="11px" color="whiteAlpha.700" truncate>
                    · {f.key}：{f.value}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}
        <Text fontSize="10px" color="whiteAlpha.500" mt="4px">
          关系随互动自然升温；画像由主模型从观察中提炼，均存本地，随记忆一并清空。
        </Text>
      </Box>

      <Text fontSize="xs" color="whiteAlpha.500" mt="auto">
        提示：正面·单人·背景简单的立绘效果最好。真人/复杂图为实验性，效果不保证。
      </Text>
    </Box>
  );
});

ThaSettingsPanel.displayName = 'ThaSettingsPanel';
