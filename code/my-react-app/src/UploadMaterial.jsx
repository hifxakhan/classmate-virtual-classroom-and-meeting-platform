// UploadMaterial.jsx - COMPLETE FIXED VERSION
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaUpload, FaFileUpload, FaArrowLeft, FaTimes, FaCheck, FaExclamationTriangle } from 'react-icons/fa';
import {
    FaFilePdf,
    FaFileWord,
    FaFilePowerpoint,
    FaFileExcel,
    FaFileImage,
    FaFileVideo,
    FaFileAudio,
    FaFileArchive,
    FaFileAlt
} from 'react-icons/fa';
import './UploadMaterial.css';
import classMateLogo from './assets/Logo2.png';

function UploadMaterial() {
    const navigate = useNavigate();
    const location = useLocation();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [file, setFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [sessions, setSessions] = useState([]);
    const [teacherId, setTeacherId] = useState(''); // Add teacherId state

    // Get course data from navigation
    const courseId = location.state?.courseId;
    const courseData = location.state?.courseData;

    // Form state
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        material_type: 'lecture_material',
        session_id: '',
        is_public: true,
        tags: ''
    });

    // Get teacher_id from localStorage on component mount
    useEffect(() => {
        // Try different localStorage keys
        const userData = localStorage.getItem('user');
        const storedTeacherId = localStorage.getItem('teacherId');
        
        console.log('🔍 Getting teacher_id from localStorage:');
        console.log('user data:', userData);
        console.log('stored teacherId:', storedTeacherId);
        
        if (storedTeacherId) {
            setTeacherId(storedTeacherId);
            console.log('✅ Teacher ID from localStorage (teacherId):', storedTeacherId);
        } else if (userData) {
            try {
                const user = JSON.parse(userData);
                console.log('👤 Parsed user object:', user);
                
                // Try different possible keys in user object
                const teacherIdFromUser = user.teacher_id || user.id || user.teacherId;
                
                if (teacherIdFromUser) {
                    setTeacherId(teacherIdFromUser);
                    localStorage.setItem('teacherId', teacherIdFromUser);
                    console.log('✅ Teacher ID from user object:', teacherIdFromUser);
                } else {
                    console.warn('⚠️ No teacher_id found in user object. Keys:', Object.keys(user));
                }
            } catch (err) {
                console.error('❌ Error parsing user data:', err);
            }
        } else {
            console.log('❌ No user data found in localStorage');
        }
    }, []);

    // Fetch course sessions
    useEffect(() => {
        const fetchSessions = async () => {
            if (!courseId) return;

            try {
                const response = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/courses/${courseId}/materials`
                );

                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.sessions) {
                        setSessions(data.sessions);
                    }
                }
            } catch (err) {
                console.error('Error fetching sessions:', err);
            }
        };

        fetchSessions();
    }, [courseId]);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            // Validate file size (100MB limit)
            if (selectedFile.size > 100 * 1024 * 1024) {
                setError('File size must be less than 100MB');
                setFile(null);
                return;
            }

            // Validate file type
            const allowedExtensions = [
                '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
                '.txt', '.jpg', '.jpeg', '.png', '.gif', '.bmp',
                '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav',
                '.zip', '.rar', '.7z'
            ];

            const fileExtension = selectedFile.name.toLowerCase().slice(
                ((selectedFile.name.lastIndexOf(".") - 1) >>> 0) + 2
            );

            if (!allowedExtensions.includes('.' + fileExtension)) {
                setError(`File type not allowed. Allowed types: ${allowedExtensions.join(', ')}`);
                setFile(null);
                return;
            }

            setFile(selectedFile);
            setError('');

            // Set default title from filename
            if (!formData.title) {
                const fileName = selectedFile.name.replace(/\.[^/.]+$/, ""); // Remove extension
                setFormData(prev => ({
                    ...prev,
                    title: fileName
                }));
            }
        }
    };

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!file) {
            setError('Please select a file to upload');
            return;
        }

        if (!formData.title.trim()) {
            setError('Please enter a title for the material');
            return;
        }

        if (!courseId) {
            setError('Course information is missing');
            return;
        }

        // Check if we have teacherId
        if (!teacherId) {
            setError('Teacher ID is missing. Please log in again.');
            return;
        }

        try {
            setLoading(true);
            setError('');
            setSuccess('');

            const formDataToSend = new FormData();
            formDataToSend.append('file', file);
            formDataToSend.append('title', formData.title);
            formDataToSend.append('description', formData.description);
            formDataToSend.append('material_type', formData.material_type);
            formDataToSend.append('session_id', formData.session_id);
            formDataToSend.append('is_public', formData.is_public.toString());
            formDataToSend.append('tags', formData.tags);
            formDataToSend.append('teacher_id', teacherId); // Use teacherId from state

            // Debug: Log what we're sending
            console.log('📤 Sending upload request:');
            console.log('Teacher ID:', teacherId);
            console.log('Course ID:', courseId);
            console.log('File:', file.name);

            // Simulate upload progress
            const progressInterval = setInterval(() => {
                setUploadProgress(prev => {
                    if (prev >= 90) {
                        clearInterval(progressInterval);
                        return prev;
                    }
                    return prev + 10;
                });
            }, 200);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/courses/${courseId}/materials/upload`,
                {
                    method: 'POST',
                    body: formDataToSend
                }
            );

            clearInterval(progressInterval);
            setUploadProgress(100);

            const data = await response.json();

            if (data.success) {
                setSuccess('Material uploaded successfully!');
                console.log('✅ Upload successful:', data.material);

                // Reset form after successful upload
                setTimeout(() => {
                    navigate('/Material', {
                        state: {
                            courseId: courseId,
                            courseData: courseData,
                            refresh: true
                        }
                    });
                }, 1500);
            } else {
                throw new Error(data.error || 'Upload failed');
            }

        } catch (err) {
            console.error('Upload error:', err);
            setError(err.message || 'Failed to upload material. Please try again.');
        } finally {
            setLoading(false);
            setTimeout(() => setUploadProgress(0), 1000);
        }
    };

    const handleCancel = () => {
        navigate('/CourseProfile', { 
            state: {
                courseId: courseId,
                courseData: courseData
            }
        });
    };

    const getFileIcon = () => {
        if (!file) return <FaFileUpload size={48} />;

        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        if (['pdf'].includes(fileExtension)) {
            return <FaFilePdf size={48} color="#2f4156" />;
        } else if (['doc', 'docx'].includes(fileExtension)) {
            return <FaFileWord size={48} color="#567c8d" />;
        } else if (['ppt', 'pptx'].includes(fileExtension)) {
            return <FaFilePowerpoint size={48} color="#2f4156" />;
        } else if (['xls', 'xlsx'].includes(fileExtension)) {
            return <FaFileExcel size={48} color="#567c8d" />;
        } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(fileExtension)) {
            return <FaFileImage size={48} color="#567c8d" />;
        } else if (['mp4', 'avi', 'mov', 'wmv'].includes(fileExtension)) {
            return <FaFileVideo size={48} color="#2f4156" />;
        } else if (['mp3', 'wav'].includes(fileExtension)) {
            return <FaFileAudio size={48} color="#567c8d" />;
        } else if (['zip', 'rar', '7z'].includes(fileExtension)) {
            return <FaFileArchive size={48} color="#567c8d" />;
        } else {
            return <FaFileAlt size={48} color="#567c8d" />;
        }
    };

    if (!courseId) {
        return (
            <div className="upload-material-error">
                <h2>Error</h2>
                <p>No course information provided</p>
                <button onClick={() => navigate(-1)}>Go Back</button>
            </div>
        );
    }

    // Check if teacherId is missing
    if (!teacherId) {
        return (
            <div className="upload-material-error">
                <h2>Authentication Required</h2>
                <p>You must be logged in as a teacher to upload materials.</p>
                <div className="upload-material-error-actions">
                    <button onClick={() => navigate('/login')}>Go to Login</button>
                    <button 
                        onClick={() => navigate(-1)} 
                        style={{ marginLeft: '10px' }}
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="upload-material-page">
            {/* Navigation Bar */}
            <nav className="upload-material-navbar">
                <div className="upload-material-navbar-left">
                    <div
                        className="upload-material-logo-container"
                        onClick={() => navigate('/teacherDashboard')}
                    >
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="upload-material-navbar-logo"
                        />
                        <span className="upload-material-brand-name">classMate</span>
                    </div>
                </div>

                <div className="upload-material-navbar-right">
                    <button
                        className="upload-material-back-btn"
                        onClick={handleCancel}
                    >
                        <FaArrowLeft style={{ marginRight: '8px' }} />
                        Cancel Upload
                    </button>
                </div>
            </nav>

            {/* Main Content */}
            <div className="upload-material-content">
                <div className="upload-material-container">
                    <div className="upload-material-header">
                        <h1 className="upload-material-title">
                            <FaUpload style={{ marginRight: '12px', color: '#567c8d' }} />
                            Upload New Material
                        </h1>
                        {courseData && (
                            <p className="upload-material-course-info">
                                Course: {courseData.course_code} - {courseData.title}
                            </p>
                        )}
                    </div>

                    {error && (
                        <div className="upload-material-alert upload-material-alert-error">
                            <FaExclamationTriangle style={{ marginRight: '10px' }} />
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="upload-material-alert upload-material-alert-success">
                            <FaCheck style={{ marginRight: '10px' }} />
                            {success}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="upload-material-form">
                        {/* File Upload Section */}
                        <div className="upload-material-form-section">
                            <h3 className="upload-material-form-section-title">
                                <FaFileUpload style={{ marginRight: '10px', color: '#567c8d' }} />
                                File Selection
                            </h3>
                            <div
                                className="upload-material-file-upload-area"
                                onClick={() => document.getElementById('upload-material-file-input').click()}
                            >
                                <input
                                    id="upload-material-file-input"
                                    type="file"
                                    onChange={handleFileChange}
                                    className="upload-material-file-input"
                                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.bmp,.mp4,.avi,.mov,.wmv,.mp3,.wav,.zip,.rar,.7z"
                                />

                                {file ? (
                                    <div className="upload-material-file-selected">
                                        <div className="upload-material-file-icon">
                                            {getFileIcon()}
                                        </div>
                                        <div className="upload-material-file-info">
                                            <h4 className="upload-material-file-name">{file.name}</h4>
                                            <p className="upload-material-file-size">
                                                {(file.size / 1024 / 1024).toFixed(2)} MB
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className="upload-material-remove-file"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setFile(null);
                                            }}
                                            title="Remove file"
                                        >
                                            <FaTimes size={20} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="upload-material-upload-placeholder">
                                        <div className="upload-material-upload-icon">
                                            <FaFileUpload size={64} color="#567c8d" />
                                        </div>
                                        <h3 className="upload-material-upload-title">Click to select a file</h3>
                                        <p className="upload-material-upload-subtitle">Max file size: 100MB</p>
                                        <p className="upload-material-supported-formats">
                                            Supported formats: PDF, DOC, PPT, XLS, Images, Videos, Audio, Archives
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Progress Bar */}
                        {loading && (
                            <div className="upload-material-progress">
                                <div className="upload-material-progress-bar">
                                    <div
                                        className="upload-material-progress-fill"
                                        style={{ width: `${uploadProgress}%` }}
                                    ></div>
                                </div>
                                <p className="upload-material-progress-text">
                                    Uploading... {uploadProgress}%
                                </p>
                            </div>
                        )}

                        {/* Material Details Section */}
                        <div className="upload-material-form-section">
                            <h3 className="upload-material-form-section-title">Material Details</h3>

                            <div className="upload-material-form-group">
                                <label htmlFor="upload-material-title" className="upload-material-form-label">
                                    Title *
                                </label>
                                <input
                                    type="text"
                                    id="upload-material-title"
                                    name="title"
                                    value={formData.title}
                                    onChange={handleInputChange}
                                    className="upload-material-form-input"
                                    placeholder="Enter material title"
                                    required
                                />
                            </div>

                            <div className="upload-material-form-group">
                                <label htmlFor="upload-material-description" className="upload-material-form-label">
                                    Description
                                </label>
                                <textarea
                                    id="upload-material-description"
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    className="upload-material-form-textarea"
                                    placeholder="Brief description of the material"
                                    rows="3"
                                />
                            </div>

                            <div className="upload-material-form-row">
                                <div className="upload-material-form-group">
                                    <label htmlFor="upload-material-type" className="upload-material-form-label">
                                        Material Type
                                    </label>
                                    <select
                                        id="upload-material-type"
                                        name="material_type"
                                        value={formData.material_type}
                                        onChange={handleInputChange}
                                        className="upload-material-form-select"
                                    >
                                        <option value="lecture_material">Lecture Material</option>
                                        <option value="assignment">Assignment</option>
                                        <option value="solution">Solution</option>
                                        <option value="reference">Reference</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>

                                {sessions.length > 0 && (
                                    <div className="upload-material-form-group">
                                        <label htmlFor="upload-material-session" className="upload-material-form-label">
                                            Associated Session (Optional)
                                        </label>
                                        <select
                                            id="upload-material-session"
                                            name="session_id"
                                            value={formData.session_id}
                                            onChange={handleInputChange}
                                            className="upload-material-form-select"
                                        >
                                            <option value="">Select Session</option>
                                            {sessions.map(session => (
                                                <option key={session.session_id} value={session.session_id}>
                                                    {session.session_date} - {session.topic}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="upload-material-form-row">
                                <div className="upload-material-form-group">
                                    <label htmlFor="upload-material-tags" className="upload-material-form-label">
                                        Tags (comma separated)
                                    </label>
                                    <input
                                        type="text"
                                        id="upload-material-tags"
                                        name="tags"
                                        value={formData.tags}
                                        onChange={handleInputChange}
                                        className="upload-material-form-input"
                                        placeholder="e.g., chapter1, slides, important"
                                    />
                                </div>

                                <div className="upload-material-form-group upload-material-checkbox-group">
                                    <label className="upload-material-checkbox-label">
                                        <input
                                            type="checkbox"
                                            name="is_public"
                                            checked={formData.is_public}
                                            onChange={handleInputChange}
                                            className="upload-material-checkbox"
                                        />
                                        <span className="upload-material-checkbox-text">
                                            Make this material public to students
                                        </span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="upload-material-form-actions">
                            <button
                                type="button"
                                className="upload-material-cancel-btn"
                                onClick={handleCancel}
                                disabled={loading}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="upload-material-submit-btn"
                                disabled={loading || !file}
                            >
                                {loading ? (
                                    <>
                                        <span className="upload-material-loading-spinner"></span>
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <FaUpload style={{ marginRight: '8px' }} />
                                        Upload Material
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default UploadMaterial;
