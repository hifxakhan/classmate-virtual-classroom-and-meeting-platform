import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import './studentDashboard.css';
import classMateLogo from './assets/Logo2.png';
import { useTimezone } from './contexts/TimezoneContext.jsx';
import { formatPKTDate, formatPKTTime } from './utils/dateUtils';
import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

function StudentDashboard() {
    const navigate = useNavigate();
    const { timezone } = useTimezone();

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showAllCourses, setShowAllCourses] = useState(false);
    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [courses, setCourses] = useState([]);
    const [coursesLoading, setCoursesLoading] = useState(false);
    const [coursesError, setCoursesError] = useState(null);
    const [todaysSchedule, setTodaysSchedule] = useState([]);
    const [scheduleLoading, setScheduleLoading] = useState(false);
    const [scheduleError, setScheduleError] = useState(null);
    const [chatUnreadCount, setChatUnreadCount] = useState(0);
    const [recentSessions, setRecentSessions] = useState([]);
    const [recentSessionsLoading, setRecentSessionsLoading] = useState(false);
    const [recentGrades, setRecentGrades] = useState([]);
    const [recentGradesLoading, setRecentGradesLoading] = useState(false);
    const [performanceStats, setPerformanceStats] = useState(null);
    const [performanceStatsLoading, setPerformanceStatsLoading] = useState(false);

    const fetchPerformanceStats = async () => {
        try {
            setPerformanceStatsLoading(true);
            const email = localStorage.getItem('studentEmail');
            if (!email) return;
            const r = await fetch(`${API_BASE}/api/student/performance-stats?email=${encodeURIComponent(email)}`);
            const d = await r.json();
            if (d.success) setPerformanceStats(d.stats);
        } catch {
            // silently ignore
        } finally {
            setPerformanceStatsLoading(false);
        }
    };

    const fetchRecentSessions = async () => {
        try {
            setRecentSessionsLoading(true);
            const email = localStorage.getItem('studentEmail');
            if (!email) return;
            const r = await fetch(`${API_BASE}/api/student/sessions/recent?email=${encodeURIComponent(email)}&limit=8`);
            const d = await r.json();
            if (d.success) setRecentSessions(d.sessions || []);
        } catch {
            // silently ignore
        } finally {
            setRecentSessionsLoading(false);
        }
    };

    const fetchTodaySchedule = async () => {
        try {
            setScheduleLoading(true);
            setScheduleError(null);

            const studentEmail = localStorage.getItem('studentEmail');
            

            if (!studentEmail) {
                console.log('No student email found');
                return;
            }

            // Fetch today's schedule from backend
            const response = await fetch(`https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/student/today-schedule?email=${studentEmail}&timezone=${encodeURIComponent(timezone)}`);

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                setTodaysSchedule(data.sessions);
                console.log(`📅 Loaded ${data.sessions.length} sessions for today`);
            } else {
                throw new Error(data.error || 'Failed to fetch today\'s schedule');
            }
        } catch (err) {
            console.error('❌ Error fetching today\'s schedule:', err);
            setScheduleError(err.message);
            setTodaysSchedule([]);
        } finally {
            setScheduleLoading(false);
        }
    };

    const fetchEnrolledCourses = async () => {
        try {
            setCoursesLoading(true);
            setCoursesError(null);

            const studentEmail = localStorage.getItem('studentEmail');

            if (!studentEmail) {
                console.log('No student email found');
                return;
            }

            // Fetch enrolled courses from backend
            const response = await fetch(`https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/student/enrolled-courses?email=${studentEmail}`);

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                setCourses(data.courses);
                console.log(`✅ Loaded ${data.courses.length} enrolled courses`);
            } else {
                throw new Error(data.error || 'Failed to fetch enrolled courses');
            }
        } catch (err) {
            console.error('❌ Error fetching enrolled courses:', err);
            setCoursesError(err.message);
            setCourses([]);
        } finally {
            setCoursesLoading(false);
        }
    };

    // Fetch student data from backend
    const fetchStudentData = async () => {
        try {
            setLoading(true);

            // Get student email from localStorage (after login)
            const studentEmail = localStorage.getItem('studentEmail');

            if (!studentEmail) {
                console.log('No student email found, redirecting to login');
                navigate('/'); // Redirect to login page
                return;
            }

            // Fetch student data from backend
            const response = await fetch(`https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/student/get-current?email=${studentEmail}`);

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                setStudent(data.student);
                console.log('✅ Student data loaded:', data.student);
                try {
                    // Persist canonical user info so other pages (chat, calls) can detect current user
                    if (data.student.student_id) localStorage.setItem('studentId', String(data.student.student_id));
                    if (data.student.name) localStorage.setItem('studentName', data.student.name);
                    if (data.student.email) localStorage.setItem('studentEmail', data.student.email);
                    const canonical = {
                        id: String(data.student.student_id || ''),
                        type: 'student',
                        name: data.student.name || '',
                        email: data.student.email || ''
                    };
                    localStorage.setItem('user', JSON.stringify(canonical));
                } catch (err) {
                    console.warn('Failed to persist student info to localStorage', err);
                }
            } else {
                throw new Error(data.error || 'Failed to fetch student data');
            }
        } catch (err) {
            console.error('❌ Error fetching student data:', err);
            setError(err.message);
            // No fallback data - show error message
        } finally {
            setLoading(false);
        }
    };

    // Initialize dashboard
    useEffect(() => {
        const initializeDashboard = async () => {
            await fetchStudentData();
            await fetchEnrolledCourses();
            await fetchTodaySchedule();
            fetchRecentSessions();
        };

        initializeDashboard();
    }, []);

    useEffect(() => {
        if (!student?.student_id) return;
        const fetchGrades = async () => {
            try {
                setRecentGradesLoading(true);
                const sid = student.student_id;
                const r = await fetch(`${API_BASE}/api/student/${encodeURIComponent(sid)}/grades`);
                const d = await r.json();
                if (r.ok && d.success) setRecentGrades(d.grades || []);
            } catch (e) {
                // ignore
            } finally {
                setRecentGradesLoading(false);
            }
        };

        let isMounted = true;

        const fetchUnreadCount = async () => {
            try {
                const response = await fetch(
                    `https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/chat/inbox/unread-total?user_id=${student.student_id}&user_type=student`
                );
                const data = await response.json();
                if (isMounted && data.success) {
                    setChatUnreadCount(data.unread_total || 0);
                }
            } catch (err) {
                console.error('Failed to fetch student unread chat count:', err);
            }
        };

        fetchGrades();
        fetchUnreadCount();
        const intervalId = setInterval(fetchUnreadCount, 10000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [student?.student_id]);

    const handleViewResources = () => {
        navigate('/studentResources');
    };

    const getGradeColor = (grade) => {
        switch (grade) {
            case 'A': return '#10b981';
            case 'B': return '#3b82f6';
            case 'C': return '#f59e0b';
            case 'D': return '#f97316';
            case 'F': return '#ef4444';
            default: return '#6b7280';
        }
    };

    const getGradeBackground = (grade) => {
        switch (grade) {
            case 'A': return '#d1fae5';
            case 'B': return '#dbeafe';
            case 'C': return '#fef3c7';
            case 'D': return '#ffedd5';
            case 'F': return '#fee2e2';
            default: return '#f3f4f6';
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return "";
        return formatPKTDate(dateString);
    };

    const formatNotificationTime = (dateString) => {
        if (!dateString) return "";
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return formatPKTDate(dateString);
    };

    const formatSchedule = (schedule) => {
        if (!schedule) return "Schedule not specified";
        return schedule;
    };

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    const handleViewAllCourses = () => {
        setShowAllCourses(!showAllCourses);
    };

    const navigateToProfile = () => {
        navigate('/studentProfile');
    };

    const handleViewCourse = (courseId, courseData) => {
        navigate('/studentCourseProfile', {
            state: {
                courseId: courseId,
                courseData: courseData
            }
        });
    };

    const handleJoinClass = (courseCode, courseId) => {
        // Use course code as meeting ID so teacher and student join same meeting
        const meetingId = courseCode;
        
        // Store current user info in localStorage for meeting room
        const currentUser = {
            id: localStorage.getItem('studentId') || 'student_' + Date.now(),
            type: 'student',
            name: localStorage.getItem('studentName') || 'Student',
            role: 'student'
        };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        // Navigate to meeting room
        navigate(`/meeting/${meetingId}`);
    };

    const handleJoinMeeting = (meetingRoomId) => {
        if (meetingRoomId && meetingRoomId !== '#') {
            // In real app: navigate to meeting or open in new tab
            window.open(`/meeting/${meetingRoomId}`, '_blank');
        } else {
            alert('Meeting link not available');
        }
    };

    const handleViewAssignment = (assignmentId) => {
        navigate(`/assignment/${assignmentId}`);
    };

    const handleLogout = () => {
        // Clear all student data from localStorage
        localStorage.removeItem('studentEmail');
        localStorage.removeItem('studentId');
        localStorage.removeItem('studentToken');
        // Redirect to login page
        navigate('/');
    };

    const refreshDashboard = async () => {
        await fetchStudentData();
        await fetchEnrolledCourses();
        await fetchTodaySchedule();
        fetchRecentSessions();
    };

    const formatSessionTime = (isoTimeString) => {
        if (!isoTimeString) return "Time not set";
        try {
            return formatPKTTime(isoTimeString);
        } catch (error) {
            return "Invalid time";
        }
    };

    const formatDuration = (minutes) => {
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            if (remainingMinutes === 0) {
                return `${hours}h`;
            }
            return `${hours}h ${remainingMinutes}m`;
        }
        return `${minutes}m`;
    };

    if (loading) {
        return (
            <div className="student-dashboard">
                <div className="student-loading-overlay">
                    <div className="student-loading-spinner"></div>
                    <p>Loading your dashboard...</p>
                </div>
            </div>
        );
    }

    if (error && !student) {
        return (
            <div className="student-error-container">
                <h2>Error Loading Dashboard</h2>
                <p>{error}</p>
                <div className="student-error-actions">
                    <button onClick={refreshDashboard}>Retry</button>
                    <button onClick={() => navigate('/')}>Go to Login</button>
                </div>
            </div>
        );
    }

    // Display data from database
    const displayName = student?.name || 'Student';
    const displayStudentId = student?.student_id || 'N/A';
    const displaySemester = student?.semester || 'N/A';
    const displayEmail = student?.email || 'N/A';
    const displayPhone = student?.phone || 'Not provided';
    const profileImageUrl = student?.profile_image_url;

    return (
        <div className="student-dashboard">
            {/* Navigation Bar */}
            <nav className="student-navbar">
                <div className="student-navbar-left">
                    <button
                        className={`student-hamburger-menu ${isMenuOpen ? 'active' : ''}`}
                        onClick={toggleMenu}
                        aria-label="Toggle navigation menu"
                    >
                        <span className="student-hamburger-line"></span>
                        <span className="student-hamburger-line"></span>
                        <span className="student-hamburger-line"></span>
                    </button>

                    <div className="student-logo-container">
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="student-navbar-logo"
                        />
                        <span className="student-brand-name">classMate</span>
                    </div>
                </div>

                <div className="student-navbar-right">
                    <div className="student-user-profile"
                        onClick={navigateToProfile}
                        style={{ cursor: 'pointer' }}
                    >
                        <div className="student-user-avatar">
                            {displayName.charAt(0)}
                        </div>
                        <span className="student-user-name">{displayName}</span>
                    </div>
                </div>
            </nav>

            {/* Side Navigation Panel */}
            <div className={`student-side-nav ${isMenuOpen ? 'open' : ''}`}>
                <div className="student-side-nav-header">
                    <h3>Student Menu</h3>
                    <button className="student-close-menu" onClick={toggleMenu} aria-label="Close menu">
                        &times;
                    </button>
                </div>

                <div className="student-nav-menu">
                    <div className="student-nav-user-info">
                        <div className="student-side-user-avatar">
                            {displayName.charAt(0)}
                        </div>
                        <div className="student-side-user-details">
                            <h4>{displayName}</h4>
                            <p className="student-user-role">Student • Semester {displaySemester}</p>
                            <p className="student-user-id">ID: {displayStudentId}</p>
                        </div>
                    </div>

                    <nav className="student-nav-links">
                        <a href="/studentDashboard" className="student-nav-link active">
                            <i className="fas fa-tachometer-alt"></i>
                            Dashboard Overview
                        </a>
                        <a href="/studentSchedule" className="student-nav-link">
                            <i className="fas fa-calendar-alt"></i>
                            My Schedule
                        </a>
                        <a href="/studentCourses" className="student-nav-link">
                            <i className="fas fa-book"></i>
                            My Courses
                        </a>
                        <a href="/studentQuizzes" className="student-nav-link">
                            <i className="fas fa-file-alt"></i>
                            Exams
                        </a>
                        <a href="/chatPage" className="student-nav-link">
                            <i className="fas fa-comments"></i>
                            Live Chat {chatUnreadCount > 0 ? `(${chatUnreadCount})` : ''}
                        </a>
                        <a href="/studentAssignments" className="student-nav-link">
                            <i className="fas fa-tasks"></i>
                            Assignments
                        </a>
                        <a href="/studentGrades" className="student-nav-link">
                            <i className="fas fa-chart-line"></i>
                            Grades
                        </a>
                        <button
                            className="student-nav-link logout"
                            onClick={handleLogout}
                            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
                        >
                            <i className="fas fa-sign-out-alt"></i>
                            Logout
                        </button>
                    </nav>
                </div>
            </div>

            {isMenuOpen && (
                <div className="student-overlay" onClick={toggleMenu}></div>
            )}

            {/* Main Dashboard Content */}
            <div className="student-dashboard-content">
                {/* Student Info Bar */}
                <div className="student-info-bar">
                    <div className="student-profile-picture-container">
                        {profileImageUrl ? (
                            <img
                                src={profileImageUrl}
                                alt="Profile"
                                className="student-profile-picture-img"
                            />
                        ) : (
                            <div className="student-profile-picture">
                                {displayName.charAt(0)}
                            </div>
                        )}
                        <div className="student-profile-status">
                            <span className="student-status-dot"></span>
                            <span>Active</span>
                        </div>
                    </div>
                    <div className="student-info-item">
                        <span className="student-info-label">Name:</span>
                        <span className="student-info-value">{displayName}</span>
                    </div>
                    <div className="student-info-item">
                        <span className="student-info-label">Student ID:</span>
                        <span className="student-info-value">{displayStudentId}</span>
                    </div>
                    <div className="student-info-item">
                        <span className="student-info-label">Email:</span>
                        <span className="student-info-value">{displayEmail}</span>
                    </div>
                    <div className="student-info-item">
                        <span className="student-info-label">Semester:</span>
                        <span className="student-info-value">{displaySemester}</span>
                    </div>
                    <div className="student-info-item">
                        <span className="student-info-label">Phone:</span>
                        <span className="student-info-value">{displayPhone}</span>
                    </div>
                </div>

                {/* Dashboard Sections in Grid Layout */}
                <div className="student-dashboard-grid">
                    {/* Left Column - Main Content */}
                    <div className="student-main-column">
                        {/* My Courses Section */}
                        <div className="student-section-header">
                            <h2>My Courses ({courses.length})</h2>
                            {courses.length > 4 && (
                                <button
                                    className="student-view-all-btn"
                                    onClick={handleViewAllCourses}
                                >
                                    {showAllCourses ? 'Show Less' : 'View All'}
                                </button>
                            )}
                        </div>

                        {coursesLoading ? (
                            <div className="student-no-data">
                                <div className="student-loading-spinner small"></div>
                                <p>Loading your courses...</p>
                            </div>
                        ) : coursesError ? (
                            <div className="student-no-data">
                                <p>Error loading courses: {coursesError}</p>
                                <button
                                    className="student-browse-courses-btn"
                                    onClick={fetchEnrolledCourses}
                                >
                                    Retry Loading Courses
                                </button>
                            </div>
                        ) : courses.length === 0 ? (
                            <div className="student-no-data">
                                <p>You are not enrolled in any courses yet.</p>
                                <button
                                    className="student-browse-courses-btn"
                                    onClick={() => navigate('/available-courses')}
                                >
                                    Browse Available Courses
                                </button>
                            </div>
                        ) : (
                            <div className="student-courses-grid">
                                {(showAllCourses ? courses : courses.slice(0, 4)).map(course => (
                                    <div key={course.course_id} className="student-course-card">
                                        <div className="student-course-code">{course.course_code}</div>
                                        <h3 className="student-course-name">{course.title}</h3>
                                        <div className="student-course-instructor">
                                            <i className="fas fa-chalkboard-teacher"></i>
                                            {course.teacher_name || 'Instructor TBA'}
                                        </div>
                                        <div className="student-course-stats">
                                            <span><i className="fas fa-clock"></i> {course.credit_hours} Credits</span>
                                            <span className="student-stat-separator">•</span>
                                            <span><i className="fas fa-building"></i> {course.department || 'General'}</span>
                                            <span className="student-stat-separator">•</span>
                                            <span><i className="fas fa-calendar"></i> Sem {course.semester || 1}</span>
                                        </div>
                                        <div className="student-course-actions">
                                            <button
                                                className="student-course-btn"
                                                onClick={() => handleViewCourse(course.course_id, course)}
                                            >
                                                <i className="fas fa-eye"></i> View Course
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Today's Schedule Section */}
                        <div className="student-section-header">
                            <h2>Today's Schedule</h2>
                            <span className="student-date-display">{formatPKTDate(new Date().toISOString())}</span>
                        </div>

                        {scheduleLoading ? (
                            <div className="student-no-schedule">
                                <div className="student-loading-spinner small"></div>
                                <p>Loading today's schedule...</p>
                            </div>
                        ) : scheduleError ? (
                            <div className="student-no-schedule">
                                <p>Error loading schedule: {scheduleError}</p>
                                <button
                                    className="student-refresh-btn"
                                    onClick={fetchTodaySchedule}
                                >
                                    Retry Loading Schedule
                                </button>
                            </div>
                        ) : todaysSchedule.filter(session => session.status !== 'completed').length === 0 ? (
                            <div className="student-no-schedule">
                                <p>No classes scheduled for today.</p>
                                <p>Enjoy your free time!</p>
                            </div>
                        ) : (
                            <div className="student-schedule-container">
                                {todaysSchedule
                                    .filter(session => session.status !== 'completed')
                                    .map((session) => (
                                    <div key={session.session_id} className="student-schedule-item">
                                        <div className="student-schedule-time">
                                            {formatSessionTime(session.start_time)}
                                            <div className="student-schedule-duration">
                                                {formatDuration(session.duration_minutes)}
                                            </div>
                                        </div>
                                        <div className="student-schedule-details">
                                            <h4>
                                                <span className="student-schedule-course-code">{session.course_code}</span>
                                                <span className="student-schedule-course-title">{session.course_title}</span>
                                            </h4>
                                            <p className="student-session-title">{session.session_title}</p>
                                            <div className="student-schedule-meta">
                                                <span className={`student-schedule-type ${session.status === 'ongoing' ? 'live' : ''}`}>
                                                    {session.status === 'ongoing' ? 'Live' : 'Scheduled'}
                                                </span>
                                                <span className="student-schedule-teacher">
                                                    <i className="fas fa-chalkboard-teacher"></i>
                                                    {session.teacher_name}
                                                </span>
                                                {session.participants_count > 0 && (
                                                    <span className="student-schedule-participants">
                                                        <i className="fas fa-users"></i>
                                                        {session.participants_count} participants
                                                    </span>
                                                )}
                                            </div>
                                            {session.description && (
                                                <p className="student-session-description">
                                                    {session.description.length > 100 ?
                                                        session.description.substring(0, 100) + '...' :
                                                        session.description}
                                                </p>
                                            )}
                                            <div className="student-schedule-room">
                                                <i className="fas fa-video"></i>
                                                {session.room === "Online" ? "Virtual Classroom" : session.room}
                                                {session.is_private && (
                                                    <span className="student-private-badge">
                                                        <i className="fas fa-lock"></i> Private
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            className={`student-join-btn ${session.status === 'ongoing' ? 'live' : ''}`}
                                            onClick={() => handleJoinMeeting(session.meeting_room_id)}
                                            disabled={session.status !== 'ongoing'}
                                        >
                                            {session.status === 'ongoing' ? (
                                                <>
                                                    <i className="fas fa-video"></i> Join Now
                                                </>
                                            ) : (
                                                <>
                                                    <i className="fas fa-clock"></i> Meeting hasn't started yet
                                                </>
                                            )}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Recent Meetings Section */}
                        <div className="student-section-header" style={{ marginTop: 32 }}>
                            <h2>Recent Meetings</h2>
                            <span style={{ fontSize: 13, color: '#888' }}>Past class sessions</span>
                        </div>

                        {recentSessionsLoading ? (
                            <div className="student-no-schedule">
                                <div className="student-loading-spinner small" />
                                <p>Loading recent meetings…</p>
                            </div>
                        ) : recentSessions.length === 0 ? (
                            <div className="student-no-schedule">
                                <p>No past meetings yet. Completed class sessions will appear here.</p>
                            </div>
                        ) : (
                            <div className="student-recent-meetings">
                                {recentSessions.map((s) => (
                                    <div key={s.session_id} className="student-recent-meeting-card">
                                        <div className="student-recent-meeting-left">
                                            <div className="student-recent-meeting-badge">{s.course_code}</div>
                                            <div>
                                                <div className="student-recent-meeting-title">{s.session_title}</div>
                                                <div className="student-recent-meeting-meta">
                                                    <i className="fas fa-chalkboard-teacher" /> {s.teacher_name}
                                                    {s.start_time && (
                                                        <>
                                                            &nbsp;·&nbsp;
                                                            {new Date(s.start_time).toLocaleDateString(undefined, {
                                                                month: 'short',
                                                                day: 'numeric',
                                                            })}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="student-recent-meeting-actions">
                                            <button
                                                className="student-quiz-link-btn"
                                                onClick={async () => {
                                                    try {
                                                        const r = await fetch(`${API_BASE}/api/sessions/${s.session_id}/quizzes?viewer_id=${encodeURIComponent(student?.student_id)}&viewer_type=student`);
                                                        const d = await r.json();
                                                        if (d.success && d.quizzes && d.quizzes.length > 0) {
                                                            navigate(`/quiz/${d.quizzes[0].quiz_id}`);
                                                        } else {
                                                            alert('No exam available for this lecture yet.');
                                                        }
                                                    } catch (e) {
                                                        alert('Failed to check for exams.');
                                                    }
                                                }}
                                            >
                                                Exam
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right Column - Sidebar */}
                    <div className="student-sidebar-column">
                        {/* Upcoming Assignments */}
                        <div className="student-sidebar-section">
                            <div className="student-section-title">
                                <h3><i className="fas fa-tasks"></i> Upcoming Assignments</h3>
                            </div>
                            <p className="student-no-items">Assignment data will be loaded from the database.</p>
                        </div>

                        {/* Exam Performance Center */}
                        <div className="student-sidebar-section exam-performance-section">
                            <div className="student-section-title">
                                <h3><i className="fas fa-graduation-cap"></i> Exam Performance</h3>
                            </div>
                            {recentGradesLoading ? (
                                <div style={{ padding: '20px', textAlign: 'center' }}>
                                    <div className="student-loading-spinner small" />
                                    <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>Loading results…</p>
                                </div>
                            ) : recentGrades.length === 0 ? (
                                <div className="exam-perf-empty">
                                    <i className="fas fa-clipboard-list" style={{ fontSize: 28, color: '#c0c4d6', marginBottom: 8 }}></i>
                                    <p style={{ fontSize: 13, color: '#999', margin: 0 }}>No exams attempted yet.</p>
                                    <p style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>Results will appear here once you take an exam.</p>
                                </div>
                            ) : (() => {
                                const totalMarks = recentGrades.reduce((s, g) => s + (Number(g.total) || 0), 0);
                                const obtainedMarks = recentGrades.reduce((s, g) => s + (Number(g.score) || 0), 0);
                                const overallPct = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100) : null;
                                const passed = recentGrades.filter(g => g.percentage >= 50).length;
                                const passRate = recentGrades.length > 0 ? Math.round((passed / recentGrades.length) * 100) : 0;
                                const pctColor = overallPct == null ? '#6b7280' : overallPct >= 80 ? '#10b981' : overallPct >= 60 ? '#f59e0b' : '#ef4444';
                                return (
                                    <div className="exam-perf-body">
                                        {/* Aggregate Stats */}
                                        <div className="exam-perf-stats-row">
                                            <div className="exam-perf-stat-box">
                                                <span className="exam-perf-stat-val" style={{ color: pctColor }}>
                                                    {overallPct != null ? `${overallPct}%` : '—'}
                                                </span>
                                                <span className="exam-perf-stat-label">Overall</span>
                                            </div>
                                            <div className="exam-perf-stat-box">
                                                <span className="exam-perf-stat-val">{obtainedMarks}<span style={{ fontSize: 11, fontWeight: 400, color: '#aaa' }}>/{totalMarks}</span></span>
                                                <span className="exam-perf-stat-label">Marks</span>
                                            </div>
                                            <div className="exam-perf-stat-box">
                                                <span className="exam-perf-stat-val" style={{ color: passRate >= 70 ? '#10b981' : '#f59e0b' }}>{passRate}%</span>
                                                <span className="exam-perf-stat-label">Pass Rate</span>
                                            </div>
                                            <div className="exam-perf-stat-box">
                                                <span className="exam-perf-stat-val">{recentGrades.length}</span>
                                                <span className="exam-perf-stat-label">Exams</span>
                                            </div>
                                        </div>

                                        {/* Progress bar */}
                                        {overallPct != null && (
                                            <div className="exam-perf-bar-wrap">
                                                <div className="exam-perf-bar-track">
                                                    <div className="exam-perf-bar-fill" style={{ width: `${overallPct}%`, background: pctColor }} />
                                                </div>
                                                <span className="exam-perf-bar-label">{overallPct}% overall score</span>
                                            </div>
                                        )}

                                        {/* Recent exams list */}
                                        <div className="exam-perf-list-header">Recent Exams</div>
                                        <div className="exam-perf-list">
                                            {recentGrades.slice(0, 5).map((g, i) => {
                                                const pct = g.percentage != null ? Math.round(Number(g.percentage)) : (g.total > 0 ? Math.round((Number(g.score) / Number(g.total)) * 100) : null);
                                                const passed = g.percentage >= 50;
                                                return (
                                                    <div key={g.attempt_id || i} className="exam-perf-list-item">
                                                        <div className="exam-perf-list-left">
                                                            <div className="exam-perf-list-title">{g.session_title || g.quiz_title || g.exam_title || 'Exam'}</div>
                                                            <div className="exam-perf-list-sub">{g.course_code || g.course_title || ''}</div>
                                                        </div>
                                                        <div className="exam-perf-list-right">
                                                            <span className="exam-perf-score">{g.score != null ? g.score : '—'}{g.total ? `/${g.total}` : ''}</span>
                                                            <span className={`exam-perf-badge ${passed ? 'pass' : 'fail'}`}>{passed ? 'Pass' : 'Fail'}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Notifications */}
                        <div className="student-sidebar-section">
                            <div className="student-section-title">
                                <h3><i className="fas fa-bell"></i> Notifications</h3>
                            </div>
                            <p className="student-no-items">No notifications at the moment.</p>
                        </div>

                        {/* Quick Actions */}
                        <div className="student-quick-actions">
                            <button className="student-quick-action-btn" onClick={()=>{navigate('/chatPage')}}>
                                <i className="fas fa-comments student-action-icon"></i>
                                <span className="student-action-text">Live Chat</span>
                            </button>
                            <button className="student-quick-action-btn" onClick={() => navigate('/studentQuizzes')}>
                                <i className="fas fa-file-alt student-action-icon"></i>
                                <span className="student-action-text">Exams</span>
                            </button>
                        </div>

                        {/* Recent Meetings Sidebar Quick Card */}
                        {recentSessions.length > 0 && (
                            <div className="student-sidebar-section">
                                <div className="student-section-title">
                                    <h3><i className="fas fa-history"></i> Recent Class</h3>
                                </div>
                                {recentSessions.slice(0, 3).map((s) => (
                                    <div
                                        key={s.session_id}
                                        style={{ padding: '8px 0', borderBottom: '1px solid #f0f2f8' }}
                                    >
                                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>
                                            {s.course_code} — {s.session_title}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                                            {s.start_time ? new Date(s.start_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default StudentDashboard;
