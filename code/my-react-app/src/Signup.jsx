import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

function Signup() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!role) {
            setError('Please select a role');
            alert('Please select a role');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            alert(error);
            return;
        }

        setLoading(true);

        // Prepare data for API
        const signupData = {
            fullName: name,
            email: email.toLowerCase().trim(),
            role: role.toLowerCase(),
            password: password,
            confirmPassword: confirmPassword
        };

        console.log('Sending signup data to API:', signupData);

        try {
            // Send signup request to Flask API
            const response = await fetch('https://classmate-backend-eysi.onrender.com/api/signup/student/request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(signupData)
            });

            const result = await response.json();
            console.log('API Response:', result);

            if (response.ok) {
                 navigate('/otpVerify', { 
                    state: { 
                        email: signupData.email,
                        name: signupData.fullName,
                        role: signupData.role,
                        password: password
                    }
                });
            } else {
                setError(result.error || 'Signup failed');
                alert(`Error: ${result.error || 'Signup failed'}`);
            }
        } catch (error) {
            console.error('API Error:', error);
            setError('Network error. Please check your connection.');
            alert('Network error. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const handleBackToLogin = (e) => {
        e.preventDefault();
        navigate('/');
    };

    return (
        <div className="login-container">
            <h2>ClassMate</h2>
            <p>Virtual Classroom and Meeting Platform</p>

            <div className="form-box">
                <h3>Create Account</h3>
                <p>Join our educational platform</p>

                <form className="login-form" onSubmit={handleSubmit}>
                    <label htmlFor="name">Full Name:</label>
                    <input
                        type="text"
                        id="name"
                        name="name"
                        placeholder="Enter your full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />

                    <label htmlFor="email">Email:</label>
                    <input
                        type='email'
                        id="email"
                        name="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />

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
                                    onChange={(e) => setRole(e.target.value)}
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
                                    onChange={(e) => setRole(e.target.value)}
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
                                    onChange={(e) => setRole(e.target.value)}
                                />
                                <span className="role-box">Student</span>
                            </label>
                        </div>
                    </div>    

                    <label htmlFor="password">Password:</label>
                    <input
                        type='password'
                        id="password"
                        name="password"
                        placeholder="Create a password"
                        minLength="8"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />

                    <label htmlFor="confirm-password">Confirm Password:</label>
                    <input
                        type='password'
                        id="confirm-password"
                        name="confirm-password"
                        placeholder="Re-write a password"
                        minLength="8"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                    />

                    {loading && <p style={{color: 'blue'}}>Sending data to server...</p>}

                    <button type="submit" className="submit-btn" disabled={loading}>Create Account</button>
                </form>

                <div className="form-links">
                    <a href="#" onClick={handleBackToLogin}>Already have an account? Login</a>
                </div>
            </div>
        </div>
    );
}

export default Signup;
