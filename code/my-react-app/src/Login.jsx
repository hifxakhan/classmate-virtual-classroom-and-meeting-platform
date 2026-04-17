import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';


function Login() {
    const navigate = useNavigate();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [role, setRole] = useState('');
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);

    const handleEmailChange = (e) => {
        setEmail(e.target.value);
        if (errors.email) {
            setErrors({ ...errors, email: '' });
        }
    };

    const handlePasswordChange = (e) => {
        setPassword(e.target.value);
        if (errors.password) {
            setErrors({ ...errors, password: '' });
        }
    };

    const validatePassword = (password) => {
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*]/.test(password);
        return password.length >= 8 && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
    };

    const handlePasswordBlur = () => {
        if (password && !validatePassword(password)) {
            setErrors({ ...errors, password: 'Password must be 8+ chars with uppercase, lowercase, numbers, and special char' });
        }
    };

    const togglePasswordVisibility = () => {
        setShowPassword(!showPassword);
    };

    const handleRoleChange = (e) => {
        setRole(e.target.value);
        if (errors.role) {
            setErrors({ ...errors, role: '' });
        }
    };

    const handleForgotPassword = (e) => {
        e.preventDefault();
        navigate('/forgotPassword');
    };

    const handleCreateAccount = (e) => {
        e.preventDefault();
        navigate('/signup');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const newErrors = {};
        const cleanEmail = email.trim().toLowerCase();
        const actualPassword = password;

        // Email validation
        if (!cleanEmail) {
            newErrors.email = 'Email is required';
        } else if (!/\S+@\S+\.\S+/.test(cleanEmail)) {
            newErrors.email = 'Please enter a valid email address';
        }

        // Password validation
        if (!actualPassword) {
            newErrors.password = 'Password is required';
        } else if (!validatePassword(actualPassword)) {
            newErrors.password = 'Password must be 8+ chars with uppercase, lowercase, numbers, and special char';
        }

        // Role validation
        if (!role) {
            newErrors.role = 'Please select a role';
        }

        setErrors(newErrors);

        if (Object.keys(newErrors).length === 0) {
            setLoading(true);

            try {
                const loginData = {
                    email: cleanEmail,
                    password: actualPassword,
                    role: role.toLowerCase()
                };

                console.log('Sending login request:', {
                    email: cleanEmail,
                    role: role.toLowerCase()
                });

                const response = await fetch('https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(loginData)
                });

                const result = await response.json();
                console.log('Login response:', result);

                if (response.ok) {
                    alert(`Login successful! Welcome ${result.user.name}`);
                    localStorage.setItem('user', JSON.stringify(result.user));
                    localStorage.setItem('token', result.token);

                    // Navigate to dashboard based on role
                    if (role.toLowerCase() === 'admin') {
                        navigate('/adminDashboard');
                    } else if (role.toLowerCase() === 'teacher') {
                        // FIX: Use result.user instead of data
                        localStorage.setItem('teacherEmail', email);
                        localStorage.setItem('teacherName', result.user.name || 'Teacher'); // Changed from data.name
                        localStorage.setItem('teacherToken', 'authenticated');
                        localStorage.setItem('isTeacherAuthenticated', 'true');

                        localStorage.setItem('teacherId', result.user.id || result.user.teacher_id);

                        console.log('✅ Teacher logged in. Email stored:', email);
                        navigate('/teacherDashboard');
                    } else {
                        // For student login
                        localStorage.setItem('studentEmail', email);
                        localStorage.setItem('studentName', result.user.name || 'Student');
                        localStorage.setItem('studentToken', 'authenticated');
                        localStorage.setItem('studentId', result.user.student_id || result.user.id || '');

                        console.log('✅ Student logged in. Email stored:', email);
                        navigate('/studentDashboard');
                    }

                } else {
                    setErrors({
                        general: result.error || 'Login failed'
                    });
                    alert(`Login failed: ${result.error}`);
                }
            } catch (error) {
                console.error('Login error:', error);
                setErrors({
                    general: 'Network error. Please check your connection.'
                });
                alert('Network error. Please check your connection.');
            } finally {
                setLoading(false);
            }
        }
    };

    return (
        <div className="login-container">
            <h2>ClassMate</h2>
            <p>Virtual Classroom and Meeting Platform</p>

            <div className="form-box">
                <h3>Welcome Back</h3>
                <p>Sign in to continue to your educational platform</p>

                <form className="login-form" onSubmit={handleSubmit}>
                    {/* Email field */}
                    <label htmlFor="email">Email:</label>
                    <input
                        type='email'
                        id="email"
                        name="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={handleEmailChange}
                        maxLength='100'
                        required
                    />
                    {errors.email && <span className="error-message">{errors.email}</span>}

                    {/* Password field */}
                    <label htmlFor="password">Password:</label>
                    <div className="password-container">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            id="password"
                            name="password"
                            placeholder="Enter your password"
                            minLength="8"
                            maxLength='50'
                            value={password}
                            onChange={handlePasswordChange}
                            onBlur={handlePasswordBlur}
                            required
                        />
                        <span
                            className="eye-overlay"
                            onClick={togglePasswordVisibility}
                            title={showPassword ? 'Hide password' : 'Show password'}
                        ></span>
                    </div>
                    {errors.password && <span className="error-message">{errors.password}</span>}

                    {/* Role selection */}
                    <div className="role-section">
                        <p>Select your Role:</p>
                        <div className="role-container">
                            <label className="role-option">
                                <input
                                    type='radio'
                                    name="role"
                                    value="Admin"
                                    className="role-input"
                                    checked={role === 'Admin'}
                                    onChange={handleRoleChange}
                                />
                                <span className="role-box">Admin</span>
                            </label>

                            <label className="role-option">
                                <input
                                    type='radio'
                                    name="role"
                                    value="Teacher"
                                    className="role-input"
                                    checked={role === 'Teacher'}
                                    onChange={handleRoleChange}
                                />
                                <span className="role-box">Teacher</span>
                            </label>

                            <label className="role-option">
                                <input
                                    type='radio'
                                    name="role"
                                    value="Student"
                                    className="role-input"
                                    checked={role === 'Student'}
                                    onChange={handleRoleChange}
                                />
                                <span className="role-box">Student</span>
                            </label>
                        </div>
                        {errors.role && <span className="error-message">{errors.role}</span>}
                    </div>

                    {/* Submit button */}
                    <button type="submit" className="submit-btn" disabled={loading}>Login to ClassMate</button>
                </form>

                {loading ? 'Logging in...' : ''}

                {/* Links */}
                <div className="form-links">
                    <a href="#" onClick={handleForgotPassword}>Forgot Password?</a>
                    <a href="#" onClick={handleCreateAccount}>Create Account</a>
                </div>
            </div>
        </div>
    );
}

export default Login;
