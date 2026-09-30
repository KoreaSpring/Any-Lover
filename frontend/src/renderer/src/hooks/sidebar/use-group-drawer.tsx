import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocket } from '@/context/websocket-context';
import { WS_OUT } from '@proto/ws-backend';
import { toaster } from '@/components/ui/toaster';

export const useGroupDrawer = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [inviteUid, setInviteUid] = useState('');
  const { sendMessage } = useWebSocket();

  // Request latest group information to update the display
  const requestGroupInfo = useCallback(() => {
    sendMessage({
      type: WS_OUT.requestGroupInfo,
    });
  }, [sendMessage]);

  const handleInvite = useCallback(async () => {
    if (!inviteUid.trim()) {
      toaster.create({
        title: t('error.enterValidUuid'),
        type: 'error',
        duration: 2000,
      });
      return;
    }

    sendMessage({
      type: WS_OUT.addClientToGroup,
      invitee_uid: inviteUid.trim(),
    });
    setInviteUid('');

    // Add a small delay to ensure server has processed the operation
    setTimeout(requestGroupInfo, 100);
  }, [inviteUid, sendMessage, requestGroupInfo, t]);

  const handleRemove = useCallback((targetUid: string) => {
    sendMessage({
      type: WS_OUT.removeClientFromGroup,
      target_uid: targetUid,
    });

    // Add a small delay to ensure server has processed the operation
    setTimeout(requestGroupInfo, 100);
  }, [sendMessage, requestGroupInfo]);

  const handleLeaveGroup = useCallback((selfUid: string) => {
    sendMessage({
      type: WS_OUT.removeClientFromGroup,
      target_uid: selfUid,
    });

    // Add a small delay to ensure server has processed the operation
    setTimeout(requestGroupInfo, 100);
  }, [sendMessage, requestGroupInfo]);

  return {
    isOpen,
    setIsOpen,
    inviteUid,
    setInviteUid,
    handleInvite,
    handleRemove,
    handleLeaveGroup,
    requestGroupInfo,
  };
};
