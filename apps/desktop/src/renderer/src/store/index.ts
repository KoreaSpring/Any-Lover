/**
 * Redux store（增量引入，与现有 zustand / context 共存）。
 *
 * 用法：
 *   import { useAppDispatch, useAppSelector } from '@/store';
 *   import { setConnection } from '@/store/appSlice';
 *   const mode = useAppSelector((s) => s.app.mode);
 *   const dispatch = useAppDispatch();
 *
 * 扩展：未来 agent / 中台状态在此注册新的 slice reducer。
 */
import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import appReducer from './appSlice';

export const store = configureStore({
  reducer: {
    app: appReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// 项目内统一使用带类型的 hooks，避免在每个组件重复标注类型
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
