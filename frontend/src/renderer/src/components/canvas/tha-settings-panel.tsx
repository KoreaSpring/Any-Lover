/* eslint-disable @typescript-eslint/ban-ts-comment */
import { memo, useState } from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { FiChevronLeft, FiUpload, FiSettings } from 'react-icons/fi';
import { useThaConfig, ThaPerfPreset } from '@/context/tha-config-context';
import { thaDriver } from '@/utils/tha-driver';
import { toaster } from '@/components/ui/toaster';

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
    const r = (window as any).electron?.ipcRenderer;
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

      <Text fontSize="xs" color="whiteAlpha.500" mt="auto">
        提示：正面·单人·背景简单的立绘效果最好。真人/复杂图为实验性，效果不保证。
      </Text>
    </Box>
  );
});

ThaSettingsPanel.displayName = 'ThaSettingsPanel';
