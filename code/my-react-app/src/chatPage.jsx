import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './chat.css';
import classMateLogo from './assets/Logo2.png';

const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
};

function Chat() {
    const navigate = useNavigate();
    const location = useLocation();

    const isTeacher = location.pathname.includes('/teacher');
    const isStudent = location.pathname.includes('/student');

    const userRole = isTeacher ? 'teacher' : 'student';
    const userEmailKey = isTeacher ? 'teacherEmail' : 'studentEmail';
    const userTokenKey = isTeacher ? 'teacherToken' : 'studentToken';
    const userProfileEndpoint = isTeacher 
        ? '/api/teacher/profile/current' 
        : '/api/student/get-current';
    const userDashboardRoute = isTeacher 
        ? '/teacherDashboard' 
        : '/studentDashboard';

    // State for search functionality
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState(null);
    

    // Use debounced search query
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    // State for chat management
    const [chats, setChats] = useState([]);
    const [activeChat, setActiveChat] = useState(null);
    const [messageInput, setMessageInput] = useState('');
    const [messages, setMessages] = useState([]);

    // State for users found in search
    const [foundUsers, setFoundUsers] = useState([]);

    // State for polling functionality
    const [isPolling, setIsPolling] = useState(false);
    const [lastCheckTimestamp, setLastCheckTimestamp] = useState(null);
    const [pollingInterval, setPollingInterval] = useState(null);
    const [newMessageNotification, setNewMessageNotification] = useState(null);

    // Fetch current teacher info (cache it)
    const [currentTeacher, setCurrentTeacher] = useState(null);

    // Ref for scroll to bottom
    const messagesEndRef = useRef(null);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Helper function to check if dates are the same day
    const isSameDay = (date1, date2) => {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    };

    // Helper function to format date label
    const getDateLabel = (date) => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (isSameDay(date, today)) {
            return 'Today';
        } else if (isSameDay(date, yesterday)) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined 
            });
        }
    };

    // Group messages by date
    const groupMessagesByDate = (messages) => {
        const grouped = {};
        
        messages.forEach(msg => {
            const msgDate = new Date(msg.timestamp || msg.time);
            const dateKey = msgDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
            
            if (!grouped[dateKey]) {
                grouped[dateKey] = [];
            }
            grouped[dateKey].push(msg);
        });

        return grouped;
    };

    // Load current teacher info on component mount
    useEffect(() => {
        const fetchCurrentTeacher = async () => {
            try {
                const teacherEmail = localStorage.getItem('teacherEmail');
                if (!teacherEmail) {
                    console.error('No teacher email found in localStorage');
                    return;
                }

                const response = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/teacher/profile/current?email=${encodeURIComponent(teacherEmail)}`
                );

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        setCurrentTeacher(data.teacher);
                        console.log('Current teacher loaded:', data.teacher);
                    }
                } else {
                    console.error('Failed to fetch teacher profile');
                }
            } catch (error) {
                console.error('Error fetching teacher:', error);
            }
        };

        fetchCurrentTeacher();
    }, []);

    // Initialize polling when teacher is loaded
    useEffect(() => {
        if (currentTeacher) {
            startPolling();
            loadConversations();
        }

        // Cleanup on unmount
        return () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
        };
    }, [currentTeacher]);

    // Start polling for new messages
    const startPolling = () => {
        if (!currentTeacher || pollingInterval) return;

        console.log('🔍 Starting polling for new messages...');

        // Set initial timestamp
        setLastCheckTimestamp(new Date().toISOString());

        // Start polling interval (every 3 seconds)
        const interval = setInterval(() => {
            pollForNewMessages();
        }, 3000);

        setPollingInterval(interval);
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file || !activeChat || !currentTeacher) return;

        // Check size (max 10MB for database storage)
        if (file.size > 10 * 1024 * 1024) {
            alert("File too large! Max 10MB");
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('sender_id', currentTeacher.teacher_id);
        formData.append('sender_type', 'teacher');
        formData.append('receiver_id', activeChat.userId);
        formData.append('receiver_type', activeChat.user_type);

        try {
            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/chat/upload-file', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (data.success) {
                // Add file message immediately to chat
                const fileMessage = {
                    id: data.message_id || Date.now(),
                    sender: 'teacher',
                    sender_id: currentTeacher.teacher_id,
                    text: `📎 ${file.name}`,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    timestamp: new Date().toISOString(),
                    is_read: false,
                    is_from_me: true,
                    has_file: true,
                    file: {
                        name: file.name,
                        size: file.size,
                        type: file.name.split('.').pop().toLowerCase(),
                        download_url: data.download_url || `/api/chat/download/${data.message_id}`
                    }
                };

                setMessages(prev => [...prev, fileMessage]);

                // Also refresh messages to ensure consistency
                setTimeout(() => {
                    loadMessages(activeChat.userId, activeChat.user_type);
                }, 500);

            } else {
                alert(`Upload failed: ${data.error}`);
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert('Error uploading file');
        }
    };

    const handleDownloadFile = async (messageId, filename) => {
        try {
            const response = await fetch(`https://classmate-backend-eysi.onrender.com/api/chat/download/${messageId}`);

            if (!response.ok) {
                throw new Error('Download failed');
            }

            // Get the blob data
            const blob = await response.blob();

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error('Download error:', error);
            alert('Failed to download file');
        }
    };

    // File icon based on type
    // File icon based on type - WITH NULL CHECK
    const getFileIcon = (fileType) => {
        if (!fileType) return '📎'; // ADD THIS CHECK

        const icons = {
            'pdf': '📕',
            'doc': '📄',
            'docx': '📄',
            'txt': '📝',
            'jpg': '🖼️',
            'jpeg': '🖼️',
            'png': '🖼️',
            'xls': '📊',
            'xlsx': '📊',
            'zip': '🗜️',
            'rar': '🗜️'
        };

        return icons[fileType.toLowerCase()] || '';
    };

    // Format file size
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Poll for new messages
    const pollForNewMessages = async () => {
        if (!currentTeacher || isPolling) return;

        setIsPolling(true);

        try {
            const params = new URLSearchParams({
                user_id: currentTeacher.teacher_id,
                user_type: 'teacher'
            });

            if (lastCheckTimestamp) {
                params.append('last_check', lastCheckTimestamp);
            }

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/poll-messages?${params}`,
                { timeout: 5000 }
            );

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    // Update last check timestamp
                    setLastCheckTimestamp(new Date().toISOString());

                    // Check if we have new messages
                    if (data.has_new_messages && data.new_messages && data.new_messages.length > 0) {
                        console.log(`📨 Found ${data.new_messages.length} new messages`);

                        // Process new messages
                        await processNewMessages(data.new_messages);
                    }
                }
            }
        } catch (error) {
            console.error('Polling error:', error);
        } finally {
            setIsPolling(false);
        }
    };

    // Process new messages from polling - UPDATED FOR FILES
    const processNewMessages = async (newMessages) => {
        if (!newMessages || newMessages.length === 0) return;

        let hasNewMessagesForActiveChat = false;
        let newMessageFromOtherUser = null;

        for (const msg of newMessages) {
            // Check if this is a new message (not a read status update)
            if (msg.is_new && !msg.is_read_update) {
                const senderId = msg.sender.id;
                const senderType = msg.sender.type;

                // Check if this message is for the active chat
                if (activeChat &&
                    activeChat.userId === senderId &&
                    activeChat.user_type === senderType) {
                    hasNewMessagesForActiveChat = true;

                    // Add message to current chat WITH FILE DATA
                    const formattedMessage = {
                        id: msg.id,
                        sender: msg.sender.type,
                        sender_id: msg.sender.id,
                        text: msg.text,
                        time: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now',
                        timestamp: msg.timestamp,
                        is_read: msg.is_read,
                        is_from_me: false,
                        // ADD FILE DATA
                        has_file: msg.has_file || false,
                        file: msg.file
                    };

                    setMessages(prev => [...prev, formattedMessage]);
                }

                // Store for notification if from other user
                if (!msg.is_from_me) {
                    newMessageFromOtherUser = msg;
                }

                // Update conversation list
                updateChatWithNewMessage(msg);
            }
        }

        // If we have new messages for active chat, refresh conversations
        if (hasNewMessagesForActiveChat) {
            await loadConversations();
        }

        // Show notification for new message from other user
        if (newMessageFromOtherUser &&
            (!activeChat ||
                activeChat.userId !== newMessageFromOtherUser.sender.id ||
                activeChat.user_type !== newMessageFromOtherUser.sender.type)) {
            showNewMessageNotification(newMessageFromOtherUser);
        }
    };

    // Update chat list with new message
    const updateChatWithNewMessage = (message) => {
        const senderId = message.sender.id;
        const senderType = message.sender.type;

        setChats(prevChats => {
            const updatedChats = [...prevChats];
            const chatIndex = updatedChats.findIndex(
                chat => chat.userId === senderId && chat.user_type === senderType
            );

            if (chatIndex > -1) {
                // Update existing chat
                updatedChats[chatIndex] = {
                    ...updatedChats[chatIndex],
                    lastMessage: message.text.length > 30
                        ? message.text.substring(0, 30) + '...'
                        : message.text,
                    timestamp: message.timestamp ?
                        new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) :
                        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    unread: (updatedChats[chatIndex].unread || 0) + 1,
                    lastMessageIsFromMe: false,
                    message_count: (updatedChats[chatIndex].message_count || 0) + 1
                };
            } else {
                // This is a new conversation - we'll refresh the whole list
                // The conversation will appear when we refresh conversations
                console.log('New conversation detected, will refresh conversations list');
            }

            return updatedChats;
        });
    };

    // Show notification for new message
    const showNewMessageNotification = (message) => {
        const senderName = message.sender?.name || 'Someone';
        const notificationText = message.text.length > 50
            ? message.text.substring(0, 50) + '...'
            : message.text;

        setNewMessageNotification({
            sender: senderName,
            text: notificationText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        // Auto-hide notification after 5 seconds
        setTimeout(() => {
            setNewMessageNotification(null);
        }, 5000);

        // Also show browser notification if permitted
        showBrowserNotification(senderName, notificationText);
    };

    // Show browser notification
    const showBrowserNotification = (title, body) => {
        if (!("Notification" in window)) return;

        if (Notification.permission === "granted") {
            new Notification(`New message from ${title}`, {
                body: body,
                icon: classMateLogo
            });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    };

    // Load conversations from API
    const loadConversations = async () => {
        if (!currentTeacher) return;

        try {
            console.log('Loading conversations for teacher:', currentTeacher.teacher_id);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/conversations?user_id=${currentTeacher.teacher_id}&user_type=teacher`
            );

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    // Convert API response to frontend chat format
                    const formattedChats = data.conversations.map(conv => ({
                        id: `chat-${currentTeacher.teacher_id}-${conv.other_user.id}`,
                        userId: conv.other_user.id,
                        name: conv.other_user.name,
                        role: conv.other_user.type.charAt(0).toUpperCase() + conv.other_user.type.slice(1),
                        avatar: conv.other_user.avatar || conv.other_user.name.charAt(0),
                        lastMessage: conv.last_message.text,
                        timestamp: conv.last_message.timestamp
                            ? new Date(conv.last_message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        unread: conv.unread_count,
                        online: false,
                        user_type: conv.other_user.type,
                        message_count: conv.total_messages,
                        lastMessageIsFromMe: conv.last_message.is_from_me
                    }));

                    setChats(formattedChats);
                    console.log(`Loaded ${formattedChats.length} conversations from API`);

                    // If there are conversations and no active chat, select the first one
                    if (formattedChats.length > 0 && !activeChat) {
                        const firstChat = formattedChats[0];
                        setActiveChat(firstChat);
                        // Load messages for the first conversation
                        await loadMessages(firstChat.userId, firstChat.user_type);
                    }
                }
            } else {
                console.error('Failed to load conversations:', response.status);
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
        }
    };

    // Perform search when debounced query changes
    useEffect(() => {
        const performSearch = async () => {
            if (debouncedSearchQuery.trim().length > 0 && currentTeacher) {
                setIsSearching(true);

                try {
                    const response = await fetch(
                        `https://classmate-backend-eysi.onrender.com/api/chat/search?q=${encodeURIComponent(debouncedSearchQuery)}&current_user_id=${currentTeacher.teacher_id}&current_user_type=teacher`
                    );

                    if (response.ok) {
                        const data = await response.json();
                        if (data.success) {
                            // Format the results for frontend
                            const formattedUsers = data.results.map(user => ({
                                id: user.id,
                                name: user.name,
                                role: user.role,
                                avatar: user.avatar || user.name.charAt(0),
                                email: user.email,
                                department: user.department,
                                user_type: user.user_type // Store the user_type for API calls
                            }));
                            setFoundUsers(formattedUsers);
                        } else {
                            console.error('Search API error:', data.error);
                            setFoundUsers([]);
                        }
                    } else {
                        console.error('Search request failed:', response.status);
                        setFoundUsers([]);
                    }
                } catch (error) {
                    console.error('Search error:', error);
                    setFoundUsers([]);
                }
            } else {
                setIsSearching(false);
                setFoundUsers([]);
            }
        };

        performSearch();
    }, [debouncedSearchQuery, currentTeacher]);

    // Handle search input change
    const handleSearch = (e) => {
        const query = e.target.value;
        setSearchQuery(query);
    };

    // Load messages for a specific user
    // Load messages for a specific user - UPDATED VERSION
    // In loadMessages function, replace with this:
    const loadMessages = async (userId, userType) => {
        if (!currentTeacher) return;

        try {
            console.log(`Loading messages between teacher ${currentTeacher.teacher_id} and ${userType} ${userId}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/messages?user1_id=${currentTeacher.teacher_id}&user1_type=teacher&user2_id=${userId}&user2_type=${userType}&limit=100`
            );

            if (response.ok) {
                const data = await response.json();
                console.log("📄 API Response:", data); // ADD THIS

                if (data.success && data.messages) {
                    console.log("📄 First message:", data.messages[0]); // ADD THIS

                    // Convert API response to frontend message format - WITH FILE DATA
                    const formattedMessages = data.messages.map(msg => {
                        console.log("📄 Processing message:", msg.id, "has_file:", msg.has_file); // ADD THIS

                        return {
                            id: msg.id,
                            sender: msg.sender.type,
                            sender_id: msg.sender.id,
                            text: msg.text,
                            time: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now',
                            timestamp: msg.timestamp,
                            is_read: msg.is_read,
                            is_from_me: msg.is_from_me,
                            // ADD THESE FILE FIELDS WITH SAFE ACCESS
                            has_file: msg.has_file || false,
                            file: msg.file ? {
                                name: msg.file.name || 'Unknown',
                                size: msg.file.size || 0,
                                type: msg.file.type || 'unknown',
                                mime: msg.file.mime || 'application/octet-stream',
                                download_url: msg.file.download_url || `/api/chat/download/${msg.id}`
                            } : null
                        };
                    });

                    // Reverse to show oldest first
                    const sortedMessages = formattedMessages.reverse();
                    setMessages(sortedMessages);
                    console.log(`Loaded ${sortedMessages.length} messages`);

                    // Update last check timestamp
                    if (data.messages.length > 0) {
                        const latestMessage = data.messages[0];
                        setLastCheckTimestamp(latestMessage.timestamp || new Date().toISOString());
                    }
                } else {
                    console.error('API returned unsuccessful:', data);
                }
            } else {
                console.error('Failed to load messages:', response.status);
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    };

    // Handle starting a new chat
    const handleStartNewChat = async (user) => {
        console.log('Starting chat with:', user);

        if (!currentTeacher) {
            console.error('No current teacher found');
            alert('Unable to start chat. Please refresh the page.');
            return;
        }

        try {
            // First check if conversation already exists
            const checkResponse = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/conversation?user1_id=${currentTeacher.teacher_id}&user1_type=teacher&user2_id=${user.id}&user2_type=${user.user_type}`
            );

            let conversationData = null;
            let isNewConversation = false;

            if (checkResponse.ok) {
                const checkData = await checkResponse.json();
                if (checkData.success) {
                    conversationData = checkData.conversation;
                    isNewConversation = checkData.is_new;

                    if (!isNewConversation) {
                        console.log('✅ Conversation already exists:', conversationData);
                    }
                }
            }

            // If conversation doesn't exist or we want to create it
            if (isNewConversation) {
                // Create new conversation with initial message
                const createResponse = await fetch(
                    'https://classmate-backend-eysi.onrender.com/api/chat/conversation',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            sender_id: currentTeacher.teacher_id,
                            sender_type: 'teacher',
                            receiver_id: user.id,
                            receiver_type: user.user_type,
                            message_text: `Hello ${user.name}! 👋`
                        })
                    }
                );

                if (!createResponse.ok) {
                    const errorData = await createResponse.json();
                    throw new Error(errorData.error || 'Failed to create conversation');
                }

                const createData = await createResponse.json();
                conversationData = createData.conversation;
                console.log('✅ New conversation created:', createData);
            }

            // Create/update chat in frontend
            const newChat = {
                id: conversationData ? `chat-${currentTeacher.teacher_id}-${user.id}` : Date.now(),
                userId: user.id,
                name: user.name,
                role: user.role,
                avatar: user.avatar || user.name.charAt(0),
                lastMessage: conversationData?.last_message?.text || '',
                timestamp: conversationData?.last_message?.timestamp
                    ? new Date(conversationData.last_message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                unread: 0,
                online: false,
                user_type: user.user_type,
                message_count: conversationData?.message_count || 0,
                lastMessageIsFromMe: conversationData?.last_message?.sender_id === currentTeacher.teacher_id
            };

            // Check if chat already exists
            const existingChatIndex = chats.findIndex(chat =>
                chat.userId === user.id && chat.user_type === user.user_type
            );

            if (existingChatIndex > -1) {
                // Update existing chat
                const updatedChats = [...chats];
                updatedChats[existingChatIndex] = {
                    ...updatedChats[existingChatIndex],
                    ...newChat,
                    id: updatedChats[existingChatIndex].id // Keep original ID
                };
                setChats(updatedChats);
                setActiveChat(updatedChats[existingChatIndex]);
            } else {
                // Add new chat
                setChats(prevChats => [newChat, ...prevChats]);
                setActiveChat(newChat);
            }

            // If conversation has messages, load them
            if (conversationData?.has_conversation && conversationData.message_count > 0) {
                await loadMessages(user.id, user.user_type);
            } else {
                setMessages([]); // Start with empty messages
            }

            // Clear search
            setIsSearching(false);
            setSearchQuery('');
            setFoundUsers([]);

            // Refresh conversations list to get latest data
            setTimeout(() => {
                loadConversations();
            }, 500);

        } catch (error) {
            console.error('Error starting chat:', error);
            alert(`Failed to start chat: ${error.message}`);
        }
    };

    // Handle selecting a chat
    const handleSelectChat = async (chat) => {
        setActiveChat(chat);

        // Reset unread count for this chat
        setChats(prevChats =>
            prevChats.map(c =>
                c.userId === chat.userId && c.user_type === chat.user_type
                    ? { ...c, unread: 0 }
                    : c
            )
        );

        // Load messages for this chat
        await loadMessages(chat.userId, chat.user_type);

        // Clear any notification for this chat
        if (newMessageNotification) {
            setNewMessageNotification(null);
        }
    };

    // Handle sending a message
    const handleSendMessage = async (e) => {
        e.preventDefault();

        if (!messageInput.trim() || !activeChat || !currentTeacher) return;

        try {
            // Save message to backend
            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/chat/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_id: currentTeacher.teacher_id,
                    sender_type: 'teacher',
                    receiver_id: activeChat.userId,
                    receiver_type: activeChat.user_type,
                    message_text: messageInput
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to send message');
            }

            const data = await response.json();

            // Add message to local state
            const newMessage = {
                id: data.message_id,
                sender: 'teacher',
                sender_id: currentTeacher.teacher_id,
                receiver_id: activeChat.userId,
                receiver_type: activeChat.user_type,
                text: messageInput,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                timestamp: new Date().toISOString(),
                is_read: false,
                is_from_me: true
            };

            setMessages(prev => [...prev, newMessage]);

            // Update chat list with last message
            setChats(prevChats =>
                prevChats.map(chat =>
                    chat.userId === activeChat.userId && chat.user_type === activeChat.user_type
                        ? {
                            ...chat,
                            lastMessage: messageInput.length > 30
                                ? messageInput.substring(0, 30) + '...'
                                : messageInput,
                            timestamp: newMessage.time,
                            unread: 0,
                            message_count: (chat.message_count || 0) + 1,
                            lastMessageIsFromMe: true
                        }
                        : chat
                )
            );

            setMessageInput('');

            // Refresh conversations to update last message
            setTimeout(() => {
                loadConversations();
            }, 500);

            console.log('✅ Message sent:', data);

        } catch (error) {
            console.error('Error sending message:', error);
            alert(`Failed to send message: ${error.message}`);
        }
    };

    // Handle going back to dashboard
    const handleBackToDashboard = () => {
        navigate('/teacherDashboard');
    };

    // Handle closing notification
    const handleCloseNotification = () => {
        setNewMessageNotification(null);
    };

    // Update chat list UI to show conversation indicators
    const renderChatItem = (chat) => {
        const isActive = activeChat?.userId === chat.userId && activeChat?.user_type === chat.user_type;

        return (
            <div
                key={chat.id}
                className={`chat-list-item ${isActive ? 'active' : ''}`}
                onClick={() => handleSelectChat(chat)}
            >
                <div className="chat-item-avatar">
                    <div className="avatar-initials">
                        {chat.avatar}
                    </div>
                    {chat.online && <div className="online-indicator"></div>}
                    {chat.unread > 0 && <div className="unread-indicator"></div>}
                </div>
                <div className="chat-item-info">
                    <div className="chat-item-header">
                        <h5 className="chat-item-name">{chat.name}</h5>
                        <span className="chat-item-time">{chat.timestamp}</span>
                    </div>
                    <p className="chat-item-preview">
                        {chat.lastMessageIsFromMe ? 'You: ' : ''}{chat.lastMessage}
                    </p>
                    <div className="chat-item-footer">
                        <span className="chat-item-role">{chat.role}</span>
                        {chat.unread > 0 && (
                            <span className="unread-badge">{chat.unread}</span>
                        )}
                        {chat.message_count > 0 && (
                            <span className="message-count">({chat.message_count})</span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="chat-container">
            {/* New Message Notification */}
            {newMessageNotification && (
                <div className="new-message-notification">
                    <div className="notification-content">
                        <div className="notification-header">
                            <span className="notification-icon">📨</span>
                            <span className="notification-title">New message from {newMessageNotification.sender}</span>
                            <button className="notification-close" onClick={handleCloseNotification}>×</button>
                        </div>
                        <p className="notification-text">{newMessageNotification.text}</p>
                        <span className="notification-time">{newMessageNotification.timestamp}</span>
                    </div>
                </div>
            )}

            {/* Navigation Header */}
            <nav className="chat-navbar">
                <div className="chat-navbar-left">
                    <div className="chat-logo-container">
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="chat-navbar-logo"
                        />
                        <span className="chat-brand-name">classMate</span>
                    </div>
                    {isPolling && (
                        <div className="polling-indicator">
                            <div className="polling-dot"></div>
                            <span>Live</span>
                        </div>
                    )}
                </div>

                <div className="chat-navbar-right">
                    <button className="chat-back-btn" onClick={handleBackToDashboard}>
                        ← Back to Dashboard
                    </button>
                </div>
            </nav>

            {/* Main Chat Area */}
            <div className="chat-main-area">
                {/* Left Sidebar - Chat List */}
                <div className="chat-sidebar">
                    {/* Search Bar */}
                    <div className="chat-search-container">
                        <div className="chat-search-input-wrapper">
                            <svg className="chat-search-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                            <input
                                type="text"
                                className="chat-search-input"
                                placeholder="Search students, teachers, admins..."
                                value={searchQuery}
                                onChange={handleSearch}
                                disabled={!currentTeacher}
                            />
                            {!currentTeacher && (
                                <div className="search-loading-text">Loading user info...</div>
                            )}
                        </div>
                    </div>

                    {/* Search Results (when searching) */}
                    {isSearching && searchQuery.trim() && (
                        <div className="chat-search-results">
                            <div className="search-results-header">
                                <h4>Search Results</h4>
                                <span className="results-count">
                                    {foundUsers.length} {foundUsers.length === 1 ? 'user' : 'users'} found
                                </span>
                            </div>
                            {foundUsers.length > 0 ? (
                                <div className="search-results-list">
                                    {foundUsers.map(user => (
                                        <div
                                            key={`${user.id}-${user.user_type}`}
                                            className="search-result-item"
                                            onClick={() => handleStartNewChat(user)}
                                        >
                                            <div className="search-result-avatar">
                                                {user.avatar}
                                            </div>
                                            <div className="search-result-info">
                                                <h5>{user.name}</h5>
                                                <span className="search-result-role">{user.role}</span>
                                                <span className="search-result-department">{user.department}</span>
                                            </div>
                                            <button
                                                className="start-chat-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleStartNewChat(user);
                                                }}
                                            >
                                                Message
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="no-search-results">
                                    {currentTeacher ? (
                                        <>
                                            <p>No users found matching "{searchQuery}"</p>
                                            <p className="search-tip">Try searching by name or email</p>
                                        </>
                                    ) : (
                                        <p>Loading user information...</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Chat List */}
                    <div className="chat-list-container">
                        <div className="chat-list-header">
                            <h3>Conversations</h3>
                            <span className="chats-count">{chats.length}</span>
                            <button
                                className="refresh-btn"
                                onClick={loadConversations}
                                title="Refresh conversations"
                            >
                                ↻
                            </button>
                        </div>

                        {chats.length === 0 ? (
                            <div className="no-chats-message">
                                <div className="no-chats-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                    </svg>
                                </div>
                                <h4>No conversations yet</h4>
                                <p>Search for a user to start chatting</p>
                                <button
                                    className="refresh-btn-large"
                                    onClick={loadConversations}
                                >
                                    ↻ Refresh
                                </button>
                            </div>
                        ) : (
                            <div className="chat-list">
                                {chats.map(chat => renderChatItem(chat))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Side - Chat Box */}
                <div className="chat-box-container">
                    {activeChat ? (
                        <>
                            {/* Chat Header */}
                            <div className="chat-box-header">
                                <div className="chat-box-user-info">
                                    <div className="chat-box-avatar">
                                        <div className="chat-box-avatar-initials">
                                            {activeChat.avatar}
                                        </div>
                                        {activeChat.online && <div className="chat-box-online"></div>}
                                    </div>
                                    <div className="chat-box-user-details">
                                        <h4>{activeChat.name}</h4>
                                        <span className="chat-box-user-role">{activeChat.role}</span>
                                        {activeChat.online ? (
                                            <span className="online-status">Online</span>
                                        ) : (
                                            <span className="offline-status">Offline</span>
                                        )}
                                    </div>
                                </div>
                                <div className="chat-box-actions">
                                    <button className="chat-action-btn" title="Voice call">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                                        </svg>
                                    </button>
                                    <button className="chat-action-btn" title="Video call">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polygon points="23 7 16 12 23 17 23 7"></polygon>
                                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Messages Area */}
                            <div className="chat-messages-area">
                                {messages.length === 0 ? (
                                    <div className="no-messages">
                                        <p>No messages yet. Start the conversation!</p>
                                        <p className="message-tip">Type your first message below</p>
                                    </div>
                                ) : (
                                    <div className="messages-container">
                                        {(() => {
                                            const groupedMessages = groupMessagesByDate(messages);
                                            const sortedDates = Object.keys(groupedMessages).sort();
                                            
                                            return sortedDates.flatMap((dateKey) => [
                                                <div key={`separator-${dateKey}`} className="date-separator">
                                                    <span>{getDateLabel(new Date(dateKey))}</span>
                                                </div>,
                                                ...groupedMessages[dateKey].map(message => (
                                                    <div
                                                        key={message.id}
                                                        className={`message-bubble ${message.is_from_me ? 'sent' : 'received'}`}
                                                    >
                                                        <div className="message-content">
                                                            <p>{message.text}</p>

                                                            {/* ADD FILE ATTACHMENT HERE */}
                                                            {message.has_file && message.file && (
                                                                <div
                                                                    className="file-attachment"
                                                                    onClick={() => handleDownloadFile(message.id, message.file.name)}
                                                                    style={{ cursor: 'pointer' }}
                                                                >
                                                                    <div className="file-preview">
                                                                        <div className="file-icon">
                                                                            {getFileIcon(message.file.type)}
                                                                        </div>
                                                                        <div className="file-info">
                                                                            <div className="file-name">{message.file.name}</div>
                                                                            <div className="file-size">{formatFileSize(message.file.size)}</div>
                                                                        </div>
                                                                        <div className="download-btn">
                                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                                                <polyline points="7 10 12 15 17 10"></polyline>
                                                                                <line x1="12" y1="15" x2="12" y2="3"></line>
                                                                            </svg>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}

                                                                <div className="message-meta">
                                                                    <span className="message-time">{message.time}</span>
                                                                    {message.is_from_me && (
                                                                        <span className="message-status">
                                                                            {message.is_read ? '✓✓' : '✓'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                        </div>
                                                    </div>
                                                ))
                                            ]);
                                        })()}
                                        <div ref={messagesEndRef} />
                                    </div>
                                )}
                            </div>

                            {/* Message Input */}
                            <form className="message-input-container" onSubmit={handleSendMessage}>
                                <div className="message-input-wrapper">
                                    <input
                                        type="text"
                                        className="message-input"
                                        placeholder="Type your message..."
                                        value={messageInput}
                                        onChange={(e) => setMessageInput(e.target.value)}
                                        disabled={!activeChat}
                                    />
                                    <label className="file-upload-btn" title="Upload file">
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="20"
                                            height="20"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        >
                                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                        </svg>
                                        <input
                                            type="file"
                                            style={{ display: 'none' }}
                                            onChange={handleFileUpload}
                                            disabled={!activeChat}
                                        />
                                    </label>
                                    <div className="message-input-actions">
                                        <button
                                            type="submit"
                                            className="message-send-btn"
                                            disabled={!messageInput.trim() || !activeChat}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </>
                    ) : (
                        <div className="no-chat-selected">
                            <div className="no-chat-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                            </div>
                            <h3>Welcome to ClassMate Chat</h3>
                            <p>
                                {currentTeacher
                                    ? `Hello ${currentTeacher.name}! Search for users to start messaging.`
                                    : 'Loading your profile...'}
                            </p>
                            {isPolling && (
                                <p className="polling-info">
                                    <span className="polling-indicator-small"></span>
                                    Live message updates enabled
                                </p>
                            )}
                            {chats.length === 0 && currentTeacher && (
                                <div className="chat-tips">
                                    <p className="tip">💡 <strong>Quick Start:</strong></p>
                                    <p>1. Use the search bar above to find users</p>
                                    <p>2. Click "Message" to start a conversation</p>
                                    <p>3. Your conversations will appear here</p>
                                </div>
                            )}
                            <div className="chat-features">
                                <div className="feature">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                    <span>Quick communication</span>
                                </div>
                                <div className="feature">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                                        <line x1="4" y1="22" x2="4" y2="15"></line>
                                    </svg>
                                    <span>Voice and video calls</span>
                                </div>
                                <div className="feature">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                    </svg>
                                    <span>File sharing</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Chat;
