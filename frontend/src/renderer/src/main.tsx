import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import 'electron-log/renderer';
import './index.css';
import App from './App';
import { store } from './store';
import { LAppAdapter } from '../WebSDK/src/lappadapter';
import './i18n';

// 统一日志管理：引入 electron-log/renderer 后，渲染进程的日志经 preload 里的
// electron-log/preload 桥接转发给主进程，与主进程日志一起落盘到同一份日志文件
// （%APPDATA%\any-lover\logs\main.log），带时间戳、可长期保留复盘。
// initialize() 是主进程 API：renderer 端的同名方法是空操作，也不在类型声明里，所以这里不调用。

const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('onnxruntime')) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

// Suppress specific console.error messages from @chatscope/chat-ui-kit-react
const originalConsoleError = console.error;
const errorMessagesToIgnore = ["Warning: Failed"];
console.error = (...args: any[]) => {
  if (typeof args[0] === 'string') {
    const shouldIgnore = errorMessagesToIgnore.some(msg => args[0].startsWith(msg));
    if (shouldIgnore) {
      return; // Suppress the warning
    }
  }
  // Call the original console.error for other messages
  originalConsoleError.apply(console, args);
};

if (typeof window !== 'undefined') {
  (window as any).getLAppAdapter = () => LAppAdapter.getInstance();

  // Dynamically load the Live2D Core script
  const loadLive2DCore = () => {
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './libs/live2dcubismcore.js'; // Path to the copied script
      script.onload = () => {
        console.log('Live2D Cubism Core loaded successfully.');
        resolve();
      };
      script.onerror = (error) => {
        console.error('Failed to load Live2D Cubism Core:', error);
        reject(error);
      };
      document.head.appendChild(script);
    });
  };

  // Load the script and then render the app
  loadLive2DCore()
    .then(() => {
      createRoot(document.getElementById('root')!).render(
        <Provider store={store}>
          <App />
        </Provider>,
      );
    })
    .catch((error) => {
      console.error('Application failed to start due to script loading error:', error);
      // Optionally render an error message to the user
      const rootElement = document.getElementById('root');
      if (rootElement) {
        rootElement.innerHTML = 'Error loading required components. Please check the console for details.';
      }
    });
}
