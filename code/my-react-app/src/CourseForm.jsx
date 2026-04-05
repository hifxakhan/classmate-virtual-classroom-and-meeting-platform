import React, { useState, useEffect } from 'react';
import './CourseForm.css';

function CourseForm({ onBackToDashboard }) {
    const [formData, setFormData] = useState({
        courseCode: '',
        courseId: '',
        title: '',
        description: '',
        creditHours: '',
        department: '',
        teacherId: '',
        semester: '',
        status: 'active',
        maxStudents: 50,
        syllabusUrl: '',
        schedule: ''
    });

    const [teachers, setTeachers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('');

    useEffect(() => {
        fetchTeachers();
    }, []);

    const fetchTeachers = async () => {
        try {
            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/admin/teachers/all');
            const data = await response.json();
            if (data.success) {
                setTeachers(data.teachers || []);
            }
        } catch (error) {
            console.error('Error fetching teachers:', error);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const validateForm = () => {
        if (!formData.courseCode.trim()) {
            setMessage('Course Code is required');
            setMessageType('error');
            return false;
        }

        if (!formData.title.trim()) {
            setMessage('Course Title is required');
            setMessageType('error');
            return false;
        }

        if (!formData.creditHours || isNaN(formData.creditHours) || parseInt(formData.creditHours) <= 0) {
            setMessage('Credit Hours must be a valid positive number');
            setMessageType('error');
            return false;
        }

        if (!formData.teacherId) {
            setMessage('Teacher is required');
            setMessageType('error');
            return false;
        }

        if (formData.maxStudents && (isNaN(formData.maxStudents) || parseInt(formData.maxStudents) <= 0)) {
            setMessage('Max Students must be a positive number');
            setMessageType('error');
            return false;
        }

        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');

        if (!validateForm()) return;

        setLoading(true);

        try {
            const payload = {
                courseCode: formData.courseCode.trim(),
                courseId: formData.courseId.trim() || null,
                title: formData.title.trim(),
                description: formData.description.trim() || null,
                creditHours: parseInt(formData.creditHours),
                department: formData.department.trim() || null,
                teacherId: formData.teacherId,
                semester: formData.semester ? parseInt(formData.semester) : null,
                status: formData.status,
                maxStudents: parseInt(formData.maxStudents) || 50,
                syllabusUrl: formData.syllabusUrl.trim() || null,
                schedule: formData.schedule.trim() || null
            };

            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/courses/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (data.success) {
                setMessageType('success');
                setMessage(`✅ Course "${formData.title}" created successfully!`);

                // Reset form
                setFormData({
                    courseCode: '',
                    courseId: '',
                    title: '',
                    description: '',
                    creditHours: '',
                    department: '',
                    teacherId: '',
                    semester: '',
                    status: 'active',
                    maxStudents: 50,
                    syllabusUrl: '',
                    schedule: ''
                });

                // Redirect after 2 seconds
                setTimeout(() => {
                    onBackToDashboard();
                }, 2000);
            } else {
                setMessageType('error');
                setMessage(`❌ ${data.message || 'Course creation failed'}`);
            }
        } catch (error) {
            console.error('Form submission error:', error);
            setMessageType('error');
            setMessage('❌ An error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="course-form-container">
            <div className="course-form-wrapper">
                {/* Header */}
                <div className="course-form-header">
                    <h1>Create New Course</h1>
                    <p>Add a new course to the system</p>
                </div>

                {/* Form */}
                <form className="course-form" onSubmit={handleSubmit}>
                    {/* Course Code and ID */}
                    <div className="form-section">
                        <h2 className="form-section-title">Course Identification</h2>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="courseCode" className="form-label">
                                    <i className="fas fa-barcode"></i> Course Code
                                </label>
                                <input
                                    type="text"
                                    id="courseCode"
                                    name="courseCode"
                                    placeholder="e.g., CS101, DB401"
                                    value={formData.courseCode}
                                    onChange={handleInputChange}
                                    className="form-input"
                                    required
                                />
                                <small style={{color: '#567c8d', marginTop: '0.3rem', display: 'block', opacity: 0.8}}>
                                    Unique course code (e.g., CS101)
                                </small>
                            </div>

                            <div className="form-group">
                                <label htmlFor="courseId" className="form-label">
                                    <i className="fas fa-id-card"></i> Course ID (Optional)
                                </label>
                                <input
                                    type="text"
                                    id="courseId"
                                    name="courseId"
                                    placeholder="Leave empty to auto-generate"
                                    value={formData.courseId}
                                    onChange={handleInputChange}
                                    className="form-input"
                                />
                                <small style={{color: '#567c8d', marginTop: '0.3rem', display: 'block', opacity: 0.8}}>
                                    System auto-generates if empty
                                </small>
                            </div>
                        </div>
                    </div>

                    {/* Course Details */}
                    <div className="form-section">
                        <h2 className="form-section-title">Course Details</h2>

                        <div className="form-group">
                            <label htmlFor="title" className="form-label">
                                <i className="fas fa-book"></i> Course Title
                            </label>
                            <input
                                type="text"
                                id="title"
                                name="title"
                                placeholder="Enter course title"
                                value={formData.title}
                                onChange={handleInputChange}
                                className="form-input"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="description" className="form-label">
                                <i className="fas fa-align-left"></i> Description (Optional)
                            </label>
                            <textarea
                                id="description"
                                name="description"
                                placeholder="Enter course description"
                                value={formData.description}
                                onChange={handleInputChange}
                                className="form-input form-textarea"
                                rows="4"
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="creditHours" className="form-label">
                                    <i className="fas fa-hourglass-half"></i> Credit Hours
                                </label>
                                <input
                                    type="number"
                                    id="creditHours"
                                    name="creditHours"
                                    placeholder="e.g., 3"
                                    value={formData.creditHours}
                                    onChange={handleInputChange}
                                    className="form-input"
                                    min="1"
                                    max="10"
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="semester" className="form-label">
                                    <i className="fas fa-calendar"></i> Semester (Optional)
                                </label>
                                <select
                                    id="semester"
                                    name="semester"
                                    value={formData.semester}
                                    onChange={handleInputChange}
                                    className="form-input"
                                >
                                    <option value="">Select semester</option>
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(sem => (
                                        <option key={sem} value={sem}>
                                            Semester {sem}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Academic Information */}
                    <div className="form-section">
                        <h2 className="form-section-title">Academic Information</h2>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="department" className="form-label">
                                    <i className="fas fa-building"></i> Department (Optional)
                                </label>
                                <input
                                    type="text"
                                    id="department"
                                    name="department"
                                    placeholder="e.g., Computer Science"
                                    value={formData.department}
                                    onChange={handleInputChange}
                                    className="form-input"
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="teacherId" className="form-label">
                                    <i className="fas fa-chalkboard-user"></i> Instructor
                                </label>
                                <select
                                    id="teacherId"
                                    name="teacherId"
                                    value={formData.teacherId}
                                    onChange={handleInputChange}
                                    className="form-input"
                                    required
                                >
                                    <option value="">Select instructor</option>
                                    {teachers.map(teacher => (
                                        <option key={teacher.teacher_id} value={teacher.teacher_id}>
                                            {teacher.name} ({teacher.department || 'N/A'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Course Configuration */}
                    <div className="form-section">
                        <h2 className="form-section-title">Course Configuration</h2>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="status" className="form-label">
                                    <i className="fas fa-toggle-on"></i> Status
                                </label>
                                <select
                                    id="status"
                                    name="status"
                                    value={formData.status}
                                    onChange={handleInputChange}
                                    className="form-input"
                                >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                    <option value="archived">Archived</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label htmlFor="maxStudents" className="form-label">
                                    <i className="fas fa-users"></i> Max Students
                                </label>
                                <input
                                    type="number"
                                    id="maxStudents"
                                    name="maxStudents"
                                    placeholder="Default: 50"
                                    value={formData.maxStudents}
                                    onChange={handleInputChange}
                                    className="form-input"
                                    min="1"
                                    max="500"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Additional Information */}
                    <div className="form-section">
                        <h2 className="form-section-title">Additional Information</h2>

                        <div className="form-group">
                            <label htmlFor="syllabusUrl" className="form-label">
                                <i className="fas fa-file-pdf"></i> Syllabus URL (Optional)
                            </label>
                            <input
                                type="url"
                                id="syllabusUrl"
                                name="syllabusUrl"
                                placeholder="https://example.com/syllabus.pdf"
                                value={formData.syllabusUrl}
                                onChange={handleInputChange}
                                className="form-input"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="schedule" className="form-label">
                                <i className="fas fa-clock"></i> Schedule (Optional)
                            </label>
                            <textarea
                                id="schedule"
                                name="schedule"
                                placeholder="e.g., Mon & Wed, 10:00 AM - 11:30 AM"
                                value={formData.schedule}
                                onChange={handleInputChange}
                                className="form-input form-textarea"
                                rows="3"
                            />
                        </div>
                    </div>

                    {/* Message Display */}
                    {message && (
                        <div className={`form-message ${messageType}`}>
                            <i className={`fas fa-${messageType === 'success' ? 'check-circle' : messageType === 'error' ? 'exclamation-circle' : 'info-circle'}`}></i>
                            <span>{message}</span>
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="form-actions">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onBackToDashboard}
                            disabled={loading}
                        >
                            <i className="fas fa-arrow-left"></i> Back to Dashboard
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <i className="fas fa-spinner fa-spin"></i> Creating Course...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-plus"></i> Create Course
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CourseForm;
