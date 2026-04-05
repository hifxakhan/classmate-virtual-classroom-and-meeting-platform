import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import './manageMeeting.css';
import classMateLogo from './assets/Logo2.png';

function ManageMeeting() {
    const navigate = useNavigate();
    const [meetings, setMeetings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const teacherId = localStorage.getItem('teacherId');
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [teacher, setTeacher] = useState(null);
    const [cancelConfirm, setCancelConfirm] = useState({
        isOpen: false,
        sessionId: null,
        sessionTitle: null
    });

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    const navigateToProfile = () => {
        if (teacher) {
            navigate('/teacherProfile', {
                state: { teacher }
            });
        } else {
            navigate('/teacherProfile');
        }
    };

    useEffect(() => {
        const fetchTeacherProfile = async () => {
            try {
                const teacherEmail = localStorage.getItem('teacherEmail');
                if (!teacherEmail) {
                    navigate('/');
                    return;
                }

                const response = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/teacher/profile/current?email=${encodeURIComponent(teacherEmail)}`
                );

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                if (data.success && data.teacher) {
                    setTeacher(data.teacher);
                }
            } catch (err) {
                console.error('Error fetching teacher profile:', err);
            }
        };

        fetchTeacherProfile();
    }, [navigate]);

    useEffect(() => {
        const fetchMeetings = async () => {
            try {
                setLoading(true);
                setError(null);

                if (!teacherId) {
                    setError('Teacher not authenticated');
                    setLoading(false);
                    return;
                }

                console.log('Fetching meetings for teacher:', teacherId);

                const response = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/teacher/sessions?teacher_id=${teacherId}`
                );

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(
                        errorData.error || `HTTP error! status: ${response.status}`
                    );
                }

                const data = await response.json();

                if (data.success) {
                    console.log(`✅ Loaded ${data.sessions.length} meetings`);
                    setMeetings(data.sessions || []);
                } else {
                    throw new Error(data.error || 'Failed to load meetings');
                }
            } catch (err) {
                console.error('Error fetching meetings:', err);
                setError(err.message || 'Failed to load meetings');
                setMeetings([]);
            } finally {
                setLoading(false);
            }
        };

        fetchMeetings();
    }, [teacherId]);

    const handleScheduleMeeting = () => {
        navigate('/scheduleForm');
    };

    const handleUpdateMeeting = (sessionId) => {
        const meeting = meetings.find(m => m.session_id === sessionId);
        navigate('/updateForm', {
            state: {
                meeting: meeting,
                isEdit: true
            }
        });
    };

    const openCancelConfirm = (sessionId, sessionTitle) => {
        setCancelConfirm({
            isOpen: true,
            sessionId: sessionId,
            sessionTitle: sessionTitle
        });
    };

    const closeCancelConfirm = () => {
        setCancelConfirm({
            isOpen: false,
            sessionId: null,
            sessionTitle: null
        });
    };

    const isEditableSession = (meeting) => {
        // Check if meeting is still editable
        const now = new Date();
        const meetingEndTime = new Date(meeting.end_time);
        const meetingStatus = meeting.status?.toLowerCase();
        
        // Meeting cannot be edited if:
        // 1. Status is 'cancelled' or 'completed'
        // 2. Meeting end time has passed
        if (meetingStatus === 'cancelled' || meetingStatus === 'completed') {
            return false;
        }
        
        if (meetingEndTime < now) {
            return false;
        }
        
        return true;
    };

    const confirmCancelMeeting = async () => {
        const { sessionId } = cancelConfirm;

        try {
            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/sessions/${sessionId}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const data = await response.json();

            if (data.success) {
                alert(`Meeting cancelled successfully`);
                // Remove from local state
                setMeetings(prev => prev.filter(meeting => meeting.session_id !== sessionId));
            } else {
                alert(`Failed to cancel: ${data.error}`);
            }
        } catch (err) {
            console.error('Cancel error:', err);
            alert('Failed to cancel meeting. Please try again.');
        } finally {
            closeCancelConfirm();
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) {
            return dateString;
        }
    };

    const formatTime = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch (e) {
            return dateString;
        }
    };

    const getStatusColor = (status) => {
        switch (status?.toLowerCase()) {
            case 'scheduled':
                return '#3b82f6';
            case 'ongoing':
            case 'in-progress':
                return '#10b981';
            case 'completed':
                return '#6b7280';
            case 'cancelled':
                return '#ef4444';
            default:
                return '#567c8d';
        }
    };

    if (loading) {
        return (
            <div className="manage-meeting-loading">
                <div className="manage-meeting-spinner"></div>
                <p>Loading meetings...</p>
            </div>
        );
    }

    return (
        <div className="manage-meeting-container">
            {/* Navigation Bar */}
            <nav className="manage-meeting-navbar">
                <div className="manage-meeting-navbar-left">
                    <button
                        className={`manage-meeting-hamburger-menu ${isMenuOpen ? 'active' : ''}`}
                        onClick={toggleMenu}
                        aria-label="Toggle navigation menu"
                    >
                        <span className="manage-meeting-hamburger-line"></span>
                        <span className="manage-meeting-hamburger-line"></span>
                        <span className="manage-meeting-hamburger-line"></span>
                    </button>

                    <div className="manage-meeting-logo-container">
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="manage-meeting-navbar-logo"
                        />
                        <span className="manage-meeting-brand-name">classMate</span>
                    </div>
                </div>

                <div className="manage-meeting-navbar-right">
                    <div className="manage-meeting-user-profile"
                        onClick={navigateToProfile}
                        style={{ cursor: 'pointer' }}
                    >
                        <div className="manage-meeting-user-avatar">
                            {teacher?.name?.charAt(0) || 'T'}
                        </div>
                        <span className="manage-meeting-user-name">{teacher?.name || 'Teacher'}</span>
                    </div>
                </div>
            </nav>

            {/* Side Navigation */}
            <div className={`manage-meeting-side-nav ${isMenuOpen ? 'open' : ''}`}>
                <div className="manage-meeting-side-nav-header">
                    <h3>Dashboard Menu</h3>
                    <button className="manage-meeting-close-menu" onClick={toggleMenu} aria-label="Close menu">
                        &times;
                    </button>
                </div>

                <nav className="manage-meeting-nav-links">
                    <a href="/teacherDashboard" className="manage-meeting-nav-link">
                        <span className="manage-meeting-nav-icon"></span>
                        Dashboard Overview
                    </a>
                    <a href="/scheduleForm" className="manage-meeting-nav-link">
                        <span className="manage-meeting-nav-icon"></span>
                        Schedule Meetings
                    </a>
                    <a href="/manageMeeting" className="manage-meeting-nav-link active">
                        <span className="manage-meeting-nav-icon"></span>
                        Manage Meetings
                    </a>
                    <a href="/chatPage" className="manage-meeting-nav-link">
                        <span className="manage-meeting-nav-icon"></span>
                        Live Chat
                    </a>
                    <a href="/teacherProfile" className="manage-meeting-nav-link">
                        <span className="manage-meeting-nav-icon"></span>
                        Profile Settings
                    </a>
                    <a href="/" className="manage-meeting-nav-link logout">
                        <span className="manage-meeting-nav-icon"></span>
                        Logout
                    </a>
                </nav>
            </div>

            {/* Overlay */}
            {isMenuOpen && (
                <div className="manage-meeting-overlay" onClick={toggleMenu}></div>
            )}

            {/* Main Content */}
            <div className="manage-meeting-content-wrapper">
                {/* Header Section */}
                <div className="manage-meeting-header-section">
                    <div className="manage-meeting-header-info">
                        <h1 className="manage-meeting-main-title">Manage Meetings</h1>
                        <p className="manage-meeting-subtitle">
                            View and manage all your scheduled meetings
                        </p>
                    </div>

                    <div className="manage-meeting-header-actions">
                        <button
                            className="manage-meeting-back-btn"
                            onClick={() => navigate('/teacherDashboard')}
                        >
                            ← Back to Dashboard
                        </button>
                        <button
                            className="manage-meeting-schedule-btn"
                            onClick={handleScheduleMeeting}
                        >
                            + Schedule Meeting
                        </button>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="manage-meeting-error">
                        <h2>Error Loading Meetings</h2>
                        <p className="manage-meeting-error-message">{error}</p>
                        <button
                            className="manage-meeting-retry-btn"
                            onClick={() => window.location.reload()}
                        >
                            ↻ Retry
                        </button>
                    </div>
                )}

                {/* Meetings List */}
                {!error && (
                    <div className="manage-meeting-list-container">
                        {meetings.length === 0 ? (
                            <div className="manage-meeting-empty-state">
                                <div className="manage-meeting-empty-content">
                                    <div className="manage-meeting-empty-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="60" height="60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                            <line x1="16" y1="2" x2="16" y2="6"></line>
                                            <line x1="8" y1="2" x2="8" y2="6"></line>
                                            <line x1="3" y1="10" x2="21" y2="10"></line>
                                        </svg>
                                    </div>
                                    <h3 className="manage-meeting-empty-title">No Meetings Scheduled</h3>
                                    <p className="manage-meeting-empty-description">
                                        You haven't scheduled any meetings yet. Create your first meeting!
                                    </p>
                                    <button
                                        className="manage-meeting-schedule-first-btn"
                                        onClick={handleScheduleMeeting}
                                    >
                                        + Schedule Your First Meeting
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="manage-meeting-cards-grid">
                                {meetings.map((meeting) => (
                                    <div key={meeting.session_id} className="manage-meeting-card">
                                        <div className="manage-meeting-card-header">
                                            <div className="manage-meeting-card-title-section">
                                                <h3 className="manage-meeting-card-title">
                                                    {meeting.title || meeting.session_title}
                                                </h3>
                                                <span
                                                    className="manage-meeting-status-badge"
                                                    style={{ backgroundColor: getStatusColor(meeting.status) }}
                                                >
                                                    {meeting.status || 'Scheduled'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="manage-meeting-card-content">
                                            <div className="manage-meeting-info-grid">
                                                <div className="manage-meeting-info-item">
                                                    <label>Course:</label>
                                                    <p>{meeting.course_code || 'N/A'} - {meeting.course_title || 'N/A'}</p>
                                                </div>
                                                <div className="manage-meeting-info-item">
                                                    <label>Date:</label>
                                                    <p>{formatDate(meeting.start_time)}</p>
                                                </div>
                                                <div className="manage-meeting-info-item">
                                                    <label>Start Time:</label>
                                                    <p>{formatTime(meeting.start_time)}</p>
                                                </div>
                                                <div className="manage-meeting-info-item">
                                                    <label>End Time:</label>
                                                    <p>{formatTime(meeting.end_time)}</p>
                                                </div>
                                            </div>

                                            {meeting.description && (
                                                <div className="manage-meeting-description">
                                                    <label>Description:</label>
                                                    <p>{meeting.description}</p>
                                                </div>
                                            )}

                                            <div className="manage-meeting-additional-info">
                                                {meeting.is_private && (
                                                    <span className="manage-meeting-badge manage-meeting-private">
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                                        </svg>
                                                        Private
                                                    </span>
                                                )}
                                                {meeting.participants_count && (
                                                    <span className="manage-meeting-badge manage-meeting-participants">
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                                            <circle cx="9" cy="7" r="4"></circle>
                                                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                                        </svg>
                                                        {meeting.participants_count} Participants
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="manage-meeting-card-footer">
                                            {isEditableSession(meeting) ? (
                                                <>
                                                    <button
                                                        className="manage-meeting-action-btn manage-meeting-update-btn"
                                                        onClick={() => handleUpdateMeeting(meeting.session_id)}
                                                    >
                                                        Update
                                                    </button>
                                                    <button
                                                        className="manage-meeting-action-btn manage-meeting-cancel-btn"
                                                        onClick={() => openCancelConfirm(meeting.session_id, meeting.title || meeting.session_title)}
                                                    >
                                                        Cancel
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="manage-meeting-cancelled-text">
                                                        {meeting.status?.toLowerCase() === 'completed' ? 'Meeting completed' : 'Meeting has ended'}
                                                    </p>
                                                    {meeting.status?.toLowerCase() === 'completed' && (
                                                        <button
                                                            className="manage-meeting-action-btn manage-meeting-attendance-btn"
                                                            onClick={() => navigate(`/attendance/${meeting.session_id}`)}
                                                        >
                                                            <i className="fas fa-chart-bar"></i> View Attendance
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Cancel Confirmation Modal */}
            {cancelConfirm.isOpen && (
                <div className="manage-meeting-modal-overlay">
                    <div className="manage-meeting-modal-content">
                        <div className="manage-meeting-modal-header">
                            <h2 className="manage-meeting-modal-title">Cancel Meeting?</h2>
                        </div>
                        <div className="manage-meeting-modal-body">
                            <p className="manage-meeting-modal-message">
                                Are you sure you want to cancel <strong>"{cancelConfirm.sessionTitle}"</strong>?
                            </p>
                            <p className="manage-meeting-modal-warning">
                                This action cannot be undone and students will be notified.
                            </p>
                        </div>
                        <div className="manage-meeting-modal-footer">
                            <button
                                className="manage-meeting-modal-btn manage-meeting-modal-cancel"
                                onClick={closeCancelConfirm}
                            >
                                Cancel
                            </button>
                            <button
                                className="manage-meeting-modal-btn manage-meeting-modal-delete"
                                onClick={confirmCancelMeeting}
                            >
                                Cancel Meeting
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ManageMeeting;
