import React, { useState } from 'react';
import LiveChat from './liveChat';
import VideoCall from './videoCall';
import './communicationPage.css';

/**
 * Integration Example - How to use Live Chat & Video Call components
 * 
 * This example shows how to integrate both features into your classroom interface
 */

const CommunicationPage = ({ 
  currentUser = {
    id: 'teacher1',
    type: 'teacher',
    name: 'Prof. John Smith'
  },
  selectedUser = {
    id: 'student1',
    type: 'student',
    name: 'John Doe'
  }
}) => {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'video'
  const [callInProgress, setCallInProgress] = useState(false);

  return (
    <div className="communication-page">
      <div className="communication-header">
        <h1>Classroom Communication</h1>
        <p className="subtitle">with {selectedUser.name}</p>
      </div>

      <div className="communication-container">
        {/* Tab Navigation */}
        <div className="communication-tabs">
          <button
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <span>💬</span> Chat
          </button>
          <button
            className={`tab-btn ${activeTab === 'video' ? 'active' : ''}`}
            onClick={() => setActiveTab('video')}
          >
            <span>📹</span> Video Call
          </button>
        </div>

        {/* Content Area */}
        <div className="communication-content">
          {/* Chat Tab */}
          {activeTab === 'chat' && (
            <div className="chat-tab-content">
              <LiveChat
                currentUserId={currentUser.id}
                currentUserType={currentUser.type}
                otherUserId={selectedUser.id}
                otherUserType={selectedUser.type}
                otherUserName={selectedUser.name}
              />
            </div>
          )}

          {/* Video Call Tab */}
          {activeTab === 'video' && (
            <div className="video-tab-content">
              <VideoCall
                currentUserId={currentUser.id}
                currentUserType={currentUser.type}
                otherUserId={selectedUser.id}
                otherUserType={selectedUser.type}
                otherUserName={selectedUser.name}
                onCallEnd={() => setCallInProgress(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommunicationPage;

/**
 * ALTERNATIVE EXAMPLE - Split Layout (Chat + Video Side by Side)
 */

export const SplitLayoutCommunication = ({ currentUser, selectedUser }) => {
  return (
    <div className="split-communication-layout">
      <div className="split-chat-section">
        <h3>Chat</h3>
        <LiveChat
          currentUserId={currentUser.id}
          currentUserType={currentUser.type}
          otherUserId={selectedUser.id}
          otherUserType={selectedUser.type}
          otherUserName={selectedUser.name}
        />
      </div>

      <div className="split-video-section">
        <h3>Video Call</h3>
        <VideoCall
          currentUserId={currentUser.id}
          currentUserType={currentUser.type}
          otherUserId={selectedUser.id}
          otherUserType={selectedUser.type}
          otherUserName={selectedUser.name}
          onCallEnd={() => {}}
        />
      </div>
    </div>
  );
};

/**
 * TEACHER DASHBOARD EXAMPLE - Showing multiple students
 */

export const TeacherDashboard = ({ teacher }) => {
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [students] = useState([
    { id: 'student1', type: 'student', name: 'Alice Johnson', status: 'online' },
    { id: 'student2', type: 'student', name: 'Bob Smith', status: 'online' },
    { id: 'student3', type: 'student', name: 'Carol Davis', status: 'offline' },
    { id: 'student4', type: 'student', name: 'David Wilson', status: 'online' },
  ]);

  if (!selectedStudent) {
    return (
      <div className="teacher-dashboard">
        <h2>Select a Student to Communicate</h2>
        <div className="student-list">
          {students.map((student) => (
            <div
              key={student.id}
              className={`student-card ${student.status}`}
              onClick={() => setSelectedStudent(student)}
            >
              <div className="student-avatar">
                {student.name[0].toUpperCase()}
              </div>
              <div className="student-info">
                <h4>{student.name}</h4>
                <span className={`status ${student.status}`}>
                  {student.status === 'online' ? '🟢 Online' : '⚪ Offline'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="teacher-dashboard">
      <button
        className="back-btn"
        onClick={() => setSelectedStudent(null)}
      >
        ← Back to Students
      </button>
      <CommunicationPage
        currentUser={{ ...teacher, type: 'teacher' }}
        selectedUser={selectedStudent}
      />
    </div>
  );
};

/**
 * STUDENT VIEW EXAMPLE - Chat with teacher
 */

export const StudentView = ({ student, teacher }) => {
  return (
    <div className="student-view">
      <div className="student-view-header">
        <h2>Chat with {teacher.name}</h2>
        <p className="teacher-info">
          📚 {teacher.department || 'Department'}
        </p>
      </div>

      <CommunicationPage
        currentUser={{ ...student, type: 'student' }}
        selectedUser={{ ...teacher, type: 'teacher' }}
      />
    </div>
  );
};

/**
 * MODAL EXAMPLE - Floating Communication Modal
 */

export const CommunicationModal = ({ 
  isOpen, 
  onClose, 
  currentUser, 
  selectedUser 
}) => {
  if (!isOpen) return null;

  return (
    <div className="communication-modal-overlay" onClick={onClose}>
      <div 
        className="communication-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Chat with {selectedUser.name}</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <LiveChat
          currentUserId={currentUser.id}
          currentUserType={currentUser.type}
          otherUserId={selectedUser.id}
          otherUserType={selectedUser.type}
          otherUserName={selectedUser.name}
        />
      </div>
    </div>
  );
};

/**
 * HOOK EXAMPLE - Custom hook for managing communication state
 */

export const useCommunication = (currentUserId, currentUserType) => {
  const [selectedUser, setSelectedUser] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [activeTab, setActiveTab] = useState('chat');

  const loadUnreadCounts = async () => {
    try {
      const response = await fetch(
        `/api/chat/unread-count/${currentUserId}/${currentUserType}`
      );
      const data = await response.json();
      setUnreadCounts(prev => ({
        ...prev,
        [selectedUser?.id]: data.unread_count
      }));
    } catch (error) {
      console.error('Error loading unread counts:', error);
    }
  };

  return {
    selectedUser,
    setSelectedUser,
    unreadCounts,
    loadUnreadCounts,
    activeTab,
    setActiveTab
  };
};

/**
 * API INTEGRATION EXAMPLE - Using the endpoints
 */

export const communicationAPI = {
  // Chat functions
  async sendMessage(senderInfo, receiverInfo, content) {
    const response = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_id: senderInfo.id,
        sender_type: senderInfo.type,
        receiver_id: receiverInfo.id,
        receiver_type: receiverInfo.type,
        content: content,
        message_type: 'text'
      })
    });
    return response.json();
  },

  async getMessages(userId, userType, otherId, otherType, limit = 50) {
    const response = await fetch(
      `/api/chat/messages/${userId}/${userType}/${otherId}/${otherType}?limit=${limit}`
    );
    return response.json();
  },

  async markAsRead(messageId) {
    const response = await fetch(`/api/chat/mark-read/${messageId}`, {
      method: 'PUT'
    });
    return response.json();
  },

  // Video call functions
  async initiateCall(initiatorInfo, receiverInfo) {
    const response = await fetch('/api/video-call/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiator_id: initiatorInfo.id,
        initiator_type: initiatorInfo.type,
        receiver_id: receiverInfo.id,
        receiver_type: receiverInfo.type
      })
    });
    return response.json();
  },

  async acceptCall(callId) {
    const response = await fetch(`/api/video-call/${callId}/accept`, {
      method: 'PUT'
    });
    return response.json();
  },

  async endCall(callId) {
    const response = await fetch(`/api/video-call/${callId}/end`, {
      method: 'PUT'
    });
    return response.json();
  }
};

/**
 * FULL PAGE INTEGRATION EXAMPLE
 */

export const FullCommunicationPage = () => {
  const currentUser = {
    id: 'teacher1',
    type: 'teacher',
    name: 'Prof. John Smith',
    department: 'Computer Science'
  };

  const [selectedUser, setSelectedUser] = useState({
    id: 'student1',
    type: 'student',
    name: 'John Doe'
  });

  return (
    <div className="full-page-layout">
      <div className="sidebar">
        <div className="user-info">
          <h3>{currentUser.name}</h3>
          <p>{currentUser.type}</p>
        </div>

        <div className="contacts-list">
          <h4>Contacts</h4>
          {/* List of contacts here */}
        </div>
      </div>

      <div className="main-content">
        <CommunicationPage
          currentUser={currentUser}
          selectedUser={selectedUser}
        />
      </div>

      <div className="info-sidebar">
        <h4>User Info</h4>
        <p><strong>Name:</strong> {selectedUser.name}</p>
        <p><strong>Type:</strong> {selectedUser.type}</p>
      </div>
    </div>
  );
};
