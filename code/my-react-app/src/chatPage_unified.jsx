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
        <>
            {incomingCall && !callActive && (
                <div className="chat-call-overlay">
                    <div className="chat-call-card">
                        <div className="chat-call-title">Incoming {incomingCall.call_type} call</div>
                        <div className="chat-call-subtitle">{incomingCall.from_name || incomingCall.from} is calling you</div>
                        <div className="chat-call-actions">
                            <button type="button" className="chat-call-btn accept" onClick={acceptCall}>Accept</button>
                            <button type="button" className="chat-call-btn decline" onClick={rejectCall}>Decline</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden audio element to play remote voice stream */}
            <audio ref={audioElRef} style={{ display: 'none' }} autoPlay playsInline />

            {/* Outgoing (caller) ringing UI */}
            {callActive && (callStatus === 'calling' || callStatus === 'ringing') && (
                <div className="chat-call-overlay">
                    <div className="chat-call-card">
                        <div className="chat-call-title">Calling {getConversationName(activeConversation) || 'User'}</div>
                        <div className="chat-call-subtitle">Ringing...</div>
                        <div className="chat-call-actions">
                            <button type="button" className="chat-call-btn decline" onClick={endCall} title="End call"><FaPhoneSlash /></button>
                        </div>
                    </div>
                </div>
            )}

            {/* Active call UI for caller/callee */}
            {callActive && callStatus === 'connected' && (
                <div className="chat-call-overlay chat-call-room-overlay">
                    <div className="chat-call-room-shell">
                        {callMode === 'video' ? (
                            <div className="private-call-stage video-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
                                <div className="private-call-video-panel" style={{ flexGrow: 1, position: 'relative', background: '#000', borderRadius: '12px', overflow: 'hidden' }}>
                                    <video ref={remoteVideoRef} className="private-call-remote-video" autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    <div className="private-call-local-preview" style={{ position: 'absolute', bottom: '16px', right: '16px', width: '120px', height: '160px', borderRadius: '8px', overflow: 'hidden', border: '2px solid #fff', background: '#000', zIndex: 10 }}>
                                        <video ref={localVideoRef} className="private-call-local-video" autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                                    </div>
                                </div>
                                <div className="private-call-controls" style={{ display: 'flex', justifyContent: 'center', gap: '16px', padding: '16px 0' }}>
                                    <button className={`private-call-btn ${!isMuted ? 'active' : 'muted'}`} onClick={toggleMute} type="button" title={isMuted ? 'Unmute' : 'Mute'}>
                                        {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                                    </button>
                                    <button className={`private-call-btn ${!isVideoMuted ? 'active' : 'muted'}`} onClick={toggleVideoMute} type="button" title={isVideoMuted ? 'Turn on camera' : 'Turn off camera'}>
                                        {isVideoMuted ? <FaVideoSlash /> : <FaVideo />}
                                    </button>
                                    <button className="private-call-btn end" onClick={endCall} type="button" title="End call">
                                        <FaPhoneSlash />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="voice-call-panel">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                    <div style={{ fontWeight: 700 }}>{getConversationName(activeConversation) || 'User'}</div>
                                    {callStartTime && <div style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}><FaClock /> {formatPKTTime(new Date(callStartTime).toISOString())}</div>}
                                </div>
                                <div style={{ marginBottom: '8px' }}>Duration: {formatCallDuration(callDuration)}</div>
                                <div className="chat-call-actions">
                                    <button type="button" className="chat-call-btn decline" onClick={endCall} title="End call"><FaPhoneSlash /></button>
                                    <button type="button" className="chat-call-btn accept" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>{isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}</button>
                                </div>
                            </div>
                        )}
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
