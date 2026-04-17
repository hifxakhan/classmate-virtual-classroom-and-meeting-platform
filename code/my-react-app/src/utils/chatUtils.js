import { formatPKTDate, formatPKTTime } from './dateUtils';

export const formatChatTime = (isoString) => {
    if (!isoString) return '';

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const sameDay =
        date.getUTCFullYear() === now.getUTCFullYear() &&
        date.getUTCMonth() === now.getUTCMonth() &&
        date.getUTCDate() === now.getUTCDate();

    if (sameDay) {
        return formatPKTTime(isoString);
    }

    return formatPKTDate(isoString);
};

export const getConversationName = (conversation) => {
    if (!conversation) return 'Unknown user';

    const directName = conversation.name || conversation.other_user?.name;
    if (directName) return directName;

    const role = conversation.user_type || conversation.other_user?.type || 'user';
    return role.charAt(0).toUpperCase() + role.slice(1);
};

export const getConversationAvatar = (conversation) => {
    const name = getConversationName(conversation);
    return name.charAt(0).toUpperCase();
};
