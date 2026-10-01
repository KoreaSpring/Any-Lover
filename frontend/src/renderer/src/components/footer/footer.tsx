/* eslint-disable react/require-default-props */
import {
  Box, Textarea, IconButton, HStack,
} from '@chakra-ui/react';
import { BsMicFill, BsMicMuteFill, BsPaperclip } from 'react-icons/bs';
import { IoHandRightSharp } from 'react-icons/io5';
import { FiChevronDown } from 'react-icons/fi';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { InputGroup } from '@/components/ui/input-group';
import { footerStyles } from './footer-styles';
import AIStateIndicator from './ai-state-indicator';
import { useFooter } from '@/hooks/footer/use-footer';
import { useOllamaReady } from '@/hooks/canvas/use-ollama-ready';
import { notifyModelNotReady } from '@/utils/model-gate';

// Type definitions
interface FooterProps {
  isCollapsed?: boolean
  onToggle?: () => void
}

interface ToggleButtonProps {
  isCollapsed: boolean
  onToggle?: () => void
}

interface ActionButtonsProps {
  micOn: boolean
  onMicToggle: () => void
  onInterrupt: () => void
  /** 模型未下完：按钮显示为禁用，点击只弹提示 */
  locked: boolean
}

interface MessageInputProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  locked: boolean
  lockedPlaceholder: string
}

// 禁用态样式。不用原生 disabled：disabled 元素收不到点击，就没法弹「模型下载中」提示。
const lockedStyle = { opacity: 0.4, cursor: 'not-allowed', filter: 'grayscale(0.6)' } as const;

// Reusable components
const ToggleButton = memo(({ isCollapsed, onToggle }: ToggleButtonProps) => (
  <Box
    {...footerStyles.footer.toggleButton}
    onClick={onToggle}
    color="whiteAlpha.500"
    style={{
      transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
    }}
  >
    <FiChevronDown />
  </Box>
));

ToggleButton.displayName = 'ToggleButton';

const ActionButtons = memo(({
  micOn, onMicToggle, onInterrupt, locked,
}: ActionButtonsProps) => (
  <HStack gap={2}>
    <IconButton
      aria-label="Toggle microphone"
      aria-disabled={locked}
      title={locked ? '模型下载完成后可用' : undefined}
      bg={micOn ? 'green.500' : 'red.500'}
      {...footerStyles.footer.actionButton}
      {...(locked ? lockedStyle : {})}
      onClick={locked ? notifyModelNotReady : onMicToggle}
    >
      {micOn ? <BsMicFill /> : <BsMicMuteFill />}
    </IconButton>
    <IconButton
      aria-label="Raise hand"
      aria-disabled={locked}
      title={locked ? '模型下载完成后可用' : undefined}
      bg="yellow.500"
      {...footerStyles.footer.actionButton}
      {...(locked ? lockedStyle : {})}
      onClick={locked ? notifyModelNotReady : onInterrupt}
    >
      <IoHandRightSharp size="24" />
    </IconButton>
  </HStack>
));

ActionButtons.displayName = 'ActionButtons';

const MessageInput = memo(({
  value,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  locked,
  lockedPlaceholder,
}: MessageInputProps) => {
  const { t } = useTranslation();

  return (
    <InputGroup flex={1}>
      <Box position="relative" width="100%">
        <IconButton
          aria-label="Attach file"
          variant="ghost"
          {...footerStyles.footer.attachButton}
          {...(locked ? lockedStyle : {})}
          onClick={locked ? notifyModelNotReady : undefined}
        >
          <BsPaperclip size="24" />
        </IconButton>
        <Textarea
          value={value}
          // 只读而非 disabled：仍能收到点击/按键，从而弹出提示
          readOnly={locked}
          aria-disabled={locked}
          onChange={onChange}
          onMouseDown={locked ? notifyModelNotReady : undefined}
          onKeyDown={locked ? (e) => { e.preventDefault(); notifyModelNotReady(); } : onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={locked ? lockedPlaceholder : t('footer.typeYourMessage')}
          {...footerStyles.footer.input}
          {...(locked ? { cursor: 'not-allowed', opacity: 0.6 } : {})}
        />
      </Box>
    </InputGroup>
  );
});

MessageInput.displayName = 'MessageInput';

// Main component
function Footer({ isCollapsed = false, onToggle }: FooterProps): JSX.Element {
  const {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleMicToggle,
    micOn,
  } = useFooter();
  // 本地主模型没下完时锁住语音/打断/输入，下完自动解锁（云端 API 不受影响）
  const { ready, percent } = useOllamaReady();
  const locked = !ready;
  const lockedPlaceholder = percent >= 0 ? `模型下载中（${percent}%），完成后可输入…` : '模型下载中，完成后可输入…';

  return (
    <Box {...footerStyles.footer.container(isCollapsed)}>
      <ToggleButton isCollapsed={isCollapsed} onToggle={onToggle} />

      <Box pt="0" px="4">
        <HStack width="100%" gap={4}>
          <Box>
            <Box mb="1.5">
              <AIStateIndicator />
            </Box>
            <ActionButtons
              micOn={micOn}
              onMicToggle={handleMicToggle}
              onInterrupt={handleInterrupt}
              locked={locked}
            />
          </Box>

          <MessageInput
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            locked={locked}
            lockedPlaceholder={lockedPlaceholder}
          />
        </HStack>
      </Box>
    </Box>
  );
}

export default Footer;
