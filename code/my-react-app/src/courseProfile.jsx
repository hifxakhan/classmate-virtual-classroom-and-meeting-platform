// CourseProfile.jsx - Updated with Class Sessions section
import { useNavigate, useLocation } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import './courseProfile.css';
import classMateLogo from './assets/Logo2.png';
import { formatPKTDate, formatPKTTime, formatPKTWeekdayShort, formatPKTDayNumber } from './utils/dateUtils';
import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

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
    const [generatingQuizSessionId, setGeneratingQuizSessionId] = useState(null);
    const [assignments, setAssignments] = useState([]);
    const [assignmentsLoading, setAssignmentsLoading] = useState(false);
    const [showAssignmentForm, setShowAssignmentForm] = useState(false);
    const [aTitle, setATitle] = useState('');
    const [aDesc, setADesc] = useState('');
    const [aDue, setADue] = useState('');
    const [aFile, setAFile] = useState(null);
    const [aSubmitting, setASubmitting] = useState(false);
    const [aMsg, setAMsg] = useState(null);

    // Manual quiz builder state
    const [manualQuizzes, setManualQuizzes] = useState([]);
    const [mqLoading, setMqLoading] = useState(false);
    const [showQuizForm, setShowQuizForm] = useState(false);
    const [mqTitle, setMqTitle] = useState('');
    const [mqDue, setMqDue] = useState('');
    const [mqQuestions, setMqQuestions] = useState([{ question_type: 'multiple_choice', question_text: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_index: 0, correct_text: '', marks: 1 }]);
    const [mqSubmitting, setMqSubmitting] = useState(false);
    const [mqMsg, setMqMsg] = useState(null);

    // Assignment submissions panel
    const [submissionsPanel, setSubmissionsPanel] = useState({});
    const [gradingState, setGradingState] = useState({});

    // Student results state
    const [studentResults, setStudentResults] = useState(null);
    const [resultsLoading, setResultsLoading] = useState(false);
    const [showResults, setShowResults] = useState(false);

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
                `${API_BASE}/api/courses/${courseId}/sessions`
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
                        date: formatPKTDate(session.start_time),
                        time: `${formatPKTTime(session.start_time)} - ${formatPKTTime(session.end_time)}`,
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
                `${API_BASE}/api/courses/${courseId}/students`
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
                `${API_BASE}/api/courses/${courseId}/full`
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
                `${API_BASE}/api/courses/${courseId}`
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

    const resolvedCourseId = course?.course_id || course?.id || courseId;
    const teacherIdForActions =
        localStorage.getItem('teacherId') ||
        localStorage.getItem('teacher_id') ||
        course?.teacher_id;

    const fetchAssignments = async (cid) => {
        if (!cid) return;
        setAssignmentsLoading(true);
        try {
            const r = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(cid)}/assignments`);
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) setAssignments(d.assignments || []);
        } catch (err) {
            console.warn('Could not fetch assignments:', err);
        } finally {
            setAssignmentsLoading(false);
        }
    };

    useEffect(() => {
        if (resolvedCourseId) {
            fetchAssignments(resolvedCourseId);
            fetchManualQuizzes(resolvedCourseId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedCourseId]);

    const submitAssignment = async () => {
        if (!aTitle.trim()) {
            setAMsg({ type: 'error', text: 'Title is required.' });
            return;
        }
        if (!teacherIdForActions) {
            setAMsg({ type: 'error', text: 'You must be logged in as a teacher.' });
            return;
        }
        setASubmitting(true);
        setAMsg(null);
        try {
            const form = new FormData();
            form.append('teacher_id', teacherIdForActions);
            form.append('title', aTitle.trim());
            form.append('description', aDesc.trim());
            if (aDue) form.append('due_date', aDue);
            if (aFile) form.append('file', aFile);

            const r = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(resolvedCourseId)}/assignments`, {
                method: 'POST',
                body: form,
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) {
                setAMsg({ type: 'success', text: 'Assignment posted for students.' });
                setATitle(''); setADesc(''); setADue(''); setAFile(null);
                setShowAssignmentForm(false);
                fetchAssignments(resolvedCourseId);
            } else {
                setAMsg({ type: 'error', text: d.error || 'Could not create assignment.' });
            }
        } catch {
            setAMsg({ type: 'error', text: 'Network error. Could not create assignment.' });
        } finally {
            setASubmitting(false);
        }
    };

    const deleteAssignment = async (assignmentId) => {
        if (!window.confirm('Delete this assignment?')) return;
        try {
            const r = await fetch(`${API_BASE}/api/assignments/${assignmentId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teacher_id: teacherIdForActions }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) {
                setAssignments((prev) => prev.filter((a) => a.assignment_id !== assignmentId));
            } else {
                alert(d.error || 'Could not delete assignment.');
            }
        } catch {
            alert('Network error. Could not delete assignment.');
        }
    };

    const fetchManualQuizzes = async (cid) => {
        if (!cid) return;
        setMqLoading(true);
        try {
            const r = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(cid)}/manual-quizzes`);
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) setManualQuizzes(d.quizzes || []);
        } catch { /* ignore */ } finally { setMqLoading(false); }
    };

    const submitManualQuiz = async () => {
        if (!mqTitle.trim()) { setMqMsg({ type: 'error', text: 'Quiz title is required.' }); return; }
        const validQs = mqQuestions.filter(q => q.question_text.trim());
        if (!validQs.length) { setMqMsg({ type: 'error', text: 'Add at least one question.' }); return; }
        if (!teacherIdForActions) { setMqMsg({ type: 'error', text: 'Teacher account not found.' }); return; }
        setMqSubmitting(true); setMqMsg(null);
        try {
            const body = {
                teacher_id: teacherIdForActions,
                title: mqTitle.trim(),
                due_date: mqDue ? `${mqDue}:00+05:00` : null,
                questions: validQs,
            };
            const r = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(resolvedCourseId)}/manual-quiz`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) {
                setMqMsg({ type: 'success', text: `Quiz created (ID: ${d.quiz_id}). Students can find it in My Quizzes.` });
                setMqTitle(''); setMqDue('');
                setMqQuestions([{ question_type: 'multiple_choice', question_text: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_index: 0, correct_text: '', marks: 1 }]);
                setShowQuizForm(false);
                fetchManualQuizzes(resolvedCourseId);
            } else {
                setMqMsg({ type: 'error', text: d.error || 'Could not create quiz.' });
            }
        } catch { setMqMsg({ type: 'error', text: 'Network error.' }); }
        finally { setMqSubmitting(false); }
    };

    const deleteManualQuiz = async (quizId) => {
        if (!window.confirm('Delete this quiz? All attempts will also be deleted.')) return;
        try {
            const r = await fetch(`${API_BASE}/api/quizzes/${quizId}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teacher_id: teacherIdForActions }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) setManualQuizzes(prev => prev.filter(q => q.quiz_id !== quizId));
            else alert(d.error || 'Could not delete quiz.');
        } catch { alert('Network error.'); }
    };

    const fetchSubmissions = async (assignmentId) => {
        setSubmissionsPanel(prev => ({ ...prev, [assignmentId]: { loading: true } }));
        try {
            const r = await fetch(`${API_BASE}/api/assignments/${assignmentId}/submissions`);
            const d = await r.json().catch(() => ({}));
            setSubmissionsPanel(prev => ({ ...prev, [assignmentId]: { loading: false, submissions: d.submissions || [], open: true } }));
        } catch {
            setSubmissionsPanel(prev => ({ ...prev, [assignmentId]: { loading: false, submissions: [], open: true } }));
        }
    };

    const toggleSubmissions = (assignmentId) => {
        const panel = submissionsPanel[assignmentId];
        if (panel?.open) {
            setSubmissionsPanel(prev => ({ ...prev, [assignmentId]: { ...prev[assignmentId], open: false } }));
        } else {
            fetchSubmissions(assignmentId);
        }
    };

    const saveGrade = async (submissionId, assignmentId) => {
        const gs = gradingState[submissionId] || {};
        try {
            const r = await fetch(`${API_BASE}/api/submissions/${submissionId}/grade`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacher_id: teacherIdForActions,
                    marks_obtained: gs.marks_obtained,
                    total_marks: gs.total_marks,
                    feedback: gs.feedback || '',
                }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) {
                fetchSubmissions(assignmentId);
                setGradingState(prev => ({ ...prev, [submissionId]: { ...prev[submissionId], saved: true } }));
                setTimeout(() => setGradingState(prev => ({ ...prev, [submissionId]: { ...prev[submissionId], saved: false } })), 2000);
            } else {
                alert(d.error || 'Could not save grade.');
            }
        } catch { alert('Network error.'); }
    };

    const fetchStudentResults = async () => {
        setResultsLoading(true); setShowResults(true);
        try {
            const r = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(resolvedCourseId)}/student-results`);
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) setStudentResults(d.students || []);
        } catch { /* ignore */ } finally { setResultsLoading(false); }
    };

    const formatDue = (iso) => {
        if (!iso) return 'No due date';
        const dt = new Date(iso);
        if (Number.isNaN(dt.getTime())) return 'No due date';
        return dt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    };

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

                                    {session.rawStatus === 'completed' && session.id && (
                                        <>
                                            <button
                                                type="button"
                                                className="session-action-btn secondary"
                                                onClick={() =>
                                                    navigate(`/recap/${encodeURIComponent(session.id)}`, {
                                                        state: {
                                                            sessionTitle: session.title,
                                                            courseCode: course?.course_code,
                                                            courseTitle: course?.title,
                                                            courseId: course?.id || course?.course_id,
                                                        },
                                                    })
                                                }
                                            >
                                                View Recap
                                            </button>
                                            <button
                                                type="button"
                                                className="session-action-btn secondary"
                                                disabled={generatingQuizSessionId === session.id}
                                                onClick={async () => {
                                                    const teacherId =
                                                        localStorage.getItem('teacherId') ||
                                                        localStorage.getItem('teacher_id') ||
                                                        course?.teacher_id;
                                                    if (!teacherId) {
                                                        alert('Teacher account not found. Log in as the course instructor.');
                                                        return;
                                                    }
                                                    setGeneratingQuizSessionId(session.id);
                                                    try {
                                                        const r = await fetch(
                                                            `${API_BASE}/api/sessions/${encodeURIComponent(session.id)}/generate-quiz`,
                                                            {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({
                                                                    teacher_id: teacherId,
                                                                    num_questions: 5,
                                                                }),
                                                            }
                                                        );
                                                        const d = await r.json().catch(() => ({}));
                                                        if (d.success) {
                                                            alert(
                                                                `Quiz created (ID: ${d.quiz_id}). Students can find it under "My Quizzes".`
                                                            );
                                                        } else {
                                                            alert(
                                                                (d.error || 'Could not generate quiz.') +
                                                                '\n\nTip: the class transcript must have captured lines during the session. Open the Recap page to see the transcript.'
                                                            );
                                                        }
                                                    } catch {
                                                        alert('Network error while generating quiz.');
                                                    } finally {
                                                        setGeneratingQuizSessionId(null);
                                                    }
                                                }}
                                            >
                                                {generatingQuizSessionId === session.id
                                                    ? 'Generating quiz…'
                                                    : 'Generate quiz'}
                                            </button>
                                        </>
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

                        {/* Assignments Section */}
                        <div className="section-card" id="assignments-section">
                            <div className="section-header">
                                <h3>Assignments ({assignments.length})</h3>
                                <button
                                    className="add-btn"
                                    onClick={() => { setShowAssignmentForm((v) => !v); setAMsg(null); }}
                                >
                                    {showAssignmentForm ? 'Cancel' : '+ New Assignment'}
                                </button>
                            </div>

                            {aMsg && (
                                <div
                                    style={{
                                        margin: '0 0 12px',
                                        padding: '10px 14px',
                                        borderRadius: 8,
                                        fontSize: 14,
                                        color: aMsg.type === 'success' ? '#065f46' : '#9b1c1c',
                                        background: aMsg.type === 'success' ? '#e8f6ee' : '#fee2e2',
                                        border: `1px solid ${aMsg.type === 'success' ? '#9cdbc0' : '#fca5a5'}`,
                                    }}
                                >
                                    {aMsg.text}
                                </div>
                            )}

                            {showAssignmentForm && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                                    <input
                                        type="text"
                                        placeholder="Assignment title"
                                        value={aTitle}
                                        onChange={(e) => setATitle(e.target.value)}
                                        style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d7e8' }}
                                    />
                                    <textarea
                                        placeholder="Description / instructions (optional)"
                                        value={aDesc}
                                        onChange={(e) => setADesc(e.target.value)}
                                        rows={3}
                                        style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d7e8', resize: 'vertical' }}
                                    />
                                    <label style={{ fontSize: 13, color: '#555', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        Due date
                                        <input
                                            type="datetime-local"
                                            value={aDue}
                                            onChange={(e) => setADue(e.target.value)}
                                            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d7e8' }}
                                        />
                                    </label>
                                    <label style={{ fontSize: 13, color: '#555', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        Attachment (optional)
                                        <input
                                            type="file"
                                            onChange={(e) => setAFile(e.target.files?.[0] || null)}
                                        />
                                    </label>
                                    <button
                                        className="add-btn"
                                        disabled={aSubmitting}
                                        onClick={submitAssignment}
                                        style={{ alignSelf: 'flex-start' }}
                                    >
                                        {aSubmitting ? 'Posting…' : 'Post Assignment'}
                                    </button>
                                </div>
                            )}

                            {assignmentsLoading ? (
                                <div className="loading-students">
                                    <div className="course-loading-spinner small"></div>
                                    <p>Loading assignments...</p>
                                </div>
                            ) : assignments.length === 0 ? (
                                <div className="no-students">
                                    <p>No assignments posted yet.</p>
                                </div>
                            ) : (
                                <div className="students-list">
                                    {assignments.map((a) => {
                                        const panel = submissionsPanel[a.assignment_id] || {};
                                        return (
                                            <div key={a.assignment_id} style={{ borderBottom: '1px solid #f0f2f8', paddingBottom: 12, marginBottom: 4 }}>
                                                <div className="student-item" style={{ alignItems: 'flex-start', borderBottom: 'none', paddingBottom: 0 }}>
                                                    <div className="student-info" style={{ flex: 1 }}>
                                                        <h4>{a.title}</h4>
                                                        {a.description && <p>{a.description}</p>}
                                                        <p className="student-email">Due: {formatDue(a.due_date)}</p>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                                                        {a.has_file && (
                                                            <a href={`${API_BASE}${a.download_url}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#567c8d', fontWeight: 600 }}>
                                                                ⤓ {a.file_name}
                                                            </a>
                                                        )}
                                                        <button
                                                            onClick={() => toggleSubmissions(a.assignment_id)}
                                                            style={{ fontSize: 12, color: '#567c8d', background: '#e8f0f5', border: '1px solid #c8d9e6', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
                                                        >
                                                            {panel.open ? 'Hide Submissions' : `View Submissions`}
                                                        </button>
                                                        <button onClick={() => deleteAssignment(a.assignment_id)} style={{ fontSize: 12, color: '#9b1c1c', background: 'none', border: 'none', cursor: 'pointer' }}>
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>

                                                {panel.open && (
                                                    <div style={{ marginTop: 10, background: '#f8fafc', borderRadius: 8, padding: 12 }}>
                                                        {panel.loading ? (
                                                            <p style={{ fontSize: 13, color: '#888' }}>Loading…</p>
                                                        ) : panel.submissions?.length === 0 ? (
                                                            <p style={{ fontSize: 13, color: '#888' }}>No submissions yet.</p>
                                                        ) : (
                                                            panel.submissions.map((sub) => {
                                                                const gs = gradingState[sub.submission_id] || {};
                                                                return (
                                                                    <div key={sub.submission_id} style={{ padding: '10px 0', borderBottom: '1px solid #e8eef5' }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                                                            <div>
                                                                                <strong style={{ fontSize: 13 }}>{sub.student_name}</strong>
                                                                                <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>{sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : ''}</span>
                                                                                {sub.has_file && (
                                                                                    <a href={`${API_BASE}${sub.download_url}`} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 12, color: '#567c8d', fontWeight: 600, marginTop: 2 }}>
                                                                                        ⤓ {sub.file_name}
                                                                                    </a>
                                                                                )}
                                                                            </div>
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
                                                                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                                                    <input
                                                                                        type="number"
                                                                                        placeholder="Marks"
                                                                                        defaultValue={sub.marks_obtained ?? ''}
                                                                                        style={{ width: 60, padding: '3px 6px', borderRadius: 4, border: '1px solid #c8d9e6', fontSize: 12 }}
                                                                                        onChange={e => setGradingState(prev => ({ ...prev, [sub.submission_id]: { ...prev[sub.submission_id], marks_obtained: e.target.value } }))}
                                                                                    />
                                                                                    <span style={{ fontSize: 12, color: '#888' }}>/</span>
                                                                                    <input
                                                                                        type="number"
                                                                                        placeholder="Total"
                                                                                        defaultValue={sub.total_marks ?? ''}
                                                                                        style={{ width: 60, padding: '3px 6px', borderRadius: 4, border: '1px solid #c8d9e6', fontSize: 12 }}
                                                                                        onChange={e => setGradingState(prev => ({ ...prev, [sub.submission_id]: { ...prev[sub.submission_id], total_marks: e.target.value } }))}
                                                                                    />
                                                                                </div>
                                                                                <input
                                                                                    type="text"
                                                                                    placeholder="Feedback (optional)"
                                                                                    defaultValue={sub.feedback || ''}
                                                                                    style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #c8d9e6', fontSize: 12 }}
                                                                                    onChange={e => setGradingState(prev => ({ ...prev, [sub.submission_id]: { ...prev[sub.submission_id], feedback: e.target.value } }))}
                                                                                />
                                                                                <button
                                                                                    onClick={() => saveGrade(sub.submission_id, a.assignment_id)}
                                                                                    style={{ padding: '4px 12px', background: '#567c8d', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                                                                                >
                                                                                    {gs.saved ? 'Saved ✓' : 'Save Grade'}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Manual Quizzes Section */}
                        <div className="section-card" id="manual-quizzes-section">
                            <div className="section-header">
                                <h3>Quizzes ({manualQuizzes.length})</h3>
                                <button
                                    className="add-btn"
                                    onClick={() => { setShowQuizForm((v) => !v); setMqMsg(null); }}
                                >
                                    {showQuizForm ? 'Cancel' : '+ Create Quiz'}
                                </button>
                            </div>

                            {mqMsg && (
                                <div style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: 8, fontSize: 14,
                                    color: mqMsg.type === 'success' ? '#065f46' : '#9b1c1c',
                                    background: mqMsg.type === 'success' ? '#e8f6ee' : '#fee2e2',
                                    border: `1px solid ${mqMsg.type === 'success' ? '#9cdbc0' : '#fca5a5'}` }}>
                                    {mqMsg.text}
                                </div>
                            )}

                            {showQuizForm && (
                                <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                                        <input type="text" placeholder="Quiz title" value={mqTitle} onChange={e => setMqTitle(e.target.value)}
                                            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #c8d9e6' }} />
                                        <label style={{ fontSize: 13, color: '#555', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            Due date (PKT)
                                            <input type="datetime-local" value={mqDue} onChange={e => setMqDue(e.target.value)}
                                                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #c8d9e6' }} />
                                        </label>
                                    </div>

                                    <div style={{ marginBottom: 12 }}>
                                        <strong style={{ fontSize: 14, color: '#2f4156' }}>Questions</strong>
                                        {mqQuestions.map((q, qi) => (
                                            <div key={qi} style={{ background: '#fff', borderRadius: 8, border: '1px solid #c8d9e6', padding: 14, marginTop: 10 }}>
                                                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                                                    <select value={q.question_type} onChange={e => {
                                                        const qs = [...mqQuestions]; qs[qi] = { ...qs[qi], question_type: e.target.value }; setMqQuestions(qs);
                                                    }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #c8d9e6', fontSize: 13 }}>
                                                        <option value="multiple_choice">Multiple Choice</option>
                                                        <option value="true_false">True / False</option>
                                                        <option value="short_answer">Fill in Blank</option>
                                                    </select>
                                                    <input type="number" min="0.5" step="0.5" value={q.marks} onChange={e => {
                                                        const qs = [...mqQuestions]; qs[qi] = { ...qs[qi], marks: e.target.value }; setMqQuestions(qs);
                                                    }} style={{ width: 70, padding: '6px 8px', borderRadius: 6, border: '1px solid #c8d9e6', fontSize: 13 }} placeholder="Marks" />
                                                    {mqQuestions.length > 1 && (
                                                        <button onClick={() => setMqQuestions(prev => prev.filter((_, i) => i !== qi))}
                                                            style={{ marginLeft: 'auto', fontSize: 12, color: '#9b1c1c', background: 'none', border: 'none', cursor: 'pointer' }}>
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>

                                                <input type="text" placeholder={`Question ${qi + 1}`} value={q.question_text}
                                                    onChange={e => { const qs = [...mqQuestions]; qs[qi] = { ...qs[qi], question_text: e.target.value }; setMqQuestions(qs); }}
                                                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #c8d9e6', fontSize: 13, boxSizing: 'border-box', marginBottom: 8 }} />

                                                {q.question_type === 'multiple_choice' && (
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                                        {['a', 'b', 'c', 'd'].map((opt, oi) => (
                                                            <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <input type="radio" name={`correct-${qi}`} checked={q.correct_index === oi}
                                                                    onChange={() => { const qs = [...mqQuestions]; qs[qi] = { ...qs[qi], correct_index: oi }; setMqQuestions(qs); }} />
                                                                <input type="text" placeholder={`Option ${opt.toUpperCase()}`} value={q[`option_${opt}`]}
                                                                    onChange={e => { const qs = [...mqQuestions]; qs[qi] = { ...qs[qi], [`option_${opt}`]: e.target.value }; setMqQuestions(qs); }}
                                                                    style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #c8d9e6', fontSize: 12 }} />
                                                            </div>
                                                        ))}
                                                        <div style={{ gridColumn: '1/-1', fontSize: 11, color: '#888' }}>Select the correct answer (radio button).</div>
                                                    </div>
                                                )}

                                                {q.question_type === 'true_false' && (
                                                    <div style={{ display: 'flex', gap: 16 }}>
                                                        {['True', 'False'].map((opt, oi) => (
                                                            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                                                <input type="radio" name={`tf-${qi}`} checked={q.correct_index === oi}
                                                                    onChange={() => { const qs = [...mqQuestions]; qs[qi] = { ...qs[qi], correct_index: oi, option_a: 'True', option_b: 'False', option_c: null, option_d: null }; setMqQuestions(qs); }} />
                                                                {opt}
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}

                                                {q.question_type === 'short_answer' && (
                                                    <input type="text" placeholder="Correct answer (for auto-grading)" value={q.correct_text}
                                                        onChange={e => { const qs = [...mqQuestions]; qs[qi] = { ...qs[qi], correct_text: e.target.value }; setMqQuestions(qs); }}
                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #c8d9e6', fontSize: 13, boxSizing: 'border-box' }} />
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                                        <button onClick={() => setMqQuestions(prev => [...prev, { question_type: 'multiple_choice', question_text: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_index: 0, correct_text: '', marks: 1 }])}
                                            style={{ padding: '8px 14px', background: '#e8f0f5', border: '1px solid #c8d9e6', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                                            + Add Question
                                        </button>
                                        <button className="add-btn" disabled={mqSubmitting} onClick={submitManualQuiz}>
                                            {mqSubmitting ? 'Creating…' : 'Create Quiz'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {mqLoading ? (
                                <div className="loading-students"><div className="course-loading-spinner small" /><p>Loading quizzes…</p></div>
                            ) : manualQuizzes.length === 0 ? (
                                <div className="no-students"><p>No quizzes created yet.</p></div>
                            ) : (
                                <div className="students-list">
                                    {manualQuizzes.map(q => (
                                        <div key={q.quiz_id} className="student-item" style={{ alignItems: 'flex-start' }}>
                                            <div className="student-info" style={{ flex: 1 }}>
                                                <h4>{q.title}</h4>
                                                <p>{q.question_count} questions · {q.total_marks} total marks · {q.attempt_count} attempts</p>
                                                <p className="student-email">Due: {formatDue(q.due_date)}</p>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                                                <span style={{ fontSize: 11, background: '#e8f0f5', color: '#567c8d', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
                                                    Quiz #{q.quiz_id}
                                                </span>
                                                <button onClick={() => deleteManualQuiz(q.quiz_id)}
                                                    style={{ fontSize: 12, color: '#9b1c1c', background: 'none', border: 'none', cursor: 'pointer' }}>
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
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
                                <button
                                    className="action-btn"
                                    onClick={() => {
                                        setShowAssignmentForm(true);
                                        setAMsg(null);
                                        document.getElementById('assignments-section')?.scrollIntoView({ behavior: 'smooth' });
                                    }}
                                >
                                    <span className="btn-icon">
                                        <i className="fa fa-file-text" aria-hidden="true"></i>
                                    </span>
                                    Create Assignment
                                </button>
                                <button
                                    className="action-btn"
                                    onClick={() => {
                                        setShowQuizForm(true);
                                        setMqMsg(null);
                                        document.getElementById('manual-quizzes-section')?.scrollIntoView({ behavior: 'smooth' });
                                    }}
                                >
                                    <span className="btn-icon">
                                        <i className="fa fa-question-circle" aria-hidden="true"></i>
                                    </span>
                                    Create Quiz
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
                                        {course.created_at ? formatPKTDate(course.created_at) : 'N/A'}
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
                                                    {formatPKTWeekdayShort(session.startTime)}
                                                </span>
                                                <span className="upcoming-date">
                                                    {formatPKTDayNumber(session.startTime)}
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

                        {/* Student Results */}
                        <div className="section-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <h3 style={{ margin: 0 }}>Student Results</h3>
                                <button
                                    className="add-btn"
                                    onClick={fetchStudentResults}
                                    disabled={resultsLoading}
                                >
                                    {resultsLoading ? 'Loading…' : showResults ? 'Refresh' : 'View Results'}
                                </button>
                            </div>

                            {showResults && !resultsLoading && (
                                studentResults === null ? (
                                    <p style={{ fontSize: 13, color: '#888' }}>Failed to load.</p>
                                ) : studentResults.length === 0 ? (
                                    <p style={{ fontSize: 13, color: '#888' }}>No enrolled students yet.</p>
                                ) : (
                                    <div>
                                        {studentResults.map(st => {
                                            const avgPct = st.quiz_attempts.length > 0
                                                ? Math.round(st.quiz_attempts.reduce((s, a) => s + a.percentage, 0) / st.quiz_attempts.length)
                                                : null;
                                            return (
                                                <div key={st.student_id} style={{ borderBottom: '1px solid #f0f2f8', paddingBottom: 12, marginBottom: 12 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div>
                                                            <strong style={{ fontSize: 14 }}>{st.name}</strong>
                                                            <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>{st.email}</span>
                                                        </div>
                                                        {avgPct != null && (
                                                            <span style={{
                                                                fontSize: 13, fontWeight: 700, padding: '2px 10px', borderRadius: 8,
                                                                background: avgPct >= 50 ? '#d1fae5' : '#fee2e2',
                                                                color: avgPct >= 50 ? '#065f46' : '#9b1c1c',
                                                            }}>{avgPct}% avg</span>
                                                        )}
                                                    </div>
                                                    {st.quiz_attempts.length > 0 && (
                                                        <div style={{ marginTop: 6 }}>
                                                            {st.quiz_attempts.slice(0, 3).map((a, i) => (
                                                                <div key={i} style={{ fontSize: 12, color: '#555', padding: '2px 0' }}>
                                                                    Quiz: {a.session_title || a.quiz_title} — {a.score} pts ({Math.round(a.percentage)}%) {a.passed ? '✓' : '✗'}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {st.assignment_submissions.length > 0 && (
                                                        <div style={{ marginTop: 4 }}>
                                                            {st.assignment_submissions.slice(0, 3).map((s, i) => (
                                                                <div key={i} style={{ fontSize: 12, color: '#555', padding: '2px 0' }}>
                                                                    Assign: {s.assignment_title} — {s.graded ? `${s.marks_obtained}/${s.total_marks}` : 'Not graded'}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {st.quiz_attempts.length === 0 && st.assignment_submissions.length === 0 && (
                                                        <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>No attempts yet.</div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CourseProfile;
