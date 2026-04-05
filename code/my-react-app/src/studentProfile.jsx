import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './studentProfile.css';

function StudentProfile() {
    const navigate = useNavigate();
    const [editing, setEditing] = useState(false);
    const [formData, setFormData] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    useEffect(() => {
        fetchStudentProfile();
    }, []);

    const fetchStudentProfile = async () => {
        try {
            setLoading(true);
            setError('');
            
            // Get email from localStorage
            const studentEmail = localStorage.getItem('studentEmail');
            
            if (!studentEmail) {
                throw new Error('No student email found. Please login again.');
            }

            console.log('📧 Fetching profile for email:', studentEmail);
            
            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/student/profile/get-by-email?email=${encodeURIComponent(studentEmail)}`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('📦 Profile API response:', data);

            if (!data.success) {
                throw new Error(data.error || 'Failed to load profile');
            }

            setFormData({
                name: data.student.name || '',
                student_id: data.student.student_id || '',
                semester: data.student.semester || 1,
                email: data.student.email || '',
                phone: data.student.phone || '',
                program: data.student.program || 'Not specified',
                address: data.student.address || '',
                emergency_contact: data.student.emergency_contact || '',
                date_of_birth: data.student.date_of_birth || '',
                created_at: data.student.created_at || '',
                status: data.student.status || 'active'
            });

            // Update localStorage with fresh data
            localStorage.setItem('studentData', JSON.stringify(data.student));
            localStorage.setItem('studentName', data.student.name);
            localStorage.setItem('studentId', data.student.student_id);
            localStorage.setItem('studentSemester', data.student.semester);

        } catch (err) {
            console.error('❌ Error fetching student profile:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSaveProfile = async () => {
        try {
            setSaving(true);
            setError('');
            setSuccessMessage('');

            const studentEmail = localStorage.getItem('studentEmail');
            
            if (!studentEmail) {
                throw new Error('No student email found');
            }

            console.log('💾 Saving profile for email:', studentEmail);
            console.log('📝 Data to save:', formData);

            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/student/profile/update-by-email', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: studentEmail,
                    name: formData.name,
                    phone: formData.phone,
                    address: formData.address,
                    emergency_contact: formData.emergency_contact,
                    date_of_birth: formData.date_of_birth,
                    semester: formData.semester,
                    program: formData.program
                })
            });

            const data = await response.json();
            console.log('✅ Save response:', data);

            if (!data.success) {
                throw new Error(data.error || 'Failed to update profile');
            }

            // Update local state with response data
            setFormData({
                ...formData,
                ...data.student
            });

            // Update localStorage
            localStorage.setItem('studentData', JSON.stringify(data.student));
            localStorage.setItem('studentName', data.student.name);
            localStorage.setItem('studentSemester', data.student.semester);

            setSuccessMessage('Profile updated successfully!');
            setEditing(false);

            // Refresh after 2 seconds
            setTimeout(() => {
                setSuccessMessage('');
            }, 2000);

        } catch (err) {
            console.error('❌ Error updating profile:', err);
            setError(err.message);
            alert(`Failed to update profile: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        // Reset form data from localStorage
        const storedStudent = localStorage.getItem('studentData');
        if (storedStudent) {
            try {
                const parsedData = JSON.parse(storedStudent);
                setFormData({
                    name: parsedData.name || '',
                    student_id: parsedData.student_id || '',
                    semester: parsedData.semester || 1,
                    email: parsedData.email || '',
                    phone: parsedData.phone || '',
                    program: parsedData.program || 'Not specified',
                    address: parsedData.address || '',
                    emergency_contact: parsedData.emergency_contact || '',
                    date_of_birth: parsedData.date_of_birth || '',
                    created_at: parsedData.created_at || '',
                    status: parsedData.status || 'active'
                });
            } catch (error) {
                console.error('Error parsing stored student data:', error);
            }
        }
        setEditing(false);
        setError('');
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            return 'Invalid date';
        }
    };

    if (loading) {
        return (
            <div className="student-loading-container">
                <div className="student-loading-spinner"></div>
                <p>Loading profile...</p>
            </div>
        );
    }

    if (error && !formData.email) {
        return (
            <div className="student-profile-page">
                <div className="student-profile-header">
                    <button className="student-back-btn" onClick={() => navigate('/studentDashboard')}>
                        Back to Dashboard
                    </button>
                    <h1>Student Profile</h1>
                </div>
                <div className="student-error-container">
                    <p className="student-error-message">Error: {error}</p>
                    <button 
                        className="student-retry-btn" 
                        onClick={fetchStudentProfile}
                    >
                        Retry
                    </button>
                    <button 
                        className="student-back-btn" 
                        onClick={() => navigate('/studentDashboard')}
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="student-profile-page">
            {/* Header */}
            <div className="student-profile-header">
                <button className="student-back-btn" onClick={() => navigate('/studentDashboard')}>
                    Back to Dashboard
                </button>
                <h1>Student Profile</h1>
                <p>Manage your personal information and settings</p>
            </div>

            {/* Success Message */}
            {successMessage && (
                <div className="student-success-message">
                    ✅ {successMessage}
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="student-error-message">
                    ❌ {error}
                </div>
            )}

            {/* Profile Card */}
            <div className="student-profile-card">
                <div className="student-profile-header-section">
                    {/* Profile Image */}
                    <div className="student-profile-image-container">
                        <div className="student-profile-avatar-large">
                            {formData.name ? formData.name.charAt(0) : 'S'}
                        </div>
                    </div>

                    <div className="student-profile-title">
                        <h2>{formData.name}</h2>
                        <p className="student-profile-role">Student • Semester {formData.semester}</p>
                        <p className="student-profile-id">ID: {formData.student_id}</p>
                    </div>
                    
                    {!editing && (
                        <button
                            className="student-edit-profile-btn"
                            onClick={() => setEditing(true)}
                        >
                            Edit Profile
                        </button>
                    )}
                </div>

                {/* Profile Form */}
                <div className="student-profile-form">
                    <div className="student-form-section">
                        <h3>Personal Information</h3>

                        <div className="student-form-group">
                            <label htmlFor="name">Full Name</label>
                            {editing ? (
                                <input
                                    type="text"
                                    id="name"
                                    name="name"
                                    value={formData.name || ''}
                                    onChange={handleInputChange}
                                    placeholder="Enter your full name"
                                />
                            ) : (
                                <div className="student-form-value">{formData.name || 'N/A'}</div>
                            )}
                        </div>

                        <div className="student-form-group">
                            <label>Email Address</label>
                            <div className="student-form-value">{formData.email}</div>
                        </div>

                        <div className="student-form-group">
                            <label htmlFor="phone">Phone Number</label>
                            {editing ? (
                                <input
                                    type="tel"
                                    id="phone"
                                    name="phone"
                                    value={formData.phone || ''}
                                    onChange={handleInputChange}
                                    placeholder="Enter your phone number"
                                />
                            ) : (
                                <div className="student-form-value">{formData.phone || 'Not provided'}</div>
                            )}
                        </div>
                    </div>

                    <div className="student-form-section">
                        <h3>Academic Information</h3>

                        <div className="student-form-group">
                            <label>Student ID</label>
                            <div className="student-form-value">{formData.student_id}</div>
                        </div>

                        <div className="student-form-group">
                            <label htmlFor="semester">Semester</label>
                            {editing ? (
                                <select
                                    id="semester"
                                    name="semester"
                                    value={formData.semester || 1}
                                    onChange={handleInputChange}
                                >
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(sem => (
                                        <option key={sem} value={sem}>Semester {sem}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="student-form-value">Semester {formData.semester}</div>
                            )}
                        </div>
                    </div>

                    <div className="student-form-section">
                        <h3>Account Information</h3>

                        <div className="student-form-group">
                            <label>Account Created</label>
                            <div className="student-form-value">
                                {formatDate(formData.created_at)}
                            </div>
                        </div>

                        <div className="student-form-group">
                            <label>Account Status</label>
                            <div className="student-form-value status-active">
                                {formData.status || 'Active'}
                            </div>
                        </div>
                    </div>

                    {/* Form Actions - Show only when editing */}
                    {editing && (
                        <div className="student-form-actions">
                            <button
                                className="student-save-btn"
                                onClick={handleSaveProfile}
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                            <button
                                className="student-cancel-btn"
                                onClick={handleCancelEdit}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Actions */}
            <div className="student-additional-info">
                <div className="student-info-card">
                    <h3>Quick Actions</h3>
                    <button 
                        className="student-action-btn" 
                        onClick={() => navigate('/studentDashboard')}
                    >
                        Back to Dashboard
                    </button>
                    <button 
                        className="student-action-btn student-danger-btn" 
                        onClick={() => {
                            localStorage.clear();
                            navigate('/');
                        }}
                    >
                        Logout
                    </button>
                </div>
            </div>
        </div>
    );
}

export default StudentProfile;
