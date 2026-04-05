import { useNavigate } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import './teacherDashboard.css';
import classMateLogo from './assets/Logo2.png';


function TeacherDashboard() {
    const navigate = useNavigate();

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showAllCourses, setShowAllCourses] = useState(false);
    const [teacher, setTeacher] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [courses, setCourses] = useState([]);
    const [coursesLoading, setCoursesLoading] = useState(false);
    const [todaysSchedule, setTodaysSchedule] = useState([]);
    const [scheduleLoading, setScheduleLoading] = useState(false);

    const handleScheduleMeeting = () => {
        navigate('/scheduleForm');
    };

    const fetchTodaysSchedule = async (teacherId) => {
        try {
            setScheduleLoading(true);
            console.log(`Fetching today's schedule for teacher: ${teacherId}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/teacher/schedule/today?teacher_id=${teacherId}`
            );

            console.log('Response status:', response.status);

            const data = await response.json();
            console.log('Schedule API response:', data);

            if (data.success) {
                console.log(`Loaded ${data.sessions.length} sessions`);

                // Transform to match frontend
                const transformedSessions = data.sessions.map(session => ({
                    id: session.session_id,
                    time: session.display_time || formatTime(session.start_time),
                    class: `${session.course_code} - ${session.session_title || session.title}`,
                    // Only show "Live Now" if backend marks status ongoing AND is_live flag is true
                    type: (session.status === 'ongoing' && session.is_live) ? 'Live Now' :
                        session.is_private ? 'Private' : 'Class',
                    link: session.meeting_room_id ? `/meeting/${session.meeting_room_id}` : '#',
                    course_code: session.course_code,
                    session_title: session.session_title || session.title,
                    course_title: session.course_title,
                    meeting_room_id: session.meeting_room_id,
                    status: session.status || 'scheduled',
                    participants_count: session.participants_count || 0,
                    is_private: session.is_private || false,
                    is_live: session.is_live || false,
                    // preserve raw ISO times for frontend logic
                    start_time: session.start_time,
                    end_time: session.end_time
                }));

                console.log('Transformed sessions:', transformedSessions);
                setTodaysSchedule(transformedSessions);
            } else {
                console.error('API error:', data.error);
                setTodaysSchedule([]);
            }
        } catch (err) {
            console.error('Fetch error:', err);
            setTodaysSchedule([]);
        } finally {
            setScheduleLoading(false);
        }
    };

    // Helper function
    const formatTime = (isoTimeString) => {
        if (!isoTimeString) return "Time not set";
        try {
            const date = new Date(isoTimeString);
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            }).replace(/^0/, '');
        } catch (error) {
            return "Invalid time";
        }
    };

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    const handleViewAllCourses = () => {
        setShowAllCourses(!showAllCourses);
    };

    const navigateToProfile = () => {
        if (teacher) {
            // Pass teacher data via state
            navigate('/teacherProfile', {
                state: { teacher }
            });
        } else {
            // If teacher data not loaded yet, just navigate
            navigate('/teacherProfile');
        }
    };

    const handleViewCourse = (courseId, courseData) => {
        console.log('View course:', courseId);
        // Navigate to course profile with course data
        navigate('/courseProfile', {
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
            id: localStorage.getItem('teacherId') || 'teacher_' + Date.now(),
            type: 'teacher',
            name: localStorage.getItem('teacherName') || 'Teacher',
            role: 'teacher'
        };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        // Navigate to meeting room
        navigate(`/meeting/${meetingId}`);
    };

    const fetchTeacherCourses = async (teacherId) => {
        try {
            setCoursesLoading(true);
            console.log(`Fetching courses for teacher: ${teacherId}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/teacher/courses?teacher_id=${teacherId}`
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch courses: ${response.status}`);
            }

            const data = await response.json();
            console.log('Courses API response:', data);

            if (data.success) {
                console.log(`Loaded ${data.courses.length} courses`);
                setCourses(data.courses);
            } else {
                console.error('Failed to load courses:', data.error);
                setCourses([]); // Set empty array if no courses
            }
        } catch (err) {
            console.error('Error fetching courses:', err);
            setCourses([]); // Set empty array on error
        } finally {
            setCoursesLoading(false);
        }
    };

    useEffect(() => {
        console.log('TeacherDashboard - localStorage contents:', {
            teacherEmail: localStorage.getItem('teacherEmail'),
            teacherName: localStorage.getItem('teacherName'),
            teacherToken: localStorage.getItem('teacherToken'),
            allKeys: Object.keys(localStorage)
        });

        const fetchTeacherProfile = async () => {
            try {
                setLoading(true);

                // Get teacher email from localStorage (set during login)
                const teacherEmail = localStorage.getItem('teacherEmail');

                if (!teacherEmail) {
                    // If no email in localStorage, redirect to login
                    console.error('No teacher email found in localStorage. Redirecting to login.');
                    navigate('/');
                    return;
                }

                console.log('Fetching teacher profile for email:', teacherEmail);

                // Use the NEW endpoint for current teacher (same as TeacherProfile)
                const response = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/teacher/profile/current?email=${encodeURIComponent(teacherEmail)}`
                );

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.error || 'Failed to load profile');
                }

                console.log('Teacher data received:', data.teacher);
                setTeacher(data.teacher);
                setError(null);

                // ADDED: Fetch courses after successfully getting teacher profile
                if (data.teacher && data.teacher.teacher_id) {
                    await fetchTeacherCourses(data.teacher.teacher_id);
                    await fetchTodaysSchedule(data.teacher.teacher_id);

                    // Set up polling to refresh schedule every 5 seconds
                    const scheduleRefreshInterval = setInterval(() => {
                        fetchTodaysSchedule(data.teacher.teacher_id);
                    }, 5000);

                    // Cleanup interval on unmount
                    return () => clearInterval(scheduleRefreshInterval);
                }

            } catch (err) {
                console.error('Error fetching teacher profile:', err);
                setError(err.message || 'Failed to load teacher profile');

                // If authentication fails, redirect to login after 2 seconds
                setTimeout(() => {
                    navigate('/');
                }, 2000);
            } finally {
                setLoading(false);
            }
        };

        fetchTeacherProfile();
    }, [navigate]); // Add navigate to dependencies

    if (loading) {
        return (
            <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>Loading teacher profile...</p>
            </div>
        );
    }

    if (error && !teacher) {
        return (
            <div className="error-container">
                <h2>Error</h2>
                <p>{error}</p>
                <button onClick={() => window.location.reload()}>Retry</button>
            </div>
        );
    }

    return (
        <div className="teacher-dashboard">
            {/* Navigation Bar */}
            <nav className="teacher-navbar">
                <div className="navbar-left">
                    {/* Add hamburger button here */}
                    <button
                        className={`hamburger-menu ${isMenuOpen ? 'active' : ''}`}
                        onClick={toggleMenu}
                        aria-label="Toggle navigation menu"
                    >
                        <span className="hamburger-line"></span>
                        <span className="hamburger-line"></span>
                        <span className="hamburger-line"></span>
                    </button>

                    <div className="logo-container">
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="navbar-logo"
                        />
                        <span className="brand-teacher-name">classMate</span>
                    </div>
                </div>

                <div className="navbar-right">
                    <div className="user-profile"
                        onClick={navigateToProfile}
                        style={{ cursor: 'pointer' }}
                    >
                        <div className="user-avatar">
                            {teacher?.name?.charAt(0) || 'T'}
                        </div>
                        <span className="user-name">{teacher?.name || 'Teacher'}</span>
                    </div>
                </div>
            </nav>

            {/* Add side navigation panel here */}
            <div className={`side-nav ${isMenuOpen ? 'open' : ''}`}>
                <div className="side-nav-header">
                    <h3>Dashboard Menu</h3>
                    <button className="close-menu" onClick={toggleMenu} aria-label="Close menu">
                        &times;
                    </button>
                </div>

                <div className="nav-menu">
                    <div className="nav-user-info">
                        <div className="side-user-avatar">
                            {teacher?.name?.charAt(0) || 'T'}
                        </div>
                        <div className="side-user-details">
                            <h4>{teacher?.name || 'Teacher'}</h4>
                            <p className="user-role">Teacher</p>
                        </div>
                    </div>

                    <nav className="nav-links">
                        <a href="/teacherDashboard" className="nav-link active">
                            <span className="nav-icon"></span>
                            Dashboard Overview
                        </a>
                        <a href="/scheduleForm" className="nav-link">
                            <span className="nav-icon"></span>
                            Schedule Meetings
                        </a>
                        <a href="/chatPage" className="nav-link">
                            <span className="nav-icon"></span>
                            Live Chat
                        </a>
                        <a href="#" className="nav-link">
                            <span className="nav-icon"></span>
                            Notifications
                        </a>
                        <a href="/teacherProfile" className="nav-link">
                            <span className="nav-icon"></span>
                            Profile Settings
                        </a>
                        <a href="/" className="nav-link logout">
                            <span className="nav-icon"></span>
                            Logout
                        </a>
                    </nav>
                </div>
            </div>

            {/* Add overlay here */}
            {isMenuOpen && (
                <div className="overlay" onClick={toggleMenu}></div>
            )}


            {/* Main Dashboard Content - To be filled with your components */}
            <div className="dashboard-content">
                <div className="teacher-info-bar">
                    <div className="profile-picture-container">
                        <div className="profile-picture">
                            {teacher?.name?.charAt(0) || 'T'}
                        </div>
                        <div className="profile-status">
                            <span className="status-dot"></span>
                            <span>Active</span>
                        </div>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Name:</span>
                        <span className="info-value">{teacher?.name || 'Loading...'}</span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Teacher ID:</span>
                        <span className="info-value">{teacher?.teacher_id || 'N/A'}</span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Role:</span>
                        <span className="info-value">Teacher</span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Department:</span>
                        <span className="info-value">{teacher?.department || 'Loading...'}</span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Email:</span>
                        <span className="info-value">{teacher?.email || 'Loading...'}</span>
                    </div>
                </div>

                {/* ===== MY COURSES SECTION ===== */}
                <div className="section-header">
                    <h2>My Courses</h2>
                    <button
                        className="view-all-btn"
                        onClick={handleViewAllCourses}
                        disabled={courses.length <= 4}
                    >
                        {showAllCourses ? 'Show Less' : 'View All'}
                    </button>
                </div>

                {coursesLoading ? (
                    <div className="loading-courses">
                        <div className="loading-spinner small"></div>
                        <p>Loading courses...</p>
                    </div>
                ) : courses.length === 0 ? (
                    <div className="no-courses">
                        <p>No courses found.</p>
                    </div>
                ) : (
                    <div className="courses-grid">
                        {(showAllCourses ? courses : courses.slice(0, 4)).map(course => (
                            <div key={course.id} className="course-card">
                                <div className="course-teacher-code">{course.course_code}</div>
                                <h3 className="course-name">{course.title}</h3>
                                <div className="course-stats">
                                    <span>{course.student_count || 0} Students</span>
                                    <span className="stat-separator">•</span>
                                    <span>{course.credit_hours || 3} Credits</span>
                                    <span className="stat-separator">•</span>
                                    <span>Sem {course.semester || 1}</span>
                                </div>
                                <div className="course-actions">
                                    <button
                                        className="course-btn"
                                        onClick={() => handleViewCourse(course.id, course)}
                                    >
                                        View Course
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ===== TODAY'S SCHEDULE ===== */}
                <div className="section-header">
                    <h2>Today's Schedule</h2>
                    <span className="date-display">{new Date().toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                    })}</span>
                </div>

                {scheduleLoading ? (
                    <div className="loading-courses">
                        <div className="loading-spinner small"></div>
                        <p>Loading today's schedule...</p>
                    </div>
                ) : todaysSchedule.length === 0 ? (
                    <div className="no-schedule">
                        <p>No scheduled sessions for today</p>
                        <button
                            className="create-schedule-btn"
                            onClick={() => { navigate('/scheduleForm') }}
                        >
                            + Schedule Session
                        </button>
                    </div>
                ) : (
                    <div className="schedule-container">
                        {todaysSchedule.map((item) => {
                            // compute time-based flags
                            const now = new Date();
                            const start = item.start_time ? new Date(item.start_time) : null;
                            const end = item.end_time ? new Date(item.end_time) : null;
                            const isCancelled = item.status === 'cancelled';
                            // isLive = only when backend marks ongoing AND is_live flag is true (teacher actually started)
                            const isLive = item.status === 'ongoing' && item.is_live;
                            // canStart = session is scheduled and at/past start time, meeting not started yet, not cancelled, not ended
                            const canStart = item.status === 'scheduled' && !isCancelled && !isLive && start && now >= start && (!end || now < end);
                            const hasEnded = !isCancelled && end && now > end;

                            return (
                                <div key={item.id} className="schedule-item">
                                    <div className="schedule-time">{item.time}</div>
                                    <div className="schedule-details">
                                        <h4>{item.class}</h4>
                                        <div className="schedule-meta">
                                            <span className="schedule-type">{item.type}</span>
                                            {item.participants_count > 0 && (
                                                <span className="schedule-participants">
                                                    {item.participants_count} participants
                                                </span>
                                            )}
                                        </div>
                                        <p className="course-title">{item.course_title}</p>

                                        {/* Live indicator under course title */}
                                        {isLive && (
                                            <div className="live-indicator" title="Live">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <circle cx="12" cy="12" r="6" fill="#ff4d4f" />
                                                </svg>
                                            </div>
                                        )}

                                    </div>

                                    {/* Action area: cancelled label, start button when ready, live join button when ongoing, ended label */}
                                    <div className="schedule-action">
                                        {isCancelled ? (
                                            <span className="cancelled-label">Cancelled</span>
                                        ) : hasEnded ? (
                                            <span className="ended-label">Meeting Ended</span>
                                        ) : isLive ? (
                                            <a href={item.link} className="join-btn live">Join Live →</a>
                                        ) : canStart ? (
                                            <a href={item.link} className="join-btn start">Start Meeting →</a>
                                        ) : (
                                            // show nothing until start time
                                            <span className="scheduled-note">Scheduled</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ===== QUICK ACTIONS ===== */}
                <div className="section-header">
                    <h2>Quick Actions</h2>
                </div>

                <div className="quick-actions-grid">
                    
                    <button className="quick-action-btn" onClick={() => navigate('/manageMeeting')}>
                        <span className="action-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2f4156" strokeWidth="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                        </span>
                        <span className="action-text">Manage Meetings</span>
                    </button>
                    <button className="quick-action-btn" onClick={()=>{navigate('/chatPage')}}>
                        <span className="action-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2f4156" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </span>
                        <span className="action-text">Chat</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default TeacherDashboard;
