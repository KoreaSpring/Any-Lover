import React, { createContext, useContext, useMemo, useState } from 'react';

// THA 参数配置（对标 live2d-config-context，第一版）。
// 立绘上传是真功能（经 thaDriver.sendSetImage 生效）；性能预设第一版仅 UI 占位，
// 实际下发需 tha_server 支持重建 core（改精度/缓存/简化），留待后续。
export type ThaPerfPreset = 'low' | 'medium' | 'high' | 'ultra';

interface ThaConfigContextType {
  currentImageName: string;
  setCurrentImageName: (name: string) => void;
  perfPreset: ThaPerfPreset;
  setPerfPreset: (p: ThaPerfPreset) => void;
}

const ThaConfigContext = createContext<ThaConfigContextType | undefined>(undefined);

export const ThaConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentImageName, setCurrentImageName] = useState<string>('lambda_00');
  const [perfPreset, setPerfPresetState] = useState<ThaPerfPreset>(() => {
    try {
      const v = window.localStorage.getItem('anylover_tha_preset');
      if (v === 'low' || v === 'medium' || v === 'high' || v === 'ultra') return v;
    } catch {
      /* ignore */
    }
    return 'low';
  });

  const setPerfPreset = (p: ThaPerfPreset): void => {
    setPerfPresetState(p);
    try {
      window.localStorage.setItem('anylover_tha_preset', p);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo(
    () => ({ currentImageName, setCurrentImageName, perfPreset, setPerfPreset }),
    [currentImageName, perfPreset],
  );

  return <ThaConfigContext.Provider value={value}>{children}</ThaConfigContext.Provider>;
};

export const useThaConfig = (): ThaConfigContextType => {
  const ctx = useContext(ThaConfigContext);
  if (ctx === undefined) {
    throw new Error('useThaConfig must be used within a ThaConfigProvider');
  }
  return ctx;
};
