import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import './scheduleForm.css';
import classMateLogo from './assets/Logo2.png';
import { useTimezone } from './contexts/TimezoneContext.jsx';

function ScheduleForm() {
    const navigate = useNavigate();
    const { timezone } = useTimezone();
    const [teacher, setTeacher] = useState(null);
    const [courses, setCourses] = useState([]);
    const [loading, setLoading] = useState(false);

    // Get current time for validation
    const getCurrentDateTime = () => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 16);
    };

    const currentDateTime = getCurrentDateTime();

    // Form state - matching class_session table columns
    const [formData, setFormData] = useState({
        // From ERD: Associated with a course
        course_id: '',

        // Session information
        title: '',
        description: '',

        // Meeting times
        start_time: '',
        end_time: '',

        // Meeting info
        meeting_room_id: '',
        meeting_token: '',
        is_private: false,

        // Recording (optional)
        recording_path: '',
        recording_available: false,

        // Status from ERD - using enum: 'scheduled', 'ongoing', 'completed', 'cancelled'
        status: 'scheduled',

        // Additional info
        materials: [''],
        notes: '',
    });

    // Fetch teacher and courses on component mount
    useEffect(() => {
        const fetchTeacherData = async () => {
            try {
                setLoading(true);
                const teacherEmail = localStorage.getItem('teacherEmail');

                if (!teacherEmail) {
                    navigate('/');
                    return;
                }

                // Fetch teacher profile
                const teacherResponse = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/teacher/profile/current?email=${encodeURIComponent(teacherEmail)}`
                );

                if (teacherResponse.ok) {
                    const teacherData = await teacherResponse.json();
                    if (teacherData.success) {
                        setTeacher(teacherData.teacher);

                        // Fetch teacher's courses (only active ones)
                        const coursesResponse = await fetch(
                            `https://classmate-backend-eysi.onrender.com/api/teacher/courses?teacher_id=${teacherData.teacher.teacher_id}`
                        );

                        if (coursesResponse.ok) {
                            const coursesData = await coursesResponse.json();
                            if (coursesData.success) {
                                // Filter only active courses
                                const activeCourses = coursesData.courses.filter(course =>
                                    course.status === 'active'
                                );
                                setCourses(activeCourses);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching teacher data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchTeacherData();
    }, [navigate]);

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleMaterialsChange = (index, value) => {
        const newMaterials = [...formData.materials];
        newMaterials[index] = value;
        setFormData(prev => ({
            ...prev,
            materials: newMaterials
        }));
    };

    const addMaterialField = () => {
        setFormData(prev => ({
            ...prev,
            materials: [...prev.materials, '']
        }));
    };

    const removeMaterialField = (index) => {
        if (formData.materials.length > 1) {
            const newMaterials = formData.materials.filter((_, i) => i !== index);
            setFormData(prev => ({
                ...prev,
                materials: newMaterials
            }));
        }
    };

    const generateMeetingId = () => {
        // Generate a simple meeting ID
        const randomId = Math.random().toString(36).substring(2, 10);
        const courseCode = courses.find(c => c.id === formData.course_id)?.course_code || 'meet';
        const meetingId = `${courseCode}-${randomId}`;

        setFormData(prev => ({
            ...prev,
            meeting_room_id: meetingId
        }));
    };

    const generateToken = () => {
        const token = Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);

        setFormData(prev => ({
            ...prev,
            meeting_token: token
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.course_id) {
            alert('Please select a course');
            return;
        }

        if (!formData.title) {
            alert('Please enter a session title');
            return;
        }

        if (!formData.start_time || !formData.end_time) {
            alert('Please select start and end times');
            return;
        }

        // Validate start time is not before current time
        if (new Date(formData.start_time) < new Date(currentDateTime)) {
            alert('Start time must be in the future (after current time)');
            return;
        }

        // Validate end time is after start time
        if (new Date(formData.end_time) <= new Date(formData.start_time)) {
            alert('End time must be after start time');
            return;
        }

        // Validate end time is not before current time
        if (new Date(formData.end_time) < new Date(currentDateTime)) {
            alert('End time must be in the future (after current time)');
            return;
        }

        setLoading(true);

        const filteredMaterials = formData.materials.filter(material => material.trim() !== '');

        const submissionData = {
            ...formData,
            materials: filteredMaterials,
            participants_count: 0,
            teacher_id: teacher?.teacher_id,
            timezone
        };

        console.log('Form submission data:', submissionData);

        try {
            // Make API call to create schedule
            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/teacher/schedule/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(submissionData)
            });

            const result = await response.json();

            if (result.success) {
                alert('Session scheduled successfully!');
                navigate('/teacherDashboard');
            } else {
                alert(`Error: ${result.error || 'Failed to schedule session'}`);
                setLoading(false);
            }
        } catch (error) {
            console.error('Error submitting form:', error);
            alert('Error scheduling session. Please try again.');
            setLoading(false);
        }
    };

    const handleCancel = () => {
        navigate('/teacherDashboard');
    };

    const statusOptions = [
        { value: 'scheduled', label: 'Scheduled', disabled: false }
    ];

    if (loading && !teacher) {
        return (
            <div className="sf-loading-container">
                <div className="sf-loading-spinner"></div>
                <p>Loading teacher data...</p>
            </div>
        );
    }

    return (
        <div className="sf-container">
            {/* Navigation Header */}
            <nav className="sf-navbar">
                <div className="sf-navbar-left">
                    <div className="sf-logo-container">
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="sf-navbar-logo"
                        />
                        <span className="sf-brand-name">classMate</span>
                    </div>
                </div>

                <div className="sf-navbar-right">
                    <button className="sf-back-btn" onClick={handleCancel}>
                        ← Back to Dashboard
                    </button>
                </div>
            </nav>

            {/* Main Form Content */}
            <div className="sf-content">
                <div className="sf-form-wrapper">
                    {/* Form Header */}
                    <div className="sf-form-header">
                        <h1 className="sf-form-title">Schedule New Session</h1>
                        <p className="sf-form-subtitle">
                            Create a new class session or meeting. All fields marked with * are required.
                        </p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="sf-form">
                        {/* Course Selection */}
                        <div className="sf-form-group">
                            <label className="sf-form-label" htmlFor="course_id">
                                Course * <span className="sf-required">*</span>
                            </label>
                            <select
                                id="course_id"
                                name="course_id"
                                value={formData.course_id}
                                onChange={handleInputChange}
                                required
                                className="sf-form-select"
                                disabled={courses.length === 0}
                            >
                                <option value="">-- Select a Course --</option>
                                {courses.map(course => (
                                    <option key={course.id} value={course.id}>
                                        {course.course_code} - {course.title}
                                        ({course.student_count || 0} students)
                                    </option>
                                ))}
                            </select>
                            {courses.length === 0 && (
                                <p className="sf-form-help">No active courses found</p>
                            )}
                        </div>

                        {/* Session Title and Status */}
                        <div className="sf-form-row">
                            <div className="sf-form-group">
                                <label className="sf-form-label" htmlFor="title">
                                    Session Title * <span className="sf-required">*</span>
                                </label>
                                <input
                                    type="text"
                                    id="title"
                                    name="title"
                                    value={formData.title}
                                    onChange={handleInputChange}
                                    placeholder="e.g., Python Basics Lecture, Department Meeting"
                                    required
                                    className="sf-form-input"
                                />
                            </div>

                            <div className="sf-form-group">
                                <label className="sf-form-label" htmlFor="status">
                                    Status
                                </label>
                                <select
                                    id="status"
                                    name="status"
                                    value={formData.status}
                                    onChange={handleInputChange}
                                    className="sf-form-select"
                                >
                                    {statusOptions.map(option => (
                                        <option key={option.value} value={option.value} disabled={option.disabled}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Description */}
                        <div className="sf-form-group">
                            <label className="sf-form-label" htmlFor="description">
                                Description
                            </label>
                            <textarea
                                id="description"
                                name="description"
                                value={formData.description}
                                onChange={handleInputChange}
                                placeholder="Brief description of the session"
                                rows="4"
                                className="sf-form-textarea"
                            />
                        </div>

                        {/* Date and Time */}
                        <div className="sf-form-row">
                            <div className="sf-form-group">
                                <label className="sf-form-label" htmlFor="start_time">
                                    Start Time * <span className="sf-required">*</span>
                                </label>
                                <input
                                    type="datetime-local"
                                    id="start_time"
                                    name="start_time"
                                    value={formData.start_time}
                                    onChange={handleInputChange}
                                    min={currentDateTime}
                                    required
                                    className="sf-form-input"
                                />
                                <p className="sf-form-help">Must be after current time</p>
                            </div>

                            <div className="sf-form-group">
                                <label className="sf-form-label" htmlFor="end_time">
                                    End Time * <span className="sf-required">*</span>
                                </label>
                                <input
                                    type="datetime-local"
                                    id="end_time"
                                    name="end_time"
                                    value={formData.end_time}
                                    onChange={handleInputChange}
                                    min={currentDateTime}
                                    required
                                    className="sf-form-input"
                                />
                                <p className="sf-form-help">Must be after start time and current time</p>
                            </div>
                        </div>

                        {/* Meeting Room Info */}
                        <div className="sf-form-row">
                            <div className="sf-form-group">
                                <label className="sf-form-label" htmlFor="meeting_room_id">
                                    Meeting Room ID
                                </label>
                                <div className="sf-input-with-button">
                                    <input
                                        type="text"
                                        id="meeting_room_id"
                                        name="meeting_room_id"
                                        value={formData.meeting_room_id}
                                        onChange={handleInputChange}
                                        placeholder="e.g., cs101-room-001"
                                        className="sf-form-input"
                                    />
                                    <button
                                        type="button"
                                        className="sf-generate-btn"
                                        onClick={generateMeetingId}
                                    >
                                        Generate
                                    </button>
                                </div>
                            </div>

                            <div className="sf-form-group">
                                <label className="sf-form-label" htmlFor="meeting_token">
                                    Meeting Token
                                </label>
                                <div className="sf-input-with-button">
                                    <input
                                        type="text"
                                        id="meeting_token"
                                        name="meeting_token"
                                        value={formData.meeting_token}
                                        onChange={handleInputChange}
                                        placeholder="Access token for the meeting"
                                        className="sf-form-input"
                                    />
                                    <button
                                        type="button"
                                        className="sf-generate-btn"
                                        onClick={generateToken}
                                    >
                                        Generate
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Privacy and Recording Settings */}
                        <div className="sf-form-row">
                            <div className="sf-form-group">
                                <div className="sf-checkbox-group">
                                    <label className="sf-checkbox-label">
                                        <input
                                            type="checkbox"
                                            name="is_private"
                                            checked={formData.is_private}
                                            onChange={handleInputChange}
                                            className="sf-form-checkbox"
                                        />
                                        <span className="sf-checkbox-text">Private Session</span>
                                    </label>
                                    <p className="sf-checkbox-hint">Private sessions require an invitation to join</p>
                                </div>
                            </div>

                            <div className="sf-form-group">
                                <div className="sf-checkbox-group">
                                    <label className="sf-checkbox-label">
                                        <input
                                            type="checkbox"
                                            name="recording_available"
                                            checked={formData.recording_available}
                                            onChange={handleInputChange}
                                            className="sf-form-checkbox"
                                        />
                                        <span className="sf-checkbox-text">Recording Available</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Recording Path (if recording available) */}
                        {formData.recording_available && (
                            <div className="sf-form-group">
                                <label className="sf-form-label" htmlFor="recording_path">
                                    Recording Path
                                </label>
                                <input
                                    type="text"
                                    id="recording_path"
                                    name="recording_path"
                                    value={formData.recording_path}
                                    onChange={handleInputChange}
                                    placeholder="Path to recording in storage"
                                    className="sf-form-input"
                                />
                            </div>
                        )}

                        {/* Materials */}
                        <div className="sf-form-group">
                            <label className="sf-form-label">
                                Materials (File paths/URLs)
                            </label>
                            {formData.materials.map((material, index) => (
                                <div key={index} className="sf-materials-row">
                                    <input
                                        type="text"
                                        value={material}
                                        onChange={(e) => handleMaterialsChange(index, e.target.value)}
                                        placeholder={`Material ${index + 1} path or URL`}
                                        className="sf-form-input"
                                    />
                                    <button
                                        type="button"
                                        className="sf-remove-btn"
                                        onClick={() => removeMaterialField(index)}
                                        disabled={formData.materials.length === 1}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="sf-add-btn"
                                onClick={addMaterialField}
                            >
                                + Add Material
                            </button>
                        </div>

                        {/* Notes */}
                        <div className="sf-form-group">
                            <label className="sf-form-label" htmlFor="notes">
                                Teacher's Notes
                            </label>
                            <textarea
                                id="notes"
                                name="notes"
                                value={formData.notes}
                                onChange={handleInputChange}
                                placeholder="Additional notes or instructions"
                                rows="3"
                                className="sf-form-textarea"
                            />
                        </div>

                        {/* Form Actions */}
                        <div className="sf-form-actions">
                            <button
                                type="button"
                                className="sf-cancel-btn"
                                onClick={handleCancel}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="sf-submit-btn"
                                disabled={loading}
                            >
                                {loading ? 'Processing...' : 'Schedule Session'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Sidebar - Teacher Info & Preview */}
                <div className="sf-sidebar">
                    <div className="sf-teacher-card">
                        <h3 className="sf-sidebar-title">Teacher Information</h3>
                        {teacher ? (
                            <div className="sf-teacher-details">
                                <div className="sf-teacher-avatar">
                                    {teacher.name?.charAt(0) || 'T'}
                                </div>
                                <div className="sf-teacher-info">
                                    <h4>{teacher.name}</h4>
                                    <p className="sf-teacher-dept">{teacher.department}</p>
                                    <p className="sf-teacher-email">{teacher.email}</p>
                                </div>
                            </div>
                        ) : (
                            <p>Loading teacher information...</p>
                        )}
                    </div>

                    <div className="sf-preview-card">
                        <h3 className="sf-sidebar-title">Session Preview</h3>
                        <div className="sf-preview-content">
                            <div className="sf-preview-item">
                                <span className="sf-preview-label">Course:</span>
                                <span className="sf-preview-value">
                                    {formData.course_id ?
                                        courses.find(c => c.id === formData.course_id)?.course_code || 'Not selected'
                                        : 'Not selected'}
                                </span>
                            </div>
                            <div className="sf-preview-item">
                                <span className="sf-preview-label">Title:</span>
                                <span className="sf-preview-value">{formData.title || 'Not entered'}</span>
                            </div>
                            <div className="sf-preview-item">
                                <span className="sf-preview-label">Time:</span>
                                <span className="sf-preview-value">
                                    {formData.start_time ?
                                        new Date(formData.start_time).toLocaleString() + ' to ' +
                                        new Date(formData.end_time).toLocaleTimeString()
                                        : 'Not set'}
                                </span>
                            </div>
                            <div className="sf-preview-item">
                                <span className="sf-preview-label">Status:</span>
                                <span className={`sf-status-badge sf-status-${formData.status}`}>
                                    {statusOptions.find(s => s.value === formData.status)?.label || 'Scheduled'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="sf-help-card">
                        <h3 className="sf-sidebar-title">Help & Guidelines</h3>
                        <ul className="sf-help-list">
                            <li>Select the course this session belongs to</li>
                            <li>Provide a clear, descriptive title</li>
                            <li>Ensure end time is after start time</li>
                            <li>Generate unique meeting IDs for each session</li>
                            <li>Private sessions are invitation-only</li>
                            <li>Status can be changed later if needed</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ScheduleForm;
