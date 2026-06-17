import { useNavigate, useLocation } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import './courseProfile.css';
import './studentCourseProfile.css';
import classMateLogo from './assets/Logo2.png';
import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

function StudentCourseProfile() {
    const navigate = useNavigate();
    const location = useLocation();
    const [course, setCourse] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [materials, setMaterials] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [quizzes, setQuizzes] = useState([]);
    const [classSessions, setClassSessions] = useState([]);
    const [showAllMaterials, setShowAllMaterials] = useState(false);
    const [notesBySession, setNotesBySession] = useState({});
    const [recordingsBySession, setRecordingsBySession] = useState({});
    const sessionPollRef = React.useRef(null);

    const courseId = location.state?.courseId || new URLSearchParams(location.search).get('id');
    const courseData = location.state?.courseData;

    const fetchMaterials = async (id) => {
        try {
            const res = await fetch(`${API_BASE}/api/courses/${id}/materials`);
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            if (data.success) setMaterials(data.materials || []);
            else setMaterials([]);
        } catch (e) {
            console.error('Error loading materials', e);
            setMaterials([]);
        }
    };

    const fetchAssignments = async (id) => {
        try {
            const res = await fetch(`${API_BASE}/api/courses/${id}/assignments`);
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            if (data.success) setAssignments(data.assignments || []);
            else setAssignments([]);
        } catch (e) {
            console.error('Error loading assignments', e);
            setAssignments([]);
        }
    };

    const fetchQuizzes = async (id) => {
        try {
            const res = await fetch(`${API_BASE}/api/courses/${id}/quizzes`);
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            if (data.success) setQuizzes(data.quizzes || []);
            else setQuizzes([]);
        } catch (e) {
            console.error('Error loading quizzes', e);
            setQuizzes([]);
        }
    };

    const fetchClassSessions = async (id) => {
        try {
            const res = await fetch(`${API_BASE}/api/courses/${id}/sessions`, { cache: 'no-store' });
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            if (data.success) setClassSessions(data.sessions || []);
            else setClassSessions([]);
        } catch (e) {
            console.error('Error loading sessions', e);
            setClassSessions([]);
        }
    };

    const handleDownloadMaterial = async (materialId, fileName) => {
        try {
            const response = await fetch(`${API_BASE}/api/materials/${materialId}/download`);

            if (!response.ok) {
                throw new Error('Download failed');
            }

            // Get the blob data
            const blob = await response.blob();

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error('Download error:', error);
            alert('Failed to download material');
        }
    };

    useEffect(() => {
        const id = courseData?.course_id || courseData?.id || courseId;

        const load = async () => {
            try {
                setLoading(true);
                if (!id) {
                    setError('No course specified');
                    setLoading(false);
                    return;
                }

                // Try to load course details (reuse same endpoints as teacher profile)
                const res = await fetch(`${API_BASE}/api/courses/${id}`);
                if (res.ok) {
                    const d = await res.json();
                    if (d.success) setCourse(d.course);
                    else setCourse(courseData || null);
                } else {
                    setCourse(courseData || null);
                }

                await Promise.all([
                    fetchMaterials(id),
                    fetchAssignments(id),
                    fetchQuizzes(id),
                    fetchClassSessions(id)
                ]);
            } catch (e) {
                console.error(e);
                setError('Failed to load course');
            } finally {
                setLoading(false);
            }
        };

        load();

        // Poll session statuses every 5 seconds so student sees live updates
        // when the teacher starts a meeting.
        if (id) {
            sessionPollRef.current = setInterval(() => {
                fetchClassSessions(id);
            }, 5000);
        }

        return () => {
            if (sessionPollRef.current) clearInterval(sessionPollRef.current);
        };
    }, [courseId, courseData]);

    // Look up shared lecture-notes PDFs for completed sessions.
    useEffect(() => {
        const completed = classSessions.filter((s) => {
            const sid = s.session_id || s.id;
            const isCompleted = s.status === 'completed' || (s.end_time && new Date(s.end_time) < new Date());
            return sid && isCompleted;
        });
        if (completed.length === 0) return;

        let cancelled = false;
        (async () => {
            const entries = await Promise.all(
                completed.map(async (s) => {
                    const sid = s.session_id || s.id;
                    try {
                        const r = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sid)}/notes-pdf`);
                        const d = await r.json().catch(() => ({}));
                        if (r.ok && d.success && d.shared) {
                            return [sid, { download_url: d.download_url, file_name: d.file_name }];
                        }
                    } catch {
                        /* ignore */
                    }
                    return [sid, null];
                })
            );
            if (!cancelled) setNotesBySession(Object.fromEntries(entries));
        })();

        return () => {
            cancelled = true;
        };
    }, [classSessions]);

    // Fetch shared recordings for each session.
    useEffect(() => {
        if (classSessions.length === 0) return;
        let cancelled = false;
        (async () => {
            const entries = await Promise.all(
                classSessions.map(async (s) => {
                    const sid = s.session_id || s.id;
                    if (!sid) return [sid, []];
                    try {
                        const r = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sid)}/recordings?viewer_type=student`);
                        const d = await r.json().catch(() => ({}));
                        if (r.ok && d.success) return [sid, d.recordings || []];
                    } catch {
                        /* ignore */
                    }
                    return [sid, []];
                })
            );
            if (!cancelled) setRecordingsBySession(Object.fromEntries(entries));
        })();
        return () => {
            cancelled = true;
        };
    }, [classSessions]);

    if (loading) return (
        <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading course...</p>
        </div>
    );

    if (error || !course) return (
        <div className="error-container">
            <h2>Error</h2>
            <p>{error || 'Course not found'}</p>
            <button onClick={() => navigate('/studentDashboard')}>Back to Dashboard</button>
        </div>
    );

    return (
        <div className="course-profile student-course-profile">
            <nav className="course-navbar student-course-navbar">
                <div className="navbar-left">
                    <div className="logo-container">
                        <img src={classMateLogo} alt="logo" className="navbar-logo" />
                        <span className="brand-name">classMate</span>
                    </div>
                </div>
                <div className="navbar-right">
                    <button className="back-course-btn" onClick={() => navigate('/studentDashboard')}>← Back</button>
                </div>
            </nav>

            <div className="course-content student-course-content">
                <div className="course-header student-course-header">
                    <div className="course-title-section student-course-title-section">
                        <h1 className="course-profile-code student-course-profile-code">{course.course_code}</h1>
                        <h2 className="course-profile-name student-course-profile-name">{course.title}</h2>
                        <p className="course-description student-course-description">{course.description || 'No description'}</p>
                        <div className="course-meta student-course-meta">
                            <span className="meta-item">{course.meeting_days || '-'}</span>
                            <span className="meta-item">{course.meeting_time || '-'}</span>
                            <span className="meta-item">{course.location || '-'}</span>
                        </div>
                    </div>

                    <div className="course-stats-grid student-course-stats-grid">
                        <div className="stat-card">
                            <span className="stat-value">{course.student_count || 0}</span>
                            <span className="stat-label">Students</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-value">{course.credit_hours || 0}</span>
                            <span className="stat-label">Credits</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-value">{classSessions.length}</span>
                            <span className="stat-label">Sessions</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-value">{assignments.length}</span>
                            <span className="stat-label">Assignments</span>
                        </div>
                    </div>
                </div>

                <div className="course-sections">
                    <div className="left-column">
                        <div className="section-card">
                            <div className="section-header">
                                <h3>Materials ({materials.length})</h3>
                                <button 
                                    className="view-all-btn" 
                                    onClick={() => setShowAllMaterials(!showAllMaterials)}
                                    disabled={materials.length === 0}
                                >
                                    {showAllMaterials ? 'Show Less' : 'View All'}
                                </button>
                            </div>
                            {materials.length === 0 ? (
                                <div className="no-students"><p>No materials uploaded yet.</p></div>
                            ) : (
                                <div className="activities-list">
                                    {(showAllMaterials ? materials : materials.slice(0, 3)).map((m, i) => (
                                        <div key={m.id || i} className="activity-item">
                                            <div className="activity-details">
                                                <p>{m.title || m.filename}</p>
                                                <small>{m.description}</small>
                                            </div>
                                            <div className="activity-time">
                                                <button 
                                                    className="download-btn"
                                                    onClick={() => handleDownloadMaterial(m.material_id || m.id, m.file_name || m.filename)}
                                                >
                                                    Download
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="section-card">
                            <div className="section-header">
                                <h3>Class Sessions ({classSessions.length})</h3>
                            </div>
                            {classSessions.length === 0 ? (
                                <div className="no-students"><p>No sessions scheduled.</p></div>
                            ) : (
                                <div className="class-sessions-list">
                                    {classSessions.map((s) => {
                                        const sessionId = s.session_id || s.id;
                                        const isCompleted =
                                            s.status === 'completed' ||
                                            (s.end_time && new Date(s.end_time) < new Date());
                                        return (
                                            <div key={sessionId} className="session-item">
                                                <div className="session-header">
                                                    <h4 className="session-title">{s.title || s.session_title}</h4>
                                                    <span className={`session-status ${s.status || 'scheduled'}`}>
                                                        {s.status || 'Scheduled'}
                                                    </span>
                                                </div>
                                                <div className="session-details">
                                                    <div className="session-date-time">
                                                        <span className="session-date">
                                                            {new Date(s.start_time || s.start).toLocaleDateString()}
                                                        </span>
                                                        <span className="session-time">
                                                            {new Date(s.start_time || s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    {s.description && (
                                                        <p className="session-description">{s.description}</p>
                                                    )}
                                                </div>
                                                <div className="session-actions">
                                                    {isCompleted ? (
                                                        notesBySession[sessionId] ? (
                                                            <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                                                                <a
                                                                    className="session-action-btn outline"
                                                                    href={`${API_BASE}${notesBySession[sessionId].view_url || notesBySession[sessionId].download_url}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    style={{ textDecoration: 'none' }}
                                                                >
                                                                    📄 View Handout
                                                                </a>
                                                                <a
                                                                    className="session-action-btn secondary"
                                                                    href={`${API_BASE}${notesBySession[sessionId].download_url}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    style={{ textDecoration: 'none' }}
                                                                >
                                                                    ⤓ Download
                                                                </a>
                                                            </span>
                                                        ) : (
                                                            <span className="session-ended-label" style={{ fontSize: 13, color: '#888', fontWeight: 600 }}>
                                                                Class ended
                                                            </span>
                                                        )
                                                    ) : (
                                                        <button
                                                            className={`session-action-btn ${s.status === 'ongoing' ? 'outline join-active' : 'outline'}`}
                                                            onClick={() =>
                                                                s.meeting_room_id
                                                                    ? window.open(`/meeting/${s.meeting_room_id}`, '_blank')
                                                                    : null
                                                            }
                                                            disabled={!s.meeting_room_id || s.status === 'cancelled'}
                                                            title={s.status === 'ongoing' ? 'Join the live session' : 'Enter waiting room — session not yet started'}
                                                        >
                                                            {s.status === 'ongoing' ? '🔴 Join Now' : 'Enter Room'}
                                                        </button>
                                                    )}
                                                </div>

                                                {(recordingsBySession[sessionId] || []).length > 0 && (
                                                    <div className="session-recordings" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#567c8d' }}>
                                                            📹 Recordings
                                                        </span>
                                                        {recordingsBySession[sessionId].map((rec) => (
                                                            <div key={rec.recording_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                                <span style={{ flex: 1, fontSize: 13, color: '#333', minWidth: 120 }}>{rec.title}</span>
                                                                <a
                                                                    className="session-action-btn outline"
                                                                    href={`${API_BASE}${rec.stream_url}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    style={{ textDecoration: 'none' }}
                                                                >
                                                                    ▶ View
                                                                </a>
                                                                <a
                                                                    className="session-action-btn secondary"
                                                                    href={`${API_BASE}${rec.download_url}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    style={{ textDecoration: 'none' }}
                                                                >
                                                                    ⤓ Download
                                                                </a>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="right-column">
                        <div className="section-card">
                            <h3>Assignments ({assignments.length})</h3>
                            {assignments.length === 0 ? (
                                <p className="no-students">No assignments posted.</p>
                            ) : (
                                <div className="assignments-list">
                                    {assignments.map(a => (
                                        <div key={a.id || a.assignment_id} className="assignment-item">
                                            <div className="assignment-details">
                                                <h4>{a.title}</h4>
                                                {a.description && <p>{a.description}</p>}
                                                <p className="assignment-due" style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>
                                                    Due: {a.due_date
                                                        ? new Date(a.due_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                                                        : 'No due date'}
                                                </p>
                                            </div>
                                            <div className="assignment-status">
                                                {a.has_file && a.download_url ? (
                                                    <a
                                                        className="view-all-btn"
                                                        href={`${API_BASE}${a.download_url}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        ⤓ Download
                                                    </a>
                                                ) : (
                                                    <span style={{ fontSize: 12, color: '#aaa' }}>No file</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="section-card">
                            <h3>Exams ({quizzes.length})</h3>
                            {quizzes.length === 0 ? (
                                <p className="no-students">No exams available.</p>
                            ) : (
                                <div className="activities-list">
                                    {quizzes.map(q => (
                                        <div key={q.id || q.quiz_id} className="activity-item">
                                            <div className="activity-details">
                                                <p>{q.title}</p>
                                                <small>Duration: {q.duration_minutes || '-'} mins</small>
                                            </div>
                                            <div className="activity-time">
                                                <button className="view-all-btn" onClick={() => navigate(`/quiz/${q.id || q.quiz_id}`)}>Take</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default StudentCourseProfile;
