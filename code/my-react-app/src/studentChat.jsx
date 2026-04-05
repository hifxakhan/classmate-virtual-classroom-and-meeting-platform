import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './chat.css'; // Using the same CSS file
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

function StudentChat() {
    const navigate = useNavigate();

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

    // Fetch current student info
    const [currentStudent, setCurrentStudent] = useState(null);

    // Ref for scroll to bottom
    const messagesEndRef = useRef(null);

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

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Load current student info on component mount
    useEffect(() => {
        const fetchCurrentStudent = async () => {
            try {
                const studentEmail = localStorage.getItem('studentEmail');
                if (!studentEmail) {
                    console.error('No student email found in localStorage');
                    navigate('/');
                    return;
                }

                const response = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/student/get-current?email=${encodeURIComponent(studentEmail)}`
                );

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        setCurrentStudent(data.student);
                        console.log('Current student loaded:', data.student);

                        // Start polling after student is loaded
                        startPolling();
                    }
                } else {
                    console.error('Failed to fetch student profile');
                }
            } catch (error) {
                console.error('Error fetching student:', error);
            }
        };

        fetchCurrentStudent();

        // Cleanup on unmount
        return () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
        };
    }, [navigate]);

    // Load conversations when currentStudent is set
    useEffect(() => {
        if (currentStudent) {
            console.log('CurrentStudent changed, loading conversations...');
            loadConversations();
        }
    }, [currentStudent]);

    // Start polling for new messages
    const startPolling = () => {
        if (!currentStudent || pollingInterval) return;

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
        if (!file || !activeChat || !currentStudent) return;

        // Check size (max 10MB for database storage)
        if (file.size > 10 * 1024 * 1024) {
            alert("File too large! Max 10MB");
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('sender_id', currentStudent.student_id);
        formData.append('sender_type', 'student');
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
                    sender: 'student',
                    sender_id: currentStudent.student_id,
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
    const getFileIcon = (fileType) => {
        if (!fileType) return '📎';

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
        if (!currentStudent || isPolling) return;

        setIsPolling(true);

        try {
            const params = new URLSearchParams({
                user_id: currentStudent.student_id,
                user_type: 'student'
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

    // Process new messages from polling
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
        if (!currentStudent) return;

        try {
            console.log('Loading conversations for student:', currentStudent.student_id);

            // Use the new student-specific endpoint
            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/student-conversations-simple?student_id=${currentStudent.student_id}`
            );

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    // Convert API response to frontend chat format
                    const formattedChats = data.conversations.map(conv => {
                        // Determine last message preview
                        let lastMessagePreview = conv.last_message.text || 'No messages yet';
                        if (conv.last_message.has_file) {
                            lastMessagePreview = `📎 ${conv.last_message.file_info.name}`;
                        } else if (lastMessagePreview.length > 30) {
                            lastMessagePreview = lastMessagePreview.substring(0, 30) + '...';
                        }

                        return {
                            id: `chat-${currentStudent.student_id}-${conv.partner.id}-${conv.partner.type}`,
                            userId: conv.partner.id,
                            name: conv.partner.name,
                            role: conv.partner.role,
                            avatar: conv.partner.avatar,
                            lastMessage: lastMessagePreview,
                            timestamp: conv.last_message.timestamp
                                ? new Date(conv.last_message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            unread: conv.unread_count,
                            online: false, // You can implement online status separately
                            user_type: conv.partner.type,
                            message_count: conv.total_messages,
                            lastMessageIsFromMe: false, // Will update based on last message check
                            department: conv.partner.department,
                            email: conv.partner.email
                        };
                    });

                    setChats(formattedChats);
                    console.log(`✅ Loaded ${formattedChats.length} conversations from API`);

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

                // Fall back to the old endpoint if the new one fails
                console.log('Falling back to generic conversations endpoint...');
                await loadConversationsFallback();
            }
        } catch (error) {
            console.error('Error loading conversations:', error);

            // Fall back to the old endpoint
            await loadConversationsFallback();
        }
    };

    const loadConversationsFallback = async () => {
        try {
            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/conversations?user_id=${currentStudent.student_id}&user_type=student`
            );

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    // Convert API response to frontend chat format (same as before)
                    const formattedChats = data.conversations.map(conv => ({
                        id: `chat-${currentStudent.student_id}-${conv.other_user.id}`,
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
                    console.log(`Loaded ${formattedChats.length} conversations from fallback API`);
                }
            }
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
        }
    };

    // Perform search when debounced query changes
    useEffect(() => {
        const performSearch = async () => {
            if (debouncedSearchQuery.trim().length > 0 && currentStudent) {
                setIsSearching(true);

                try {
                    const response = await fetch(
                        `https://classmate-backend-eysi.onrender.com/api/chat/search?q=${encodeURIComponent(debouncedSearchQuery)}&current_user_id=${currentStudent.student_id}&current_user_type=student`
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
    }, [debouncedSearchQuery, currentStudent]);

    // Handle search input change
    const handleSearch = (e) => {
        const query = e.target.value;
        setSearchQuery(query);
    };

    // Load messages for a specific user
    const loadMessages = async (userId, userType) => {
        if (!currentStudent) return;

        try {
            console.log(`Loading messages between student ${currentStudent.student_id} and ${userType} ${userId}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/messages?user1_id=${currentStudent.student_id}&user1_type=student&user2_id=${userId}&user2_type=${userType}&limit=100`
            );

            if (response.ok) {
                const data = await response.json();

                if (data.success && data.messages) {
                    // Convert API response to frontend message format - WITH FILE DATA
                    const formattedMessages = data.messages.map(msg => {
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

        if (!currentStudent) {
            console.error('No current student found');
            alert('Unable to start chat. Please refresh the page.');
            return;
        }

        try {
            // First check if conversation already exists
            const checkResponse = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/chat/conversation?user1_id=${currentStudent.student_id}&user1_type=student&user2_id=${user.id}&user2_type=${user.user_type}`
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
                            sender_id: currentStudent.student_id,
                            sender_type: 'student',
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
                id: conversationData ? `chat-${currentStudent.student_id}-${user.id}` : Date.now(),
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
                lastMessageIsFromMe: conversationData?.last_message?.sender_id === currentStudent.student_id
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

        if (!messageInput.trim() || !activeChat || !currentStudent) return;

        try {
            // Save message to backend
            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/chat/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_id: currentStudent.student_id,
                    sender_type: 'student',
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
                sender: 'student',
                sender_id: currentStudent.student_id,
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
        navigate('/studentDashboard');
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
                    <div className="user-profile-info">
                        <span className="user-name">
                            {currentStudent?.name || 'Loading...'}
                        </span>
                        <button className="chat-back-btn" onClick={handleBackToDashboard}>
                            ← Back to Dashboard
                        </button>
                    </div>
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
                                placeholder="Search teachers, students, admins..."
                                value={searchQuery}
                                onChange={handleSearch}
                                disabled={!currentStudent}
                            />
                            {!currentStudent && (
                                <div className="search-loading-text">Loading student info...</div>
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
                                    {currentStudent ? (
                                        <>
                                            <p>No users found matching "{searchQuery}"</p>
                                            <p className="search-tip">Try searching by name or email</p>
                                        </>
                                    ) : (
                                        <p>Loading student information...</p>
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
                                        {isPolling && (
                                            <span className="polling-status">• Live updates</span>
                                        )}
                                    </div>
                                </div>
                                <div className="chat-box-actions">
                                    <button className="chat-action-btn" title="Voice call">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                        </svg>
                                    </button>
                                    <button className="chat-action-btn" title="Video call">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M23 7l-7 5 7 5V7z" />
                                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Messages Container */}
                            <div className="messages-container">
                                {messages.length === 0 ? (
                                    <div className="no-messages">
                                        <div className="no-messages-icon">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                            </svg>
                                        </div>
                                        <h3>No messages yet</h3>
                                        <p>Start the conversation by sending a message!</p>
                                        <button
                                            className="start-conversation-btn"
                                            onClick={() => setMessageInput(`Hi ${activeChat.name}! 👋`)}
                                        >
                                            Say Hello
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="messages-list">
                                            {(() => {
                                                const groupedMessages = groupMessagesByDate(messages);
                                                const sortedDates = Object.keys(groupedMessages).sort();
                                                
                                                return sortedDates.flatMap((dateKey) => [
                                                    <div key={`separator-${dateKey}`} className="date-separator">
                                                        <span>{getDateLabel(new Date(dateKey))}</span>
                                                    </div>,
                                                    ...groupedMessages[dateKey].map((message) => (
                                                        <div
                                                            key={message.id}
                                                            className={`message ${message.is_from_me ? 'sent' : 'received'}`}
                                                        >
                                                            <div className="message-content">
                                                                <div className="message-text">
                                                                    {message.text}

                                                                    {/* File Attachment Display */}
                                                                    {message.has_file && message.file && (
                                                                        <div
                                                                            className="file-attachment"
                                                                            onClick={() => handleDownloadFile(message.id, message.file.name)}
                                                                        >
                                                                            <div className="file-icon">
                                                                                {getFileIcon(message.file.type)}
                                                                            </div>
                                                                            <div className="file-info">
                                                                                <div className="file-name">{message.file.name}</div>
                                                                                <div className="file-size">{formatFileSize(message.file.size)}</div>
                                                                            </div>
                                                                            <div className="file-download-btn">
                                                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                                    <polyline points="7 10 12 15 17 10" />
                                                                                    <line x1="12" y1="15" x2="12" y2="3" />
                                                                                </svg>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="message-meta">
                                                                    <span className="message-time">{message.time}</span>
                                                                    {message.is_from_me && (
                                                                        <span className="message-status">
                                                                            {message.is_read ? (
                                                                                <span className="read-status" title="Read">
                                                                                    ✓✓
                                                                                </span>
                                                                            ) : (
                                                                                <span className="sent-status" title="Sent">
                                                                                    ✓
                                                                                </span>
                                                                            )}
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
                                    </>
                                )}
                            </div>

                            {/* Message Input Area */}
                            <div className="message-input-container">
                                <form onSubmit={handleSendMessage}>
                                    <div className="message-input-wrapper">
                                        {/* File Upload Button */}
                                        <label className="file-upload-btn" title="Upload file">
                                            <input
                                                type="file"
                                                onChange={handleFileUpload}
                                                style={{ display: 'none' }}
                                            />
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                            </svg>
                                        </label>

                                        {/* Message Input */}
                                        <input
                                            type="text"
                                            className="message-input"
                                            placeholder="Type a message..."
                                            value={messageInput}
                                            onChange={(e) => setMessageInput(e.target.value)}
                                            onKeyPress={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSendMessage(e);
                                                }
                                            }}
                                        />

                                        {/* Send Button */}
                                        <button
                                            type="submit"
                                            className="send-button"
                                            disabled={!messageInput.trim()}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="22" y1="2" x2="11" y2="13" />
                                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                            </svg>
                                        </button>
                                    </div>
                                </form>

                                {/* File upload info */}
                                <div className="file-upload-info">
                                    <small>Max file size: 10MB • Supported: PDF, Images, Docs</small>
                                </div>
                            </div>
                        </>
                    ) : (
                        /* No Chat Selected View */
                        <div className="no-chat-selected">
                            <div className="no-chat-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                            </div>
                            <h2>Welcome to ClassMate Chat</h2>
                            <p>Select a conversation from the left or search for a user to start chatting</p>
                            <div className="chat-features">
                                <div className="feature">
                                    <div className="feature-icon">🔍</div>
                                    <h4>Search Users</h4>
                                    <p>Find teachers, students, or administrators</p>
                                </div>
                                <div className="feature">
                                    <div className="feature-icon">📎</div>
                                    <h4>Share Files</h4>
                                    <p>Upload documents, images, and PDFs</p>
                                </div>
                                <div className="feature">
                                    <div className="feature-icon">🔔</div>
                                    <h4>Real-time Updates</h4>
                                    <p>Get instant notifications for new messages</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="chat-footer">
                <div className="chat-footer-left">
                    <span className="footer-text">
                        ClassMate Chat • Real-time communication for students
                    </span>
                    {isPolling && (
                        <span className="connection-status">
                            <span className="connection-dot connected"></span>
                            Connected
                        </span>
                    )}
                </div>
                <div className="chat-footer-right">
                    <span className="message-count-total">
                        Total conversations: {chats.length}
                    </span>
                    {currentStudent && (
                        <span className="student-id">
                            Student ID: {currentStudent.student_id}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default StudentChat;
