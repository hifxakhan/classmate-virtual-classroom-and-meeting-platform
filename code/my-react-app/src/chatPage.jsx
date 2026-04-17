import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './chat.css';
import classMateLogo from './assets/Logo2.png';
import { formatPKTTime } from './utils/dateUtils';
import { formatChatTime, getConversationAvatar, getConversationName } from './utils/chatUtils';

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
        text,
        timestamp,
        is_from_me: senderId === String(currentUserId)
    };
};

const MessageList = React.memo(function MessageList({ messages, currentUserId }) {
    return (
        <div className="messages-container">
            {messages.map((message) => (
                <div
                    key={message.id}
                    className={`message-bubble ${String(message.sender_id) === String(currentUserId) ? 'sent' : 'received'}`}
                >
                    <div className="message-content">
                        <p>{message.text}</p>
                        <span className="message-time">{message.timestamp ? formatPKTTime(message.timestamp) : 'Now'}</span>
                    </div>
                </div>
            ))}
        </div>
    );
});

const ConversationItem = React.memo(function ConversationItem({ conversation, isSelected, onSelect, onDelete }) {
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
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {conversation.unread_count > 0 && <span className="unread-badge">{conversation.unread_count}</span>}
                        <button
                            className="chat-action-btn"
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDelete(conversation);
                            }}
                            title="Delete conversation"
                        >
                            x
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

const ConversationList = React.memo(function ConversationList({ conversations, selectedId, onSelectConversation, onDeleteConversation }) {
    return (
        <>
            {conversations.map((conversation) => (
                <ConversationItem
                    key={conversation.conversation_id || conversation.other_user?.id}
                    conversation={conversation}
                    isSelected={selectedId === (conversation.conversation_id || conversation.other_user?.id)}
                    onSelect={onSelectConversation}
                    onDelete={onDeleteConversation}
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

    const typingTimeoutRef = useRef(null);
    const messagesRef = useRef(null);
    const inputRef = useRef(null);
    const pollingRef = useRef(null);
    const unreadPollingRef = useRef(null);
    const isPageVisibleRef = useRef(true);

    const activeConversationRef = useRef(null);
    const messagesRefState = useRef([]);

    useEffect(() => {
        activeConversationRef.current = activeConversation;
    }, [activeConversation]);

    useEffect(() => {
        messagesRefState.current = messages;
    }, [messages]);

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
                        const nextId = matched.conversation_id || matched.other_user?.id;
                        if (String(prevId) === String(nextId) && (prev?.last_message?.timestamp || '') === (matched.last_message?.timestamp || '')) {
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
            await fetch(
                `${API_BASE}/api/chat/conversations/${conversation.other_user.id}/read?user_id=${encodeURIComponent(currentUser.id)}`,
                { method: 'PUT' }
            );
        } catch (error) {
            console.error('Failed to mark conversation read', error);
        }
    };

    const fetchMessagesPage = async (conversation, pageOffset = 0, appendOlder = false) => {
        if (!currentUser || !conversation) return;

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
        if (!currentUser || !activeConversationRef.current || !isPageVisibleRef.current) return;

        try {
            const params = new URLSearchParams({
                user1_id: currentUser.id,
                user1_type: currentUser.type,
                user2_id: activeConversationRef.current.other_user.id,
                user2_type: activeConversationRef.current.other_user.type,
                limit: String(PAGE_SIZE),
                offset: '0'
            });

            const response = await fetch(`${API_BASE}/api/chat/messages?${params}`);
            if (!response.ok) return;

            const data = await response.json();
            if (!data.success || !Array.isArray(data.messages)) return;

            const latestAsc = data.messages.slice().reverse();
            const wasAtBottom = isAtBottom();
            const mapped = latestAsc.map((m) => normalizeMessage(m, currentUser.id));
            let addedCount = 0;

            setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => String(m.id)));
                const onlyNew = mapped.filter((m) => !existingIds.has(String(m.id)));
                addedCount = onlyNew.length;
                if (addedCount === 0) return prev;
                return [...prev, ...onlyNew];
            });

            if (wasAtBottom && addedCount > 0) {
                setTimeout(() => scrollToBottom('smooth'), 40);
            }
        } catch (error) {
            console.error('Background polling failed:', error);
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
                text,
                timestamp: new Date().toISOString(),
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
            const response = await fetch(`${API_BASE}/api/chat/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_id: currentUser.id,
                    sender_type: currentUser.type,
                    receiver_id: String(activeConversation.other_user.id),
                    receiver_type: activeConversation.other_user.type,
                    message_text: text
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Send failed');
            }

            setMessages((prev) => {
                const sentMessage = data.message || {};
                const realId = String(sentMessage.id || data.id);
                const hasRealAlready = prev.some((m) => String(m.id) === realId);

                if (hasRealAlready) {
                    return prev.filter((m) => String(m.id) !== tempId);
                }

                return prev.map((m) =>
                    String(m.id) === tempId
                        ? {
                            id: realId,
                            sender_id: String(currentUser.id),
                            text,
                            timestamp: sentMessage.timestamp || data.timestamp || new Date().toISOString(),
                            is_from_me: true
                        }
                        : m
                );
            });

            fetchConversations(searchQuery.trim());
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

            fetchConversations(searchQuery.trim());
        } catch (error) {
            console.error('Failed to delete conversation', error);
        }
    };

    const selectConversation = (conversation) => {
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
                type: user.user_type || 'user',
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
        fetchConversations(query);
        fetchDirectoryResults(query);
    }, [searchQuery]);

    useEffect(() => {
        if (!activeConversation) return;
        setOffset(0);
        setHasMore(false);
        fetchMessagesPage(activeConversation, 0, false);
        setTimeout(() => inputRef.current?.focus(), 50);
    }, [activeConversation]);

    useEffect(() => {
        if (!activeConversation || !currentUser) return;

        if (pollingRef.current) {
            clearInterval(pollingRef.current);
        }

        pollingRef.current = setInterval(() => {
            pollNewMessages();
        }, MESSAGE_POLL_MS);

        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, [activeConversation, currentUser]);

    useEffect(() => {
        if (!currentUser) return;

        if (unreadPollingRef.current) {
            clearInterval(unreadPollingRef.current);
        }

        unreadPollingRef.current = setInterval(() => {
            fetchConversations(searchQuery.trim(), { silent: true });
        }, UNREAD_POLL_MS);

        return () => {
            if (unreadPollingRef.current) {
                clearInterval(unreadPollingRef.current);
            }
        };
    }, [currentUser, searchQuery]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            isPageVisibleRef.current = !document.hidden;
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    const currentDashboard = currentUser?.type === 'teacher' ? '/teacherDashboard' : '/studentDashboard';

    return (
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
                                    onSelectConversation={selectConversation}
                                    onDeleteConversation={deleteConversation}
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
                                            Send
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}

export default React.memo(ChatPage);
