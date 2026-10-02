// window.api 的类型直接由 preload 的实现推导，避免手写声明与实现不一致。
// 声明为可选：在纯浏览器里调试 renderer（没有 preload）时 window.api 不存在。
interface Window {
  api?: import('../../preload/index').PreloadApi;
}
