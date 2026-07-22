import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Peer from 'simple-peer';
import { io } from 'socket.io-client';
import { FaPhone, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash, FaClock, FaVideo, FaVideoSlash, FaPaperclip, FaFile, FaFilePdf, FaFileImage, FaDownload, FaExternalLinkAlt, FaTrash, FaTimes } from 'react-icons/fa';
import './chat.css';
import classMateLogo from './assets/Logo2.png';
import { formatPKTDate, formatPKTTime, getPKTDateKey } from './utils/dateUtils.js';
import { formatChatTime, getConversationAvatar, getConversationName } from './utils/chatUtils.js';
import { CallErrorBoundary } from './CallErrorBoundary.jsx';
import PrivateCall from './PrivateCall.jsx';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const SFU_BASE = import.meta.env.VITE_SFU_URL || 'http://localhost:4001';
const callDebug = (...args) => console.log('[CALL_DEBUG][CHAT]', ...args);
const MESSAGE_POLL_MS = 3000;
const UNREAD_POLL_MS = 10000;
const PAGE_SIZE = 20;
const EMOJIS = [':)', ':D', '<3', ':P', ';)', ':O'];

const formatFileSize = (size) => {
    const bytes = Number(size || 0);
    if (!bytes) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** unitIndex);
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const getAttachmentUrl = (downloadUrl, inline = false) => {
    if (!downloadUrl) return '#';
    const suffix = inline ? (downloadUrl.includes('?') ? '&inline=1' : '?inline=1') : '';
    return `${API_BASE}${downloadUrl}${suffix}`;
};

const getAttachmentIcon = (file = {}) => {
    const mime = String(file.mime || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    if (mime.includes('pdf') || type === 'pdf') return FaFilePdf;
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(type)) return FaFileImage;
    return FaFile;
};

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
    const file = message.file || (message.has_file ? {
        name: message.file_name || message.fileName || '',
        size: message.file_size || message.fileSize || 0,
        type: message.file_type || message.fileType || '',
        mime: message.file_mime || message.fileMime || '',
        download_url: message.download_url || message.file_download_url || ''
    } : null);

    return {
        id: String(message.id),
        sender_id: senderId,
        receiver_id: String(message.receiver_id || message.receiver?.id || ''),
        text,
        timestamp,
        status: message.status || 'sent',
        is_read: Boolean(message.is_read),
        read_at: message.read_at || null,
        is_from_me: senderId === String(currentUserId),
        has_file: Boolean(message.has_file || file),
        file
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

const MessageList = React.memo(function MessageList({ messages, currentUserId, onDeleteAttachment }) {
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
                    {message.text && <p>{message.text}</p>}
                    {message.file && (
                        <div className="message-file-card">
                            <div className="message-file-main">
                                <div className="message-file-icon">
                                    {React.createElement(getAttachmentIcon(message.file))}
                                </div>
                                <div className="message-file-details">
                                    <span className="message-file-name">{message.file.name || 'Attachment'}</span>
                                    <span className="message-file-meta">
                                        {formatFileSize(message.file.size)}{message.file.type ? ` • ${String(message.file.type).toUpperCase()}` : ''}
                                    </span>
                                </div>
                            </div>
                            <div className="message-file-actions">
                                <a
                                    href={getAttachmentUrl(message.file.download_url, true)}
                                    className="message-file-action"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <FaExternalLinkAlt />
                                    <span>Open</span>
                                </a>
                                <a
                                    href={getAttachmentUrl(message.file.download_url, false)}
                                    className="message-file-action"
                                    download
                                >
                                    <FaDownload />
                                    <span>Save</span>
                                </a>
                                <button
                                    type="button"
                                    className="message-file-action danger"
                                    onClick={() => onDeleteAttachment?.(message)}
                                    title="Delete file for me"
                                >
                                    <FaTrash />
                                    <span>Delete</span>
                                </button>
                            </div>
                        </div>
                    )}
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
    const [attachedFile, setAttachedFile] = useState(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [isTyping, setIsTyping] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // State: User & Authentication
    const [currentUser, setCurrentUser] = useState(null);

    // State: Calls (unified P2P)
    const [callMode, setCallMode] = useState('video');
    const [callActive, setCallActive] = useState(false);
    const [callStatus, setCallStatus] = useState('idle');
    const [incomingCall, setIncomingCall] = useState(null);
    const [callStream, setCallStream] = useState(null);
    const [callPeer, setCallPeer] = useState(null);
    const [callRemoteStream, setCallRemoteStream] = useState(null);
    const [callDuration, setCallDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoMuted, setIsVideoMuted] = useState(false);
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
    const fileInputRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const sfuSocketRef = useRef(null);
    // Stable function refs — always point to the latest version, avoiding stale closures in socket handlers
    const currentUserRef = useRef(null);
    const handleIncomingSocketMessageRef = useRef(null);
    const pollNewMessagesRef = useRef(null);
    const endCallRef = useRef(null);
    const startCallTimerRef = useRef(null);

    // Refs: Calls
    const incomingCallRef = useRef(null);
    const callModeRef = useRef('video');
    const callActiveRef = useRef(false);
    const callStatusRef = useRef('idle');
    const callPeerRef = useRef(null);
    const callTimeoutRef = useRef(null);
    const callTimerRef = useRef(null);
    const audioElRef = useRef(null);
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const outgoingRingIntervalRef = useRef(null);
    const outgoingRingCountRef = useRef(0);

    // Refs: Ringtone
    const incomingRingTimerRef = useRef(null);
    const incomingRingCountRef = useRef(0);

    // Dual-tone telephone ring (DTMF-style: 440Hz + 480Hz like a real phone)
    const playIncomingRingTone = useCallback(async () => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const duration = 2.0; // ring for 2 seconds

            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc1.frequency.value = 440;
            osc2.frequency.value = 480;
            osc1.type = 'sine';
            osc2.type = 'sine';

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);

            // Shape the ring: fade in, hold, fade out
            gain.gain.setValueAtTime(0, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime + duration - 0.1);
            gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);

            osc1.start(audioCtx.currentTime);
            osc2.start(audioCtx.currentTime);
            osc1.stop(audioCtx.currentTime + duration);
            osc2.stop(audioCtx.currentTime + duration);

            osc2.addEventListener('ended', () => { try { audioCtx.close(); } catch(e){} });
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

    // Outgoing ring: classic double-ring pattern (ring, pause, ring, pause)
    const startOutgoingRingtone = useCallback(() => {
        try {
            if (outgoingRingIntervalRef.current) return;
            outgoingRingCountRef.current = 0;

            const playRingBurst = (offset) => {
                try {
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const osc1 = audioCtx.createOscillator();
                    const osc2 = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc1.frequency.value = 440;
                    osc2.frequency.value = 480;
                    osc1.type = 'sine';
                    osc2.type = 'sine';
                    osc1.connect(gain);
                    osc2.connect(gain);
                    gain.connect(audioCtx.destination);
                    gain.gain.setValueAtTime(0.25, audioCtx.currentTime + offset);
                    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + offset + 0.4);
                    osc1.start(audioCtx.currentTime + offset);
                    osc2.start(audioCtx.currentTime + offset);
                    osc1.stop(audioCtx.currentTime + offset + 0.4);
                    osc2.stop(audioCtx.currentTime + offset + 0.4);
                    osc2.addEventListener('ended', () => { try { audioCtx.close(); } catch(e){} });
                } catch(e){}
            };

            // Play double-ring immediately then every 3 seconds
            const doRing = () => {
                playRingBurst(0);
                playRingBurst(0.5);
                outgoingRingCountRef.current += 1;
            };

            doRing();
            outgoingRingIntervalRef.current = setInterval(doRing, 3000);
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

    // Keep a ref copy of incomingCall for handlers that need stable access
    useEffect(() => {
        incomingCallRef.current = incomingCall;
    }, [incomingCall]);

    // When streams arrive, attach them to the appropriate elements
    useEffect(() => {
        if (callMode === 'voice') {
            const audioEl = audioElRef.current;
            if (audioEl && callRemoteStream) {
                audioEl.srcObject = callRemoteStream;
                audioEl.play().catch(e => console.warn('Autoplay prevented:', e));
            } else if (audioEl) {
                audioEl.pause();
                audioEl.srcObject = null;
            }
        } else {
            const remoteVideo = remoteVideoRef.current;
            const localVideo = localVideoRef.current;
            
            if (remoteVideo && callRemoteStream) {
                remoteVideo.srcObject = callRemoteStream;
                remoteVideo.play().catch(e => console.warn('Autoplay prevented:', e));
            } else if (remoteVideo) {
                remoteVideo.pause();
                remoteVideo.srcObject = null;
            }

            if (localVideo && callStream) {
                localVideo.srcObject = callStream;
                localVideo.play().catch(e => console.warn('Autoplay prevented:', e));
            } else if (localVideo) {
                localVideo.pause();
                localVideo.srcObject = null;
            }
        }
    }, [callRemoteStream, callStream, callMode]);

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

        const cu = currentUserRef.current;
        if (!cu) return;

        const senderId = String(message.sender_id || '');
        const receiverId = String(message.receiver_id || '');
        const currentUserId = String(cu.id || '');
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
    // Keep ref up-to-date so socket handler always uses latest
    handleIncomingSocketMessageRef.current = handleIncomingSocketMessage;

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

                setOffset((prev) => prev + ordered.length);

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
        const cu = currentUserRef.current;
        if (!activeConversationRef.current || !cu) return;

        try {
            const conversation = activeConversationRef.current;
            const params = new URLSearchParams({
                user1_id: cu.id,
                user1_type: cu.type,
                user2_id: conversation.other_user.id,
                user2_type: conversation.other_user.type,
                limit: '5',
                offset: '0'
            });

            const response = await fetch(`${API_BASE}/api/chat/messages?${params}`);
            if (!response.ok) return;

            const data = await response.json();
            if (!data.success || !data.messages) return;

            const newMessages = data.messages
                .slice()
                .reverse()
                .map((m) => normalizeMessage(m, cu.id));

            const existingIds = new Set(messagesRefState.current.map((m) => String(m.id)));
            const actuallyNewMessages = newMessages.filter((m) => !existingIds.has(String(m.id)));

            if (actuallyNewMessages.length > 0) {
                console.log('📨 Polling found new messages:', actuallyNewMessages);
                actuallyNewMessages.forEach((msg) => handleIncomingSocketMessageRef.current?.(msg));
            }
        } catch (error) {
            console.error('Polling for new messages failed:', error);
        }
    };
    // Keep ref up-to-date
    pollNewMessagesRef.current = pollNewMessages;

    const sendMessageOptimistic = async () => {
        if (!currentUser || !activeConversation || sendingMessage) return;

        const text = messageInput.trim();
        if (!text && !attachedFile) return;

        const tempId = `temp-${Date.now()}`;

        if (attachedFile) {
            setSendingMessage(true);
            setMessageInput('');
            setShowEmojiPicker(false);

            try {
                const formData = new FormData();
                formData.append('file', attachedFile);
                formData.append('sender_id', currentUser.id);
                formData.append('sender_type', currentUser.type);
                formData.append('receiver_id', String(activeConversation.other_user.id));
                formData.append('receiver_type', activeConversation.other_user.type);
                if (text) {
                    formData.append('message_text', text);
                }

                const response = await fetch(`${API_BASE}/api/chat/upload-file`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || 'File upload failed');
                }

                if (data.message_payload) {
                    const normalized = normalizeMessage(data.message_payload, currentUser.id);
                    setMessages((prev) => [...prev, normalized]);
                    setOffset((prev) => prev + 1);
                    setTimeout(() => scrollToBottom('smooth'), 30);
                } else {
                    setTimeout(() => pollNewMessages(), 300);
                }

                clearAttachment();
                scheduleBackgroundConversationsSync(300);
            } catch (error) {
                console.error('Send attachment failed:', error);
                window.alert(error.message || 'Failed to send attachment');
            } finally {
                setSendingMessage(false);
                inputRef.current?.focus();
            }

            return;
        }

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

    const deleteAttachmentForMe = async (message) => {
        if (!currentUser || !message?.file) return;

        const confirmed = window.confirm(`Delete ${message.file.name || 'this attachment'} from your chat view?`);
        if (!confirmed) return;

        try {
            const response = await fetch(`${API_BASE}/api/chat/messages/${message.id}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to delete attachment');
            }

            setMessages((prev) => prev.filter((item) => String(item.id) !== String(message.id)));
            scheduleBackgroundConversationsSync(300);
        } catch (error) {
            console.error('Failed to delete attachment:', error);
            window.alert(error.message || 'Failed to delete attachment');
        }
    };

    const handleAttachmentChange = (event) => {
        const file = event.target.files?.[0];
        if (file) {
            setAttachedFile(file);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleAttachmentButtonClick = () => {
        fileInputRef.current?.click();
    };

    const clearAttachment = () => {
        setAttachedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
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

    const startCall = async (mode) => {
        if (!currentUser || !activeConversation) return;

        const targetUserId = activeConversation.other_user.id;
        const targetUserType = activeConversation.other_user.type;
        const sfuSocket = socketRef.current;
        const callType = normalizeCallType(mode);

        setCallMode(callType);
        callModeRef.current = callType;

        if (!sfuSocket || !sfuSocket.connected) {
            window.alert('Chat server not connected. Please try again.');
            return;
        }

        if (callActiveRef.current || callStatusRef.current === 'calling' || callStatusRef.current === 'ringing') {
            window.alert('A call is already in progress.');
            return;
        }

        setCallStatus('calling');
        callStatusRef.current = 'calling';
        setCallActive(true);
        callActiveRef.current = true;
        setIncomingCall(null);

        startOutgoingRingtone();

        try {
            const constraints = callType === 'video' ? { video: true, audio: true } : { audio: true };
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                alert(`Could not access media devices. Please check permissions.`);
                endCall();
                return;
            }

            setCallStream(stream);

            const peer = new Peer({
                initiator: true,
                trickle: false,
                stream
            });
            callPeerRef.current = peer;
            setCallPeer(peer);

            peer.on('stream', (remoteStream) => {
                setCallRemoteStream(remoteStream);
                setCallStatus('connected');
                callStatusRef.current = 'connected';
                startCallTimer();
            });

            peer.on('error', (err) => {
                console.error('Call peer error:', err);
                endCall();
            });

            peer.on('close', () => {
                if (callStatusRef.current !== 'idle') {
                    endCall();
                }
            });

            peer.on('signal', (signal) => {
                sfuSocket.emit('voice_call_request', {
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
                    call_type: callType,
                    timestamp: Date.now()
                });
            });

            callTimeoutRef.current = setTimeout(() => {
                if (callStatusRef.current === 'calling' || callStatusRef.current === 'ringing') {
                    endCall();
                    alert('Call not answered. Please try again.');
                }
            }, 30000);
        } catch (err) {
            console.error('Failed to start call:', err);
            endCall();
        }
    };

    const acceptCall = async () => {
        if (!incomingCall) return;
        const sfuSocket = socketRef.current;

        if (!sfuSocket) {
            window.alert('Chat server is still connecting. Please try again in a moment.');
            return;
        }

        try {
            stopIncomingRingtone();
            setCallStatus('ringing');
            callStatusRef.current = 'ringing';

            const callType = incomingCall.call_type || 'video';
            const constraints = callType === 'video' ? { video: true, audio: true } : { audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            setCallStream(stream);

            const peer = new Peer({
                initiator: false,
                trickle: false,
                stream
            });
            callPeerRef.current = peer;
            setCallPeer(peer);

            peer.on('signal', (signal) => {
                sfuSocket.emit('voice_call_answer', {
                    signal,
                    to: incomingCall.from,
                    to_type: incomingCall.from_type,
                    from: currentUser.id,
                    from_type: currentUser.type,
                    from_name: currentUser.name || 'User',
                    call_type: callType
                });
            });

            peer.on('stream', (remoteStream) => {
                setCallRemoteStream(remoteStream);
                setCallStatus('connected');
                callStatusRef.current = 'connected';
                startCallTimer();
            });

            peer.on('error', (err) => {
                console.error('Call peer error:', err);
                endCall();
            });

            peer.on('close', () => {
                if (callStatusRef.current !== 'idle') {
                    endCall();
                }
            });

            peer.signal(incomingCall.signal);

            setCallActive(true);
            callActiveRef.current = true;
            setIncomingCall(null);
        } catch (err) {
            console.error('Failed to accept call:', err);
            alert('Could not access media devices. Please check permissions.');
            endCall();
        }
    };

    const rejectCall = () => {
        if (incomingCall) {
            stopIncomingRingtone();
            socketRef.current?.emit('voice_call_reject', {
                to: incomingCall.from,
                to_type: incomingCall.from_type,
                from: currentUser.id,
                from_type: currentUser.type,
                from_name: currentUser.name || 'User',
                call_type: incomingCall.call_type || 'video'
            });
            setIncomingCall(null);
        }
    };

    const endCall = () => {
        stopIncomingRingtone();
        stopOutgoingRingtone();

        if (callTimeoutRef.current) {
            clearTimeout(callTimeoutRef.current);
            callTimeoutRef.current = null;
        }

        if (callTimerRef.current) {
            clearInterval(callTimerRef.current);
            callTimerRef.current = null;
        }

        const wasConnected = callStatusRef.current === 'connected';

        if (callPeerRef.current) {
            callPeerRef.current.destroy();
            callPeerRef.current = null;
        }

        if (callStream) {
            callStream.getTracks().forEach(track => track.stop());
            setCallStream(null);
        }

        if (wasConnected) {
            const finalDuration = callDuration || 0;
            setLastCallDurationDisplay(formatCallDuration(finalDuration));
            setTimeout(() => setLastCallDurationDisplay(null), 6000);
        }

        setCallRemoteStream(null);
        setCallActive(false);
        callActiveRef.current = false;
        setCallStatus('idle');
        callStatusRef.current = 'idle';
        setCallPeer(null);
        setCallDuration(0);
        setCallStartTime(null);
        setIsMuted(false);
        setIsVideoMuted(false);
        setIncomingCall(null);

        if (wasConnected) {
            const cu = currentUserRef.current;
            socketRef.current?.emit('voice_call_end', {
                to: activeConversation?.other_user.id,
                to_type: activeConversation?.other_user.type,
                from: cu?.id,
                from_type: cu?.type,
                call_type: callModeRef.current
            });
        }
    };
    // Keep ref up-to-date so socket handlers can call endCall without stale closure
    endCallRef.current = endCall;

    const toggleMute = () => {
        if (callStream) {
            const audioTrack = callStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    };

    const toggleVideoMute = () => {
        if (callStream) {
            const videoTrack = callStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setIsVideoMuted(!videoTrack.enabled);
            }
        }
    };

    const startCallTimer = () => {
        let seconds = 0;
        setCallStartTime(Date.now());
        setCallDuration(0);
        callTimerRef.current = setInterval(() => {
            seconds++;
            setCallDuration(seconds);
        }, 1000);
    };
    // Keep ref up-to-date
    startCallTimerRef.current = startCallTimer;

    const formatCallDuration = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        if (!incomingCall || callActiveRef.current) {
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
                rejectCall();
            }
        }, 2800);

        return () => {
            stopIncomingRingtone();
        };
    }, [incomingCall?.signal, playIncomingRingTone, stopIncomingRingtone]);

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

    // Keep currentUserRef always up-to-date
    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);

    useEffect(() => {
        activeConversationRef.current = activeConversation;
    }, [activeConversation]);

    useEffect(() => {
        messagesRefState.current = messages;
    }, [messages]);

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
        clearAttachment();
        setMessageInput('');
        setShowEmojiPicker(false);
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


        // Wrap message handlers to always use latest version via ref
        const wrappedChatMessageSaved = (payload) => { if (handleIncomingSocketMessageRef.current) handleIncomingSocketMessageRef.current(payload); };
        const wrappedChatMessage = (payload) => { if (handleIncomingSocketMessageRef.current) handleIncomingSocketMessageRef.current(payload); };
        const wrappedNewMessage = (payload) => { if (handleIncomingSocketMessageRef.current) handleIncomingSocketMessageRef.current(payload); };

        socket.on('chat_message_saved', wrappedChatMessageSaved);
        socket.on('chat_message', wrappedChatMessage);
        socket.on('new_message', wrappedNewMessage);

        // ── Call signaling listeners (Flask handles voice_call_* on same socket) ──
        const handleIncomingCallRequest = (payload) => {
            const cu = currentUserRef.current;
            if (!cu) return;
            const call = payload?.call || payload;
            if (!call || String(call.receiver_id || call.to) !== String(cu.id)) return;
            if (callActiveRef.current || callStatusRef.current !== 'idle') {
                socket.emit('voice_call_busy', {
                    to: call.initiator_id || call.from,
                    to_type: call.initiator_type || call.from_type,
                    from: cu.id,
                    from_type: cu.type,
                    from_name: cu.name || 'User',
                    call_type: call.call_type
                });
                return;
            }
            const callType = normalizeCallType(call.call_type);
            setIncomingCall({
                from: call.initiator_id || call.from,
                from_type: call.initiator_type || call.from_type,
                from_name: call.initiator_name || call.from_name || 'User',
                signal: call.signal,
                call_type: callType
            });
            setCallMode(callType);
            callModeRef.current = callType;
            setCallStatus('ringing');
            callStatusRef.current = 'ringing';
            try { playIncomingRingTone(); } catch (e) {}
        };

        const handleCallAccepted = async (payload) => {
            const data = payload?.call || payload;
            if (!data || !callPeerRef.current || !data.signal) return;
            try {
                stopOutgoingRingtone();
                await callPeerRef.current.signal(data.signal);
                setCallStatus('connected');
                callStatusRef.current = 'connected';
                setCallActive(true);
                callActiveRef.current = true;
                if (startCallTimerRef.current) startCallTimerRef.current();
            } catch (error) {
                console.error('Failed to apply call answer:', error);
            }
        };

        const handleCallRejected = (payload) => {
            const cu = currentUserRef.current;
            const data = payload?.call || payload;
            if (!data || !cu) return;
            if (String(data.to) !== String(cu.id) && String(data.from) !== String(cu.id)) return;
            window.alert(`${data.from_name || 'User'} declined your call`);
            stopOutgoingRingtone();
            if (endCallRef.current) endCallRef.current();
        };

        const handleCallBusy = (payload) => {
            const cu = currentUserRef.current;
            const data = payload?.call || payload;
            if (!data || !cu) return;
            if (String(data.to) !== String(cu.id) && String(data.from) !== String(cu.id)) return;
            window.alert(`${data.from_name || 'User'} is on another call`);
            stopOutgoingRingtone();
            if (endCallRef.current) endCallRef.current();
        };

        const handleCallEnded = (payload) => {
            const cu = currentUserRef.current;
            const data = payload?.call || payload;
            if (!data || !cu) return;
            if (String(data.to) !== String(cu.id) && String(data.from) !== String(cu.id)) return;
            stopOutgoingRingtone();
            if (endCallRef.current) endCallRef.current();
        };

        socket.on('voice_call_incoming', handleIncomingCallRequest);
        socket.on('voice_call_accepted', handleCallAccepted);
        socket.on('voice_call_rejected', handleCallRejected);
        socket.on('voice_call_busy', handleCallBusy);
        socket.on('voice_call_ended', handleCallEnded);

        return () => {
            socket.off('chat_message_saved', wrappedChatMessageSaved);
            socket.off('chat_message', wrappedChatMessage);
            socket.off('new_message', wrappedNewMessage);
            socket.off('conversation_updated');
            socket.off('messages_read');
            socket.off('voice_call_incoming', handleIncomingCallRequest);
            socket.off('voice_call_accepted', handleCallAccepted);
            socket.off('voice_call_rejected', handleCallRejected);
            socket.off('voice_call_busy', handleCallBusy);
            socket.off('voice_call_ended', handleCallEnded);
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.disconnect();
            socketRef.current = null;
        };
    }, [currentUser, playIncomingRingTone, stopOutgoingRingtone]);



    useEffect(() => {
        if (!currentUser || !activeConversation || !socketRef.current?.connected) return;

        socketRef.current.emit('join_chat_room', {
            user_id: currentUser.id,
            other_user_id: activeConversation.other_user.id
        });
    }, [activeConversation, currentUser]);


    // Polling fallback for real-time message delivery
    useEffect(() => {
        if (!activeConversation) return;

        // Poll every 2.5 seconds as a fallback
        const pollInterval = setInterval(() => {
            if (pollNewMessagesRef.current) pollNewMessagesRef.current();
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
            {/* ── INCOMING CALL OVERLAY ── */}
            {incomingCall && !callActive && (
                <div className="cm-call-overlay">
                    <div className="cm-call-modal incoming">
                        <div className="cm-call-pulse-ring" />
                        <div className="cm-call-avatar">
                            {(incomingCall.from_name || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="cm-call-caller-name">{incomingCall.from_name || incomingCall.from}</div>
                        <div className="cm-call-status-label">
                            <span className="cm-call-type-badge">{incomingCall.call_type === 'video' ? 'Video' : 'Voice'} Call</span>
                            <span className="cm-call-ring-dots">Incoming<span className="dots">...</span></span>
                        </div>
                        <div className="cm-call-actions">
                            <button className="cm-call-btn cm-call-reject" onClick={rejectCall} title="Decline">
                                <FaPhoneSlash />
                                <span>Decline</span>
                            </button>
                            <button className="cm-call-btn cm-call-accept" onClick={acceptCall} title="Accept">
                                <FaPhone />
                                <span>Accept</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden audio for remote voice stream */}
            <audio ref={audioElRef} style={{ display: 'none' }} autoPlay playsInline />

            {/* ── OUTGOING / RINGING OVERLAY ── */}
            {callActive && (callStatus === 'calling' || callStatus === 'ringing') && (
                <div className="cm-call-overlay">
                    <div className="cm-call-modal outgoing">
                        <div className="cm-call-pulse-ring" />
                        <div className="cm-call-avatar">
                            {(getConversationName(activeConversation) || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="cm-call-caller-name">{getConversationName(activeConversation) || 'User'}</div>
                        <div className="cm-call-status-label">
                            <span className="cm-call-type-badge">{callMode === 'video' ? 'Video' : 'Voice'} Call</span>
                            <span className="cm-call-ring-dots">Ringing<span className="dots">...</span></span>
                        </div>
                        <div className="cm-call-actions">
                            <button className="cm-call-btn cm-call-reject" onClick={endCall} title="Cancel">
                                <FaPhoneSlash />
                                <span>Cancel</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── ACTIVE CALL OVERLAY ── */}
            {callActive && callStatus === 'connected' && (
                <div className="cm-call-overlay cm-call-active-overlay">
                    {callMode === 'video' ? (
                        /* VIDEO CALL */
                        <div className="cm-video-shell">
                            <div className="cm-video-remote-wrap">
                                <video ref={remoteVideoRef} className="cm-video-remote" autoPlay playsInline />
                                <div className="cm-video-local-pip">
                                    <video ref={localVideoRef} className="cm-video-local" autoPlay playsInline muted />
                                </div>
                                <div className="cm-video-top-bar">
                                    <span className="cm-active-name">{getConversationName(activeConversation) || 'User'}</span>
                                    <span className="cm-active-timer">{formatCallDuration(callDuration)}</span>
                                </div>
                            </div>
                            <div className="cm-call-controls">
                                <button className={`cm-ctrl-btn ${isMuted ? 'cm-ctrl-off' : ''}`} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
                                    {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                                </button>
                                <button className={`cm-ctrl-btn ${isVideoMuted ? 'cm-ctrl-off' : ''}`} onClick={toggleVideoMute} title={isVideoMuted ? 'Turn on camera' : 'Turn off camera'}>
                                    {isVideoMuted ? <FaVideoSlash /> : <FaVideo />}
                                </button>
                                <button className="cm-ctrl-btn cm-ctrl-end" onClick={endCall} title="End call">
                                    <FaPhoneSlash />
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* VOICE CALL */
                        <div className="cm-call-modal voice-active">
                            <div className="cm-call-avatar active">
                                {(getConversationName(activeConversation) || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div className="cm-call-caller-name">{getConversationName(activeConversation) || 'User'}</div>
                            <div className="cm-active-timer">{formatCallDuration(callDuration)}</div>
                            <div className="cm-call-controls inline">
                                <button className={`cm-ctrl-btn ${isMuted ? 'cm-ctrl-off' : ''}`} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
                                    {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                                </button>
                                <button className="cm-ctrl-btn cm-ctrl-end" onClick={endCall} title="End call">
                                    <FaPhoneSlash />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── CALL ENDED TOAST ── */}
            {lastCallDurationDisplay && (
                <div className="cm-call-ended-toast">
                    <FaPhoneSlash className="cm-toast-icon" />
                    <div className="cm-toast-text">
                        <span className="cm-toast-title">Call ended</span>
                        <span className="cm-toast-sub">{lastCallDurationDisplay}</span>
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
                                            onClick={() => startCall('voice')}
                                            disabled={callActive}
                                        >
                                            <FaPhone />
                                        </button>
                                        <button className="chat-header-action-btn" type="button" title="Start video call" onClick={() => startCall('video')}>
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
                                            <MessageList messages={messages} currentUserId={currentUser?.id} onDeleteAttachment={deleteAttachmentForMe} />
                                            {messages.length === 0 && <div className="no-messages">No messages yet.</div>}
                                        </>
                                    )}
                                </div>

                                <div className="message-input-container">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        className="chat-file-input"
                                        onChange={handleAttachmentChange}
                                    />

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

                                    {attachedFile && (
                                        <div className="attached-file-preview">
                                            <div className="attached-file-info">
                                                <FaPaperclip />
                                                <div>
                                                    <strong>{attachedFile.name}</strong>
                                                    <span>{formatFileSize(attachedFile.size)}</span>
                                                </div>
                                            </div>
                                            <button type="button" className="attached-file-remove" onClick={clearAttachment} aria-label="Remove attachment">
                                                <FaTimes />
                                            </button>
                                        </div>
                                    )}

                                    <div className="message-input-wrapper">
                                        <textarea
                                            ref={inputRef}
                                            className="message-input"
                                            rows={1}
                                            placeholder={attachedFile ? 'Add a caption (optional)' : 'Type a message'}
                                            value={messageInput}
                                            onChange={handleInputChange}
                                            onKeyDown={handleInputKeyDown}
                                        />

                                        <div className="message-input-actions">
                                            <button
                                                className="message-attachment-btn"
                                                type="button"
                                                onClick={handleAttachmentButtonClick}
                                                title="Attach file"
                                            >
                                                <FaPaperclip />
                                            </button>
                                            <button
                                                className="message-attachment-btn"
                                                type="button"
                                                onClick={() => setShowEmojiPicker((prev) => !prev)}
                                                title="Emoji picker"
                                            >
                                                <span aria-hidden="true">☺</span>
                                            </button>
                                            <button
                                                className="message-send-btn"
                                                type="button"
                                                disabled={sendingMessage || (!messageInput.trim() && !attachedFile)}
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
