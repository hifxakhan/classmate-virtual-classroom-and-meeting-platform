import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './teacherProfile.css';

function TeacherProfile() {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);
    const [teacher, setTeacher] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [formData, setFormData] = useState({});
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [uploadingImage, setUploadingImage] = useState(false);
    const [previewImage, setPreviewImage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchTeacherProfile = async () => {
            try {
                setLoading(true);
                setError('');

                // Get teacher email from localStorage (set during login)
                const teacherEmail = localStorage.getItem('teacherEmail');
                
                if (!teacherEmail) {
                    throw new Error('No teacher email found. Please login again.');
                }

                console.log('Fetching current teacher profile for email:', teacherEmail);

                // Use the NEW endpoint for current teacher
                const response = await fetch(
                    `https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/teacher/profile/current?email=${encodeURIComponent(teacherEmail)}`,
                    {
                        headers: {
                            'X-Teacher-Email': teacherEmail
                        }
                    }
                );

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.error || 'Failed to load profile');
                }

                console.log('Current teacher data received:', data.teacher);
                
                setTeacher(data.teacher);
                setFormData({
                    name: data.teacher.name,
                    department: data.teacher.department || 'Loading...',
                    email: data.teacher.email,
                });

                // Set preview if profile image exists
                if (data.teacher.profile_image_url) {
                    setPreviewImage(data.teacher.profile_image_url);
                }

            } catch (err) {
                console.error('Error fetching teacher profile:', err);
                setError(err.message);
                
                // Don't use mock data - show error instead
            } finally {
                setLoading(false);
            }
        };

        fetchTeacherProfile();
    }, []);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    // Handle image upload
    const handleImageClick = () => {
        if (editing) {
            fileInputRef.current.click();
        }
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Check file type
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            alert('Please select a valid image file (JPEG, PNG, GIF)');
            return;
        }

        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('Image size should be less than 5MB');
            return;
        }

        try {
            setUploadingImage(true);
            setSuccessMessage('');

            // Create FormData for file upload
            const uploadFormData = new FormData();
            uploadFormData.append('image', file);
            uploadFormData.append('teacher_id', teacher.teacher_id);

            console.log('Uploading image for teacher:', teacher.teacher_id);

            const response = await fetch('https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/teacher/upload-image', {
                method: 'POST',
                body: uploadFormData,
            });

            console.log('Response status:', response.status);

            // Get response as text first for debugging
            const responseText = await response.text();
            console.log('Raw response text:', responseText);

            // Try to parse as JSON
            let data;
            try {
                data = JSON.parse(responseText);
                console.log('Parsed JSON data:', data);
            } catch (jsonError) {
                throw new Error('Server returned invalid response');
            }

            if (!data.success) {
                throw new Error(data.error || 'Upload failed');
            }

            // Make sure the URL is complete
            let imageUrl = data.image_url;
            if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = `https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app${imageUrl}`;
            }

            console.log('Final image URL:', imageUrl);

            // Update preview and teacher data
            setPreviewImage(imageUrl);
            setTeacher(prev => ({
                ...prev,
                profile_image_url: imageUrl
            }));

            setSuccessMessage('Profile image updated successfully!');

            // Refresh profile data
            setTimeout(() => {
                const refreshProfile = async () => {
                    try {
                        const teacherEmail = localStorage.getItem('teacherEmail');
                        if (teacherEmail) {
                            const refreshResponse = await fetch(
                                `https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/teacher/profile/current?email=${encodeURIComponent(teacherEmail)}`
                            );
                            if (refreshResponse.ok) {
                                const refreshData = await refreshResponse.json();
                                if (refreshData.success) {
                                    setTeacher(refreshData.teacher);
                                }
                            }
                        }
                    } catch (refreshErr) {
                        console.error('Error refreshing profile:', refreshErr);
                    }
                };
                refreshProfile();
            }, 500);

        } catch (err) {
            console.error('Upload error:', err);
            alert(`Failed to upload image: ${err.message}`);
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSaveProfile = async () => {
        try {
            setSaving(true);
            setSuccessMessage('');

            // API call to update profile
            const response = await fetch('https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/teacher/profile/update', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    teacher_id: teacher.teacher_id,
                    ...formData
                })
            });

            const data = await response.json();

            if (!data.success) throw new Error(data.error || 'Failed to update profile');

            // Update teacher data with response
            setTeacher(data.teacher);
            setSuccessMessage('Profile updated successfully!');
            setEditing(false);

            // Update localStorage
            localStorage.setItem('teacherName', data.teacher.name);

            // Refresh profile data
            setTimeout(() => {
                const refreshProfile = async () => {
                    try {
                        const teacherEmail = localStorage.getItem('teacherEmail');
                        if (teacherEmail) {
                            const refreshResponse = await fetch(
                                `https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/teacher/profile/current?email=${encodeURIComponent(teacherEmail)}`
                            );
                            if (refreshResponse.ok) {
                                const refreshData = await refreshResponse.json();
                                if (refreshData.success) {
                                    setTeacher(refreshData.teacher);
                                }
                            }
                        }
                    } catch (refreshErr) {
                        console.error('Error refreshing profile:', refreshErr);
                    }
                };
                refreshProfile();
            }, 500);

        } catch (err) {
            console.error('Error updating profile:', err);
            alert(`Failed to update profile: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        if (teacher) {
            setFormData({
                name: teacher.name,
                department: teacher.department || 'Computer Science',
                email: teacher.email,
            });
        }
        setEditing(false);
        setSuccessMessage('');
    };

    const handleChangePassword = () => {
        navigate('/forgotPassword');
    };

    const handleLogout = () => {
        const confirmLogout = window.confirm("Are you sure you want to logout?");
        
        if (!confirmLogout) return;
        
        // Clear ALL authentication data
        localStorage.clear();
        sessionStorage.clear();
        
        // Clear browser history
        window.history.replaceState(null, '', '/');
        
        // Navigate to login
        navigate('/', { replace: true });
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>Loading profile...</p>
            </div>
        );
    }

    if (error && !teacher) {
        return (
            <div className="teacher-profile-page">
                <div className="profile-header">
                    <button className="back-btn" onClick={() => navigate('/teacherDashboard')}>
                        ← Back to Dashboard
                    </button>
                    <h1>Teacher Profile</h1>
                </div>
                <div className="error-container">
                    <p className="error-message">❌ {error}</p>
                    <button 
                        className="retry-btn" 
                        onClick={() => window.location.reload()}
                    >
                        Retry
                    </button>
                    <button 
                        className="back-btn" 
                        onClick={() => navigate('/teacherDashboard')}
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    if (!teacher) {
        return (
            <div className="teacher-profile-page">
                <div className="profile-header">
                    <button className="back-btn" onClick={() => navigate('/teacherDashboard')}>
                        ← Back to Dashboard
                    </button>
                    <h1>Teacher Profile</h1>
                </div>
                <div className="error-container">
                    <p className="error-message">No teacher data available</p>
                    <button 
                        className="retry-btn" 
                        onClick={() => window.location.reload()}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="teacher-profile-page">
            {/* Header */}
            <div className="profile-header">
                <button className="back-btn" onClick={() => navigate('/teacherDashboard')}>
                    ← Back to Dashboard
                </button>
                <h1>Teacher Profile</h1>
                <p>Manage your personal information and settings</p>
            </div>

            {/* Success Message */}
            {successMessage && (
                <div className="success-message">
                    ✅ {successMessage}
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="error-message">
                    ❌ {error}
                </div>
            )}

            {/* Profile Card */}
            <div className="profile-card">
                <div className="profile-header-section">
                    {/* Profile Image with Upload Button */}
                    <div className="profile-image-container">
                        <div
                            className="profile-avatar-large"
                            onClick={handleImageClick}
                            style={{ cursor: editing ? 'pointer' : 'default' }}
                        >
                            {previewImage ? (
                                <img
                                    src={previewImage}
                                    alt={teacher.name}
                                    className="profile-image"
                                />
                            ) : (
                                teacher.name?.charAt(0) || 'T'
                            )}

                            {/* Edit pencil overlay */}
                            {editing && (
                                <div className="image-edit-overlay">
                                    <span className="edit-icon">✏️</span>
                                    <span className="edit-text">Change Photo</span>
                                </div>
                            )}
                        </div>

                        {/* Hidden file input */}
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleImageUpload}
                            accept="image/*"
                            style={{ display: 'none' }}
                        />

                        {uploadingImage && (
                            <div className="uploading-indicator">
                                <div className="uploading-spinner"></div>
                                <p>Uploading...</p>
                            </div>
                        )}
                    </div>

                    <div className="profile-title">
                        <h2>{teacher.name}</h2>
                        <p className="profile-role">Teacher</p>
                        <p className="profile-id">ID: {teacher.teacher_id}</p>
                    </div>
                    {!editing && (
                        <button
                            className="edit-profile-btn"
                            onClick={() => setEditing(true)}
                        >
                            Edit Profile
                        </button>
                    )}
                </div>

                {/* Profile Form */}
                <div className="profile-form">
                    <div className="form-section">
                        <h3>Personal Information</h3>

                        <div className="form-group">
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
                                <div className="form-value">{teacher.name}</div>
                            )}
                        </div>

                        <div className="form-group">
                            <label htmlFor="email">Email Address</label>
                            {editing ? (
                                <input
                                    type="email"
                                    id="email"
                                    name="email"
                                    value={formData.email || ''}
                                    onChange={handleInputChange}
                                    placeholder="Enter your email"
                                    disabled
                                />
                            ) : (
                                <div className="form-value">{teacher.email}</div>
                            )}
                        </div>

                        <div className="form-group">
                            <label htmlFor="department">Department</label>
                            {editing ? (
                                <select
                                    id="department"
                                    name="department"
                                    value={formData.department || ''}
                                    onChange={handleInputChange}
                                >
                                    <option value="">Select Department</option>
                                    <option value="Computer Science">Computer Science</option>
                                    <option value="Mathematics">Mathematics</option>
                                    <option value="Physics">Physics</option>
                                    <option value="Chemistry">Chemistry</option>
                                    <option value="Biology">Biology</option>
                                    <option value="Engineering">Engineering</option>
                                    <option value="Business">Business</option>
                                    <option value="Other">Other</option>
                                </select>
                            ) : (
                                <div className="form-value">{teacher.department || 'Not specified'}</div>
                            )}
                        </div>
                    </div>

                    {/* Form Actions */}
                    {editing && (
                        <div className="form-actions">
                            <button
                                className="save-btn"
                                onClick={handleSaveProfile}
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                            <button
                                className="cancel-btn"
                                onClick={handleCancelEdit}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Additional Information */}
            <div className="additional-info">
                <div className="info-card">
                    <h3>Account Information</h3>
                    <div className="info-item">
                        <span className="info-label">Account Created:</span>
                        <span className="info-profile-value">
                            {teacher.created_at ? new Date(teacher.created_at).toLocaleDateString() : 'N/A'}
                        </span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Last Updated:</span>
                        <span className="info-profile-value">
                            {teacher.updated_at ? new Date(teacher.updated_at).toLocaleDateString() : 'N/A'}
                        </span>
                    </div>
                </div>

                <div className="info-card">
                    <h3>Quick Actions</h3>
                    <button className="action-btn" onClick={() => navigate('/teacherDashboard')}>
                        ⬅ Back to Dashboard
                    </button>
                    <button className="action-btn" onClick={handleChangePassword}>
                        Change Password
                    </button>
                    <button className="action-btn danger" onClick={handleLogout}>
                        Logout
                    </button>
                </div>
            </div>
        </div>
    );
}

export default TeacherProfile;
