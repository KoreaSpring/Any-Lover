/**
 * 应用级全局状态（Redux Toolkit）。
 *
 * 定位：这里只放"应用外壳级、跨组件共享、生命周期跟随整个 App"的状态，
 * 作为增量引入 Redux 的骨架与未来 agent / 中台状态的落脚点。
 *
 * 与现有状态方案的边界（见 .kiro/steering）：
 *  - Redux（本 store）：应用级全局状态（连接、运行模式镜像、未来的 agent 会话/工具状态）
 *  - zustand：局部/组件族共享状态（沿用上游既有 store，不迁移）
 *  - React context：跨组件依赖注入（Live2D、摄像头、屏幕采集等，沿用上游）
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type AppMode = 'window' | 'pet';

export interface AppState {
  /** 后端 WebSocket 连接状态（应用级镜像，便于任意组件读取） */
  connection: ConnectionStatus;
  /** 当前窗口运行模式镜像 */
  mode: AppMode;
}

const initialState: AppState = {
  connection: 'disconnected',
  mode: 'window',
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setConnection(state, action: PayloadAction<ConnectionStatus>) {
      state.connection = action.payload;
    },
    setMode(state, action: PayloadAction<AppMode>) {
      state.mode = action.payload;
    },
  },
});

export const { setConnection, setMode } = appSlice.actions;
export default appSlice.reducer;
