import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './chat.css';
import classMateLogo from './assets/Logo2.png';
import { formatPKTTime } from './utils/dateUtils';
import { formatChatTime, getConversationAvatar, getConversationName } from './utils/chatUtils';

const API_BASE = 'https://classmate-backend-eysi.onrender.com';
const MESSAGE_POLL_MS = 3000;
const UNREAD_POLL_MS = 10000;
const PAGE_SIZE = 25;
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
    const [sendingMessage, setSendingMessage] = useState(false);
    const [unreadTotal, setUnreadTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const typingTimeoutRef = useRef(null);
    const messagesRef = useRef(null);

    const filteredConversations = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return conversations;
        return conversations.filter((item) => {
            const name = getConversationName(item).toLowerCase();
            const preview = (item.last_message?.text || '').toLowerCase();
            return name.includes(query) || preview.includes(query);
        });
    }, [searchQuery, conversations]);

    const fetchConversations = async (q = '') => {
        if (!currentUser) return;

        try {
            setLoadingConversations(true);
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

            const normalized = (data.conversations || []).map((item) => {
                if (item.other_user) {
                    return item;
                }

                return {
                    other_user: {
                        id: String(item.other_user_id),
                        type: item.other_user_type || 'user',
                        name: item.other_user_name || 'Unknown user',
                        avatar: (item.other_user_name || 'U').charAt(0).toUpperCase()
                    },
                    last_message: {
                        text: item.last_message || '',
                        timestamp: item.last_message_time || null,
                        sender_id: item.last_message_sender_id || null
                    },
                    unread_count: item.unread_count || 0,
                    total_messages: item.total_messages || 0
                };
            });

            setConversations(normalized);
            setUnreadTotal(
                typeof data.total_unread === 'number'
                    ? data.total_unread
                    : normalized.reduce((sum, c) => sum + (c.unread_count || 0), 0)
            );

            if (!activeConversation && normalized.length) {
                setActiveConversation(normalized[0]);
            }
        } catch (error) {
            console.error('Failed to fetch conversations', error);
            setConversations([]);
            setUnreadTotal(0);
        } finally {
            setLoadingConversations(false);
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
            await fetch(`${API_BASE}/api/chat/inbox/mark-read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    user_type: currentUser.type,
                    other_user_id: String(conversation.other_user.id),
                    other_user_type: conversation.other_user.type
                })
            });
        } catch (error) {
            console.error('Failed to mark conversation read', error);
        }
    };

    const fetchMessages = async (conversation, nextOffset = 0, appendOlder = false) => {
        if (!currentUser || !conversation) return;

        try {
            if (!appendOlder) {
                setLoadingMessages(true);
            }

            const params = new URLSearchParams({
                user_id: currentUser.id,
                user_type: currentUser.type,
                other_user_id: String(conversation.other_user.id),
                other_user_type: conversation.other_user.type,
                limit: String(PAGE_SIZE),
                offset: String(nextOffset)
            });
            const response = await fetch(`${API_BASE}/api/chat/inbox/messages?${params}`);
            const data = await response.json();

            if (!data.success) return;

            const ordered = [...(data.messages || [])].reverse();

            if (appendOlder) {
                setMessages((prev) => [...ordered, ...prev]);
            } else {
                setMessages(ordered);
            }

            setOffset(nextOffset + ordered.length);
            setHasMore(Boolean(data.has_more));

            await markConversationRead(conversation);

            if (!appendOlder) {
                setTimeout(() => {
                    if (messagesRef.current) {
                        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
                    }
                }, 50);
            }
        } catch (error) {
            console.error('Failed to fetch messages', error);
        } finally {
            setLoadingMessages(false);
        }
    };

    const sendMessage = async () => {
        if (!currentUser || !activeConversation || !messageInput.trim() || sendingMessage) return;

        const text = messageInput.trim();
        setSendingMessage(true);

        try {
            const response = await fetch(`${API_BASE}/api/chat/inbox/send`, {
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

            const data = await response.json();
            if (!data.success) return;

            setMessageInput('');
            setShowEmojiPicker(false);
            setMessages((prev) => [
                ...prev,
                {
                    id: data.message.id,
                    text: data.message.text,
                    timestamp: data.message.timestamp,
                    sender: {
                        id: String(data.message.sender_id),
                        type: data.message.sender_type,
                        name: currentUser.name
                    },
                    is_from_me: true
                }
            ]);

            fetchConversations(searchQuery.trim());
        } catch (error) {
            console.error('Failed to send message', error);
        } finally {
            setSendingMessage(false);
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
                        !(
                            String(item.other_user.id) === String(conversation.other_user.id) &&
                            item.other_user.type === conversation.other_user.type
                        )
                )
            );

            if (
                activeConversation &&
                String(activeConversation.other_user.id) === String(conversation.other_user.id) &&
                activeConversation.other_user.type === conversation.other_user.type
            ) {
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
        const existing = conversations.find(
            (item) =>
                String(item.other_user.id) === String(user.id) &&
                item.other_user.type === user.user_type
        );

        if (existing) {
            selectConversation(existing);
            return;
        }

        const adHocConversation = {
            other_user: {
                id: String(user.id),
                type: user.user_type,
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
        fetchMessages(activeConversation, 0, false);
    }, [activeConversation]);

    useEffect(() => {
        if (!activeConversation || !currentUser) return;

        const messageTimer = setInterval(() => {
            fetchMessages(activeConversation, 0, false);
        }, MESSAGE_POLL_MS);

        const unreadTimer = setInterval(() => {
            fetchConversations(searchQuery.trim());
        }, UNREAD_POLL_MS);

        return () => {
            clearInterval(messageTimer);
            clearInterval(unreadTimer);
        };
    }, [activeConversation, currentUser, searchQuery]);

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
            sendMessage();
        }
    };

    const loadOlderMessages = () => {
        if (!activeConversation || !hasMore) return;
        fetchMessages(activeConversation, offset, true);
    };

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
                                {filteredConversations.map((conversation) => {
                                    const active =
                                        activeConversation &&
                                        String(activeConversation.other_user.id) === String(conversation.other_user.id) &&
                                        activeConversation.other_user.type === conversation.other_user.type;

                                    return (
                                        <div
                                            key={`${conversation.other_user.type}-${conversation.other_user.id}`}
                                            className={`chat-list-item ${active ? 'active' : ''}`}
                                            onClick={() => selectConversation(conversation)}
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
                                                                deleteConversation(conversation);
                                                            }}
                                                            title="Delete conversation"
                                                        >
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

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

                            <div className="chat-messages-area" ref={messagesRef}>
                                {hasMore && (
                                    <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                                        <button className="chat-back-btn" type="button" onClick={loadOlderMessages}>
                                            Load older messages
                                        </button>
                                    </div>
                                )}

                                {loadingMessages ? (
                                    <div className="no-messages">Loading messages...</div>
                                ) : (
                                    <div className="messages-container">
                                        {messages.map((message) => (
                                            <div
                                                key={message.id}
                                                className={`message-bubble ${message.is_from_me ? 'sent' : 'received'}`}
                                            >
                                                <div className="message-content">
                                                    <p>{message.text}</p>
                                                    <span className="message-time">{formatPKTTime(message.timestamp)}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {messages.length === 0 && <div className="no-messages">No messages yet.</div>}
                                    </div>
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
                                            onClick={sendMessage}
                                        >
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

export default ChatPage;
