// CourseProfile.jsx - Updated with Class Sessions section
import { useNavigate, useLocation } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import './courseProfile.css';
import classMateLogo from './assets/Logo2.png';

function CourseProfile() {
    const navigate = useNavigate();
    const location = useLocation();
    const [course, setCourse] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [students, setStudents] = useState([]);
    const [studentsLoading, setStudentsLoading] = useState(false);
    const [studentCount, setStudentCount] = useState(0);
    const [showAllStudents, setShowAllStudents] = useState(false);
    const [classSessions, setClassSessions] = useState([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [showAllSessions, setShowAllSessions] = useState(false);

    // Get course ID from URL parameters or navigation state
    const courseId = location.state?.courseId ||
        new URLSearchParams(location.search).get('id');

    // Get course data from navigation state if available
    const courseData = location.state?.courseData;

    // Fetch class sessions for this course
    const fetchClassSessions = async (courseId) => {
        try {
            setSessionsLoading(true);
            console.log(`📅 Fetching class sessions for course: ${courseId}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/courses/${courseId}/sessions`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                console.log(`✅ Loaded ${data.sessions.length} class sessions`);

                // Format sessions data
                const formattedSessions = data.sessions.map(session => {
                    const startTime = new Date(session.start_time);
                    const endTime = new Date(session.end_time);
                    const now = new Date();

                    // Determine session status based on database status and timing
                    let status = session.status || 'scheduled';
                    let statusClass = status;

                    // Override status based on timing if it's scheduled
                    if (status === 'scheduled') {
                        if (now >= startTime && now <= endTime) {
                            status = 'ongoing';
                            statusClass = 'ongoing';
                        } else if (now > endTime) {
                            status = 'completed';
                            statusClass = 'completed';
                        }
                    }

                    // Map status to display labels
                    const statusLabels = {
                        'scheduled': 'Scheduled',
                        'ongoing': 'On Going',
                        'completed': 'Completed',
                        'cancelled': 'Cancelled'
                    };

                    const displayStatus = statusLabels[status] || status;

                    return {
                        id: session.session_id,
                        title: session.title,
                        description: session.description,
                        startTime: startTime,
                        endTime: endTime,
                        date: startTime.toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                        }),
                        time: `${startTime.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        })} - ${endTime.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        })}`,
                        status: displayStatus,
                        rawStatus: status, // Keep original for logic
                        statusClass: statusClass,
                        participants: session.participants_count || 0,
                        meetingRoomId: session.meeting_room_id,
                        recordingAvailable: session.recording_available || false,
                        recordingPath: session.recording_path,
                        materials: session.materials || [],
                        isPrivate: session.is_private || false,
                        notes: session.notes || ''
                    };
                });

                // Sort sessions: upcoming first, then past
                formattedSessions.sort((a, b) => {
                    const now = new Date();
                    const aIsPast = a.rawStatus === 'completed' || (a.endTime < now && a.rawStatus !== 'cancelled');
                    const bIsPast = b.rawStatus === 'completed' || (b.endTime < now && b.rawStatus !== 'cancelled');

                    // Cancelled sessions go to bottom
                    if (a.rawStatus === 'cancelled' && b.rawStatus !== 'cancelled') return 1;
                    if (a.rawStatus !== 'cancelled' && b.rawStatus === 'cancelled') return -1;

                    // Ongoing sessions come first
                    if (a.rawStatus === 'ongoing' && b.rawStatus !== 'ongoing') return -1;
                    if (a.rawStatus !== 'ongoing' && b.rawStatus === 'ongoing') return 1;

                    if (aIsPast && !bIsPast) return 1;
                    if (!aIsPast && bIsPast) return -1;

                    // Both upcoming or both past - sort by date
                    return a.startTime - b.startTime;
                });

                setClassSessions(formattedSessions);
            } else {
                console.error('Failed to load class sessions:', data.error);
                setClassSessions([]);
            }
        } catch (err) {
            console.error('Error fetching class sessions:', err);
            setClassSessions([]);
        } finally {
            setSessionsLoading(false);
        }
    };

    // Fetch enrolled students from API
    const fetchCourseStudents = async (courseId) => {
        try {
            setStudentsLoading(true);
            console.log(`📚 Fetching students for course: ${courseId}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/courses/${courseId}/students`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                console.log(`✅ Loaded ${data.students.length} students`);
                setStudents(data.students);
                setStudentCount(data.count);
            } else {
                console.error('Failed to load students:', data.error);
                setStudents([]);
            }
        } catch (err) {
            console.error('Error fetching students:', err);
            setStudents([]);
        } finally {
            setStudentsLoading(false);
        }
    };

    // Fetch COMPLETE course details from API
    const fetchCompleteCourseDetails = async (courseId) => {
        try {
            console.log(`📘 Fetching complete course details for: ${courseId}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/courses/${courseId}/full`
            );

            if (!response.ok) {
                // Fallback to basic endpoint if full endpoint fails
                console.log('Full details endpoint failed, trying basic endpoint...');
                return await fetchBasicCourseDetails(courseId);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load course details');
            }

            console.log('Complete course data received:', data.course);
            return data.course;

        } catch (err) {
            console.error('Error fetching complete course details:', err);
            // Fallback to basic endpoint
            return await fetchBasicCourseDetails(courseId);
        }
    };

    // Fallback: Fetch basic course details
    const fetchBasicCourseDetails = async (courseId) => {
        try {
            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/courses/${courseId}`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load course details');
            }

            console.log('Basic course data received:', data.course);
            return data.course;

        } catch (err) {
            console.error('Error fetching basic course details:', err);
            throw err;
        }
    };

    // Toggle show all students
    const toggleShowAllStudents = () => {
        setShowAllStudents(!showAllStudents);
    };

    // Toggle show all sessions
    const toggleShowAllSessions = () => {
        setShowAllSessions(!showAllSessions);
    };

    // Determine how many students to show
    const studentsToShow = showAllStudents ? students : students.slice(0, 3);

    // Determine how many sessions to show
    const sessionsToShow = showAllSessions ? classSessions : classSessions.slice(0, 3);

    // Update handleSessionAction function
    const handleSessionAction = (session) => {
        if (session.rawStatus === 'ongoing') {
            // Navigate to meeting for ongoing sessions
            if (session.meetingRoomId) {
                window.open(`/meeting/${session.meetingRoomId}`, '_blank');
            } else {
                alert('Meeting room not available');
            }
        } else if (session.recordingAvailable) {
            // View recording for completed sessions with recording
            if (session.recordingPath) {
                window.open(session.recordingPath, '_blank');
            } else {
                alert('Recording not available');
            }
        } else if (session.rawStatus === 'scheduled') {
            // For scheduled sessions, navigate to edit or join if early
            const now = new Date();
            if (now >= session.startTime && now <= session.endTime) {
                // If current time is within session time, allow join
                if (session.meetingRoomId) {
                    window.open(`/meeting/${session.meetingRoomId}`, '_blank');
                } else {
                    alert('Meeting room not available');
                }
            } else {
                // Navigate to edit session
                navigate('/scheduleForm', {
                    state: {
                        sessionId: session.id,
                        courseId: course.id || course.course_id,
                        courseCode: course.course_code,
                        courseTitle: course.title,
                        editMode: true
                    }
                });
            }
        } else if (session.rawStatus === 'completed') {
            // View session details or recordings
            if (session.recordingAvailable) {
                window.open(session.recordingPath, '_blank');
            } else {
                // Navigate to session details page
                navigate('/session-details', { state: { session } });
            }
        } else if (session.rawStatus === 'cancelled') {
            // Show cancelled session details
            alert(`This session was cancelled. ${session.notes ? `Notes: ${session.notes}` : ''}`);
        }
    };

    // Format session duration
    const getSessionDuration = (startTime, endTime) => {
        const durationMs = endTime - startTime;
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    };

    // Fetch course details from API
    useEffect(() => {
        const loadCourseData = async () => {
            try {
                setLoading(true);
                console.log('Loading course data for ID:', courseId);

                let actualCourseId = courseId;
                let loadedCourseData = courseData;

                // If course data was passed via navigation state, use it as base
                if (courseData) {
                    console.log('Using course data from navigation state');
                    actualCourseId = courseData.course_id || courseData.id || courseId;

                    // Still fetch fresh data to ensure we have all information
                    const freshCourseData = await fetchCompleteCourseDetails(actualCourseId);
                    setCourse(freshCourseData || courseData);

                    // Fetch students and sessions for this course
                    await Promise.all([
                        fetchCourseStudents(actualCourseId),
                        fetchClassSessions(actualCourseId)
                    ]);

                    setLoading(false);
                    return;
                }

                // Otherwise fetch everything from API
                if (!courseId) {
                    throw new Error('No course ID provided');
                }

                // Fetch complete course details
                const courseDetails = await fetchCompleteCourseDetails(courseId);
                setCourse(courseDetails);
                setError(null);

                // Fetch students and sessions for this course
                await Promise.all([
                    fetchCourseStudents(courseId),
                    fetchClassSessions(courseId)
                ]);

            } catch (err) {
                console.error('Error loading course data:', err);
                setError(err.message || 'Failed to load course data');
            } finally {
                setLoading(false);
            }
        };

        if (courseId || courseData) {
            loadCourseData();
        } else {
            setError('No course information provided');
            setLoading(false);
        }
    }, [courseId, courseData]);

    // Helper function to format schedule if available
    const formatSchedule = (schedule) => {
        if (!schedule || schedule === 'Schedule not specified') {
            return 'Not scheduled yet';
        }
        return schedule;
    };

    if (loading) {
        return (
            <div className="course-loading-container">
                <div className="course-loading-spinner"></div>
                <p>Loading course details...</p>
            </div>
        );
    }

    if (error || !course) {
        return (
            <div className="course-error-container">
                <h2>Error</h2>
                <p>{error || 'Course not found'}</p>
                <button onClick={() => navigate('/teacherDashboard')}>Back to Dashboard</button>
            </div>
        );
    }

    return (
        <div className="course-profile">
            {/* Navigation Bar */}
            <nav className="course-navbar">
                <div className="navbar-left">
                    <div className="logo-container">
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="navbar-logo"
                        />
                        <span className="brand-name">classMate</span>
                    </div>
                </div>

                <div className="navbar-right">
                    <button
                        className="back-course-btn"
                        onClick={() => navigate('/teacherDashboard')}
                    >
                        ← Back to Dashboard
                    </button>
                </div>
            </nav>

            {/* Main Content */}
            <div className="course-content">
                {/* Course Header */}
                <div className="course-header">
                    <div className="course-title-section">
                        <h1 className="course-profile-code">{course.course_code}</h1>
                        <h2 className="course-profile-name">{course.title}</h2>
                        <p className="course-description">
                            {course.description || "No description available"}
                        </p>
                        <div className="course-meta">
                            <span className="meta-item">{course.meeting_days || 'MWF'}</span>
                            <span className="meta-item">{course.meeting_time || '10:00 AM - 11:30 AM'}</span>
                            <span className="meta-item">{course.location || 'Main Campus'}</span>
                        </div>
                    </div>

                    <div className="course-stats-grid">
                        <div className="stat-card">
                            <span className="stat-icon"></span>
                            <span className="stat-value">{studentCount || course.student_count || 0}</span>
                            <span className="stat-label">Students</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-icon"></span>
                            <span className="stat-value">{course.credit_hours || 3}</span>
                            <span className="stat-label">Credits</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-icon"></span>
                            <span className="stat-value">{classSessions.length}</span>
                            <span className="stat-label">Sessions</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-icon"></span>
                            <span className="stat-value">{course.total_assignments || 0}</span>
                            <span className="stat-label">Assignments</span>
                        </div>
                    </div>
                </div>

                {/* Course Details Sections */}
                <div className="course-sections">
                    {/* Left Column */}
                    <div className="left-column">
                        {/* Students Section */}
                        <div className="section-card">
                            <div className="section-header">
                                <h3>Students Enrolled ({studentCount})</h3>
                                {studentCount > 3 && (
                                    <button
                                        className="view-all-btn"
                                        onClick={toggleShowAllStudents}
                                    >
                                        {showAllStudents ? 'Show Less' : 'View All'}
                                    </button>
                                )}
                            </div>

                            {studentsLoading ? (
                                <div className="loading-students">
                                    <div className="course-loading-spinner small"></div>
                                    <p>Loading students...</p>
                                </div>
                            ) : students.length === 0 ? (
                                <div className="no-students">
                                    <p>No students enrolled in this course yet.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="students-list">
                                        {studentsToShow.map((student, index) => (
                                            <div key={student.id || index} className="student-item">
                                                <div className="student-avatar">
                                                    {student.avatar || student.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="student-info">
                                                    <h4>{student.name}</h4>
                                                    <p>Roll No: {student.rollNumber}</p>
                                                    {student.email && (
                                                        <p className="student-email">{student.email}</p>
                                                    )}
                                                </div>
                                                <div className="student-stats">
                                                    <span className="attendance"> {student.attendance || "0%"}</span>
                                                    <span className="grade"> {student.grade || "N/A"}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {!showAllStudents && students.length > 3 && (
                                        <div className="more-students-info">
                                            <p className="more-students-text">
                                                ...and {students.length - 3} more students
                                            </p>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Class Sessions Section - REPLACES Assignments */}
                        <div className="section-card">
                            <div className="section-header">
                                <h3>Class Sessions ({classSessions.length})</h3>
                                <button
                                    className="add-btn"
                                    onClick={() => navigate('/scheduleForm', {
                                        state: {
                                            courseId: course.id || course.course_id,
                                            courseCode: course.course_code,
                                            courseTitle: course.title
                                        }
                                    })}
                                >
                                    + Schedule Session
                                </button>
                            </div>

                            {sessionsLoading ? (
                                <div className="loading-students">
                                    <div className="course-loading-spinner small"></div>
                                    <p>Loading sessions...</p>
                                </div>
                            ) : classSessions.length === 0 ? (
                                <div className="no-students">
                                    <p>No class sessions scheduled yet.</p>
                                    <button
                                        className="create-schedule-btn"
                                        onClick={() => navigate('/scheduleForm', {
                                            state: {
                                                courseId: course.id || course.course_id,
                                                courseCode: course.course_code,
                                                courseTitle: course.title
                                            }
                                        })}
                                    >
                                        Schedule First Session
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="class-sessions-list">
                                        {sessionsToShow.map((session) => (
                                            <div key={session.id} className="session-item">
                                                <div className="session-header">
                                                    <h4 className="session-title">{session.title}</h4>
                                                    <span className={`session-status ${session.statusClass}`}>
                                                        {session.status}
                                                    </span>
                                                </div>

                                                <div className="session-details">
                                                    <div className="session-date-time">
                                                        <span className="session-date">
                                                             {session.date}
                                                        </span>
                                                        <span className="session-time">
                                                             {session.time}
                                                        </span>
                                                        <span className="session-duration">
                                                             {getSessionDuration(session.startTime, session.endTime)}
                                                        </span>
                                                    </div>

                                                    {session.description && (
                                                        <p className="session-description">
                                                            {session.description}
                                                        </p>
                                                    )}

                                                    <div className="session-meta">
                                                        <span className="session-participants">
                                                            <i className="fa fa-users" aria-hidden="true"></i>
                                                            {session.participants} participants
                                                        </span>
                                                        {session.isPrivate && (
                                                            <span className="session-private">
                                                                <i className="fa fa-lock" aria-hidden="true"></i>
                                                                Private
                                                            </span>
                                                        )}
                                                        {session.recordingAvailable && (
                                                            <span className="session-recording">
                                                                <i className="fa fa-video-camera" aria-hidden="true"></i>
                                                                Recording Available
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="session-actions">
                                                    {session.status === 'Live Now' || session.status === 'In Progress' ? (
                                                        <button
                                                            className="session-action-btn primary"
                                                            onClick={() => handleSessionAction(session)}
                                                        >
                                                            Join Session →
                                                        </button>
                                                    ) : session.recordingAvailable ? (
                                                        <button
                                                            className="session-action-btn secondary"
                                                            onClick={() => handleSessionAction(session)}
                                                        >
                                                            View Recording
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="session-action-btn outline"
                                                            onClick={() => handleSessionAction(session)}
                                                        >
                                                            View Details
                                                        </button>
                                                    )}

                                                    {session.materials && session.materials.length > 0 && (
                                                        <button className="session-action-btn materials">
                                                             {session.materials.length} Materials
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {!showAllSessions && classSessions.length > 3 && (
                                        <div className="more-sessions-info">
                                            <p className="more-sessions-text">
                                                ...and {classSessions.length - 3} more sessions
                                            </p>
                                            <button
                                                className="view-all-sessions-btn"
                                                onClick={toggleShowAllSessions}
                                            >
                                                View All Sessions
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Right Column */}
                    <div className="right-column">
                        {/* Quick Actions */}
                        <div className="section-card">
                            <h3>Course Actions</h3>
                            <div className="action-buttons">
                                <button className="action-btn"
                                    onClick={() => navigate('/Material', {
                                        state: {
                                            courseId: course.id || course.course_id,
                                            courseCode: course.course_code,
                                            courseTitle: course.title
                                        }
                                    })}>
                                    <span className="btn-icon">
                                        <i className="fa fa-upload" aria-hidden="true"></i>
                                    </span>
                                    Upload Materials
                                </button>
                                <button className="action-btn">
                                    <span className="btn-icon">
                                        <i className="fa fa-file-text" aria-hidden="true"></i>
                                    </span>
                                    Create Assignment
                                </button>
                                <button
                                    className="action-btn"
                                    onClick={() => navigate('/scheduleForm', {
                                        state: {
                                            courseId: course.id || course.course_id,
                                            courseCode: course.course_code,
                                            courseTitle: course.title
                                        }
                                    })}
                                >
                                    <span className="btn-icon">
                                        <i className="fa fa-calendar" aria-hidden="true"></i>
                                    </span>
                                    Schedule Class
                                </button>
                            </div>
                        </div>

                        {/* Course Information - UPDATED WITH REAL DATA */}
                        <div className="section-card">
                            <h3>Course Information</h3>
                            <div className="info-grid">
                                <div className="info-item">
                                    <span className="info-label">Course Code:</span>
                                    <span className="info-course-value">{course.course_code}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Course Title:</span>
                                    <span className="info-course-value">{course.title}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Course Type:</span>
                                    <span className="info-course-value">{course.course_type || 'Regular'}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Enrolled Students:</span>
                                    <span className="info-course-value">{studentCount || course.student_count || 0} / {course.max_students || 50}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Course Status:</span>
                                    <span className={`info-course-value status-${course.status || 'active'}`}>
                                        {course.status || 'Active'}
                                    </span>
                                </div>
                                {course.syllabus_url && (
                                    <div className="info-item full-width">
                                        <span className="info-label">Syllabus:</span>
                                        <a
                                            href={course.syllabus_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="info-course-value link"
                                        >
                                            View Syllabus
                                        </a>
                                    </div>
                                )}
                                <div className="info-item full-width">
                                    <span className="info-label">Course Created:</span>
                                    <span className="info-course-value">
                                        {course.created_at ? new Date(course.created_at).toLocaleDateString() : 'N/A'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Upcoming Sessions - Side Panel */}
                        <div className="section-card">
                            <h3>Upcoming Sessions</h3>
                            <div className="upcoming-sessions">
                                {classSessions
                                    .filter(session =>
                                        session.status === 'scheduled' ||
                                        session.status === 'Live Now' ||
                                        session.status === 'In Progress'
                                    )
                                    .slice(0, 3)
                                    .map(session => (
                                        <div key={session.id} className="upcoming-session-item">
                                            <div className="upcoming-session-date">
                                                <span className="upcoming-day">
                                                    {session.startTime.toLocaleDateString('en-US', { weekday: 'short' })}
                                                </span>
                                                <span className="upcoming-date">
                                                    {session.startTime.getDate()}
                                                </span>
                                            </div>
                                            <div className="upcoming-session-info">
                                                <h4>{session.title}</h4>
                                                <p className="upcoming-time">{session.time}</p>
                                                <span className={`upcoming-status ${session.statusClass}`}>
                                                    {session.status}
                                                </span>
                                            </div>
                                        </div>
                                    ))}

                                {classSessions.filter(session =>
                                    session.status === 'scheduled' ||
                                    session.status === 'Live Now' ||
                                    session.status === 'In Progress'
                                ).length === 0 && (
                                        <p className="no-upcoming">No upcoming sessions</p>
                                    )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CourseProfile;
