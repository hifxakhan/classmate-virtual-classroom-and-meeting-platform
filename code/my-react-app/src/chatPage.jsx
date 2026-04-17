import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import './chat.css';
import classMateLogo from './assets/Logo2.png';
import { formatPKTDate, formatPKTTime, getPKTDateKey } from './utils/dateUtils';
import { formatChatTime, getConversationAvatar, getConversationName } from './utils/chatUtils';
import PrivateCall from './PrivateCall.jsx';

const API_BASE = 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app';
const MESSAGE_POLL_MS = 3000;
const UNREAD_POLL_MS = 10000;
const PAGE_SIZE = 20;
const EMOJIS = [':)', ':D', '<3', ':P', ';)', ':O'];

const getCurrentUser = () => {
    const teacherId = localStorage.getItem('teacherId');
    const studentId = localStorage.getItem('studentId');

    if (teacherId) {
        return {
            id: String(teacherId),
            type: 'teacher',
            name: localStorage.getItem('teacherName') || 'Teacher'
        };
    }

    if (studentId) {
        return {
            id: String(studentId),
            type: 'student',
            name: localStorage.getItem('studentName') || 'Student'
        };
    }

    return null;
};

const normalizeConversation = (item) => {
    if (item.other_user) {
        return {
            ...item,
            conversation_id: item.conversation_id || `${item.other_user.id}`,
            other_user_name: item.other_user.name
        };
    }

    return {
        conversation_id: item.conversation_id || `${item.other_user_id}`,
        other_user: {
            id: String(item.other_user_id),
            type: item.other_user_type || 'user',
            name: item.other_user_name || 'Unknown user',
            avatar: (item.other_user_name || 'U').charAt(0).toUpperCase()
        },
        other_user_name: item.other_user_name || 'Unknown user',
        last_message: {
            text: item.last_message || '',
            timestamp: item.last_message_time || null,
            sender_id: item.last_message_sender_id || null
        },
        unread_count: item.unread_count || 0,
        total_messages: item.total_messages || 0
    };
};

const normalizeMessage = (message, currentUserId) => {
    const senderId = String(message.sender_id || message.sender?.id || '');
    const text = message.message || message.text || '';
    const timestamp = message.timestamp || message.created_at || null;

    return {
        id: String(message.id),
        sender_id: senderId,
        receiver_id: String(message.receiver_id || message.receiver?.id || ''),
        text,
        timestamp,
        status: message.status || 'sent',
        is_read: Boolean(message.is_read),
        read_at: message.read_at || null,
        is_from_me: senderId === String(currentUserId)
    };
};

const getMessageDayLabel = (timestamp) => {
    if (!timestamp) return '';

    const todayKey = getPKTDateKey(new Date().toISOString());
    const messageKey = getPKTDateKey(timestamp);
    if (!messageKey) return '';

    if (messageKey === todayKey) {
        return 'Today';
    }

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = getPKTDateKey(yesterday.toISOString());
    if (messageKey === yesterdayKey) {
        return 'Yesterday';
    }

    return formatPKTDate(timestamp);
};

const getMessageReceiptState = (message, currentUserId) => {
    const isFromMe = String(message.sender_id) === String(currentUserId);
    if (!isFromMe) return null;

    if (message.is_optimistic || message.status === 'pending') {
        return null;
    }

    if (message.is_read || message.status === 'read' || message.read_at) {
        return 'read';
    }

    return 'delivered';
};

const isLiveCallState = (call) => {
    const status = String(call?.status || '').trim().toLowerCase();
    if (!status) return true;
    return ['pending', 'ringing', 'accepted', 'active', 'ongoing', 'connecting'].includes(status);
};

const ReceiptIcon = ({ state }) => {
    if (!state) return null;

    return (
        <span className={`message-receipt-icon ${state}`} aria-hidden="true">
            {state === 'read' ? '✓✓' : '✓'}
        </span>
    );
};

const getConversationKey = (conversation) => {
    if (!conversation?.other_user?.id) return '';
    return `${conversation.other_user.type || 'user'}:${conversation.other_user.id}`;
};

const buildSocketRoomKey = (userAId, userAType, userBId, userBType) => {
    const left = `${String(userAType || 'user')}:${String(userAId || '')}`;
    const right = `${String(userBType || 'user')}:${String(userBId || '')}`;
    return [left, right].sort().join('|');
};

const resolveUserType = (candidate) => {
    const direct = String(candidate?.user_type || candidate?.type || '').toLowerCase();
    if (direct === 'teacher' || direct === 'student' || direct === 'admin') return direct;

    const role = String(candidate?.role || '').toLowerCase();
    if (role.includes('teacher')) return 'teacher';
    if (role.includes('student')) return 'student';
    if (role.includes('admin')) return 'admin';

    const id = String(candidate?.id || candidate?.user_id || '');
    if (id.startsWith('TCH')) return 'teacher';
    if (id.startsWith('STU')) return 'student';
    if (id.startsWith('ADM')) return 'admin';

    return 'user';
};

const MessageList = React.memo(function MessageList({ messages, currentUserId }) {
    const renderedItems = [];
    let previousDayKey = null;

    messages.forEach((message) => {
        const dayKey = getPKTDateKey(message.timestamp);
        const dayLabel = getMessageDayLabel(message.timestamp);

        if (dayKey && dayKey !== previousDayKey) {
            renderedItems.push(
                <div className="message-date-separator" key={`day-${dayKey}`}>
                    <span>{dayLabel}</span>
                </div>
            );
            previousDayKey = dayKey;
        }

        const receiptState = getMessageReceiptState(message, currentUserId);

        renderedItems.push(
            <div
                key={message.id}
                className={`message-bubble ${String(message.sender_id) === String(currentUserId) ? 'sent' : 'received'} ${receiptState === 'read' ? 'read' : ''}`}
            >
                <div className="message-content">
                    <p>{message.text}</p>
                    <div className="message-meta">
                        <span className="message-time">{message.timestamp ? formatPKTTime(message.timestamp) : 'Now'}</span>
                        <ReceiptIcon state={receiptState} />
                    </div>
                </div>
            </div>
        );
    });

    return <div className="messages-container">{renderedItems}</div>;
});

const ConversationItem = React.memo(function ConversationItem({ conversation, isSelected, isMenuOpen, onSelect, onToggleMenu, onDelete, onMarkUnread }) {
    return (
        <div
            className={`chat-list-item ${isSelected ? 'active' : ''}`}
            onClick={() => onSelect(conversation)}
        >
            <div className="chat-item-avatar">
                <div className="avatar-initials">{getConversationAvatar(conversation)}</div>
            </div>
            <div className="chat-item-info">
                <div className="chat-item-header">
                    <h4 className="chat-item-name">{getConversationName(conversation)}</h4>
                    <span className="chat-item-time">{formatChatTime(conversation.last_message?.timestamp)}</span>
                </div>
                <p className="chat-item-preview">{conversation.last_message?.text || 'No messages yet'}</p>
                <div className="chat-item-footer">
                    <span className="chat-item-role">{conversation.other_user?.type || 'user'}</span>
                    <div className="chat-item-actions" onClick={(event) => event.stopPropagation()}>
                        {conversation.unread_count > 0 && <span className="unread-badge">{conversation.unread_count}</span>}
                        <button
                            className="chat-kebab-btn"
                            type="button"
                            onClick={() => onToggleMenu(conversation)}
                            title="Conversation options"
                        >
                            ⋮
                        </button>
                        {isMenuOpen && (
                            <div className="chat-context-menu">
                                <button type="button" onClick={() => onMarkUnread(conversation)}>Mark unread</button>
                                <button type="button" className="danger" onClick={() => onDelete(conversation)}>Delete chat</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

const ConversationList = React.memo(function ConversationList({ conversations, selectedId, openMenuId, onSelectConversation, onToggleMenu, onDeleteConversation, onMarkUnreadConversation }) {
    return (
        <>
            {conversations.map((conversation) => (
                <ConversationItem
                    key={conversation.conversation_id || conversation.other_user?.id}
                    conversation={conversation}
                    isSelected={selectedId === (conversation.conversation_id || conversation.other_user?.id)}
                    isMenuOpen={openMenuId === (conversation.conversation_id || conversation.other_user?.id)}
                    onSelect={onSelectConversation}
                    onToggleMenu={onToggleMenu}
                    onDelete={onDeleteConversation}
                    onMarkUnread={onMarkUnreadConversation}
                />
            ))}
        </>
    );
});

function ChatPage() {
    const navigate = useNavigate();
    const [currentUser, setCurrentUser] = useState(getCurrentUser);
    const [searchQuery, setSearchQuery] = useState('');
    const [conversations, setConversations] = useState([]);
    const [directoryResults, setDirectoryResults] = useState([]);
    const [activeConversation, setActiveConversation] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messageInput, setMessageInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [loadingConversations, setLoadingConversations] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [isLoadingInitial, setIsLoadingInitial] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [unreadTotal, setUnreadTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [incomingCall, setIncomingCall] = useState(null);
    const [activeCall, setActiveCall] = useState(null);
    const [callMode, setCallMode] = useState('video');

    const typingTimeoutRef = useRef(null);
    const socketRef = useRef(null);
    const messagesRef = useRef(null);
    const inputRef = useRef(null);
    const searchQueryRef = useRef('');
    const backgroundSyncTimerRef = useRef(null);
    const incomingRingTimerRef = useRef(null);
    const incomingRingCountRef = useRef(0);
    const incomingRingAudioCtxRef = useRef(null);

    const activeConversationRef = useRef(null);
    const messagesRefState = useRef([]);

    useEffect(() => {
        activeConversationRef.current = activeConversation;
    }, [activeConversation]);

    useEffect(() => {
        messagesRefState.current = messages;
    }, [messages]);

    useEffect(() => {
        searchQueryRef.current = searchQuery;
    }, [searchQuery]);

    const stopIncomingRingtone = useCallback(() => {
        if (incomingRingTimerRef.current) {
            clearInterval(incomingRingTimerRef.current);
            incomingRingTimerRef.current = null;
        }
        incomingRingCountRef.current = 0;
        if (incomingRingAudioCtxRef.current) {
            try {
                incomingRingAudioCtxRef.current.close();
            } catch (error) {
                console.warn('Ringtone audio cleanup warning:', error);
            }
            incomingRingAudioCtxRef.current = null;
        }
    }, []);

    const playIncomingRingTone = useCallback(async () => {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;

            if (!incomingRingAudioCtxRef.current) {
                incomingRingAudioCtxRef.current = new AudioContextClass();
            }

            const ctx = incomingRingAudioCtxRef.current;
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = 440;
            gain.gain.value = 0.0001;
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.start();

            const now = ctx.currentTime;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
            gain.gain.linearRampToValueAtTime(0.0001, now + 0.55);
            oscillator.stop(now + 0.6);
        } catch (error) {
            console.warn('Incoming ringtone playback failed:', error);
        }
    }, []);

    const filteredConversations = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return conversations;
        return conversations.filter((item) => {
            const name = getConversationName(item).toLowerCase();
            const preview = (item.last_message?.text || '').toLowerCase();
            return name.includes(query) || preview.includes(query);
        });
    }, [searchQuery, conversations]);

    const isAtBottom = () => {
        const container = messagesRef.current;
        if (!container) return true;
        const threshold = 60;
        return container.scrollHeight - container.scrollTop <= container.clientHeight + threshold;
    };

    const scrollToBottom = (behavior = 'auto') => {
        const container = messagesRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
    };

    const areConversationsEqual = (prev, next) => {
        if (prev.length !== next.length) return false;

        for (let i = 0; i < prev.length; i += 1) {
            const a = prev[i];
            const b = next[i];
            const idA = a.conversation_id || a.other_user?.id;
            const idB = b.conversation_id || b.other_user?.id;
            if (String(idA) !== String(idB)) return false;
            if ((a.last_message?.timestamp || '') !== (b.last_message?.timestamp || '')) return false;
            if ((a.last_message?.text || '') !== (b.last_message?.text || '')) return false;
            if ((a.unread_count || 0) !== (b.unread_count || 0)) return false;
        }

        return true;
    };

    const fetchConversations = async (q = '', { silent = false } = {}) => {
        if (!currentUser) return;

        try {
            if (!silent) {
                setLoadingConversations(true);
            }
            const params = new URLSearchParams({
                user_id: currentUser.id,
                user_type: currentUser.type,
                q
            });
            const response = await fetch(`${API_BASE}/api/chat/conversations?${params}`);

            if (response.status === 404) {
                console.warn('Chat backend endpoint /api/chat/conversations is not available yet');
                setConversations([]);
                setUnreadTotal(0);
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const raw = await response.text();
                console.warn('Expected JSON but received non-JSON response:', raw.slice(0, 120));
                setConversations([]);
                setUnreadTotal(0);
                return;
            }

            const data = await response.json();
            if (!data.success) {
                setConversations([]);
                setUnreadTotal(0);
                return;
            }

            const normalized = (data.conversations || []).map(normalizeConversation);
            setConversations((prev) => (areConversationsEqual(prev, normalized) ? prev : normalized));
            setUnreadTotal(
                typeof data.total_unread === 'number'
                    ? data.total_unread
                    : normalized.reduce((sum, c) => sum + (c.unread_count || 0), 0)
            );

            if (!activeConversationRef.current && normalized.length) {
                setActiveConversation(normalized[0]);
            } else if (activeConversationRef.current) {
                const activeId = activeConversationRef.current.conversation_id || activeConversationRef.current.other_user?.id;
                const matched = normalized.find((c) => String(c.conversation_id || c.other_user?.id) === String(activeId));
                if (matched) {
                    setActiveConversation((prev) => {
                        const prevId = prev?.conversation_id || prev?.other_user?.id;
                        if (String(prevId) === String(activeId)) {
                            return prev;
                        }
                        return matched;
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load conversations:', error);
            setConversations([]);
            setUnreadTotal(0);
        } finally {
            if (!silent) {
                setLoadingConversations(false);
            }
        }
    };

    const scheduleBackgroundConversationsSync = (delayMs = 1200) => {
        if (backgroundSyncTimerRef.current) {
            clearTimeout(backgroundSyncTimerRef.current);
        }

        backgroundSyncTimerRef.current = setTimeout(() => {
            fetchConversations(searchQueryRef.current.trim(), { silent: true });
        }, Math.min(1800, Math.max(300, delayMs)));
    };

    const fetchDirectoryResults = async (q) => {
        if (!currentUser || !q || q.length < 2) {
            setDirectoryResults([]);
            return;
        }

        try {
            const params = new URLSearchParams({
                q,
                current_user_id: currentUser.id,
                current_user_type: currentUser.type
            });
            const response = await fetch(`${API_BASE}/api/chat/search?${params}`);
            const data = await response.json();
            if (!data.success) return;
            setDirectoryResults(data.results || []);
        } catch (error) {
            console.error('Failed to fetch search directory', error);
        }
    };

    const markConversationRead = async (conversation) => {
        if (!currentUser || !conversation) return;

        try {
            const socket = socketRef.current;
            if (socket?.connected) {
                socket.emit('mark_read', {
                    user_id: currentUser.id,
                    user_type: currentUser.type,
                    other_user_id: conversation.other_user.id,
                    other_user_type: conversation.other_user.type
                });
                return;
            }

            await fetch(`${API_BASE}/api/chat/inbox/mark-read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type,
                    other_user_id: conversation.other_user.id,
                    other_user_type: conversation.other_user.type
                })
            });
        } catch (error) {
            console.error('Failed to mark conversation read', error);
        }
    };

    const markConversationUnread = async (conversation) => {
        if (!currentUser || !conversation) return;

        try {
            const response = await fetch(`${API_BASE}/api/chat/inbox/mark-unread`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type,
                    other_user_id: conversation.other_user.id,
                    other_user_type: conversation.other_user.type
                })
            });
            const data = await response.json();
            if (!data.success) return;

            setConversations((prev) => prev.map((item) => {
                const itemId = item.conversation_id || item.other_user?.id;
                const conversationId = conversation.conversation_id || conversation.other_user?.id;
                if (String(itemId) !== String(conversationId)) return item;
                return {
                    ...item,
                    unread_count: data.unread_count ?? Math.max(item.unread_count || 0, 1)
                };
            }));

            setUnreadTotal((prev) => Math.max(prev + 1, data.total_unread ?? prev + 1));
        } catch (error) {
            console.error('Failed to mark conversation unread', error);
        }
    };

    const upsertConversationFromMessage = (message) => {
        if (!currentUser || !message) return;

        const senderId = String(message.sender_id || '');
        const receiverId = String(message.receiver_id || '');
        const otherUserId = senderId === String(currentUser.id) ? receiverId : senderId;
        if (!otherUserId) return;

        const otherUserType = senderId === String(currentUser.id)
            ? String(message.receiver_type || 'user')
            : String(message.sender_type || 'user');

        const otherUserName = senderId === String(currentUser.id)
            ? String(message.receiver_name || message.other_user_name || 'Unknown user')
            : String(message.sender_name || message.other_user_name || 'Unknown user');

        setConversations((prev) => {
            const next = [...prev];
            const index = next.findIndex((item) => String(item.other_user?.id) === otherUserId);

            const conversationPatch = {
                conversation_id: next[index]?.conversation_id || buildSocketRoomKey(currentUser.id, currentUser.type, otherUserId, otherUserType),
                other_user: {
                    id: otherUserId,
                    type: otherUserType,
                    name: otherUserName,
                    avatar: otherUserName.charAt(0).toUpperCase()
                },
                other_user_name: otherUserName,
                last_message: {
                    id: message.id,
                    text: message.message || message.text || '',
                    timestamp: message.timestamp || message.created_at || new Date().toISOString(),
                    sender_id: senderId,
                    sender_type: message.sender_type || currentUser.type,
                    is_from_me: senderId === String(currentUser.id)
                },
                unread_count: senderId === String(currentUser.id)
                    ? (next[index]?.unread_count || 0)
                    : (next[index]?.unread_count || 0) + 1,
                total_messages: (next[index]?.total_messages || 0) + 1
            };

            if (index >= 0) {
                next[index] = { ...next[index], ...conversationPatch };
            } else {
                next.unshift(conversationPatch);
            }

            return next.sort((a, b) => {
                const timeA = new Date(a.last_message?.timestamp || 0).getTime();
                const timeB = new Date(b.last_message?.timestamp || 0).getTime();
                return timeB - timeA;
            });
        });

        if (String(currentUser.id) !== senderId && activeConversationRef.current && String(activeConversationRef.current.other_user?.id) !== otherUserId) {
            setUnreadTotal((prev) => prev + 1);
        }
    };

    const handleIncomingSocketMessage = (payload) => {
        const message = payload?.message || payload;
        if (!message) return;

        const senderId = String(message.sender_id || '');
        const receiverId = String(message.receiver_id || '');
        const currentUserId = String(currentUser?.id || '');
        const isForCurrentUser = senderId === currentUserId || receiverId === currentUserId;
        if (!isForCurrentUser) return;

        const activeOtherId = String(activeConversationRef.current?.other_user?.id || '');
        const matchesActiveThread = Boolean(activeOtherId) && (
            (senderId === currentUserId && receiverId === activeOtherId) ||
            (senderId === activeOtherId && receiverId === currentUserId)
        );

        const normalized = normalizeMessage(message, currentUserId);
        if (normalized.is_from_me && !normalized.is_read) {
            normalized.status = 'delivered';
            normalized.is_optimistic = false;
        }
        if (matchesActiveThread) {
            setMessages((prev) => {
                if (message.client_message_id) {
                    const tempIndex = prev.findIndex((item) => String(item.id) === String(message.client_message_id));
                    if (tempIndex >= 0) {
                        const next = [...prev];
                        next[tempIndex] = {
                            ...normalized,
                            is_optimistic: false,
                            send_failed: false
                        };
                        return next;
                    }
                }

                if (prev.some((item) => String(item.id) === String(normalized.id))) {
                    return prev;
                }

                return [...prev, normalized];
            });
            setTimeout(() => scrollToBottom('smooth'), 30);
        }

        upsertConversationFromMessage(message);
    };

    const fetchMessagesPage = async (conversation, pageOffset = 0, appendOlder = false) => {
        if (!currentUser || !conversation) return;

        const requestedConversationKey = getConversationKey(conversation);

        try {
            if (!appendOlder) {
                setLoadingMessages(true);
                setIsLoadingInitial(true);
            }

            const container = messagesRef.current;
            const prevScrollHeight = container?.scrollHeight || 0;

            const params = new URLSearchParams({
                user1_id: currentUser.id,
                user1_type: currentUser.type,
                user2_id: conversation.other_user.id,
                user2_type: conversation.other_user.type,
                limit: String(PAGE_SIZE),
                offset: String(pageOffset)
            });

            const response = await fetch(`${API_BASE}/api/chat/messages?${params}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch messages');
            }

            if (requestedConversationKey !== getConversationKey(activeConversationRef.current)) {
                return;
            }

            const ordered = (data.messages || [])
                .slice()
                .reverse()
                .map((m) => normalizeMessage(m, currentUser.id));

            if (appendOlder) {
                let addedCount = 0;
                setMessages((prev) => {
                    const prevIds = new Set(prev.map((m) => String(m.id)));
                    const older = ordered.filter((m) => !prevIds.has(String(m.id)));
                    addedCount = older.length;
                    if (older.length === 0) return prev;
                    return [...older, ...prev];
                });

                setOffset((prev) => prev + addedCount);

                if (container && addedCount > 0) {
                    setTimeout(() => {
                        const newScrollHeight = container.scrollHeight;
                        container.scrollTop = newScrollHeight - prevScrollHeight;
                    }, 0);
                }
            } else {
                setMessages(ordered);
                setOffset(ordered.length);
                setTimeout(() => scrollToBottom('auto'), 20);
            }

            if (typeof data.has_more === 'boolean') {
                setHasMore(data.has_more);
            } else {
                setHasMore((data.messages || []).length === PAGE_SIZE);
            }

            await markConversationRead(conversation);
        } catch (error) {
            console.error('Failed to fetch messages', error);
        } finally {
            if (!appendOlder) {
                setLoadingMessages(false);
                setIsLoadingInitial(false);
            }
            setIsLoadingMore(false);
        }
    };

    const pollNewMessages = async () => {
        if (!activeConversationRef.current || !currentUser) return;

        try {
            const conversation = activeConversationRef.current;
            const params = new URLSearchParams({
                user1_id: currentUser.id,
                user1_type: currentUser.type,
                user2_id: conversation.other_user.id,
                user2_type: conversation.other_user.type,
                limit: '5',
                offset: '0'
            });

            const response = await fetch(`${API_BASE}/api/chat/messages?${params}`);
            if (!response.ok) return;

            const data = await response.json();
            if (!data.success || !data.messages) return;

            // Get the most recent messages
            const newMessages = data.messages
                .slice()
                .reverse()
                .map((m) => normalizeMessage(m, currentUser.id));

            // Check if there are new messages not in our current state
            const existingIds = new Set(messagesRefState.current.map((m) => String(m.id)));
            const actuallyNewMessages = newMessages.filter((m) => !existingIds.has(String(m.id)));

            if (actuallyNewMessages.length > 0) {
                console.log('📨 Polling found new messages:', actuallyNewMessages);
                actuallyNewMessages.forEach((msg) => handleIncomingSocketMessage(msg));
            }
        } catch (error) {
            console.error('Polling for new messages failed:', error);
        }
    };

    const sendMessageOptimistic = async () => {
        if (!currentUser || !activeConversation || !messageInput.trim() || sendingMessage) return;

        const text = messageInput.trim();
        const tempId = `temp-${Date.now()}`;

        setMessages((prev) => [
            ...prev,
            {
                id: tempId,
                sender_id: String(currentUser.id),
                receiver_id: String(activeConversation.other_user.id),
                text,
                timestamp: new Date().toISOString(),
                status: 'pending',
                is_from_me: true,
                is_optimistic: true
            }
        ]);

        setMessageInput('');
        setShowEmojiPicker(false);
        setSendingMessage(true);
        setTimeout(() => {
            scrollToBottom('smooth');
            inputRef.current?.focus();
        }, 10);

        try {
            const socket = socketRef.current;
            const payload = {
                sender_id: currentUser.id,
                sender_type: currentUser.type,
                receiver_id: String(activeConversation.other_user.id),
                receiver_type: activeConversation.other_user.type,
                message_text: text,
                client_message_id: tempId
            };

            const wsConnected = socket?.connected;
            
            if (wsConnected) {
                console.log('📤 Sending via WebSocket');
                socket.emit('send_message', payload);
            } else {
                console.log('📤 Socket not connected, sending via REST API');
                const response = await fetch(`${API_BASE}/api/chat/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || 'Send failed');
                }
                
                // Poll for new message if socket is not connected
                setTimeout(() => {
                    console.log('📤 Polling for sent message confirmation...');
                    pollNewMessages();
                }, 300);
            }
        } catch (error) {
            console.error('Send message failed:', error);
            setMessages((prev) =>
                prev.map((m) =>
                    String(m.id) === tempId
                        ? { ...m, is_optimistic: false, send_failed: true }
                        : m
                )
            );
        } finally {
            setSendingMessage(false);
            inputRef.current?.focus();
        }
    };

    const deleteConversation = async (conversation) => {
        if (!currentUser || !conversation) return;

        const confirmed = window.confirm(`Delete conversation with ${getConversationName(conversation)}?`);
        if (!confirmed) return;

        try {
            const response = await fetch(`${API_BASE}/api/chat/inbox/delete-conversation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type,
                    other_user_id: String(conversation.other_user.id),
                    other_user_type: conversation.other_user.type
                })
            });
            const data = await response.json();
            if (!data.success) return;

            setConversations((prev) =>
                prev.filter(
                    (item) =>
                        !(String(item.other_user.id) === String(conversation.other_user.id))
                )
            );

            if (activeConversationRef.current && String(activeConversationRef.current.other_user.id) === String(conversation.other_user.id)) {
                setActiveConversation(null);
                setMessages([]);
                setOffset(0);
                setHasMore(false);
            }

            setOpenMenuId(null);
            scheduleBackgroundConversationsSync(400);
        } catch (error) {
            console.error('Failed to delete conversation', error);
        }
    };

    const initiateCall = async (mode) => {
        if (!currentUser || !activeConversation) return;

        const callType = mode === 'voice' ? 'voice' : 'video';
        setCallMode(callType);

        const receiverId = String(activeConversation?.other_user?.id || activeConversation?.other_user_id || '');
        const receiverType = resolveUserType(activeConversation?.other_user || activeConversation);
        if (!receiverId || receiverType === 'user') {
            window.alert('Please select a valid teacher/student user from search before calling.');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/video-call/initiate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    initiator_id: currentUser.id,
                    initiator_type: currentUser.type,
                    receiver_id: receiverId,
                    receiver_type: receiverType,
                    call_type: callType
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Call initiation failed (${response.status})`);
            }

            setActiveCall(data.call || { call_id: data.call_id, room_id: data.room_id, call_type: callType });
        } catch (error) {
            console.error('Failed to initiate call:', error);
            window.alert(`Could not start ${callType} call: ${error.message}`);
        }
    };

    const acceptIncomingCall = async () => {
        if (!incomingCall || !currentUser) return;

        try {
            const response = await fetch(`${API_BASE}/api/video-call/${incomingCall.call_id}/accept`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type,
                    call_type: incomingCall.call_type || 'video'
                })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to accept call');
            }

            setActiveCall(data.call || incomingCall);
            setCallMode(String((data.call || incomingCall).call_type || 'video'));
            setIncomingCall(null);
        } catch (error) {
            console.error('Failed to accept call:', error);
            window.alert(`Could not accept call: ${error.message}`);
        }
    };

    const declineIncomingCall = async () => {
        if (!incomingCall || !currentUser) return;

        try {
            await fetch(`${API_BASE}/api/video-call/${incomingCall.call_id}/decline`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type
                })
            });
        } catch (error) {
            console.error('Failed to decline call:', error);
        } finally {
            setIncomingCall(null);
        }
    };

    const endActiveCall = async () => {
        if (!activeCall) return;
        setActiveCall(null);
        setIncomingCall(null);
    };

    useEffect(() => {
        if (!incomingCall || activeCall) {
            stopIncomingRingtone();
            return undefined;
        }

        incomingRingCountRef.current = 0;
        void playIncomingRingTone();
        incomingRingTimerRef.current = setInterval(() => {
            incomingRingCountRef.current += 1;
            void playIncomingRingTone();

            if (incomingRingCountRef.current >= 10) {
                stopIncomingRingtone();
                declineIncomingCall();
            }
        }, 2000);

        return () => {
            stopIncomingRingtone();
        };
    }, [activeCall, declineIncomingCall, incomingCall, playIncomingRingTone, stopIncomingRingtone]);

    const toggleConversationMenu = (conversation) => {
        const key = conversation.conversation_id || conversation.other_user?.id;
        setOpenMenuId((prev) => (String(prev) === String(key) ? null : key));
    };

    const selectConversation = (conversation) => {
        setOpenMenuId(null);
        setActiveConversation(conversation);
    };

    const startConversationFromSearch = (user) => {
        const existing = conversations.find((item) => String(item.other_user.id) === String(user.id));

        if (existing) {
            selectConversation(existing);
            return;
        }

        const adHocConversation = {
            other_user: {
                id: String(user.id),
                type: resolveUserType(user),
                name: user.name,
                avatar: user.avatar
            },
            last_message: { text: 'New conversation', timestamp: new Date().toISOString() },
            unread_count: 0,
            total_messages: 0
        };

        setConversations((prev) => [adHocConversation, ...prev]);
        setActiveConversation(adHocConversation);
    };

    const handleInputChange = (event) => {
        setMessageInput(event.target.value);
        setIsTyping(true);

        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 1000);
    };

    const handleInputKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessageOptimistic();
        }
    };

    const loadOlderMessages = () => {
        if (!activeConversation || !hasMore || isLoadingMore || isLoadingInitial) return;
        setIsLoadingMore(true);
        fetchMessagesPage(activeConversation, offset, true);
    };

    const handleMessagesScroll = (event) => {
        const { scrollTop } = event.currentTarget;
        if (scrollTop < 80 && hasMore && !isLoadingMore && !isLoadingInitial) {
            loadOlderMessages();
        }
    };

    useEffect(() => {
        const user = getCurrentUser();
        if (!user) {
            navigate('/');
            return;
        }
        setCurrentUser(user);
    }, [navigate]);

    useEffect(() => {
        if (!currentUser) return;
        fetchConversations('');
    }, [currentUser]);

    useEffect(() => {
        const query = searchQuery.trim();
        fetchDirectoryResults(query);
    }, [searchQuery]);

    useEffect(() => {
        if (!activeConversation) return;
        setMessages([]);
        setOffset(0);
        setHasMore(false);
        fetchMessagesPage(activeConversation, 0, false);
        setTimeout(() => inputRef.current?.focus(), 50);
    }, [activeConversation]);

    useEffect(() => {
        const handleDocumentClick = () => setOpenMenuId(null);
        document.addEventListener('click', handleDocumentClick);
        return () => {
            document.removeEventListener('click', handleDocumentClick);
            if (backgroundSyncTimerRef.current) {
                clearTimeout(backgroundSyncTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!currentUser) return;

        const socket = io(API_BASE, {
            transports: ['websocket', 'polling'],
            withCredentials: true,
            autoConnect: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 500,
            reconnectionDelayMax: 3000
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('✅ Socket.IO connected, registering user...');
            socket.emit('register_user', {
                user_id: currentUser.id,
                user_type: currentUser.type
            });
            fetchConversations(searchQueryRef.current.trim(), { silent: true });

            if (activeConversationRef.current) {
                markConversationRead(activeConversationRef.current);
            }
        });

        socket.on('register_user_response', (response) => {
            console.log('✅ User registered on socket:', response);
        });

        socket.on('chat_message_saved', (payload) => {
            console.log('📨 Received chat_message_saved:', payload);
            handleIncomingSocketMessage(payload);
        });
        
        socket.on('chat_message', (payload) => {
            console.log('📨 Received chat_message:', payload);
            handleIncomingSocketMessage(payload);
        });
        
        socket.on('new_message', (payload) => {
            console.log('📨 Received new_message:', payload);
            handleIncomingSocketMessage(payload);
        });

        socket.on('conversation_updated', () => {
            console.log('🔄 Conversation updated event received');
            scheduleBackgroundConversationsSync(600);
        });
        socket.on('messages_read', (payload) => {
            const readMessageIds = new Set((payload?.message_ids || []).map((id) => String(id)));
            const readerId = String(payload?.user_id || '');
            const peerId = String(payload?.other_user_id || '');

            setMessages((prev) => prev.map((message) => {
                const messageId = String(message.id);
                const isExplicitlyRead = readMessageIds.has(messageId);
                const isMyOutgoingToReader = String(message.sender_id) === peerId && String(message.receiver_id || activeConversationRef.current?.other_user?.id || '') === readerId;

                if (!isExplicitlyRead && !isMyOutgoingToReader) return message;
                return {
                    ...message,
                    is_read: true,
                    read_at: payload?.read_at || new Date().toISOString(),
                    status: 'read'
                };
            }));

            setConversations((prev) => prev.map((conversation) => {
                const itemId = conversation.conversation_id || conversation.other_user?.id;
                if (String(itemId) !== readerId && String(itemId) !== peerId) return conversation;
                return {
                    ...conversation,
                    unread_count: 0,
                    last_message: conversation.last_message
                        ? { ...conversation.last_message, is_read: true }
                        : conversation.last_message
                };
            }));

            scheduleBackgroundConversationsSync(500);
        });
        socket.on('connect_error', (error) => {
            console.error('❌ Chat socket connection failed:', error);
        });

        socket.on('video_call_incoming', (payload) => {
            const call = payload?.call || payload;
            if (!call || String(call.receiver_id) !== String(currentUser.id)) return;
            if (!isLiveCallState(call)) return;
            setIncomingCall(call);
            setCallMode(String(call.call_type || 'video'));
        });

        socket.on('video_call_outgoing', (payload) => {
            const call = payload?.call || payload;
            if (!call || String(call.initiator_id) !== String(currentUser.id)) return;
            if (!isLiveCallState(call)) return;
            setActiveCall(call);
            setCallMode(String(call.call_type || 'video'));
        });

        socket.on('video_call_accepted', (payload) => {
            const call = payload?.call || payload;
            if (!call) return;
            if (!isLiveCallState(call)) {
                setIncomingCall(null);
                setActiveCall(null);
                return;
            }
            if (String(call.initiator_id) === String(currentUser.id) || String(call.receiver_id) === String(currentUser.id)) {
                setIncomingCall(null);
                setActiveCall(call);
                setCallMode(String(call.call_type || 'video'));
            }
        });

        socket.on('video_call_declined', (payload) => {
            const call = payload?.call || payload;
            if (!call) return;
            if (String(call.initiator_id) === String(currentUser.id) || String(call.receiver_id) === String(currentUser.id)) {
                setIncomingCall(null);
                setActiveCall(null);
            }
        });

        socket.on('video_call_ended', (payload) => {
            const call = payload?.call || payload;
            if (!call) return;
            if (String(call.initiator_id) === String(currentUser.id) || String(call.receiver_id) === String(currentUser.id)) {
                setIncomingCall(null);
                setActiveCall(null);
            }
        });
        
        socket.on('disconnect', (reason) => {
            console.warn('⚠️ Socket disconnected:', reason);
        });

        return () => {
            socket.off('chat_message_saved');
            socket.off('chat_message');
            socket.off('new_message');
            socket.off('conversation_updated');
            socket.off('messages_read');
            socket.off('video_call_incoming');
            socket.off('video_call_outgoing');
            socket.off('video_call_accepted');
            socket.off('video_call_declined');
            socket.off('video_call_ended');
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.disconnect();
            socketRef.current = null;
        };
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser || !activeConversation || !socketRef.current?.connected) return;

        socketRef.current.emit('join_chat_room', {
            user_id: currentUser.id,
            other_user_id: activeConversation.other_user.id
        });
    }, [activeConversation, currentUser]);

    useEffect(() => {
        if (!currentUser || activeCall) return;

        const pollPendingCalls = async () => {
            try {
                const response = await fetch(`${API_BASE}/api/video-call/pending/${encodeURIComponent(currentUser.id)}/${encodeURIComponent(currentUser.type)}`);
                if (!response.ok) return;

                const data = await response.json();
                if (!data.success || !Array.isArray(data.calls) || data.calls.length === 0) return;

                const call = data.calls.find((item) => isLiveCallState(item));
                if (!call) return;
                if (!incomingCall || String(incomingCall.call_id) !== String(call.call_id)) {
                    setIncomingCall({ ...call, call_type: call.call_type || 'video' });
                }
            } catch (error) {
                console.error('Pending call polling failed:', error);
            }
        };

        pollPendingCalls();
        const timer = setInterval(pollPendingCalls, 2500);
        return () => clearInterval(timer);
    }, [currentUser, incomingCall, activeCall]);

    // Polling fallback for real-time message delivery
    useEffect(() => {
        if (!activeConversation) return;

        // Poll every 2.5 seconds as a fallback
        const pollInterval = setInterval(() => {
            console.log('🔄 Polling for new messages...');
            pollNewMessages();
        }, 2500);

        return () => clearInterval(pollInterval);
    }, [activeConversation]);

    const currentDashboard = currentUser?.type === 'teacher' ? '/teacherDashboard' : '/studentDashboard';

    return (
        <>
            {incomingCall && !activeCall && (
                <div className="chat-call-overlay">
                    <div className="chat-call-card">
                        <div className="chat-call-title">Incoming {String(incomingCall.call_type || 'video')} call</div>
                        <div className="chat-call-subtitle">User {incomingCall.initiator_id} is calling you</div>
                        <div className="chat-call-actions">
                            <button type="button" className="chat-call-btn accept" onClick={acceptIncomingCall}>Accept</button>
                            <button type="button" className="chat-call-btn decline" onClick={declineIncomingCall}>Decline</button>
                        </div>
                    </div>
                </div>
            )}

            {activeCall && (
                <div className="chat-call-overlay chat-call-room-overlay">
                    <div className="chat-call-room-shell">
                        <PrivateCall
                            currentUser={currentUser}
                            call={activeCall}
                            socket={socketRef.current}
                            onEnd={endActiveCall}
                        />
                    </div>
                </div>
            )}

        <div className="chat-container">
            <nav className="chat-navbar">
                <div className="chat-navbar-left">
                    <button className="chat-back-btn" onClick={() => navigate(currentDashboard)}>Back</button>
                    <div className="chat-logo-container">
                        <img src={classMateLogo} alt="ClassMate Logo" className="chat-navbar-logo" />
                        <span className="chat-brand-name">classMate</span>
                    </div>
                </div>
                <div className="chat-navbar-right">
                    <span style={{ color: '#2f4156', fontWeight: 600 }}>Inbox</span>
                    {unreadTotal > 0 && <span className="unread-badge">{unreadTotal}</span>}
                </div>
            </nav>

            <div className="chat-main-area">
                <aside className="chat-sidebar">
                    <div className="chat-search-container">
                        <input
                            className="chat-search-input"
                            placeholder="Search people or conversations"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                        />
                    </div>

                    {searchQuery.trim().length >= 2 && directoryResults.length > 0 && (
                        <div className="chat-search-results">
                            <div className="search-results-header">
                                <h4>People</h4>
                                <span className="results-count">{directoryResults.length}</span>
                            </div>
                            <div className="search-results-list">
                                {directoryResults.slice(0, 5).map((user) => (
                                    <div
                                        key={`${user.user_type}-${user.id}`}
                                        className="search-result-item"
                                        onClick={() => startConversationFromSearch(user)}
                                    >
                                        <div className="search-result-avatar">{(user.avatar || user.name?.charAt(0) || 'U').toUpperCase()}</div>
                                        <div className="search-result-info">
                                            <h5>{user.name}</h5>
                                            <span className="search-result-role">{user.role || user.user_type}</span>
                                        </div>
                                        <button className="start-chat-btn" type="button">Chat</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="chat-list-container">
                        <div className="chat-list-header">
                            <h3>Conversations</h3>
                            <span className="chats-count">{filteredConversations.length}</span>
                        </div>

                        {loadingConversations ? (
                            <div className="no-chats-message"><p>Loading conversations...</p></div>
                        ) : (
                            <div className="chat-list">
                                <ConversationList
                                    conversations={filteredConversations}
                                    selectedId={activeConversation?.conversation_id || activeConversation?.other_user?.id}
                                    openMenuId={openMenuId}
                                    onSelectConversation={selectConversation}
                                    onToggleMenu={toggleConversationMenu}
                                    onDeleteConversation={deleteConversation}
                                    onMarkUnreadConversation={markConversationUnread}
                                />

                                {filteredConversations.length === 0 && (
                                    <div className="no-chats-message">
                                        <h4>No conversations found</h4>
                                        <p>Search for a user to start chatting.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </aside>

                <section className="chat-box-container">
                    {!activeConversation ? (
                        <div className="no-chat-selected">
                            <h3>Select a conversation</h3>
                            <p>Choose a conversation from the left or search for a user.</p>
                        </div>
                    ) : (
                        <>
                            <header className="chat-box-header">
                                <div className="chat-box-user-info">
                                    <div className="chat-box-avatar">
                                        <div className="chat-box-avatar-initials">{getConversationAvatar(activeConversation)}</div>
                                    </div>
                                    <div className="chat-box-user-details">
                                        <h4>{getConversationName(activeConversation)}</h4>
                                        <span className="chat-box-user-role">{activeConversation.other_user.type}</span>
                                        {isTyping && <span className="online-status">Typing...</span>}
                                    </div>
                                </div>
                                <div className="chat-box-actions">
                                    <button className="chat-header-action-btn" type="button" title="Start voice call" onClick={() => initiateCall('voice')}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.3 2.6 3.6 4.9 6.2 6.2l2.1-2.1c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.9.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.3 21 3 13.7 3 4c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1 0 1.3.2 2.7.6 3.9.1.4 0 .8-.3 1.1L6.6 10.8z"/></svg>
                                    </button>
                                    <button className="chat-header-action-btn" type="button" title="Start video call" onClick={() => initiateCall('video')}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2.5l5 3.5V5l-5 3.5z"/></svg>
                                    </button>
                                </div>
                            </header>

                            <div className="chat-messages-area message-list-container" ref={messagesRef} onScroll={handleMessagesScroll}>
                                {isLoadingMore && (
                                    <div style={{ textAlign: 'center', marginBottom: '1rem', color: '#567c8d', fontSize: '0.9rem' }}>
                                        Loading older messages...
                                    </div>
                                )}

                                {loadingMessages && messages.length === 0 ? (
                                    <div className="no-messages">Loading messages...</div>
                                ) : (
                                    <>
                                        <MessageList messages={messages} currentUserId={currentUser?.id} />
                                        {messages.length === 0 && <div className="no-messages">No messages yet.</div>}
                                    </>
                                )}
                            </div>

                            <div className="message-input-container">
                                {showEmojiPicker && (
                                    <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        {EMOJIS.map((emoji) => (
                                            <button
                                                key={emoji}
                                                type="button"
                                                className="message-attachment-btn"
                                                onClick={() => setMessageInput((prev) => `${prev} ${emoji}`.trim())}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className="message-input-wrapper">
                                    <textarea
                                        ref={inputRef}
                                        className="message-input"
                                        rows={1}
                                        placeholder="Type a message"
                                        value={messageInput}
                                        onChange={handleInputChange}
                                        onKeyDown={handleInputKeyDown}
                                    />

                                    <div className="message-input-actions">
                                        <button
                                            className="message-attachment-btn"
                                            type="button"
                                            onClick={() => setShowEmojiPicker((prev) => !prev)}
                                            title="Emoji picker"
                                        >
                                            :)
                                        </button>
                                        <button
                                            className="message-send-btn"
                                            type="button"
                                            disabled={sendingMessage || !messageInput.trim()}
                                            onClick={sendMessageOptimistic}
                                        >
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l18-8L3 4v6l12 2-12 2v6z"/></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
        </>
    );
}

export default React.memo(ChatPage);
