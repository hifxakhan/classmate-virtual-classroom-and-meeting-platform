import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './viewAttendance.css';
import classMateLogo from './assets/Logo2.png';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

function ViewAttendance() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sessionInfo, setSessionInfo] = useState(null);
    const [teacherInfo, setTeacherInfo] = useState(null);
    const pdfRef = useRef();

    useEffect(() => {
        fetchAttendance();
    }, [sessionId]);

    const fetchAttendance = async () => {
        try {
            setLoading(true);
            setError(null);

            // Fetch attendance records
            const response = await fetch(`https://classmate-backend-eysi.onrender.com/api/attendance/session/${sessionId}`);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                setAttendance(data.attendance || []);
                
                // Fetch session info for display
                const sessionResponse = await fetch(`https://classmate-backend-eysi.onrender.com/api/sessions/${sessionId}`);
                if (sessionResponse.ok) {
                    const sessionData = await sessionResponse.json();
                    if (sessionData.success) {
                        // Handle both response formats (direct session or nested in data)
                        const sessionInfo = sessionData.session || sessionData.data?.session;
                        setSessionInfo(sessionInfo);
                        
                        // Fetch teacher info
                        if (sessionInfo?.teacher_id) {
                            const teacherResponse = await fetch(`https://classmate-backend-eysi.onrender.com/api/teacher/${sessionInfo.teacher_id}`);
                            if (teacherResponse.ok) {
                                const teacherData = await teacherResponse.json();
                                if (teacherData.success) {
                                    setTeacherInfo(teacherData.teacher);
                                }
                            }
                        }
                    }
                } else {
                    console.error('Failed to fetch session info:', sessionResponse.status);
                }
            } else {
                throw new Error(data.error || 'Failed to load attendance');
            }
        } catch (err) {
            console.error('Error fetching attendance:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatDuration = (seconds) => {
        if (!seconds) return 'N/A';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    };

    const getStatusBadgeClass = (status) => {
        switch(status?.toLowerCase()) {
            case 'present':
                return 'status-present';
            case 'absent':
                return 'status-absent';
            case 'late':
                return 'status-late';
            default:
                return 'status-unknown';
        }
    };

    const generatePDF = async () => {
        try {
            const element = pdfRef.current;
            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff'
            });
            
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4'
            });
            
            const imgWidth = 280;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            const pdf_width = pdf.internal.pageSize.getWidth();
            const pdf_height = pdf.internal.pageSize.getHeight();
            
            let heightLeft = imgHeight;
            let position = 0;
            
            pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
            heightLeft -= pdf_height;
            
            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
                heightLeft -= pdf_height;
            }
            
            const fileName = `Attendance_${sessionInfo?.course_code}_${new Date().getTime()}.pdf`;
            pdf.save(fileName);
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Failed to generate PDF');
        }
    };

    return (
        <div className="attendance-container">
            {/* Header */}
            <div className="attendance-header">
                <div className="attendance-logo-section">
                    <img src={classMateLogo} alt="ClassMate Logo" className="attendance-logo" />
                    <h1 className="attendance-app-name">classmate</h1>
                </div>
            </div>

            {/* Main Content */}
            <div className="attendance-content">
                <div className="attendance-page-header">
                    <div className="attendance-header-info">
                        <h1 className="attendance-main-title">Session Attendance</h1>
                        {sessionInfo && (
                            <div className="attendance-session-info">
                                <p className="attendance-session-title">{sessionInfo.title || sessionInfo.session_title}</p>
                                <p className="attendance-session-course">{sessionInfo.course_code} - {sessionInfo.course_title}</p>
                                <p className="attendance-session-date">{formatDateTime(sessionInfo.start_time)}</p>
                            </div>
                        )}
                    </div>
                    <div className="attendance-header-actions">
                        {attendance.length > 0 && (
                            <button
                                className="attendance-download-btn"
                                onClick={generatePDF}
                            >
                                <i className="fas fa-download"></i> Download Attendance
                            </button>
                        )}
                        <button
                            className="attendance-back-btn"
                            onClick={() => navigate('/manageMeeting')}
                        >
                            <i className="fas fa-arrow-left"></i> Back to Meetings
                        </button>
                    </div>
                </div>

                {loading && (
                    <div className="attendance-loading">
                        <div className="attendance-spinner"></div>
                        <p>Loading attendance records...</p>
                    </div>
                )}

                {error && (
                    <div className="attendance-error">
                        <h2>Error Loading Attendance</h2>
                        <p>{error}</p>
                        <button onClick={fetchAttendance} className="attendance-retry-btn">
                            ↻ Retry
                        </button>
                    </div>
                )}

                {!loading && !error && (
                    <>
                        {attendance.length === 0 ? (
                            <div className="attendance-empty">
                                <div className="attendance-empty-icon">
                                    <i className="fas fa-users"></i>
                                </div>
                                <h3>No Attendance Records</h3>
                                <p>No students have joined this session yet.</p>
                            </div>
                        ) : (
                            <div ref={pdfRef} className="attendance-pdf-container">
                                <div className="attendance-pdf-header">
                                    <div className="attendance-pdf-logo-section">
                                        <img src={classMateLogo} alt="ClassMate Logo" className="attendance-pdf-logo" />
                                        <div>
                                            <h2 className="attendance-pdf-brand">ClassMate</h2>
                                            <p className="attendance-pdf-subtitle">Virtual Classroom & Meeting Platform</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="attendance-pdf-info">
                                    <div className="attendance-pdf-section">
                                        <h3>Course Information</h3>
                                        <p><strong>Course Code:</strong> {sessionInfo?.course_code}</p>
                                        <p><strong>Course Title:</strong> {sessionInfo?.course_title}</p>
                                    </div>
                                    <div className="attendance-pdf-section">
                                        <h3>Session Details</h3>
                                        <p><strong>Session Title:</strong> {sessionInfo?.title || sessionInfo?.session_title}</p>
                                        <p><strong>Date & Time:</strong> {formatDateTime(sessionInfo?.start_time)}</p>
                                    </div>
                                    {teacherInfo && (
                                        <div className="attendance-pdf-section">
                                            <h3>Instructor</h3>
                                            <p><strong>Name:</strong> {teacherInfo.first_name} {teacherInfo.last_name}</p>
                                            <p><strong>Email:</strong> {teacherInfo.email}</p>
                                        </div>
                                    )}
                                </div>

                            <div className="attendance-table-container">
                                <div className="attendance-summary">
                                    <div className="attendance-summary-card">
                                        <div className="attendance-summary-label">Total Students</div>
                                        <div className="attendance-summary-value">{attendance.length}</div>
                                    </div>
                                    <div className="attendance-summary-card">
                                        <div className="attendance-summary-label">Present</div>
                                        <div className="attendance-summary-value attendance-present-count">
                                            {attendance.filter(a => a.status === 'present').length}
                                        </div>
                                    </div>
                                    <div className="attendance-summary-card">
                                        <div className="attendance-summary-label">Session Duration</div>
                                        <div className="attendance-summary-value">
                                            {formatDuration(
                                                Math.floor((new Date(sessionInfo?.end_time) - new Date(sessionInfo?.start_time)) / 1000)
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <table className="attendance-table">
                                    <thead>
                                        <tr>
                                            <th>Student ID</th>
                                            <th>Student Name</th>
                                            <th>Status</th>
                                            <th>Joined At</th>
                                            <th>Left At</th>
                                            <th>Duration</th>
                                            <th>Remarks</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {attendance.map((record) => (
                                            <tr key={record.attendance_id}>
                                                <td>{record.student_id}</td>
                                                <td>{record.student_name || 'N/A'}</td>
                                                <td>
                                                    <span className={`attendance-status-badge ${getStatusBadgeClass(record.status)}`}>
                                                        {record.status || 'N/A'}
                                                    </span>
                                                </td>
                                                <td>{formatDateTime(record.joined_at)}</td>
                                                <td>{formatDateTime(record.left_at)}</td>
                                                <td>{formatDuration(record.duration_seconds)}</td>
                                                <td>{record.remarks || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default ViewAttendance;
