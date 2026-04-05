import React, { useState } from 'react';
import './UserForm.css';

function UserForm({ onBackToDashboard }) {
    const [userType, setUserType] = useState('student'); // 'student' or 'teacher'
    const [formData, setFormData] = useState({
        // Common fields
        name: '',
        email: '',
        password: '',
        confirmPassword: '',
        profileImage: null,
        
        // Student-specific fields
        registrationNumber: '',
        semester: '',
        phone: '',
        
        // Teacher-specific fields
        department: ''
    });

    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState(''); // 'success', 'error', 'info'
    const [previewImage, setPreviewImage] = useState(null);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setFormData(prev => ({
                ...prev,
                profileImage: file
            }));
            
            // Create preview
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviewImage(reader.result);
            };
            reader.readAsDataURL(file);
        }
    };

    const validateForm = () => {
        if (!formData.name.trim()) {
            setMessage('Name is required');
            setMessageType('error');
            return false;
        }
        
        if (!formData.email.includes('@')) {
            setMessage('Valid email is required');
            setMessageType('error');
            return false;
        }
        
        if (formData.password.length < 6) {
            setMessage('Password must be at least 6 characters');
            setMessageType('error');
            return false;
        }
        
        if (formData.password !== formData.confirmPassword) {
            setMessage('Passwords do not match');
            setMessageType('error');
            return false;
        }
        
        if (userType === 'student' && !formData.semester) {
            setMessage('Semester is required for students');
            setMessageType('error');
            return false;
        }
        
        if (userType === 'teacher' && !formData.department) {
            setMessage('Department is required for teachers');
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
            // First, upload the image if provided
            let profileImageUrl = null;
            if (formData.profileImage) {
                try {
                    const formDataImg = new FormData();
                    formDataImg.append('file', formData.profileImage);
                    
                    const uploadRes = await fetch('https://classmate-backend-eysi.onrender.com/api/upload-profile', {
                        method: 'POST',
                        body: formDataImg
                    });
                    
                    const uploadData = await uploadRes.json();
                    if (uploadData.success) {
                        profileImageUrl = uploadData.url;
                    }
                } catch (uploadError) {
                    console.warn('Image upload failed, continuing without image:', uploadError);
                    // Continue registration without image
                }
            }

            // Prepare endpoint and payload based on user type
            let endpoint, payload;

            if (userType === 'student') {
                endpoint = 'https://classmate-backend-eysi.onrender.com/api/students/register';
                payload = {
                    name: formData.name,
                    email: formData.email,
                    password: formData.password,
                    registration_number: formData.registrationNumber || null,
                    semester: parseInt(formData.semester),
                    phone: formData.phone || null,
                    profile_image_url: profileImageUrl
                };
            } else {
                endpoint = 'https://classmate-backend-eysi.onrender.com/api/teachers/register';
                payload = {
                    name: formData.name,
                    email: formData.email,
                    password: formData.password,
                    department: formData.department,
                    profile_image_url: profileImageUrl
                };
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (data.success) {
                setMessageType('success');
                setMessage(`✅ ${userType.charAt(0).toUpperCase() + userType.slice(1)} registered successfully!`);
                
                // Reset form
                setFormData({
                    name: '',
                    email: '',
                    password: '',
                    confirmPassword: '',
                    profileImage: null,
                    registrationNumber: '',
                    semester: '',
                    phone: '',
                    department: ''
                });
                setPreviewImage(null);
                
                // Redirect after 2 seconds
                setTimeout(() => {
                    onBackToDashboard();
                }, 2000);
            } else {
                setMessageType('error');
                setMessage(`❌ ${data.message || 'Registration failed'}`);
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
        <div className="user-form-container">
            <div className="user-form-wrapper">
                {/* Header */}
                <div className="user-form-header">
                    <h1>Register New User</h1>
                    <p>Add a new student or teacher to the system</p>
                </div>

                {/* Form */}
                <form className="user-form" onSubmit={handleSubmit}>
                    {/* User Type Selection */}
                    <div className="form-section">
                        <h2 className="form-section-title">User Type</h2>
                        <div className="type-selector">
                            <label className={`type-option ${userType === 'student' ? 'active' : ''}`}>
                                <input
                                    type="radio"
                                    name="userType"
                                    value="student"
                                    checked={userType === 'student'}
                                    onChange={(e) => setUserType(e.target.value)}
                                />
                                <span className="type-icon"><i className="fas fa-graduation-cap"></i></span>
                                <span className="type-label">Student</span>
                            </label>

                            <label className={`type-option ${userType === 'teacher' ? 'active' : ''}`}>
                                <input
                                    type="radio"
                                    name="userType"
                                    value="teacher"
                                    checked={userType === 'teacher'}
                                    onChange={(e) => setUserType(e.target.value)}
                                />
                                <span className="type-icon"><i className="fas fa-chalkboard-user"></i></span>
                                <span className="type-label">Teacher</span>
                            </label>
                        </div>
                    </div>

                    {/* Common Fields */}
                    <div className="form-section">
                        <h2 className="form-section-title">Basic Information</h2>
                        
                        {/* Profile Image */}
                        <div className="form-group profile-image-group">
                            <label className="form-label">Profile Picture</label>
                            <div className="image-upload-area">
                                {previewImage && (
                                    <div className="image-preview">
                                        <img src={previewImage} alt="Preview" />
                                        <button
                                            type="button"
                                            className="remove-image-btn"
                                            onClick={() => {
                                                setFormData(prev => ({ ...prev, profileImage: null }));
                                                setPreviewImage(null);
                                            }}
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                )}
                                <div className="upload-input-wrapper">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleImageChange}
                                        className="image-input"
                                        id="profileImage"
                                    />
                                    <label htmlFor="profileImage" className="upload-label">
                                        <i className="fas fa-cloud-upload-alt"></i>
                                        <span>Click to upload or drag and drop</span>
                                        <small>PNG, JPG, GIF up to 5MB</small>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Name */}
                        <div className="form-group">
                            <label htmlFor="name" className="form-label">
                                <i className="fas fa-user"></i> Full Name
                            </label>
                            <input
                                type="text"
                                id="name"
                                name="name"
                                placeholder="Enter full name"
                                value={formData.name}
                                onChange={handleInputChange}
                                className="form-input"
                                required
                            />
                        </div>

                        {/* Email */}
                        <div className="form-group">
                            <label htmlFor="email" className="form-label">
                                <i className="fas fa-envelope"></i> Email Address
                            </label>
                            <input
                                type="email"
                                id="email"
                                name="email"
                                placeholder="Enter email address"
                                value={formData.email}
                                onChange={handleInputChange}
                                className="form-input"
                                required
                            />
                        </div>
                    </div>

                    {/* Password Fields */}
                    <div className="form-section">
                        <h2 className="form-section-title">Security</h2>
                        
                        <div className="form-group">
                            <label htmlFor="password" className="form-label">
                                <i className="fas fa-lock"></i> Password
                            </label>
                            <input
                                type="password"
                                id="password"
                                name="password"
                                placeholder="Enter password (minimum 6 characters)"
                                value={formData.password}
                                onChange={handleInputChange}
                                className="form-input"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="confirmPassword" className="form-label">
                                <i className="fas fa-lock"></i> Confirm Password
                            </label>
                            <input
                                type="password"
                                id="confirmPassword"
                                name="confirmPassword"
                                placeholder="Re-enter password"
                                value={formData.confirmPassword}
                                onChange={handleInputChange}
                                className="form-input"
                                required
                            />
                        </div>
                    </div>

                    {/* Conditional Fields */}
                    {userType === 'student' ? (
                        <div className="form-section">
                            <h2 className="form-section-title">Student Information</h2>
                            
                            <div className="form-group">
                                <label htmlFor="registrationNumber" className="form-label">
                                    <i className="fas fa-id-card"></i> Registration Number (Optional)
                                </label>
                                <input
                                    type="text"
                                    id="registrationNumber"
                                    name="registrationNumber"
                                    placeholder="Leave empty to auto-generate"
                                    value={formData.registrationNumber}
                                    onChange={handleInputChange}
                                    className="form-input"
                                />
                                <small style={{color: '#567c8d', marginTop: '0.3rem', display: 'block', opacity: 0.8}}>
                                    If left empty, system will auto-generate a unique registration number
                                </small>
                            </div>
                            
                            <div className="form-row">
                                <div className="form-group">
                                    <label htmlFor="semester" className="form-label">
                                        <i className="fas fa-book"></i> Semester
                                    </label>
                                    <select
                                        id="semester"
                                        name="semester"
                                        value={formData.semester}
                                        onChange={handleInputChange}
                                        className="form-input"
                                        required
                                    >
                                        <option value="">Select semester</option>
                                        {[1, 2, 3, 4, 5, 6, 7, 8].map(sem => (
                                            <option key={sem} value={sem}>
                                                Semester {sem}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="phone" className="form-label">
                                        <i className="fas fa-phone"></i> Phone Number (Optional)
                                    </label>
                                    <input
                                        type="tel"
                                        id="phone"
                                        name="phone"
                                        placeholder="Enter phone number"
                                        value={formData.phone}
                                        onChange={handleInputChange}
                                        className="form-input"
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="form-section">
                            <h2 className="form-section-title">Teacher Information</h2>
                            
                            <div className="form-group">
                                <label htmlFor="department" className="form-label">
                                    <i className="fas fa-building"></i> Department
                                </label>
                                <input
                                    type="text"
                                    id="department"
                                    name="department"
                                    placeholder="Enter department name"
                                    value={formData.department}
                                    onChange={handleInputChange}
                                    className="form-input"
                                    required
                                />
                            </div>
                        </div>
                    )}

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
                                    <i className="fas fa-spinner fa-spin"></i> Registering...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-check"></i> Register User
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default UserForm;
