import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './adminDashboard.css';
import UserForm from './UserForm';
import CourseForm from './CourseForm';
import jsPDF from 'jspdf';
import classMateLogo from './assets/Logo2.png';

function AdminDashboard() {
    const navigate = useNavigate();
    // NEW STATE FOR ADMIN PROFILE (Added to support app.py profile routes)
    const [adminData, setAdminData] = useState({ name: "Admin User", email: "", id: "", role: "Administrator" });
    
    const userName = adminData?.name || adminData?.full_name || "Admin User"; // Linked to database state
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    
    // NEW STATES FOR USER MANAGEMENT (Added without removing original code)
    const [view, setView] = useState('dashboard'); 
    const [allUsers, setAllUsers] = useState([]);
    const [userFilter, setUserFilter] = useState('all'); // 'all', 'student', 'teacher'
    const [editingUser, setEditingUser] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editFormData, setEditFormData] = useState({});

    const [statsData, setStatsData] = useState({
        totalStudents: 0,
        totalTeachers: 0,
        activeCourses: 0,
        activeMeetings: 0
    });
    
    const [recentActivities, setRecentActivities] = useState([
        { timestamp: "Loading...", user: "System", activity: "Connecting to backend", ip: "localhost", status: "info" }
    ]);
    
    const [loading, setLoading] = useState(true);
    const [backendStatus, setBackendStatus] = useState('checking');
    
    // NEW STATE FOR ANNOUNCEMENTS
    const [announcements, setAnnouncements] = useState([]);
    const [announcementTitle, setAnnouncementTitle] = useState('');
    const [announcementContent, setAnnouncementContent] = useState('');
    const [announcementRecipients, setAnnouncementRecipients] = useState('all'); // 'all', 'students', 'teachers'
    
    // NEW STATE FOR COURSE REGISTRATION/ENROLLMENT
    const [availableCourses, setAvailableCourses] = useState([]);
    const [registeredStudents, setRegisteredStudents] = useState([]);
    const [enrollments, setEnrollments] = useState([]);
    const [selectedStudentForEnroll, setSelectedStudentForEnroll] = useState('');
    const [selectedCourseForEnroll, setSelectedCourseForEnroll] = useState('');
    
    // Security Logs state
    const [securityLogs, setSecurityLogs] = useState([]);
    const [logsPage, setLogsPage] = useState(1);
    const [logsLimit, setLogsLimit] = useState(25);
    const [logsTotal, setLogsTotal] = useState(0);
    const [logsFilters, setLogsFilters] = useState({ user: '', severity: '', q: '', start: '', end: '' });
    const [securityDetail, setSecurityDetail] = useState(null);
    const [showSecurityDetail, setShowSecurityDetail] = useState(false);
    
    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    // ---------- Security Logs functions ----------
    const fetchSecurityLogs = (page = logsPage) => {
        const params = new URLSearchParams();
        params.append('page', page);
        params.append('limit', logsLimit);
        if (logsFilters.user) params.append('user', logsFilters.user);
        if (logsFilters.severity) params.append('severity', logsFilters.severity);
        if (logsFilters.q) params.append('q', logsFilters.q);
        if (logsFilters.start) params.append('start', logsFilters.start);
        if (logsFilters.end) params.append('end', logsFilters.end);

        fetch(`https://classmate-backend-eysi.onrender.com/api/admin/security/logs?${params.toString()}`)
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setSecurityLogs(data.events || []);
                    setLogsTotal(data.total || 0);
                    setLogsPage(page);
                }
            })
            .catch(err => {
                console.error('Security logs fetch error', err);
                setSecurityLogs([]);
                setLogsTotal(0);
            });
    };

    const fetchSecurityLogDetail = (id) => {
        fetch(`https://classmate-backend-eysi.onrender.com/api/admin/security/logs/${id}`)
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setSecurityDetail(data.event);
                    setShowSecurityDetail(true);
                } else {
                    alert('Log details not found');
                }
            })
            .catch(err => {
                console.error('Security log detail error', err);
                alert('Failed to load log details');
            });
    };

    const clearLogFilters = () => {
        setLogsFilters({ user: '', severity: '', q: '', start: '', end: '' });
        fetchSecurityLogs(1);
    };

    const handleLogsFilterChange = (field) => (e) => {
        const value = e && e.target ? e.target.value : e;
        setLogsFilters(prev => ({ ...prev, [field]: value }));
    };

    // ✅ NEW FUNCTION TO FETCH ADMIN PROFILE FROM DATABASE
    const fetchAdminProfile = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/profile')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setAdminData(data.admin);
                }
            })
            .catch(err => console.error("Admin Profile Load Error:", err));
    };

    // ✅ NEW FUNCTION TO EDIT ADMIN PROFILE
    const handleEditProfile = () => {
        const newName = prompt("Edit Admin Name:", adminData.name);
        const newEmail = prompt("Edit Admin Email:", adminData.email);
        
        if (newName && newEmail) {
            fetch('https://classmate-backend-eysi.onrender.com/api/admin/profile/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: adminData.id,
                    name: newName,
                    email: newEmail
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert(data.message);
                    fetchAdminProfile(); // Refresh UI with new data
                }
            });
        }
    };

    const normalizeUserType = (type) => (type || '').toLowerCase();

    // ✅ BACKEND CONNECTION
    useEffect(() => {
        console.log("🔄 Admin Dashboard loading...");
        fetchAdminProfile(); // Load real admin data on startup
        
        // 1. Test backend connection
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/test')
            .then(response => {
                if (!response.ok) throw new Error(`Backend error: ${response.status}`);
                return response.json();
            })
            .then(data => {
                console.log("✅ Backend connected:", data);
                setBackendStatus('connected');
            })
            .catch(error => {
                console.log("⚠️  Backend not available");
                setBackendStatus('disconnected');
            });
        
        // 2. Fetch stats
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/stats')
            .then(response => response.json())
            .then(data => {
                console.log("📊 Stats:", data);
                if (data.success) {
                    setStatsData(data.stats);
                    if (data.database === 'real') {
                        setBackendStatus('connected');
                    }
                }
                setLoading(false);
            })
            .catch(error => {
                console.log("❌ Stats error, using demo data");
                setStatsData({
                    totalStudents: 2847,
                    totalTeachers: 124,
                    activeCourses: 68,
                    activeMeetings: 23
                });
                setLoading(false);
            });
        
        // 3. Fetch activity logs
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/activity-logs')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.logs) {
                    setRecentActivities(data.logs.map(log => ({
                        timestamp: log.timestamp || new Date().toLocaleString(),
                        user: log.user || 'System',
                        activity: log.activity || 'Activity',
                        ip: log.ip || 'localhost',
                        status: log.status || 'info'
                    })));
                }
            })
            .catch(() => {
                setRecentActivities([
                    { timestamp: new Date().toLocaleString(), user: "Admin", activity: "Dashboard loaded", ip: "localhost", status: "Success" },
                    { timestamp: new Date().toLocaleString(), user: "System", activity: "Backend connected", ip: "127.0.0.1", status: "Success" }
                ]);
            });
            
    }, []);

    // ✅ NEW FUNCTION TO FETCH USERS FOR THE TABLE
    const fetchAllUsersForTable = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/users/all')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    const normalized = (data.users || []).map(u => ({
                        ...u,
                        type: normalizeUserType(u.type)
                    }));
                    setAllUsers(normalized);
                }
            });
    };

    // ✅ ADD NEW USER FUNCTION - Now navigates to UserForm
    const handleAddUser = () => {
        setView('userForm');
    };

    // ✅ VIEW REPORTS FUNCTION
    const handleViewReports = () => {
        console.log("📊 Fetching reports...");
        
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/users/all')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    const count = data.count || 0;
                    const normalized = (data.users || []).map(u => ({
                        ...u,
                        type: normalizeUserType(u.type)
                    }));
                    alert(`📋 Total Users: ${count}\nDatabase: real`);
                    console.log("Users:", normalized);
                    // Open the table view
                    setAllUsers(normalized);
                    setView('users');
                } else {
                    alert(`❌ ${data.message}`);
                }
            })
            .catch(err => {
                alert("❌ Failed to fetch reports");
                console.error(err);
            });
    };

    // ✅ AUDIT LOGS FUNCTION
    const handleAuditLogs = () => {
        console.log("🔍 Fetching logs...");
        
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/activity-logs')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert(`📝 Activity Logs: ${data.count} entries`);
                    console.log("Logs:", data.logs);
                }
            })
            .catch(err => {
                alert("ℹ️ Using demo logs");
                console.error(err);
            });
    };
    
    // ✅ NEW ADD COURSE FUNCTION - Now navigates to CourseForm
    const handleAddCourse = () => {
        setView('courseForm');
    };

    // ✅ DELETE USER FUNCTION
    const handleDeleteUser = async (userId, userType) => {
        const normalizedType = normalizeUserType(userType) || 'teacher';
        const typeLabel = normalizedType === 'student' ? 'student' : 'teacher';

        if (!window.confirm(`Are you sure you want to delete this ${typeLabel}? This action cannot be undone.`)) {
            return;
        }

        const endpoint = normalizedType === 'student' ? 'students' : 'teachers';
        
        try {
            const response = await fetch(`https://classmate-backend-eysi.onrender.com/api/admin/${endpoint}/${userId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert(`✅ ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} deleted successfully!`);
                fetchAllUsersForTable();
            } else {
                alert(`❌ Error: ${data.message || 'Failed to delete user'}`);
                console.log('Delete response:', data);
            }
        } catch (error) {
            alert(`❌ Failed to delete user: ${error.message}`);
            console.error('Delete error:', error);
        }
    };

    // ✅ EDIT USER FUNCTION - Open modal
    const handleEditUser = (user) => {
        setEditingUser(user);
        setEditFormData({
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            department: user.department || '',
            semester: user.semester || ''
        });
        setShowEditModal(true);
    };

    // ✅ SAVE UPDATED USER
    const handleSaveUser = () => {
        if (!editFormData.name.trim() || !editFormData.email.trim()) {
            alert('Name and email are required');
            return;
        }

        const endpoint = editingUser.type === 'student' ? 'students' : 'teachers';
        const payload = { name: editFormData.name, email: editFormData.email };
        if (editingUser.type === 'student') {
            payload.phone = editFormData.phone || '';
            payload.semester = editFormData.semester || '';
        }
        if (editingUser.type === 'teacher') {
            payload.department = editFormData.department || '';
        }

        fetch(`https://classmate-backend-eysi.onrender.com/api/admin/${endpoint}/${editingUser.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert(`✅ User updated successfully!`);
                setShowEditModal(false);
                setEditingUser(null);
                fetchAllUsersForTable();
            } else {
                alert(`❌ Error: ${data.message}`);
            }
        })
        .catch(err => {
            alert('❌ Failed to update user');
            console.error(err);
        });
    };

    // ✅ DOWNLOAD USERS AS PDF
    const handleDownloadUsersPDF = () => {
        try {
            const doc = new jsPDF();
            
            // Filter users based on current filter
            const filteredUsers = userFilter === 'all' 
                ? allUsers 
                : allUsers.filter(u => normalizeUserType(u.type) === userFilter);
            
            // Title
            const title = userFilter === 'all' 
                ? 'All Users Report' 
                : userFilter === 'student' ? 'Students List' : 'Teachers List';
        
        doc.setFontSize(16);
        doc.text(title, 14, 15);
        
        // Date
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 25);
        
        // Table headers
        const headers = ['ID', 'Name', 'Email', 'Type'];
        const data = filteredUsers.map(u => [
            u.id,
            u.name,
            u.email,
            u.type.charAt(0).toUpperCase() + u.type.slice(1)
        ]);
        
        let startY = 35;
        
        // Column widths
        const colWidths = [40, 50, 70, 30];
        const pageWidth = doc.internal.pageSize.getWidth();
        const margins = 14;
        
        // Draw headers
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        let xPos = margins;
        headers.forEach((header, i) => {
            doc.text(header, xPos, startY);
            xPos += colWidths[i];
        });
        
        // Draw rows
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        startY += 8;
        
        data.forEach((row, rowIndex) => {
            if (startY > 270) {
                doc.addPage();
                startY = 15;
            }
            
            xPos = margins;
            row.forEach((cell, i) => {
                doc.text(cell.toString(), xPos, startY);
                xPos += colWidths[i];
            });
            startY += 8;
        });
        
            // Footer
            const pageCount = doc.internal.pages.length - 1;
            doc.setFontSize(9);
            doc.text(`Total ${filteredUsers.length} ${userFilter === 'all' ? 'users' : userFilter}`, 14, doc.internal.pageSize.getHeight() - 10);
            
            doc.save(`${title.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Error generating PDF. Please try again.');
        }
    };

    // ✅ FUNCTION TO CREATE AND SEND ANNOUNCEMENT
    const handleCreateAnnouncement = () => {
        if (!announcementTitle.trim() || !announcementContent.trim()) {
            alert("❌ Please fill in both title and content");
            return;
        }

        fetch('https://classmate-backend-eysi.onrender.com/api/admin/announcements/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: announcementTitle,
                content: announcementContent,
                recipients: announcementRecipients,
                created_by: adminData.id
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert(`✅ ${data.message}`);
                setAnnouncementTitle('');
                setAnnouncementContent('');
                setAnnouncementRecipients('all');
                // Fetch announcements to show the new one
                fetchAnnouncements();
            } else {
                alert(`❌ ${data.message || 'Error creating announcement'}`);
            }
        })
        .catch(err => {
            alert("❌ Failed to create announcement");
            console.error(err);
        });
    };

    // ✅ FUNCTION TO FETCH ALL ANNOUNCEMENTS
    const fetchAnnouncements = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/announcements')
            .then(r => r.json())
            .then(data => {
                if (data.success && data.announcements) {
                    setAnnouncements(data.announcements);
                }
            })
            .catch(err => console.error("Fetch announcements error:", err));
    };

    // ✅ FUNCTION TO DELETE ANNOUNCEMENT
    const handleDeleteAnnouncement = (announcementId) => {
        if (!window.confirm("Are you sure you want to delete this announcement?")) return;

        fetch(`https://classmate-backend-eysi.onrender.com/api/admin/announcements/${announcementId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert("✅ Announcement deleted");
                fetchAnnouncements();
            } else {
                alert(`❌ ${data.message}`);
            }
        })
        .catch(err => {
            alert("❌ Failed to delete announcement");
            console.error(err);
        });
    };

    // ✅ FUNCTION TO FETCH AVAILABLE COURSES
    const fetchAvailableCourses = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/courses/all')
            .then(r => r.json())
            .then(data => {
                if (data.success && data.courses) {
                    setAvailableCourses(data.courses);
                }
            })
            .catch(err => console.error("Fetch courses error:", err));
    };

    // ✅ FUNCTION TO FETCH REGISTERED STUDENTS
    const fetchRegisteredStudents = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/students/registered')
            .then(r => r.json())
            .then(data => {
                if (data.success && data.students) {
                    setRegisteredStudents(data.students);
                }
            })
            .catch(err => console.error("Fetch students error:", err));
    };

    // ✅ FUNCTION TO FETCH ALL ENROLLMENTS
    const fetchEnrollments = () => {
        fetch('https://classmate-backend-eysi.onrender.com/api/admin/enrollments')
            .then(r => r.json())
            .then(data => {
                if (data.success && data.enrollments) {
                    setEnrollments(data.enrollments);
                }
            })
            .catch(err => console.error("Fetch enrollments error:", err));
    };

    // ✅ FUNCTION TO REGISTER STUDENT IN COURSE
    const handleEnrollStudentInCourse = () => {
        if (!selectedStudentForEnroll || !selectedCourseForEnroll) {
            alert("❌ Please select both a student and a course");
            return;
        }

        fetch('https://classmate-backend-eysi.onrender.com/api/admin/enrollments/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: selectedStudentForEnroll,
                course_id: selectedCourseForEnroll
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert(`✅ ${data.message}`);
                setSelectedStudentForEnroll('');
                setSelectedCourseForEnroll('');
                // Refresh enrollments list
                fetchEnrollments();
            } else {
                alert(`❌ ${data.message || 'Error enrolling student'}`);
            }
        })
        .catch(err => {
            alert("❌ Failed to enroll student");
            console.error(err);
        });
    };

    // ✅ FUNCTION TO REMOVE STUDENT FROM COURSE
    const handleRemoveEnrollment = (enrollmentId) => {
        if (!window.confirm("Are you sure you want to remove this student from the course?")) return;

        fetch(`https://classmate-backend-eysi.onrender.com/api/admin/enrollments/${enrollmentId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert("✅ Student removed from course");
                fetchEnrollments();
            } else {
                alert(`❌ ${data.message}`);
            }
        })
        .catch(err => {
            alert("❌ Failed to remove enrollment");
            console.error(err);
        });
    };

    // ✅ LOADING SCREEN
    if (loading) {
        return (
            <div className="admin-dashboard loading">
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Loading Admin Dashboard...</p>
                    <p className="loading-subtext">Connecting to backend...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-dashboard">
            {/* Navigation Bar */}
            <nav className="admin-navbar">
                <div className="navbar-left">
                    <button 
                        className={`hamburger-menu ${isMenuOpen ? 'active' : ''}`}
                        onClick={toggleMenu}
                        aria-label="Toggle menu"
                    >
                        <span className="hamburger-line"></span>
                        <span className="hamburger-line"></span>
                        <span className="hamburger-line"></span>
                    </button>
                    
                    <div className="logo-container">
                        <div className="navbar-logo">
                            <img
                                src={classMateLogo}
                                alt="Classmate logo"
                                className="navbar-logo-img"
                                onError={(e) => { e.target.onerror = null; e.target.src = '/logo.jpeg'; }}
                            />
                        </div>
                        <span className="admin-brand-name">
                            classMate <span className="admin-badge">Admin</span>
                        </span>
                    </div>
                </div>
                
                <div className="navbar-right">
                    <div className="user-profile" onClick={() => setView('profile')} style={{cursor: 'pointer'}}>
                        <div className="user-avatar admin-avatar">
                            {userName.charAt(0)}
                        </div>
                        <span className="user-name">{userName}</span>
                        <div className="backend-status">
                            <span className={`status-dot ${backendStatus === 'connected' ? 'connected' : 'demo'}`}></span>
                            <span className="status-text">
                                {backendStatus === 'connected' ? 'Live' : 'Demo'}
                            </span>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Side Navigation */}
            <div className={`side-nav ${isMenuOpen ? 'open' : ''}`}>
                <div className="side-nav-header">
                    <h3>Admin Panel</h3>
                    <button className="close-menu" onClick={toggleMenu} aria-label="Close menu">
                        &times;
                    </button>
                </div>
                
                <div className="nav-menu">
                    <div className="nav-user-info" onClick={() => setView('profile')} style={{cursor: 'pointer'}}>
                        <div className="side-user-avatar"><i className="fas fa-crown"></i></div>
                        <div className="side-user-details">
                            <h4>{userName}</h4>
                            <p className="user-role">{adminData.role}</p>
                            <p className="data-source">
                                {backendStatus === 'connected' ? '📊 Live Database' : '⚠️ Demo Mode'}
                            </p>
                        </div>
                    </div>
                    
                    <nav className="nav-links">
                        <a href="#" className={`nav-link ${view === 'dashboard' ? 'active' : ''}`} onClick={() => {setView('dashboard'); setIsMenuOpen(false);}}>
                            <span className="nav-icon"><i className="fas fa-chart-line"></i></span> Dashboard
                        </a>
                        <a href="#" className={`nav-link ${view === 'users' ? 'active' : ''}`} onClick={() => {setView('users'); fetchAllUsersForTable(); setIsMenuOpen(false);}}>
                            <span className="nav-icon"><i className="fas fa-users"></i></span> User Management
                        </a>
                        <a href="#" className="nav-link" onClick={() => {setIsMenuOpen(false); navigate('/manageEnrollment');}}>
                            <span className="nav-icon"><i className="fas fa-book"></i></span> Course Registration
                        </a>
                        <a href="#" className={`nav-link ${view === 'announcements' ? 'active' : ''}`} onClick={() => {setView('announcements'); fetchAnnouncements(); setIsMenuOpen(false);}}>
                            <span className="nav-icon"><i className="fas fa-bell"></i></span> Announcements
                        </a>
                        <a href="#" className={`nav-link ${view === 'security' ? 'active' : ''}`} onClick={() => { setView('security'); fetchSecurityLogs(1); setIsMenuOpen(false); }}>
                            <span className="nav-icon"><i className="fas fa-shield"></i></span> Security Logs
                        </a>
                        <a href="#" className="nav-link logout">
                            <span className="nav-icon"><i className="fas fa-sign-out-alt"></i></span> Logout
                        </a>
                    </nav>
                </div>
            </div>

            {/* Overlay */}
            {isMenuOpen && (
                <div className="overlay" onClick={toggleMenu}></div>
            )}

            {/* Main Content */}
            <div className="dashboard-content">
                {/* Search Bar */}
                <div className="search-container">
                    <input 
                        type="text" 
                        className="search-input"
                        placeholder="Search users, courses, logs..."
                    />
                    <div className="data-source-indicator">
                        <span className={`indicator-dot ${backendStatus === 'connected' ? 'live' : 'demo'}`}></span>
                        <span>
                            {backendStatus === 'connected' 
                                ? '' 
                                : '⚠️ Demo Mode (Backend: https://classmate-backend-eysi.onrender.com)'}
                        </span>
                    </div>
                </div>

                {/* Main Content View Switch */}
                {view === 'dashboard' ? (
                    <>
                        {/* Stats Cards */}
                        <div className="stats-grid">
                            <div className="stat-card">
                                <h3>Total Students</h3>
                                <p className="stat-number">{statsData.totalStudents.toLocaleString()}</p>
                                <span className="stat-trend">↑ 12% this month</span>
                                <div className="data-source-badge">
                                    {backendStatus === 'connected' ? 'LIVE' : 'DEMO'}
                                </div>
                            </div>
                            
                            <div className="stat-card">
                                <h3>Total Teachers</h3>
                                <p className="stat-number">{statsData.totalTeachers}</p>
                                <span className="stat-trend">↑ 8% this week</span>
                                <div className="data-source-badge">
                                    {backendStatus === 'connected' ? 'LIVE' : 'DEMO'}
                                </div>
                            </div>
                            
                            <div className="stat-card">
                                <h3>Active Courses</h3>
                                <p className="stat-number">{statsData.activeCourses}</p>
                                <span className="stat-trend">↓ 2% yesterday</span>
                                <div className="data-source-badge">
                                    {backendStatus === 'connected' ? 'LIVE' : 'DEMO'}
                                </div>
                            </div>
                            
                            <div className="stat-card">
                                <h3>Active Meetings</h3>
                                <p className="stat-number">{statsData.activeMeetings}</p>
                                <span className="stat-trend">↑ 15% today</span>
                                <div className="data-source-badge">
                                    {backendStatus === 'connected' ? 'LIVE' : 'DEMO'}
                                </div>
                            </div>
                        </div>

                        {/* Activity Logs */}
                        <div className="activity-section">
                            <div className="section-header">
                                <h2>Recent Activity Logs</h2>
                                <div>
                                    <span className="logs-count">
                                        {recentActivities.length} activities
                                    </span>
                                    <button className="view-all-btn">View All Logs</button>
                                </div>
                            </div>
                            
                            <table className="activity-table">
                                <thead>
                                    <tr>
                                        <th>Timestamp</th>
                                        <th>User</th>
                                        <th>Activity</th>
                                        <th>IP Address</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentActivities.map((activity, index) => (
                                        <tr key={index}>
                                            <td>{activity.timestamp}</td>
                                            <td>{activity.user}</td>
                                            <td>{activity.activity}</td>
                                            <td>{activity.ip}</td>
                                            <td className={`status-${activity.status.toLowerCase()}`}>
                                                {activity.status}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Quick Actions */}
                        <div className="quick-actions-section">
                            <h2>Quick Actions</h2>
                            <div className="actions-grid">
                                <button className="action-btn" onClick={handleAddUser}>
                                    <span className="action-icon"><i className="fas fa-user-plus"></i></span>
                                    Add New User
                                </button>
                                
                                <button className="action-btn" onClick={handleAddCourse}>
                                    <span className="action-icon"><i className="fas fa-plus-circle"></i></span>
                                    Add Course
                                </button>
                                
                                <button className="action-btn" onClick={() => {fetchAllUsersForTable(); setView('users');}}>
                                    <span className="action-icon"><i className="fas fa-users"></i></span>
                                    User Management
                                </button>
                                
                                <button className="action-btn" onClick={() => navigate('/manageEnrollment')}>
                                    <span className="action-icon"><i className="fas fa-user-check"></i></span>
                                    Manage Enrollment
                                </button>
                            </div>
                        </div>
                    </>
                ) : view === 'users' ? (
                    /* USER MANAGEMENT TABLE VIEW WITH FILTER AND ACTIONS */
                    <div className="activity-section">
                        <div className="section-header">
                            <h2>User Management</h2>
                            <button className="view-all-btn" onClick={() => setView('dashboard')}>Back to Dashboard</button>
                        </div>

                        {/* Filter and Download Controls */}
                        <div style={{display: 'flex', gap: '15px', marginBottom: '20px', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', backgroundColor: '#f5efeb', padding: '15px', borderRadius: '8px', border: '1px solid #c8d9e6'}}>
                            <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                                <label style={{color: '#2f4156', fontWeight: '600', fontSize: '14px', whiteSpace: 'nowrap'}}>Filter:</label>
                                <select 
                                    value={userFilter}
                                    onChange={(e) => setUserFilter(e.target.value)}
                                    style={{padding: '8px 12px', backgroundColor: '#ffffff', border: '1px solid #c8d9e6', borderRadius: '5px', color: '#2f4156', cursor: 'pointer', fontSize: '14px'}}
                                >
                                    <option value="all" style={{color: '#000'}}>All Users</option>
                                    <option value="student" style={{color: '#000'}}>Students Only</option>
                                    <option value="teacher" style={{color: '#000'}}>Teachers Only</option>
                                </select>
                            </div>
                            
                            <button 
                                onClick={handleDownloadUsersPDF}
                                style={{
                                    padding: '8px 16px', 
                                    backgroundColor: '#2f4156', 
                                    color: '#f5efeb', 
                                    border: '1px solid #567c8d', 
                                    borderRadius: '5px', 
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontWeight: '500',
                                    fontSize: '14px',
                                    transition: 'all 0.3s ease',
                                    whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = '#3b5168'}
                                onMouseLeave={(e) => e.target.style.backgroundColor = '#2f4156'}
                            >
                                <i className="fas fa-download"></i> Download {userFilter === 'all' ? 'All Users' : userFilter === 'student' ? 'Students' : 'Teachers'} as PDF
                            </button>
                        </div>

                        {/* Users Table */}
                        <table className="activity-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Name</th>
                                    <th>Email</th>
                                    <th>Type</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(userFilter === 'all' ? allUsers : allUsers.filter(u => normalizeUserType(u.type) === userFilter)).map((user, index) => (
                                    <tr key={index}>
                                        <td>{user.id}</td>
                                        <td>{user.name}</td>
                                        <td>{user.email}</td>
                                        <td><span style={{backgroundColor: normalizeUserType(user.type) === 'student' ? 'rgba(33, 150, 243, 0.2)' : 'rgba(255, 152, 0, 0.2)', color: normalizeUserType(user.type) === 'student' ? '#2196F3' : '#FF9800', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '500'}}>{normalizeUserType(user.type) === 'student' ? 'Student' : 'Teacher'}</span></td>
                                        <td style={{display: 'flex', gap: '8px'}}>
                                            <button 
                                                onClick={() => handleEditUser(user)}
                                                style={{padding: '5px 10px', backgroundColor: 'rgba(33, 150, 243, 0.2)', color: '#2196F3', border: '1px solid rgba(33, 150, 243, 0.3)', borderRadius: '5px', cursor: 'pointer', fontSize: '12px'}}
                                                title="Edit user"
                                            >
                                                <i className="fas fa-edit"></i> Edit
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteUser(user.id, user.type)}
                                                style={{padding: '5px 10px', backgroundColor: 'rgba(255, 59, 48, 0.2)', color: '#ff3b30', border: '1px solid rgba(255, 59, 48, 0.3)', borderRadius: '5px', cursor: 'pointer', fontSize: '12px'}}
                                                title="Delete user"
                                            >
                                                <i className="fas fa-trash-alt"></i> Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {allUsers.length === 0 && (
                            <div style={{padding: '30px', textAlign: 'center', color: '#999'}}>
                                No users found. Create new users using the "Add User" button on the dashboard.
                            </div>
                        )}

                        {/* Edit User Modal */}
                        {showEditModal && editingUser && (
                            <div style={{
                                position: 'fixed',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                zIndex: 10000,
                                padding: '20px'
                            }}>
                                <div style={{
                                    backgroundColor: '#1a1f2e',
                                    borderRadius: '12px',
                                    padding: '30px',
                                    maxWidth: '600px',
                                    width: '100%',
                                    border: '2px solid rgba(255, 255, 255, 0.15)',
                                    maxHeight: '90vh',
                                    overflowY: 'auto',
                                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
                                }}>
                                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px'}}>
                                        <h3 style={{margin: 0, color: '#fff', fontSize: '18px', fontWeight: '600'}}>Edit {editingUser.type.charAt(0).toUpperCase() + editingUser.type.slice(1)}</h3>
                                        <button 
                                            onClick={() => setShowEditModal(false)}
                                            style={{background: 'none', border: 'none', color: '#ccc', fontSize: '28px', cursor: 'pointer', padding: 0, width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
                                        >
                                            ×
                                        </button>
                                    </div>

                                    <div style={{marginBottom: '15px'}}>
                                        <label style={{display: 'block', marginBottom: '6px', color: '#aaa', fontSize: '13px', fontWeight: '500'}}>Full Name</label>
                                        <input 
                                            type="text"
                                            value={editFormData.name || ''}
                                            onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                                            style={{width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', boxSizing: 'border-box', fontSize: '14px'}}
                                            placeholder="Enter full name"
                                        />
                                    </div>

                                    <div style={{marginBottom: '15px'}}>
                                        <label style={{display: 'block', marginBottom: '6px', color: '#aaa', fontSize: '13px', fontWeight: '500'}}>Email Address</label>
                                        <input 
                                            type="email"
                                            value={editFormData.email || ''}
                                            onChange={(e) => setEditFormData({...editFormData, email: e.target.value})}
                                            style={{width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', boxSizing: 'border-box', fontSize: '14px'}}
                                            placeholder="Enter email address"
                                        />
                                    </div>

                                    <div style={{marginBottom: '15px'}}>
                                        <label style={{display: 'block', marginBottom: '6px', color: '#aaa', fontSize: '13px', fontWeight: '500'}}>Phone Number</label>
                                        <input 
                                            type="text"
                                            value={editFormData.phone || ''}
                                            onChange={(e) => setEditFormData({...editFormData, phone: e.target.value})}
                                            style={{width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', boxSizing: 'border-box', fontSize: '14px'}}
                                            placeholder="Enter phone number (optional)"
                                        />
                                    </div>

                                    {editingUser.type === 'student' && (
                                        <div style={{marginBottom: '15px'}}>
                                            <label style={{display: 'block', marginBottom: '6px', color: '#aaa', fontSize: '13px', fontWeight: '500'}}>Semester</label>
                                            <input 
                                                type="text"
                                                value={editFormData.semester || ''}
                                                onChange={(e) => setEditFormData({...editFormData, semester: e.target.value})}
                                                style={{width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', boxSizing: 'border-box', fontSize: '14px'}}
                                                placeholder="e.g., 1st Semester, 2nd Year"
                                            />
                                        </div>
                                    )}

                                    {editingUser.type === 'teacher' && (
                                        <div style={{marginBottom: '15px'}}>
                                            <label style={{display: 'block', marginBottom: '6px', color: '#aaa', fontSize: '13px', fontWeight: '500'}}>Department</label>
                                            <input 
                                                type="text"
                                                value={editFormData.department || ''}
                                                onChange={(e) => setEditFormData({...editFormData, department: e.target.value})}
                                                style={{width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', boxSizing: 'border-box', fontSize: '14px'}}
                                                placeholder="e.g., Computer Science, Mathematics"
                                            />
                                        </div>
                                    )}

                                    <div style={{display: 'flex', gap: '12px', marginTop: '25px', paddingTop: '15px', borderTop: '1px solid rgba(255, 255, 255,0.1)'}}>
                                        <button 
                                            onClick={handleSaveUser}
                                            style={{flex: 1, padding: '12px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', transition: 'all 0.3s ease'}}
                                            onMouseEnter={(e) => e.target.style.backgroundColor = '#45a049'}
                                            onMouseLeave={(e) => e.target.style.backgroundColor = '#4CAF50'}
                                        >
                                            <i className="fas fa-save"></i> Save Changes
                                        </button>
                                        <button 
                                            onClick={() => setShowEditModal(false)}
                                            style={{flex: 1, padding: '12px', backgroundColor: 'rgba(255, 255, 255, 0.1)', color: '#ccc', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', transition: 'all 0.3s ease'}}
                                            onMouseEnter={(e) => {e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.15)'; e.target.style.color = '#fff'}}
                                            onMouseLeave={(e) => {e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; e.target.style.color = '#ccc'}}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : view === 'announcements' ? (
                    /* ANNOUNCEMENTS VIEW */
                    <div className="activity-section">
                        <div className="section-header">
                            <h2>Announcements Management</h2>
                            <button className="view-all-btn" onClick={() => setView('dashboard')}>Back to Dashboard</button>
                        </div>

                        {/* Create Announcement Form */}
                        <div style={{backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '10px', padding: '20px', marginBottom: '30px', border: '1px solid rgba(255, 255, 255, 0.1)'}}>
                            <h3 style={{marginBottom: '20px', color: '#fff'}}>Create New Announcement</h3>
                            
                            <div style={{marginBottom: '15px'}}>
                                <label style={{display: 'block', marginBottom: '5px', color: '#aaa', fontSize: '14px'}}>Title</label>
                                <input 
                                    type="text"
                                    placeholder="e.g., System Maintenance Notice"
                                    value={announcementTitle}
                                    onChange={(e) => setAnnouncementTitle(e.target.value)}
                                    style={{width: '100%', padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '5px', color: '#fff'}}
                                />
                            </div>

                            <div style={{marginBottom: '15px'}}>
                                <label style={{display: 'block', marginBottom: '5px', color: '#aaa', fontSize: '14px'}}>Content</label>
                                <textarea 
                                    placeholder="Enter announcement content..."
                                    value={announcementContent}
                                    onChange={(e) => setAnnouncementContent(e.target.value)}
                                    rows="6"
                                    style={{width: '100%', padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '5px', color: '#fff', fontFamily: 'Arial, sans-serif'}}
                                />
                            </div>

                            <div style={{marginBottom: '15px'}}>
                                <label style={{display: 'block', marginBottom: '5px', color: '#aaa', fontSize: '14px'}}>Send To</label>
                                <select 
                                    value={announcementRecipients}
                                    onChange={(e) => setAnnouncementRecipients(e.target.value)}
                                    style={{width: '100%', padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '5px', color: '#fff'}}
                                >
                                    <option value="all" style={{color: '#000'}}>All Users (Students & Teachers)</option>
                                    <option value="students" style={{color: '#000'}}>Students Only</option>
                                    <option value="teachers" style={{color: '#000'}}>Teachers Only</option>
                                </select>
                            </div>

                            <button className="action-btn" onClick={handleCreateAnnouncement} style={{marginTop: '10px'}}>
                                <span className="action-icon"><i className="fas fa-paper-plane"></i></span>
                                Send Announcement
                            </button>
                        </div>

                        {/* List of Announcements */}
                        <h3 style={{marginBottom: '15px', color: '#fff'}}>Recent Announcements ({announcements.length})</h3>
                        {announcements.length === 0 ? (
                            <div style={{padding: '20px', textAlign: 'center', color: '#999'}}>
                                No announcements yet. Create one above!
                            </div>
                        ) : (
                            <div style={{display: 'grid', gap: '15px'}}>
                                {announcements.map((announcement) => (
                                    <div key={announcement.id} style={{backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '15px', border: '1px solid rgba(255, 255, 255, 0.1)'}}>
                                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '10px'}}>
                                            <div>
                                                <h4 style={{margin: '0 0 5px 0', color: '#fff'}}>{announcement.title}</h4>
                                                <p style={{margin: '0', fontSize: '12px', color: '#999'}}>
                                                    Sent to: <strong>{announcement.recipients || 'All Users'}</strong> • {announcement.created_at || new Date().toLocaleString()}
                                                </p>
                                            </div>
                                            <button 
                                                onClick={() => handleDeleteAnnouncement(announcement.id)}
                                                style={{padding: '5px 10px', backgroundColor: 'rgba(255, 59, 48, 0.2)', color: '#ff3b30', border: '1px solid rgba(255, 59, 48, 0.3)', borderRadius: '5px', cursor: 'pointer', fontSize: '12px'}}
                                            >
                                                <i className="fas fa-trash-alt"></i> Delete
                                            </button>
                                        </div>
                                        <p style={{margin: '0', color: '#ccc', lineHeight: '1.5'}}>{announcement.content}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : view === 'enrollment' ? (
                    /* COURSE ENROLLMENT/REGISTRATION VIEW */
                    <div className="activity-section">
                        <div className="section-header">
                            <h2>Student Course Registration</h2>
                            <button className="view-all-btn" onClick={() => setView('dashboard')}>Back to Dashboard</button>
                        </div>

                        {/* Enroll Student Form */}
                        <div style={{backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '10px', padding: '20px', marginBottom: '30px', border: '1px solid rgba(255, 255, 255, 0.1)'}}>
                            <h3 style={{marginBottom: '20px', color: '#fff'}}>Enroll Student in Course</h3>
                            
                            <div style={{marginBottom: '15px'}}>
                                <label style={{display: 'block', marginBottom: '5px', color: '#aaa', fontSize: '14px'}}>Select Student</label>
                                <select 
                                    value={selectedStudentForEnroll}
                                    onChange={(e) => setSelectedStudentForEnroll(e.target.value)}
                                    style={{width: '100%', padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '5px', color: '#fff'}}
                                >
                                    <option value="" style={{color: '#000'}}>-- Choose a Student --</option>
                                    {registeredStudents.map((student) => (
                                        <option key={student.student_id} value={student.student_id} style={{color: '#000'}}>
                                            {student.name} (ID: {student.student_id})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div style={{marginBottom: '15px'}}>
                                <label style={{display: 'block', marginBottom: '5px', color: '#aaa', fontSize: '14px'}}>Select Course</label>
                                <select 
                                    value={selectedCourseForEnroll}
                                    onChange={(e) => setSelectedCourseForEnroll(e.target.value)}
                                    style={{width: '100%', padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '5px', color: '#fff'}}
                                >
                                    <option value="" style={{color: '#000'}}>-- Choose a Course --</option>
                                    {availableCourses.map((course) => (
                                        <option key={course.course_id} value={course.course_id} style={{color: '#000'}}>
                                            {course.course_name} ({course.course_code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <button className="action-btn" onClick={handleEnrollStudentInCourse} style={{marginTop: '10px'}}>
                                <span className="action-icon"><i className="fas fa-check-circle"></i></span>
                                Enroll Student
                            </button>
                        </div>

                        {/* List of Current Enrollments */}
                        <h3 style={{marginBottom: '15px', color: '#fff'}}>Current Enrollments ({enrollments.length})</h3>
                        {enrollments.length === 0 ? (
                            <div style={{padding: '20px', textAlign: 'center', color: '#999'}}>
                                No enrollments yet. Enroll students above!
                            </div>
                        ) : (
                            <div style={{overflowX: 'auto'}}>
                                <table style={{width: '100%', borderCollapse: 'collapse', color: '#ccc'}}>
                                    <thead>
                                        <tr style={{borderBottom: '2px solid rgba(255, 255, 255, 0.2)', backgroundColor: 'rgba(255, 255, 255, 0.05)'}}>
                                            <th style={{padding: '12px', textAlign: 'left', color: '#aaa'}}>Student Name</th>
                                            <th style={{padding: '12px', textAlign: 'left', color: '#aaa'}}>Student ID</th>
                                            <th style={{padding: '12px', textAlign: 'left', color: '#aaa'}}>Course Name</th>
                                            <th style={{padding: '12px', textAlign: 'left', color: '#aaa'}}>Enrolled Date</th>
                                            <th style={{padding: '12px', textAlign: 'center', color: '#aaa'}}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {enrollments.map((enrollment) => (
                                            <tr key={enrollment.enrollment_id} style={{borderBottom: '1px solid rgba(255, 255, 255, 0.1)'}}>
                                                <td style={{padding: '12px'}}>{enrollment.student_name || 'N/A'}</td>
                                                <td style={{padding: '12px'}}>{enrollment.student_id || 'N/A'}</td>
                                                <td style={{padding: '12px'}}>{enrollment.course_name || 'N/A'}</td>
                                                <td style={{padding: '12px'}}>{enrollment.enrollment_date ? new Date(enrollment.enrollment_date).toLocaleDateString() : 'N/A'}</td>
                                                <td style={{padding: '12px', textAlign: 'center'}}>
                                                    <button 
                                                        onClick={() => handleRemoveEnrollment(enrollment.enrollment_id)}
                                                        style={{padding: '5px 10px', backgroundColor: 'rgba(255, 59, 48, 0.2)', color: '#ff3b30', border: '1px solid rgba(255, 59, 48, 0.3)', borderRadius: '5px', cursor: 'pointer', fontSize: '12px'}}
                                                    >
                                                        <i className="fas fa-times-circle"></i> Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                ) : view === 'profile' ? (
                    /* SEPARATE ADMIN PROFILE PAGE VIEW */
                    <div className="activity-section">
                        <div className="section-header">
                            <h2>Admin Profile Details</h2>
                            <button className="view-all-btn" onClick={() => setView('dashboard')}>Back to Dashboard</button>
                        </div>
                        <div className="profile-details-container" style={{padding: '20px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '10px', marginTop: '20px'}}>
                             <div style={{marginBottom: '20px'}}>
                                <h4 style={{color: '#6c757d', marginBottom: '5px'}}>Registration ID</h4>
                                <p style={{fontSize: '18px'}}>{adminData.id}</p>
                             </div>
                             <div style={{marginBottom: '20px'}}>
                                <h4 style={{color: '#6c757d', marginBottom: '5px'}}>Full Name</h4>
                                <p style={{fontSize: '18px'}}>{adminData.name}</p>
                             </div>
                             <div style={{marginBottom: '20px'}}>
                                <h4 style={{color: '#6c757d', marginBottom: '5px'}}>Email Address</h4>
                                <p style={{fontSize: '18px'}}>{adminData.email}</p>
                             </div>
                             <div style={{marginBottom: '20px'}}>
                                <h4 style={{color: '#6c757d', marginBottom: '5px'}}>System Role</h4>
                                <p style={{fontSize: '18px'}}>{adminData.role}</p>
                             </div>
                             <button className="action-btn" onClick={handleEditProfile}>
                                <span className="action-icon"><i className="fas fa-edit"></i></span>
                                Edit Profile Info
                             </button>
                        </div>
                    </div>
                ) : view === 'security' ? (
                    /* SECURITY LOGS VIEW */
                    <div className="activity-section">
                        <div className="section-header">
                            <h2>Security Logs</h2>
                            <button className="view-all-btn" onClick={() => setView('dashboard')}>Back to Dashboard</button>
                        </div>

                        <div style={{display: 'flex', gap: '12px', marginBottom: '18px', alignItems: 'center'}}>
                            <input placeholder="User" value={logsFilters.user} onChange={handleLogsFilterChange('user')} style={{padding: '8px'}} />
                            <select value={logsFilters.severity} onChange={handleLogsFilterChange('severity')} style={{padding: '8px'}}>
                                <option value="">All Severities</option>
                                <option value="info">Info</option>
                                <option value="warning">Warning</option>
                                <option value="critical">Critical</option>
                            </select>
                            <input placeholder="Search text" value={logsFilters.q} onChange={handleLogsFilterChange('q')} style={{padding: '8px', flex: 1}} />
                            <input type="date" value={logsFilters.start} onChange={handleLogsFilterChange('start')} />
                            <input type="date" value={logsFilters.end} onChange={handleLogsFilterChange('end')} />
                            <button className="action-btn" onClick={() => fetchSecurityLogs(1)} style={{padding: '8px 12px'}}>Apply</button>
                            <button className="action-btn" onClick={clearLogFilters} style={{padding: '8px 12px', backgroundColor: '#666'}}>Clear</button>
                        </div>

                        <table className="activity-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>User</th>
                                    <th>Action</th>
                                    <th>IP</th>
                                    <th>Severity</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {securityLogs.map((ev) => (
                                    <tr key={ev.id}>
                                        <td>{ev.event_time}</td>
                                        <td>{ev.username}</td>
                                        <td style={{maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis'}}>{ev.action}</td>
                                        <td>{ev.ip}</td>
                                        <td>{ev.severity}</td>
                                        <td>
                                            <button className="action-btn" onClick={() => fetchSecurityLogDetail(ev.id)}>View</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div style={{display: 'flex', justifyContent: 'space-between', marginTop: '12px', alignItems: 'center'}}>
                            <div>{logsTotal} events</div>
                            <div>
                                <button className="action-btn" onClick={() => { if (logsPage > 1) fetchSecurityLogs(logsPage - 1); }}>Prev</button>
                                <span style={{margin: '0 8px'}}>Page {logsPage}</span>
                                <button className="action-btn" onClick={() => { if ((logsPage * logsLimit) < logsTotal) fetchSecurityLogs(logsPage + 1); }}>Next</button>
                            </div>
                        </div>

                        {showSecurityDetail && securityDetail && (
                            <div style={{marginTop: '20px', background: 'rgba(255,255,255,0.04)', padding: '16px', borderRadius: '8px'}}>
                                <h3>Log Detail</h3>
                                <pre style={{whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto'}}>{JSON.stringify(securityDetail, null, 2)}</pre>
                                <button className="action-btn" onClick={() => setShowSecurityDetail(false)}>Close</button>
                            </div>
                        )}
                    </div>
                ) : view === 'userForm' ? (
                    /* USER FORM VIEW */
                    <UserForm onBackToDashboard={() => {
                        setView('dashboard');
                        // Refresh stats and users after adding new user
                        fetch('https://classmate-backend-eysi.onrender.com/api/admin/stats')
                            .then(r => r.json())
                            .then(statsDataResp => {
                                if (statsDataResp.success) setStatsData(statsDataResp.stats);
                            });
                        fetchAllUsersForTable();
                    }} />
                ) : view === 'courseForm' ? (
                    /* COURSE FORM VIEW */
                    <CourseForm onBackToDashboard={() => {
                        setView('dashboard');
                        // Refresh stats after adding new course
                        fetch('https://classmate-backend-eysi.onrender.com/api/admin/stats')
                            .then(r => r.json())
                            .then(statsDataResp => {
                                if (statsDataResp.success) setStatsData(statsDataResp.stats);
                            });
                    }} />
                ) : null }
            </div>
        </div>
    );
}

export default AdminDashboard;
