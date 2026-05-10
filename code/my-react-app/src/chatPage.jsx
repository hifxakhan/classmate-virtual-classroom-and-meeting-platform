import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Peer from 'simple-peer';
import { io } from 'socket.io-client';
import { FaPhone, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash, FaClock } from 'react-icons/fa';
import './chat.css';
import classMateLogo from './assets/Logo2.png';
import { formatPKTDate, formatPKTTime, getPKTDateKey } from './utils/dateUtils.js';
import { formatChatTime, getConversationAvatar, getConversationName } from './utils/chatUtils.js';
import { CallErrorBoundary } from './CallErrorBoundary.jsx';
import PrivateCall from './PrivateCall.jsx';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const callDebug = (...args) => console.log('[CALL_DEBUG][CHAT]', ...args);
const MESSAGE_POLL_MS = 3000;
const UNREAD_POLL_MS = 10000;
const PAGE_SIZE = 20;
const EMOJIS = [':)', ':D', '<3', ':P', ';)', ':O'];

const getCurrentUser = () => {
    // Prefer the canonical `user` object saved at login when available.
    try {
        const raw = localStorage.getItem('user');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && (parsed.id || parsed.user_id)) {
                const id = String(parsed.id || parsed.user_id || parsed.teacher_id || parsed.student_id);
                const role = (parsed.role || parsed.user_type || parsed.type || '').toString().toLowerCase();
                const inferredType = role || (id && id.startsWith('TCH') ? 'teacher' : id.startsWith('STU') ? 'student' : 'user');
                return {
                    id,
                    type: inferredType,
                    name: parsed.name || parsed.full_name || localStorage.getItem('teacherName') || localStorage.getItem('studentName') || 'User'
                };
            }
        }
    } catch (e) {
        console.warn('Failed to parse stored user object:', e);
    }

    // Backwards-compat fallback: explicit role keys
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

// Helper to resolve actual user ID from name (for cases where localStorage has name instead of ID)
const resolveUserId = async (name, type) => {
    try {
        const params = new URLSearchParams({ q: name, current_user_id: 'temp', current_user_type: type });
        const response = await fetch(`${API_BASE}/api/chat/search?${params}`);
        const data = await response.json();
        if (data.success && data.results?.length > 0) {
            const match = data.results.find(r => r.name?.toLowerCase() === name?.toLowerCase());
            if (match) return { id: String(match.id), name: match.name, type: resolveUserType(match) };
        }
    } catch (e) {
        console.warn('Failed to resolve user ID from name:', e);
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

const isCallTooOld = (call, maxMinutes = 5) => {
    const createdAt = call?.created_at || call?.started_at;
    if (!createdAt) return false;
    const ageMs = Date.now() - new Date(createdAt).getTime();
    return ageMs > maxMinutes * 60 * 1000;
};

const normalizeCallType = (value, fallback = 'video') => {
    const raw = String(value || fallback).trim().toLowerCase();
    if (raw === 'voice' || raw === 'audio') return 'voice';
    return 'video';
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

// Compare two conversation lists for equality to avoid unnecessary state updates
const areConversationsEqual = (a = [], b = []) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;

    const mapA = new Map();
    for (const c of a) {
        mapA.set(getConversationKey(c), c);
    }

    for (const c of b) {
        const key = getConversationKey(c);
        const prev = mapA.get(key);
        if (!prev) return false;

        const prevTs = prev?.last_message?.timestamp || prev?.last_message_time || null;
        const newTs = c?.last_message?.timestamp || c?.last_message_time || null;
        if (String(prevTs) !== String(newTs)) return false;

        const prevUnread = Number(prev?.unread_count || 0);
        const newUnread = Number(c?.unread_count || 0);
        if (prevUnread !== newUnread) return false;
    }

    return true;
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

const ChatPage = () => {
    const navigate = useNavigate();

    // State: Conversations
    const [loadingConversations, setLoadingConversations] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [unreadTotal, setUnreadTotal] = useState(0);
    const [directoryResults, setDirectoryResults] = useState([]);

    // State: Messages
    const [messages, setMessages] = useState([]);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [activeConversation, setActiveConversation] = useState(null);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [isLoadingInitial, setIsLoadingInitial] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // State: Input & UI
    const [messageInput, setMessageInput] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [isTyping, setIsTyping] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // State: User & Authentication
    const [currentUser, setCurrentUser] = useState(null);

    // State: Calls (video & voice)
    const [callMode, setCallMode] = useState('video');
    const [activeCall, setActiveCall] = useState(null);
    const [incomingCall, setIncomingCall] = useState(null);

    // State: Voice Calls
    const [voiceCallActive, setVoiceCallActive] = useState(false);
    const [voiceCallStatus, setVoiceCallStatus] = useState('idle');
    const [incomingVoiceCall, setIncomingVoiceCall] = useState(null);
    const [voiceCallStream, setVoiceCallStream] = useState(null);
    const [voiceCallPeer, setVoiceCallPeer] = useState(null);
    const [voiceCallRemoteStream, setVoiceCallRemoteStream] = useState(null);
    const [voiceCallDuration, setVoiceCallDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [callStartTime, setCallStartTime] = useState(null);
    const [lastCallDurationDisplay, setLastCallDurationDisplay] = useState(null);

    // Refs: Core
    const activeConversationRef = useRef(null);
    const backgroundSyncTimerRef = useRef(null);
    const socketRef = useRef(null);
    const searchQueryRef = useRef('');
    const messagesRef = useRef(null);
    const messagesRefState = useRef([]);
    const inputRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const sfuSocketRef = useRef(null);

    // Refs: Calls (video & voice)
    const incomingCallRef = useRef(null);
    const activeCallRef = useRef(null);
    const callModeRef = useRef('video');

    // Refs: Voice Calls
    const voiceCallActiveRef = useRef(false);
    const voiceCallStatusRef = useRef('idle');
    const voiceCallPeerRef = useRef(null);
    const voiceCallTimeoutRef = useRef(null);
    const voiceCallTimerRef = useRef(null);
    const incomingVoiceCallRef = useRef(null);
    const audioElRef = useRef(null);
    const outgoingRingIntervalRef = useRef(null);
    const outgoingRingCountRef = useRef(0);

    // Refs: Ringtone
    const incomingRingTimerRef = useRef(null);
    const incomingRingCountRef = useRef(0);

    // Ringtone management functions
    const playIncomingRingTone = useCallback(async () => {
        try {
            // Play a short ringing tone (longer pattern)
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 650;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1.0);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 1.0);
        } catch (err) {
            console.warn('Could not play ringtone:', err);
        }
    }, []);

    const stopIncomingRingtone = useCallback(() => {
        if (incomingRingTimerRef.current) {
            clearInterval(incomingRingTimerRef.current);
            incomingRingTimerRef.current = null;
        }
        incomingRingCountRef.current = 0;
    }, []);

    const startOutgoingRingtone = useCallback(() => {
        try {
            if (outgoingRingIntervalRef.current) return;
            outgoingRingCountRef.current = 0;
            outgoingRingIntervalRef.current = setInterval(() => {
                try {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    oscillator.frequency.value = 520;
                    oscillator.type = 'sine';
                    gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
                    oscillator.start();
                    setTimeout(() => {
                        try { oscillator.stop(); } catch (e) {}
                        try { audioContext.close(); } catch (e) {}
                    }, 600);
                    outgoingRingCountRef.current += 1;
                } catch (err) {
                    console.warn('Outgoing ringtone error:', err);
                }
            }, 1200);
        } catch (err) {
            console.warn('Failed to start outgoing ringtone:', err);
        }
    }, []);

    const stopOutgoingRingtone = useCallback(() => {
        try {
            if (outgoingRingIntervalRef.current) {
                clearInterval(outgoingRingIntervalRef.current);
                outgoingRingIntervalRef.current = null;
            }
            outgoingRingCountRef.current = 0;
        } catch (err) {
            console.warn('Failed to stop outgoing ringtone:', err);
        }
    }, []);

    // Keep a ref copy of incomingVoiceCall for handlers that need stable access
    useEffect(() => {
        incomingVoiceCallRef.current = incomingVoiceCall;
    }, [incomingVoiceCall]);

    // When a remote voice stream arrives, attach it to a hidden audio element and play
    useEffect(() => {
        const audioEl = audioElRef.current;
        if (!audioEl) return;

        if (voiceCallRemoteStream) {
            try {
                audioEl.srcObject = voiceCallRemoteStream;
                const playPromise = audioEl.play();
                if (playPromise && typeof playPromise.then === 'function') {
                    playPromise.catch((err) => {
                        console.warn('Autoplay prevented, will require user gesture to start audio:', err);
                    });
                }
            } catch (err) {
                console.error('Failed to attach remote stream to audio element:', err);
            }
        } else {
            try {
                audioEl.pause();
                audioEl.srcObject = null;
            } catch (err) {
                // ignore
            }
        }

        return () => {
            try {
                if (audioEl) {
                    audioEl.pause();
                    audioEl.srcObject = null;
                }
            } catch (e) {}
        };
    }, [voiceCallRemoteStream]);

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

        const callType = normalizeCallType(mode);
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

            const returnedCall = data.call || { call_id: data.call_id, room_id: data.room_id, call_type: callType };
            const normalizedType = normalizeCallType(returnedCall.call_type, callType);

            // Notify SFU server to forward call request to receiver
            const sfuSocket = sfuSocketRef.current;
            const privateCallPayload = {
                call_id: returnedCall.call_id,
                room_id: returnedCall.room_id,
                initiator_id: currentUser.id,
                initiator_type: currentUser.type,
                receiver_id: receiverId,
                receiver_type: receiverType,
                call_type: normalizedType
            };
            callDebug('call initiated via API', {
                call_id: privateCallPayload.call_id,
                room_id: privateCallPayload.room_id,
                initiator_id: privateCallPayload.initiator_id,
                initiator_type: privateCallPayload.initiator_type,
                receiver_id: privateCallPayload.receiver_id,
                receiver_type: privateCallPayload.receiver_type,
                call_type: privateCallPayload.call_type
            });

            if (sfuSocket) {
                if (sfuSocket.connected) {
                    console.log('📞 Emitting private_call_request to SFU server');
                    callDebug('emitting private_call_request now', privateCallPayload);
                    sfuSocket.emit('private_call_request', privateCallPayload);
                } else {
                    console.warn('⚠️ SFU socket not connected yet, sending call request on connect');
                    callDebug('deferring private_call_request until connect', privateCallPayload);
                    sfuSocket.once('connect', () => {
                        callDebug('deferred private_call_request emit on connect', privateCallPayload);
                        sfuSocket.emit('private_call_request', privateCallPayload);
                    });
                    sfuSocket.connect();
                }
            } else {
                console.warn('⚠️ SFU socket not connected, receiver may not get notified');
            }

            setActiveCall({ ...returnedCall, call_type: normalizedType, preferred_call_type: normalizedType });
        } catch (error) {
            console.error('Failed to initiate call:', error);
            window.alert(`Could not start ${callType} call: ${error.message}`);
        }
    };

    const acceptIncomingCall = async () => {
        const call = incomingCallRef.current;
        if (!call || !currentUser) {
            console.warn('⚠️ Accept called but no incoming call');
            return;
        }

        try {
            console.log('✅ Accepting call:', call.call_id);
            const response = await fetch(`${API_BASE}/api/video-call/${call.call_id}/accept`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type,
                    call_type: normalizeCallType(call.call_type)
                })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Failed to accept call (${response.status})`);
            }

            const acceptedCall = data.call || call;
            const acceptedType = normalizeCallType(acceptedCall.call_type);
            console.log('✅ Call accepted, setting activeCall:', acceptedCall.call_id);
            stopIncomingRingtone();
            setIncomingCall(null);
            setActiveCall({ ...acceptedCall, call_type: acceptedType, preferred_call_type: acceptedType });
            setCallMode(acceptedType);
        } catch (error) {
            console.error('❌ Failed to accept call:', error);
            window.alert(`Could not accept call: ${error.message}`);
        }
    };

    const declineIncomingCall = async () => {
        const call = incomingCallRef.current;
        if (!call || !currentUser) {
            console.warn('⚠️ Decline called but no incoming call');
            stopIncomingRingtone();
            setIncomingCall(null);
            return;
        }

        try {
            console.log('❌ Declining call:', call.call_id);
            const response = await fetch(`${API_BASE}/api/video-call/${call.call_id}/decline`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type
                })
            });
            if (!response.ok) {
                console.warn('Decline API returned:', response.status);
            }
        } catch (error) {
            console.error('Failed to decline call:', error);
        } finally {
            stopIncomingRingtone();
            setIncomingCall(null);
        }
    };

    const endActiveCall = useCallback(async () => {
        if (!activeCall) return;
        stopIncomingRingtone();
        setActiveCall(null);
        setIncomingCall(null);
    }, [activeCall, stopIncomingRingtone]);

    // ============ VOICE CALL FUNCTIONS ============

    const startVoiceCall = async () => {
        if (!currentUser || !activeConversation) return;

        const targetUserId = activeConversation.other_user.id;
        const targetUserType = activeConversation.other_user.type;
        const voiceSocket = socketRef.current;

        console.log(`📞 [VOICE_CALL_START] Calling ${targetUserType}:${targetUserId}`);
        console.log(`   Socket connected: ${voiceSocket?.connected || false}`);
        console.log(`   Socket ID: ${voiceSocket?.id || 'NONE'}`);
        callDebug('startVoiceCall state', {
            currentUser,
            activeConversation: {
                other_user: {
                    id: activeConversation.other_user.id,
                    type: activeConversation.other_user.type,
                    name: activeConversation.other_user.name
                }
            },
            targetUserId,
            targetUserType
        });

        if (!voiceSocket) {
            window.alert('Chat socket is still connecting. Please try again in a moment.');
            return;
        }

        if (!voiceSocket.connected) {
            window.alert('Chat socket not connected. Please try again.');
            return;
        }

        if (voiceCallActiveRef.current || voiceCallStatusRef.current === 'calling' || voiceCallStatusRef.current === 'ringing') {
            window.alert('A voice call is already in progress.');
            return;
        }

        setVoiceCallStatus('calling');
        voiceCallStatusRef.current = 'calling';
        setVoiceCallActive(true);
        voiceCallActiveRef.current = true;
        setIncomingVoiceCall(null);

        // Start outgoing ringtone for caller
        startOutgoingRingtone();

        try {
            // Request microphone permission first (better UX: detect denied state, force prompt when needed)
            let stream = null;
            try {
                if (navigator.permissions && navigator.permissions.query) {
                    const permission = await navigator.permissions.query({ name: 'microphone' });
                    if (permission.state === 'denied') {
                        alert('Please allow microphone access in your browser settings');
                        endVoiceCall();
                        return;
                    }

                    if (permission.state !== 'granted') {
                        // Force a prompt to request permission
                        try {
                            const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            testStream.getTracks().forEach(t => t.stop());
                            // We'll request a fresh stream below
                        } catch (permErr) {
                            alert(`Microphone access needed: ${permErr.message}`);
                            endVoiceCall();
                            return;
                        }
                    }
                } else {
                    // No permissions API available; attempt to request a test stream to trigger prompt
                    try {
                        const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        testStream.getTracks().forEach(t => t.stop());
                    } catch (permErr) {
                        alert(`Microphone access needed: ${permErr.message}`);
                        endVoiceCall();
                        return;
                    }
                }
            } catch (permCheckErr) {
                console.warn('Microphone permission check failed:', permCheckErr);
            }

            // Now request the actual microphone stream
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setVoiceCallStream(stream);

            // Create peer connection
            const peer = new Peer({
                initiator: true,
                trickle: false,
                stream
            });
            voiceCallPeerRef.current = peer;
            setVoiceCallPeer(peer);

            // Handle remote stream
            peer.on('stream', (remoteStream) => {
                console.log('Received remote voice stream');
                setVoiceCallRemoteStream(remoteStream);
                setVoiceCallStatus('connected');
                voiceCallStatusRef.current = 'connected';
                startVoiceCallTimer();
            });

            peer.on('error', (err) => {
                console.error('Voice call peer error:', err);
                endVoiceCall();
            });

            peer.on('close', () => {
                if (voiceCallStatusRef.current !== 'idle') {
                    endVoiceCall();
                }
            });

            console.log(`📞 [VOICE_CALL] Sending voice_call_request to chat socket`);
            console.log(`   Caller: ${currentUser.type}:${currentUser.id}`);
            console.log(`   Target: ${targetUserType}:${targetUserId}`);
            callDebug('ABOUT TO EMIT voice_call_request', {
                to: targetUserId,
                to_type: targetUserType,
                from: currentUser.id,
                from_type: currentUser.type,
                from_name: currentUser.name,
                receiver_id: targetUserId,
                receiver_type: targetUserType,
                initiator_id: currentUser.id,
                initiator_type: currentUser.type,
                initiator_name: currentUser.name,
                call_type: 'voice'
            });

            peer.on('signal', (signal) => {
                voiceSocket.emit('voice_call_request', {
                    signal,
                    to: targetUserId,
                    to_type: targetUserType,
                    from: currentUser.id,
                    from_type: currentUser.type,
                    from_name: currentUser.name || 'User',
                    receiver_id: targetUserId,
                    receiver_type: targetUserType,
                    initiator_id: currentUser.id,
                    initiator_type: currentUser.type,
                    initiator_name: currentUser.name || 'User',
                    call_type: 'voice',
                    timestamp: Date.now()
                });
            });

            voiceCallTimeoutRef.current = setTimeout(() => {
                if (voiceCallStatusRef.current === 'calling' || voiceCallStatusRef.current === 'ringing') {
                    endVoiceCall();
                    alert('Call not answered. Please try again.');
                }
            }, 30000);
        } catch (err) {
            console.error('Failed to start voice call:', err);
            alert('Could not access microphone. Please check permissions.');
            endVoiceCall();
        }
    };

    const acceptVoiceCall = async () => {
        if (!incomingVoiceCall) return;
        const voiceSocket = socketRef.current;

        if (!voiceSocket) {
            window.alert('Chat socket is still connecting. Please try again in a moment.');
            return;
        }

        try {
            // Stop ringtone immediately
            stopIncomingRingtone();
            setVoiceCallStatus('ringing');
            voiceCallStatusRef.current = 'ringing';

            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setVoiceCallStream(stream);

            // Create peer connection
            const peer = new Peer({
                initiator: false,
                trickle: false,
                stream
            });
            voiceCallPeerRef.current = peer;
            setVoiceCallPeer(peer);

            peer.on('signal', (signal) => {
                voiceSocket.emit('voice_call_answer', {
                    signal,
                    to: incomingVoiceCall.from,
                    to_type: incomingVoiceCall.from_type,
                    from: currentUser.id,
                    from_type: currentUser.type,
                    from_name: currentUser.name || 'User',
                    call_type: incomingVoiceCall.call_type || 'voice'
                });
            });

            peer.on('stream', (remoteStream) => {
                console.log('Received remote voice stream');
                setVoiceCallRemoteStream(remoteStream);
                setVoiceCallStatus('connected');
                voiceCallStatusRef.current = 'connected';
                startVoiceCallTimer();
            });

            peer.on('error', (err) => {
                console.error('Voice call peer error:', err);
                endVoiceCall();
            });

            peer.on('close', () => {
                if (voiceCallStatusRef.current !== 'idle') {
                    endVoiceCall();
                }
            });

            peer.signal(incomingVoiceCall.signal);

            setVoiceCallActive(true);
        voiceCallActiveRef.current = true;
            setVoiceCallStatus('ringing');
            voiceCallStatusRef.current = 'ringing';
            setIncomingVoiceCall(null);
        } catch (err) {
            console.error('Failed to accept voice call:', err);
            alert('Could not access microphone. Please check permissions.');
            endVoiceCall();
        }
    };

    const rejectVoiceCall = () => {
        if (incomingVoiceCall) {
            stopIncomingRingtone();
            socketRef.current?.emit('voice_call_reject', {
                to: incomingVoiceCall.from,
                to_type: incomingVoiceCall.from_type,
                from: currentUser.id,
                from_type: currentUser.type,
                from_name: currentUser.name || 'User',
                call_type: incomingVoiceCall.call_type || 'voice'
            });
            setIncomingVoiceCall(null);
        }
    };

    const endVoiceCall = () => {
        // Stop ringtone
        stopIncomingRingtone();
        stopOutgoingRingtone();

        if (voiceCallTimeoutRef.current) {
            clearTimeout(voiceCallTimeoutRef.current);
            voiceCallTimeoutRef.current = null;
        }

        // Stop timer
        if (voiceCallTimerRef.current) {
            clearInterval(voiceCallTimerRef.current);
            voiceCallTimerRef.current = null;
        }

        const wasConnected = voiceCallStatusRef.current === 'connected';

        // Close peer connection
        if (voiceCallPeerRef.current) {
            voiceCallPeerRef.current.destroy();
            voiceCallPeerRef.current = null;
        }

        // Stop local stream
        if (voiceCallStream) {
            voiceCallStream.getTracks().forEach(track => track.stop());
            setVoiceCallStream(null);
        }

        // Capture final duration and reset states
        if (wasConnected) {
            const finalDuration = voiceCallDuration || 0;
            setLastCallDurationDisplay(formatVoiceCallDuration(finalDuration));
            // clear after 6s
            setTimeout(() => setLastCallDurationDisplay(null), 6000);
        }

        // Reset states
        setVoiceCallRemoteStream(null);
        setVoiceCallActive(false);
        voiceCallActiveRef.current = false;
        setVoiceCallStatus('idle');
        voiceCallStatusRef.current = 'idle';
        setVoiceCallPeer(null);
        setVoiceCallDuration(0);
        setCallStartTime(null);
        setIsMuted(false);
        setIncomingVoiceCall(null);

        // Notify other party if call was connected
        if (wasConnected) {
            socketRef.current?.emit('voice_call_end', {
                to: activeConversation?.other_user.id,
                to_type: activeConversation?.other_user.type,
                from: currentUser.id,
                from_type: currentUser.type,
                call_type: 'voice'
            });
        }
    };

    const toggleMute = () => {
        if (voiceCallStream) {
            const audioTrack = voiceCallStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    };

    const startVoiceCallTimer = () => {
        let seconds = 0;
        setCallStartTime(Date.now());
        setVoiceCallDuration(0);
        voiceCallTimerRef.current = setInterval(() => {
            seconds++;
            setVoiceCallDuration(seconds);
        }, 1000);
    };

    const formatVoiceCallDuration = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
        }, 2800);

        return () => {
            stopIncomingRingtone();
        };
    }, [activeCall, declineIncomingCall, incomingCall?.call_id, playIncomingRingTone, stopIncomingRingtone]);

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
            if (isCallTooOld(call, 5)) {
                console.log('⏰ Ignoring stale incoming call:', call.call_id);
                return;
            }
            // Ignore if already have an active call or incoming call with same ID
            if (activeCallRef.current) return;
            if (incomingCallRef.current && String(incomingCallRef.current.call_id) === String(call.call_id)) return;
            console.log('📞 Incoming call from:', call.initiator_id, 'call_id:', call.call_id);
            const fallbackType = normalizeCallType(
                incomingCallRef.current?.preferred_call_type || incomingCallRef.current?.call_type,
                callModeRef.current
            );
            const normalizedType = normalizeCallType(call.call_type, fallbackType);
            setIncomingCall({ ...call, call_type: normalizedType, preferred_call_type: normalizedType });
            setCallMode(normalizedType);
        });

        socket.on('video_call_outgoing', (payload) => {
            const call = payload?.call || payload;
            if (!call || String(call.initiator_id) !== String(currentUser.id)) return;
            if (!isLiveCallState(call)) return;
            const fallbackType = normalizeCallType(
                activeCallRef.current?.preferred_call_type || activeCallRef.current?.call_type,
                callModeRef.current
            );
            const normalizedType = normalizeCallType(call.call_type, fallbackType);
            setActiveCall({ ...call, call_type: normalizedType, preferred_call_type: normalizedType });
            setCallMode(normalizedType);
        });

        socket.on('video_call_accepted', (payload) => {
            const call = payload?.call || payload;
            if (!call) return;
            if (!isLiveCallState(call)) {
                setIncomingCall(null);
                setActiveCall(null);
                stopIncomingRingtone();
                return;
            }
            if (String(call.initiator_id) === String(currentUser.id) || String(call.receiver_id) === String(currentUser.id)) {
                // Prevent setting activeCall again if we already have the same call active
                if (activeCallRef.current && String(activeCallRef.current.call_id) === String(call.call_id)) return;
                const fallbackType = normalizeCallType(
                    activeCallRef.current?.preferred_call_type || incomingCallRef.current?.preferred_call_type || callModeRef.current,
                    callModeRef.current
                );
                const normalizedType = normalizeCallType(call.call_type, fallbackType);
                console.log('✅ Call accepted:', call.call_id);
                stopIncomingRingtone();
                setIncomingCall(null);
                setActiveCall({ ...call, call_type: normalizedType, preferred_call_type: normalizedType });
                setCallMode(normalizedType);
            }
        });

        socket.on('video_call_declined', (payload) => {
            const call = payload?.call || payload;
            if (!call) return;
            if (String(call.initiator_id) === String(currentUser.id) || String(call.receiver_id) === String(currentUser.id)) {
                console.log('📞 Call declined:', call.call_id);
                stopIncomingRingtone();
                setIncomingCall(null);
                setActiveCall(null);
            }
        });

        socket.on('video_call_ended', (payload) => {
            const call = payload?.call || payload;
            if (!call) return;
            if (String(call.initiator_id) === String(currentUser.id) || String(call.receiver_id) === String(currentUser.id)) {
                console.log('📞 Call ended:', call.call_id);
                stopIncomingRingtone();
                setIncomingCall(null);
                setActiveCall(null);
            }
        });

        socket.on('voice_call_incoming', (payload) => {
            const call = payload?.call || payload;
            console.log(`📞 [VOICE_CALL_INCOMING] Raw payload:`, JSON.stringify(payload, null, 2));
            callDebug('voice_call_incoming received', { rawPayload: payload, normalizedCall: call });

            if (!call) {
                console.warn('⚠️ [VOICE_CALL_INCOMING] Call object is null/undefined');
                return;
            }

            if (String(call.receiver_id) !== String(currentUser.id)) {
                console.log(`⚠️ [VOICE_CALL_INCOMING] Receiver mismatch. Expected ${currentUser.id}, got ${call.receiver_id}`);
                return;
            }

            if (voiceCallActiveRef.current || voiceCallStatusRef.current === 'connected' || voiceCallStatusRef.current === 'calling') {
                console.log('⚠️ [VOICE_CALL_INCOMING] User busy - already in call');
                socket.emit('voice_call_busy', {
                    to: call.initiator_id || call.from,
                    to_type: call.initiator_type || call.from_type,
                    from: currentUser.id,
                    from_type: currentUser.type,
                    from_name: currentUser.name || 'User',
                    call_type: call.call_type || 'voice'
                });
                return;
            }

            console.log(`✅ [VOICE_CALL_INCOMING] Incoming voice call from ${call.initiator_id || call.from}`);
            setIncomingVoiceCall({
                from: call.initiator_id || call.from,
                from_type: call.initiator_type || call.from_type,
                from_name: call.initiator_name || call.from_name || 'User',
                signal: call.signal,
                call_type: normalizeCallType(call.call_type, 'voice')
            });
            setVoiceCallStatus('ringing');
            voiceCallStatusRef.current = 'ringing';

            try {
                playIncomingRingTone();
            } catch (error) {
                console.warn('Failed to play voice call ringtone:', error);
            }
        });

        socket.on('voice_call_accepted', async (payload) => {
            const data = payload?.call || payload;
            if (!data || !voiceCallPeerRef.current || !data.signal) return;
            try {
                // Stop outgoing ringtone when accepted
                stopOutgoingRingtone();
                await voiceCallPeerRef.current.signal(data.signal);
                setVoiceCallStatus('connected');
                voiceCallStatusRef.current = 'connected';
                setVoiceCallActive(true);
        voiceCallActiveRef.current = true;
                startVoiceCallTimer();
            } catch (error) {
                console.error('Failed to apply voice call answer:', error);
            }
        });

        socket.on('voice_call_rejected', (payload) => {
            const data = payload?.call || payload;
            if (!data) return;
            if (String(data.to) !== String(currentUser.id) && String(data.from) !== String(currentUser.id)) return;
            window.alert(`${data.from_name || 'User'} declined your call`);
            stopOutgoingRingtone();
            endVoiceCall();
        });

        socket.on('voice_call_busy', (payload) => {
            const data = payload?.call || payload;
            if (!data) return;
            if (String(data.to) !== String(currentUser.id) && String(data.from) !== String(currentUser.id)) return;
            window.alert(`${data.from_name || 'User'} is on another call`);
            stopOutgoingRingtone();
            endVoiceCall();
        });

        socket.on('voice_call_ended', (payload) => {
            const data = payload?.call || payload;
            if (!data) return;
            if (String(data.to) !== String(currentUser.id) && String(data.from) !== String(currentUser.id)) return;
            stopOutgoingRingtone();
            endVoiceCall();
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
            socket.off('voice_call_incoming');
            socket.off('voice_call_accepted');
            socket.off('voice_call_rejected');
            socket.off('voice_call_busy');
            socket.off('voice_call_ended');
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.disconnect();
            socketRef.current = null;
        };
    }, [currentUser, stopIncomingRingtone]);

    useEffect(() => {
        if (!currentUser || !activeConversation || !socketRef.current?.connected) return;

        socketRef.current.emit('join_chat_room', {
            user_id: currentUser.id,
            other_user_id: activeConversation.other_user.id
        });
    }, [activeConversation, currentUser]);

    // Global polling for incoming calls - runs regardless of activeCall state
    useEffect(() => {
        if (!currentUser) return;

        console.log('🔄 Starting poll for pending calls for:', currentUser.id, currentUser.type);

        const pollPendingCalls = async () => {
            try {
                const url = `${API_BASE}/api/video-call/pending/${encodeURIComponent(currentUser.id)}/${encodeURIComponent(currentUser.type)}`;
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn('Poll failed:', response.status);
                    return;
                }

                const data = await response.json();
                if (!data.success || !Array.isArray(data.calls)) return;

                // Only pick up calls where we're the RECEIVER (incoming), not initiator
                // Also ignore calls that are too old (stale)
                const call = data.calls.find((item) =>
                    isLiveCallState(item) &&
                    String(item.receiver_id) === String(currentUser.id) &&
                    String(item.initiator_id) !== String(currentUser.id) &&
                    !isCallTooOld(item, 5)
                );

                if (!call) return;

                // Only set if it's a new call (different from current incomingCall)
                if (!incomingCallRef.current || String(incomingCallRef.current.call_id) !== String(call.call_id)) {
                    console.log('📞 Found pending incoming call:', call.call_id, 'from:', call.initiator_id, 'type:', call.call_type);
                    const normalizedType = normalizeCallType(call.call_type);
                    setIncomingCall({ ...call, call_type: normalizedType, preferred_call_type: normalizedType });
                }
            } catch (error) {
                console.error('Pending call polling failed:', error);
            }
        };

        pollPendingCalls();
        const timer = setInterval(pollPendingCalls, 2000);
        return () => {
            console.log('🔄 Stopping poll for pending calls');
            clearInterval(timer);
        };
    }, [currentUser?.id]);

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

    // Compute filtered conversations based on search query
    const filteredConversations = useMemo(() => {
        if (!searchQuery.trim()) {
            return conversations;
        }
        const query = searchQuery.toLowerCase();
        return conversations.filter((conv) => {
            const name = (conv.other_user_name || conv.other_user?.name || '').toLowerCase();
            const type = (conv.other_user?.type || '').toLowerCase();
            return name.includes(query) || type.includes(query);
        });
    }, [conversations, searchQuery]);

    // Voice call UI overlay component intentionally disabled for now.
    const VoiceCallOverlay = () => null;

    return (
        <>
            {incomingCall && !activeCall && (
                <div className="chat-call-overlay">
                    <div className="chat-call-card">
                        <div className="chat-call-title">Incoming {normalizeCallType(incomingCall.call_type, callMode)} call</div>
                        <div className="chat-call-subtitle">User {incomingCall.initiator_id} is calling you</div>
                        <div className="chat-call-actions">
                            <button type="button" className="chat-call-btn accept" onClick={acceptIncomingCall}>Accept</button>
                            <button type="button" className="chat-call-btn decline" onClick={declineIncomingCall}>Decline</button>
                        </div>
                    </div>
                </div>
            )}

            {incomingVoiceCall && !voiceCallActive && (
                <div className="chat-call-overlay">
                    <div className="chat-call-card">
                        <div className="chat-call-title">Incoming voice call</div>
                        <div className="chat-call-subtitle">{incomingVoiceCall.from_name || incomingVoiceCall.from} is calling</div>
                        <div className="chat-call-actions">
                            <button type="button" className="chat-call-btn accept" onClick={acceptVoiceCall}>Accept</button>
                            <button type="button" className="chat-call-btn decline" onClick={rejectVoiceCall}>Decline</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden audio element to play remote voice stream */}
            <audio ref={audioElRef} style={{ display: 'none' }} autoPlay playsInline />

            {/* Outgoing (caller) ringing UI */}
            {voiceCallActive && (voiceCallStatus === 'calling' || voiceCallStatus === 'ringing') && (
                <div className="chat-call-overlay">
                    <div className="chat-call-card">
                        <div className="chat-call-title">Calling {getConversationName(activeConversation) || 'User'}</div>
                        <div className="chat-call-subtitle">Ringing...</div>
                        <div className="chat-call-actions">
                            <button type="button" className="chat-call-btn decline" onClick={endVoiceCall} title="End call"><FaPhoneSlash /></button>
                            <button type="button" className="chat-call-btn accept" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>{isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Active voice call UI for caller/callee */}
            {voiceCallActive && voiceCallStatus === 'connected' && (
                <div className="chat-call-overlay chat-call-room-overlay">
                    <div className="chat-call-room-shell">
                        <div className="voice-call-panel">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ fontWeight: 700 }}>{getConversationName(activeConversation) || 'User'}</div>
                                {callStartTime && <div style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}><FaClock /> {formatPKTTime(new Date(callStartTime).toISOString())}</div>}
                            </div>
                            <div style={{ marginBottom: '8px' }}>Duration: {formatVoiceCallDuration(voiceCallDuration)}</div>
                            <div className="chat-call-actions">
                                <button type="button" className="chat-call-btn decline" onClick={endVoiceCall} title="End call"><FaPhoneSlash /></button>
                                <button type="button" className="chat-call-btn accept" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>{isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {lastCallDurationDisplay && (
                <div className="chat-call-overlay" style={{ top: 'auto', bottom: 20 }}>
                    <div className="chat-call-card" style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 700 }}>Call ended</div>
                        <div style={{ fontSize: '0.95rem', color: '#334155' }}>Duration: {lastCallDurationDisplay}</div>
                    </div>
                </div>
            )}

            {activeCall && (
                <div className="chat-call-overlay chat-call-room-overlay">
                    <div className="chat-call-room-shell">
                        <CallErrorBoundary onEnd={endActiveCall}>
                            <PrivateCall
                                currentUser={currentUser}
                                call={{
                                    ...activeCall,
                                    call_type: normalizeCallType(activeCall?.preferred_call_type || activeCall?.call_type, callModeRef.current),
                                    preferred_call_type: normalizeCallType(activeCall?.preferred_call_type || activeCall?.call_type, callModeRef.current)
                                }}
                                onEnd={endActiveCall}
                            />
                        </CallErrorBoundary>
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
                                        <button
                                            className="chat-header-action-btn"
                                            type="button"
                                            title="Start direct voice call"
                                            onClick={startVoiceCall}
                                            disabled={voiceCallActive}
                                        >
                                            <FaPhone />
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
};

export default React.memo(ChatPage);
