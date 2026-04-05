import React, { useEffect, useState } from 'react';
import './manageEnrollment.css';

const ManageEnrollment = () => {
    const [courses, setCourses] = useState([]);
    const [students, setStudents] = useState([]);
    const [enrollments, setEnrollments] = useState([]);
    const [selectedCourse, setSelectedCourse] = useState('');
    const [selectedStudent, setSelectedStudent] = useState('');
    const [loading, setLoading] = useState(true);

    const fetchCourses = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/courses/all')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setCourses(data.courses || []);
                }
            })
            .catch(err => console.error('Fetch courses error:', err));
    };

    const fetchStudents = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/students/registered')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setStudents(data.students || []);
                }
            })
            .catch(err => console.error('Fetch students error:', err));
    };

    const fetchEnrollments = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/enrollments')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setEnrollments(data.enrollments || []);
                }
            })
            .catch(err => console.error('Fetch enrollments error:', err));
    };

    const handleCreateEnrollment = () => {
        if (!selectedStudent || !selectedCourse) {
            alert('Please select a student and a course');
            return;
        }

        fetch('https://classmate-backend-eysi.onrender.com/api/admin/enrollments/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: selectedStudent,
                course_id: selectedCourse
            })
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert('Student enrolled successfully');
                    setSelectedStudent('');
                    setSelectedCourse('');
                    fetchEnrollments();
                } else {
                    alert(data.message || 'Failed to enroll student');
                }
            })
            .catch(err => {
                console.error('Enroll error:', err);
                alert('Failed to enroll student');
            });
    };

    const handleRemoveEnrollment = (enrollmentId) => {
        if (!window.confirm('Remove this student from the course?')) return;

        fetch(`https://classmate-backend-eysi.onrender.com/api/admin/enrollments/${enrollmentId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    fetchEnrollments();
                } else {
                    alert(data.message || 'Failed to remove enrollment');
                }
            })
            .catch(err => {
                console.error('Remove enrollment error:', err);
                alert('Failed to remove enrollment');
            });
    };

    useEffect(() => {
        setLoading(true);
        fetchCourses();
        fetchStudents();
        fetchEnrollments();
        setLoading(false);
    }, []);

    if (loading) {
        return (
            <div className="manage-enroll-page">
                <div className="manage-enroll-loading">Loading enrollment data...</div>
            </div>
        );
    }

    return (
        <div className="manage-enroll-page">
            <div className="manage-enroll-header">
                <div>
                    <h1 className="manage-enroll-title">Manage Enrollment</h1>
                    <p className="manage-enroll-subtitle">Enroll students into courses and track active enrollments.</p>
                </div>
                <a className="manage-enroll-back" href="/adminDashboard">Back to Dashboard</a>
            </div>

            <div className="manage-enroll-card">
                <h2 className="manage-enroll-section-title">Create Enrollment</h2>
                <div className="manage-enroll-form">
                    <div className="manage-enroll-field">
                        <label>Student</label>
                        <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)}>
                            <option value="">Select student</option>
                            {students.map((student) => (
                                <option key={student.student_id} value={student.student_id}>
                                    {student.name} ({student.student_id})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="manage-enroll-field">
                        <label>Course</label>
                        <select value={selectedCourse} onChange={(e) => setSelectedCourse(e.target.value)}>
                            <option value="">Select course</option>
                            {courses.map((course) => (
                                <option key={course.course_id} value={course.course_id}>
                                    {course.title} ({course.course_code})
                                </option>
                            ))}
                        </select>
                    </div>
                    <button className="manage-enroll-submit" onClick={handleCreateEnrollment}>
                        Enroll Student
                    </button>
                </div>
            </div>

            <div className="manage-enroll-card">
                <div className="manage-enroll-table-header">
                    <h2 className="manage-enroll-section-title">Current Enrollments</h2>
                    <span className="manage-enroll-count">{enrollments.length} active</span>
                </div>
                <div className="manage-enroll-table-wrap">
                    <table className="manage-enroll-table">
                        <thead>
                            <tr>
                                <th>Enrollment ID</th>
                                <th>Student</th>
                                <th>Course</th>
                                <th>Enrolled At</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {enrollments.map((row) => (
                                <tr key={row.enrollment_id}>
                                    <td>{row.enrollment_id}</td>
                                    <td>
                                        <div className="manage-enroll-student">
                                            <span className="manage-enroll-name">{row.student_name || row.student_id}</span>
                                            <span className="manage-enroll-muted">{row.student_id}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="manage-enroll-course">
                                            <span className="manage-enroll-name">{row.course_title || row.course_id}</span>
                                            <span className="manage-enroll-muted">{row.course_code || row.course_id}</span>
                                        </div>
                                    </td>
                                    <td>{row.enrollment_date || 'N/A'}</td>
                                    <td>
                                        <span className={`manage-enroll-status ${row.is_active ? 'active' : 'inactive'}`}>
                                            {row.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td>
                                        <button
                                            className="manage-enroll-remove"
                                            onClick={() => handleRemoveEnrollment(row.enrollment_id)}
                                        >
                                            Remove
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {enrollments.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="manage-enroll-empty">No enrollments found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ManageEnrollment;
