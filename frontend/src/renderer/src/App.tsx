/* eslint-disable no-shadow */
// import { StrictMode } from 'react';
import { Box, Flex, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useState, useEffect, useRef } from "react";
// import Canvas from './components/canvas/canvas'; // Likely unused now
import Sidebar from "./components/sidebar/sidebar";
import Footer from "./components/footer/footer";
import { AiStateProvider } from "./context/ai-state-context";
import { Live2DConfigProvider } from "./context/live2d-config-context";
import { SubtitleProvider } from "./context/subtitle-context";
import { BgUrlProvider } from "./context/bgurl-context";
import { layoutStyles } from "./layout";
import WebSocketHandler from "./services/websocket-handler";
import { CameraProvider } from "./context/camera-context";
import { ChatHistoryProvider } from "./context/chat-history-context";
import { CharacterConfigProvider } from "./context/character-config-context";
import { Toaster } from "./components/ui/toaster";
import { VADProvider } from "./context/vad-context";
import { Live2D } from "./components/canvas/live2d";
import TitleBar from "./components/electron/title-bar";
import { InputSubtitle } from "./components/electron/input-subtitle";
import { ProactiveSpeakProvider } from "./context/proactive-speak-context";
import { ScreenCaptureProvider } from "./context/screen-capture-context";
import { GroupProvider } from "./context/group-context";
import { BrowserProvider } from "./context/browser-context";
// eslint-disable-next-line import/no-extraneous-dependencies, import/newline-after-import
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Background from "./components/canvas/background";
import WebSocketStatus from "./components/canvas/ws-status";
import Subtitle from "./components/canvas/subtitle";
import { ModeProvider, useMode } from "./context/mode-context";
import OllamaOnboarding from "./components/onboarding/ollama-onboarding";
import ModelDownloadIndicator from "./components/onboarding/model-download-indicator";
import ModeSwitcher from "./components/shell/mode-switcher";
import BrowserBar from "./components/shell/browser-bar";
import WindowControls from "./components/shell/window-controls";

function AppContent(): JSX.Element {
  const [showSidebar, setShowSidebar] = useState(true);
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(false);
  const { mode } = useMode();
  const isElectron = window.api !== undefined;
  const live2dContainerRef = useRef<HTMLDivElement>(null);

  // 三模式外壳状态（browser / workbench / home）。仅 home 时显示 window mode 的
  // 完整界面（Live2D + 侧栏 + 对话）；browser / workbench 时让位给原生 WebContentsView，
  // 隐藏 renderer 自身的 window UI，避免顶部叠加混乱。
  const [shellMode, setShellMode] = useState<string>("home");
  useEffect(() => {
    const a = (window as any).api;
    if (!a) return undefined;
    try {
      const m = a.getMode?.();
      if (m) setShellMode(m);
    } catch {
      /* ignore */
    }
    const off = a.onModeChanged?.((m: string) => setShellMode(m));
    return typeof off === "function" ? off : undefined;
  }, []);
  // home 模式才渲染 window mode 界面（叠加原有 window/pet 判断）。
  const showHomeUI = shellMode === "home";

  useEffect(() => {
    const handleResize = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

    
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.height = '100%';
  document.body.style.height = '100%';
  document.documentElement.style.position = 'fixed';
  document.body.style.position = 'fixed';
  document.documentElement.style.width = '100%';
  document.body.style.width = '100%';

  // Define base style properties shared across modes/breakpoints
  const live2dBaseStyle = {
    position: "absolute" as const,
    overflow: "hidden",
    transition: "all 0.3s ease-in-out", // Optional transition
    pointerEvents: "auto" as const,
  };

  // Define styles specifically for the "window" mode, using responsive syntax
  const getResponsiveLive2DWindowStyle = (sidebarVisible: boolean) => ({
    ...live2dBaseStyle,
    top: isElectron ? "30px" : "0px",
    height: `calc(100% - ${isElectron ? "30px" : "0px"})`,
    zIndex: 5, // Ensure it's layered correctly below UI but above background
    left: {
      base: "0px", // Column layout (base): Start from left edge
      md: sidebarVisible ? "440px" : "24px", // Row layout (md+): Offset by sidebar width
    },
    width: {
      base: "100%", // Column layout (base): Full width
      md: `calc(100% - ${sidebarVisible ? "440px" : "24px"})`, // Row layout (md+): Adjust width based on sidebar
    },
  });

  // Define styles specifically for the "pet" mode
  const live2dPetStyle = {
    ...live2dBaseStyle,
    top: 0, // Override position for pet mode
    left: 0,
    width: "100vw", // Full viewport
    height: "100vh",
    zIndex: 15, // Higher zIndex for pet mode overlay
  };

  return (
    <>
      {/* browser / workbench 模式：隐藏整个 renderer 界面（Live2D + window UI），
          让位给原生 WebContentsView；只保留下方的 fixed 浮层（切换器/窗口控制等）。 */}
      {showHomeUI && (
        <Box
          ref={live2dContainerRef}
          // Apply styles conditionally based on mode
          // Use the function to get dynamic responsive styles for window mode
          {...(mode === "window"
            ? getResponsiveLive2DWindowStyle(showSidebar)
            : live2dPetStyle)}
        >
          <Live2D />
        </Box>
      )}

      {/* Conditional Rendering of Window UI */}
      {showHomeUI && mode === "window" && (
        <>
          {isElectron && <TitleBar />}
          {/* Apply styles by spreading */}
          <Flex {...layoutStyles.appContainer}>
            <Box
              {...layoutStyles.sidebar}
              {...(!showSidebar && { width: "24px" })}
            >
              <Sidebar
                isCollapsed={!showSidebar}
                onToggle={() => setShowSidebar(!showSidebar)}
              />
            </Box>
            <Box {...layoutStyles.mainContent}>
              <Background />
              <Box position="absolute" top="20px" left="20px" zIndex={10}>
                <WebSocketStatus />
              </Box>
              <Box
                position="absolute"
                bottom={isFooterCollapsed ? "39px" : "135px"}
                left="50%"
                transform="translateX(-50%)"
                zIndex={10}
                width="60%"
              >
                <Subtitle />
              </Box>
              <Box
                {...layoutStyles.footer}
                zIndex={10}
                {...(isFooterCollapsed && layoutStyles.collapsedFooter)}
              >
                <Footer
                  isCollapsed={isFooterCollapsed}
                  onToggle={() => setIsFooterCollapsed(!isFooterCollapsed)}
                />
              </Box>
            </Box>
          </Flex>
        </>
      )}

      {/* Conditional Rendering of Pet Mode UI */}
      {showHomeUI && mode === "pet" && <InputSubtitle />}

      {/* 首启「设置选项」覆盖层：仅在需要引导时显示，下载并启动后淡出 */}
      <OllamaOnboarding />

      {/* 常驻角落下载进度：覆盖层淡出后，模型仍在后台下载时显示于右上角 */}
      <ModelDownloadIndicator />

      {/* 浏览器模式顶栏（Edge 风 + 珊瑚橙）：仅 browser 模式显示 */}
      <BrowserBar />

      {/* 浏览器 / 工作台模式的窗口控制按钮（最小化 / 最大化 / 关闭） */}
      <WindowControls />

      {/* 顶部左侧三模式切换（浏览器 / 工作台 / 桌宠）。
          pet 透明穿透模式下整个窗口壳需消失（仅剩桌宠），故此时不渲染切换栏。 */}
      {mode !== "pet" && <ModeSwitcher />}
    </>
  );
}

function App(): JSX.Element {
  return (
    <ChakraProvider value={defaultSystem}>
      {/* ModeProvider needs to wrap AppContent to provide mode to getGlobalStyles */}
      <ModeProvider>
        <AppWithGlobalStyles />
      </ModeProvider>
    </ChakraProvider>
  );
}

// New component to access mode for global styles
function AppWithGlobalStyles(): JSX.Element {
  return (
    <>
      <CameraProvider>
        <ScreenCaptureProvider>
          <CharacterConfigProvider>
            <ChatHistoryProvider>
              <AiStateProvider>
                <ProactiveSpeakProvider>
                  <Live2DConfigProvider>
                    <SubtitleProvider>
                      <VADProvider>
                        <BgUrlProvider>
                          <GroupProvider>
                            <BrowserProvider>
                              <WebSocketHandler>
                                <Toaster />
                                <AppContent />
                              </WebSocketHandler>
                            </BrowserProvider>
                          </GroupProvider>
                        </BgUrlProvider>
                      </VADProvider>
                    </SubtitleProvider>
                  </Live2DConfigProvider>
                </ProactiveSpeakProvider>
              </AiStateProvider>
            </ChatHistoryProvider>
          </CharacterConfigProvider>
        </ScreenCaptureProvider>
      </CameraProvider>
    </>
  );
}

export default App;
