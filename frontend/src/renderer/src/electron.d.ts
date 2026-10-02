import { IpcRenderer } from 'electron';

declare global {
  interface Window {
    // Define the structure of the API exposed by your preload script
    electron?: {
      ipcRenderer: IpcRenderer;
      process: {
        platform: string;
      };
      // Add other methods or properties exposed by preload script if any
    };
    // window.api 的类型见同目录 env.d.ts（由 preload 实现推导）
  }
}

// Export {} is needed to make this a module
export {};
