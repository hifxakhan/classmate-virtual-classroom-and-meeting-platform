// Material.jsx - SIMPLIFIED WITH REACT ICONS
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    FaBook,
    FaDownload,
    FaEye,
    FaUpload,
    FaFilePdf,
    FaFileWord,
    FaFilePowerpoint,
    FaFileImage,
    FaFileVideo,
    FaFileAudio,
    FaFileAlt,
    FaFileArchive,
    FaTrashAlt,
    FaArrowLeft,
    FaCalendarAlt,
    FaUser,
    FaSearch,
    FaFilter,
    FaCheck,
    FaTimes
} from 'react-icons/fa';
import './Material.css';
import classMateLogo from './assets/Logo2.png';

function Material() {
    const navigate = useNavigate();
    const location = useLocation();
    const [materials, setMaterials] = useState([]);
    const [course, setCourse] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState({
        total_materials: 0,
        total_downloads: 0,
        total_views: 0
    });
    const [deleteConfirm, setDeleteConfirm] = useState({
        isOpen: false,
        materialId: null,
        materialName: null
    });

    // Get course ID from navigation state or URL
    const courseId = location.state?.courseId;
    const courseData = location.state?.courseData;
    const teacherId = localStorage.getItem('teacherId');

    useEffect(() => {
        const fetchMaterials = async () => {
            try {
                setLoading(true);
                setError(null);

                if (!courseId) {
                    throw new Error('No course ID provided');
                }

                if (!teacherId) {
                    throw new Error('Teacher not authenticated');
                }

                console.log('Fetching materials for course:', courseId, 'Teacher ID:', teacherId);

                // First test the API
                const testResponse = await fetch('https://classmate-backend-eysi.onrender.com/api/materials/test');
                if (!testResponse.ok) {
                    console.warn('Materials API test failed');
                }

                const response = await fetch(
                    `https://classmate-backend-eysi.onrender.com/api/courses/${courseId}/materials?teacher_id=${teacherId}`
                );

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(
                        errorData.error || `HTTP error! status: ${response.status}`
                    );
                }

                const data = await response.json();

                if (data.success) {
                    console.log(`✅ Loaded ${data.count} materials`);
                    setMaterials(data.materials);
                    setCourse(data.course);
                    setStats(data.stats || {
                        total_materials: data.count,
                        total_downloads: 0,
                        total_views: 0
                    });
                } else {
                    throw new Error(data.error || 'Failed to load materials');
                }
            } catch (err) {
                console.error('Error fetching materials:', err);
                setError(err.message || 'Failed to load materials');

                // Use course data from navigation if available
                if (courseData) {
                    setCourse({
                        id: courseData.id || courseData.course_id,
                        code: courseData.course_code,
                        title: courseData.title
                    });
                }
            } finally {
                setLoading(false);
            }
        };

        if (courseId) {
            fetchMaterials();
        } else {
            setError('No course information provided');
            setLoading(false);
        }
    }, [courseId, courseData]);

    const handleDownload = async (materialId, fileName) => {
        try {
            console.log(`Downloading material ${materialId}: ${fileName}`);

            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/materials/${materialId}/download`,
                {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/octet-stream'
                    }
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    errorData.error || `Download failed: ${response.status}`
                );
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            // Update local download count
            setMaterials(prev => prev.map(material =>
                material.material_id === materialId
                    ? { ...material, download_count: material.download_count + 1 }
                    : material
            ));

            // Update stats
            setStats(prev => ({
                ...prev,
                total_downloads: prev.total_downloads + 1
            }));

        } catch (err) {
            console.error('Download error:', err);
            alert(`Failed to download file: ${err.message}`);
        }
    };

    const handleDelete = async (materialId, materialName) => {
        // Open confirmation dialog
        setDeleteConfirm({
            isOpen: true,
            materialId: materialId,
            materialName: materialName
        });
    };

    const confirmDelete = async () => {
        const { materialId } = deleteConfirm;
        
        try {
            const response = await fetch(
                `https://classmate-backend-eysi.onrender.com/api/materials/${materialId}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const data = await response.json();

            if (data.success) {
                alert(`✅ ${data.message}`);
                // Remove from local state
                setMaterials(prev => prev.filter(material => material.material_id !== materialId));
                setStats(prev => ({
                    ...prev,
                    total_materials: prev.total_materials - 1
                }));
            } else {
                alert(`❌ Delete failed: ${data.error}`);
            }
        } catch (err) {
            console.error('Delete error:', err);
            alert('Failed to delete material. Please try again.');
        } finally {
            // Close dialog
            setDeleteConfirm({
                isOpen: false,
                materialId: null,
                materialName: null
            });
        }
    };

    const cancelDelete = () => {
        setDeleteConfirm({
            isOpen: false,
            materialId: null,
            materialName: null
        });
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) {
            return dateString;
        }
    };

    const getFileExtension = (fileName) => {
        if (!fileName) return '';
        const parts = fileName.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
    };

    const getFileIcon = (fileType, color) => {
        if (!fileType) return <FaFileAlt style={{ color }} size={24} />;

        const fileTypeLower = fileType.toLowerCase();

        if (fileTypeLower.includes('pdf')) {
            return <FaFilePdf style={{ color }} size={24} />;
        } else if (fileTypeLower.includes('word') || fileTypeLower.includes('doc')) {
            return <FaFileWord style={{ color }} size={24} />;
        } else if (fileTypeLower.includes('powerpoint') || fileTypeLower.includes('ppt')) {
            return <FaFilePowerpoint style={{ color }} size={24} />;
        } else if (fileTypeLower.includes('excel') || fileTypeLower.includes('xls') || fileTypeLower.includes('spreadsheet')) {
            return <FaFileAlt style={{ color }} size={24} />;
        } else if (fileTypeLower.includes('image')) {
            return <FaFileImage style={{ color }} size={24} />;
        } else if (fileTypeLower.includes('video')) {
            return <FaFileVideo style={{ color }} size={24} />;
        } else if (fileTypeLower.includes('audio')) {
            return <FaFileAudio style={{ color }} size={24} />;
        } else if (fileTypeLower.includes('zip') || fileTypeLower.includes('rar') || fileTypeLower.includes('compress')) {
            return <FaFileArchive style={{ color }} size={24} />;
        } else {
            return <FaFileAlt style={{ color }} size={24} />;
        }
    };

    const getFileColor = (fileType) => {
        if (!fileType) return '#567c8d';

        const fileTypeLower = fileType.toLowerCase();

        if (fileTypeLower.includes('pdf')) {
            return '#2f4156';
        } else if (fileTypeLower.includes('word') || fileTypeLower.includes('doc')) {
            return '#567c8d';
        } else if (fileTypeLower.includes('powerpoint') || fileTypeLower.includes('ppt')) {
            return '#2f4156';
        } else if (fileTypeLower.includes('excel') || fileTypeLower.includes('xls') || fileTypeLower.includes('spreadsheet')) {
            return '#567c8d';
        } else if (fileTypeLower.includes('image')) {
            return '#567c8d';
        } else if (fileTypeLower.includes('video')) {
            return '#2f4156';
        } else if (fileTypeLower.includes('audio')) {
            return '#567c8d';
        } else if (fileTypeLower.includes('zip') || fileTypeLower.includes('rar') || fileTypeLower.includes('compress')) {
            return '#567c8d';
        } else {
            return '#567c8d';
        }
    };

    if (loading) {
        return (
            <div className="materials-page-loading">
                <div className="materials-spinner"></div>
                <p>Loading materials...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="materials-page-error">
                <h2>Error Loading Materials</h2>
                <p className="materials-error-message">{error}</p>
                <div className="materials-error-actions">
                    <button
                        className="materials-back-btn"
                        onClick={() => navigate(-1)}
                    >
                        <FaArrowLeft style={{ marginRight: '8px' }} />
                        Go Back
                    </button>
                    <button
                        className="materials-retry-btn"
                        onClick={() => window.location.reload()}
                    >
                        <span style={{ marginRight: '8px' }}>↻</span>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="materials-page-container">
            {/* Navigation Bar */}
            <nav className="materials-navbar">
                <div className="materials-navbar-left">
                    <div
                        className="materials-logo-container"
                        onClick={() => navigate('/teacherDashboard')}
                    >
                        <img
                            src={classMateLogo}
                            alt="ClassMate Logo"
                            className="materials-navbar-logo"
                        />
                        <span className="materials-brand-name">classMate</span>
                    </div>
                </div>

                <div className="materials-navbar-right">
                    <button
                        className="materials-back-course-btn"
                        onClick={() => navigate(-1)}
                    >
                        <FaArrowLeft style={{ marginRight: '8px' }} />
                        Back to Course
                    </button>
                </div>
            </nav>

            {/* Main Content */}
            <div className="materials-content-wrapper">
                {/* Header Section */}
                <div className="materials-header-section">
                    <div className="materials-header-info">
                        <h1 className="materials-main-title">
                            <FaBook style={{ marginRight: '12px', color: '#567c8d' }} />
                            Course Materials
                        </h1>
                        {course && (
                            <div className="materials-course-info">
                                <h2 className="materials-course-title">
                                    {course.code} - {course.title}
                                </h2>
                                <p className="materials-course-subtitle">
                                    Manage and organize your course materials
                                </p>
                            </div>
                        )}
                    </div>

                    <button
                        className="materials-upload-fab"
                        onClick={() => navigate('/UploadMaterial', {
                            state: {
                                courseId: courseId,
                                courseData: courseData
                            }
                        })}
                    >
                        <FaUpload style={{ marginRight: '8px' }} />
                        <span className="materials-fab-text">Upload Material</span>
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="materials-stats-grid">
                    <div className="materials-stat-card">
                        <div className="materials-stat-icon materials-stat-total">
                            <FaBook size={32} />
                        </div>
                        <div className="materials-stat-content">
                            <h3 className="materials-stat-value">{stats.total_materials}</h3>
                            <p className="materials-stat-label">Total Materials</p>
                        </div>
                    </div>
                    <div className="materials-stat-card">
                        <div className="materials-stat-icon materials-stat-downloads">
                            <FaDownload size={32} />
                        </div>
                        <div className="materials-stat-content">
                            <h3 className="materials-stat-value">{stats.total_downloads}</h3>
                            <p className="materials-stat-label">Total Downloads</p>
                        </div>
                    </div>
                </div>

                {/* Materials List */}
                <div className="materials-list-container">
                    <div className="materials-list-header">
                        <h3 className="materials-list-title">
                            <FaBook style={{ marginRight: '8px', color: '#567c8d' }} />
                            All Materials ({materials.length})
                        </h3>
                        <div className="materials-list-actions">
                            <div className="materials-filter-wrapper">
                                <FaFilter style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: '#567c8d',
                                    zIndex: 1
                                }} />
                                <select className="materials-filter-select">
                                    <option value="all">All Types</option>
                                    <option value="pdf">PDFs</option>
                                    <option value="document">Documents</option>
                                    <option value="presentation">Presentations</option>
                                    <option value="image">Images</option>
                                    <option value="video">Videos</option>
                                    <option value="audio">Audio</option>
                                </select>
                            </div>
                            <div className="materials-search-wrapper">
                                <FaSearch style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: '#567c8d',
                                    zIndex: 1
                                }} />
                                <input
                                    type="text"
                                    className="materials-search-input"
                                    placeholder="Search materials..."
                                />
                            </div>
                        </div>
                    </div>

                    {materials.length === 0 ? (
                        <div className="materials-empty-state">
                            <div className="materials-empty-content">
                                <div className="materials-empty-icon">
                                    <FaBook size={80} color="#567c8d" />
                                </div>
                                <h3 className="materials-empty-title">No Materials Yet</h3>
                                <p className="materials-empty-description">
                                    Start by uploading your first material for this course
                                </p>
                                <button
                                    className="materials-upload-first-btn"
                                    onClick={() => navigate('/UploadMaterial', {
                                        state: {
                                            courseId: courseId,
                                            courseData: courseData
                                        }
                                    })}
                                >
                                    <FaUpload style={{ marginRight: '8px' }} />
                                    Upload First Material
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="materials-grid-view">
                            {materials.map((material) => {
                                const fileColor = getFileColor(material.file_type);
                                return (
                                    <div key={material.material_id} className="materials-item-card">
                                        <div className="materials-item-header">
                                            <div
                                                className="materials-file-icon"
                                                style={{
                                                    backgroundColor: `${fileColor}15`,
                                                    borderColor: fileColor
                                                }}
                                            >
                                                {getFileIcon(material.file_type, fileColor)}
                                                <span className="materials-file-extension">
                                                    {getFileExtension(material.file_name)}
                                                </span>
                                            </div>
                                            <div className="materials-item-info">
                                                <h4 className="materials-item-title">{material.title}</h4>
                                                <p className="materials-file-name">{material.file_name}</p>
                                                {material.teacher_name && (
                                                    <p className="materials-uploaded-by">
                                                        <FaUser style={{ marginRight: '6px', fontSize: '12px' }} />
                                                        Uploaded by: {material.teacher_name}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="materials-item-actions">
                                                <button
                                                    className="materials-action-btn materials-download-btn"
                                                    onClick={() => handleDownload(material.material_id, material.file_name)}
                                                    title="Download"
                                                >
                                                    <FaDownload style={{ marginRight: '6px' }} />
                                                    Download
                                                </button>
                                                <button
                                                    className="materials-action-btn materials-delete-btn"
                                                    onClick={() => handleDelete(material.material_id, material.title)}
                                                    title="Delete"
                                                >
                                                    <FaTrashAlt style={{ marginRight: '6px' }} />
                                                    Delete
                                                </button>
                                            </div>
                                        </div>

                                        <div className="materials-item-content">
                                            <p className="materials-item-description">
                                                {material.description || 'No description provided'}
                                            </p>

                                            <div className="materials-meta-info">
                                                <div className="materials-meta-item">
                                                    <span className="materials-meta-label">File Type:</span>
                                                    <span className="materials-meta-value">
                                                        {material.file_type?.split('/').pop()?.toUpperCase() || 'Unknown'}
                                                    </span>
                                                </div>
                                                <div className="materials-meta-item">
                                                    <span className="materials-meta-label">File Size:</span>
                                                    <span className="materials-meta-value">{material.file_size}</span>
                                                </div>
                                                <div className="materials-meta-item">
                                                    <span className="materials-meta-label">Visibility:</span>
                                                    <span className={`materials-meta-value materials-visibility-${material.is_public ? 'public' : 'private'}`}>
                                                        {material.is_public ? (
                                                            <><FaCheck style={{ marginRight: '4px' }} /> Public</>
                                                        ) : (
                                                            <><FaTimes style={{ marginRight: '4px' }} /> Private</>
                                                        )}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="materials-item-footer">
                                                <div className="materials-stats-info">
                                                    <span className="materials-stat-item">
                                                        <FaDownload style={{ marginRight: '4px', color: '#567c8d' }} />
                                                        {material.download_count} downloads
                                                    </span>
                                                    <span className="materials-stat-item">
                                                        <FaEye style={{ marginRight: '4px', color: '#567c8d' }} />
                                                        {material.view_count} views
                                                    </span>
                                                </div>
                                                <div className="materials-upload-date">
                                                    <FaCalendarAlt style={{ marginRight: '6px', fontSize: '12px' }} />
                                                    Uploaded: {formatDate(material.uploaded_date)}
                                                </div>
                                            </div>

                                            {material.tags && material.tags.length > 0 && (
                                                <div className="materials-tags-container">
                                                    {material.tags.slice(0, 3).map((tag, index) => (
                                                        <span key={index} className="materials-tag">
                                                            #{tag}
                                                        </span>
                                                    ))}
                                                    {material.tags.length > 3 && (
                                                        <span className="materials-tag-more">
                                                            +{material.tags.length - 3} more
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteConfirm.isOpen && (
                <div className="materials-modal-overlay">
                    <div className="materials-modal-content">
                        <div className="materials-modal-header">
                            <h2 className="materials-modal-title">Delete Material?</h2>
                        </div>
                        <div className="materials-modal-body">
                            <p className="materials-modal-message">
                                Are you sure you want to delete <strong>"{deleteConfirm.materialName}"</strong>?
                            </p>
                            <p className="materials-modal-warning">
                                This action cannot be undone.
                            </p>
                        </div>
                        <div className="materials-modal-footer">
                            <button
                                className="materials-modal-btn materials-modal-cancel"
                                onClick={cancelDelete}
                            >
                                Cancel
                            </button>
                            <button
                                className="materials-modal-btn materials-modal-delete"
                                onClick={confirmDelete}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Material;
