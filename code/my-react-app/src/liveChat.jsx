import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './liveChat.css';

const LiveChat = ({ currentUserId, currentUserType, otherUserId, otherUserType, otherUserName }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Scroll to bottom when messages update
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch messages
  const fetchMessages = async () => {
    try {
      const response = await axios.get(
        `https://classmate-backend-eysi.onrender.com/api/chat/messages/${currentUserId}/${currentUserType}/${otherUserId}/${otherUserType}?limit=50`
      );
      if (response.data.success) {
        setMessages(response.data.messages);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
      setError('Failed to load messages');
    }
  };

  useEffect(() => {
    // Fetch messages initially
    fetchMessages();

    // Poll for new messages every 1 second
    pollIntervalRef.current = setInterval(() => {
      fetchMessages();
    }, 1000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [currentUserId, otherUserId]);

  // Send message
  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!newMessage.trim()) {
      setError('Message cannot be empty');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await axios.post('https://classmate-backend-eysi.onrender.com/api/chat/send', {
        sender_id: currentUserId,
        sender_type: currentUserType,
        receiver_id: otherUserId,
        receiver_type: otherUserType,
        content: newMessage,
        message_type: 'text'
      });

      if (response.data.success) {
        setNewMessage('');
        // Fetch updated messages
        await fetchMessages();
      } else {
        setError(response.data.error || 'Failed to send message');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  // Mark message as read
  const markAsRead = async (messageId) => {
    try {
      await axios.put(`https://classmate-backend-eysi.onrender.com/api/chat/mark-read/${messageId}`);
    } catch (err) {
      console.error('Error marking message as read:', err);
    }
  };

  return (
    <div className="live-chat-container">
      <div className="chat-header">
        <h2>{otherUserName || otherUserId}</h2>
        <span className="user-type">{otherUserType}</span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="no-messages">
            <p>No messages yet. Start a conversation!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.message_id}
              className={`message-live-bubble ${
                msg.sender_id === currentUserId ? 'sent' : 'received'
              }`}
              onClick={() => !msg.is_read && markAsRead(msg.message_id)}
            >
              <div className="message-content">
                <p>{msg.content}</p>
              </div>
              <div className="message-meta">
                <span className="message-time">
                  {new Date(msg.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
                {msg.sender_id === currentUserId && (
                  <span className="message-status">
                    {msg.is_read ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <form className="chat-input-form" onSubmit={handleSendMessage}>
        <input
          type="text"
          placeholder="Type your message..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          disabled={loading}
          className="chat-input"
        />
        <button
          type="submit"
          disabled={loading || !newMessage.trim()}
          className="chat-send-btn"
        >
          {loading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

export default LiveChat;
