import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './forgotPassword.css';

function ForgotPassword() {
    const navigate = useNavigate();
    
    // States for the flow
    const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState(''); // 'success' or 'error'
    const [timer, setTimer] = useState(0);
    const [userRole, setUserRole] = useState('');

    // Timer effect
    useEffect(() => {
        if (timer > 0 && step === 2) {
            const intervalId = setInterval(() => {
                setTimer(prevTimer => {
                    if (prevTimer <= 1) {
                        clearInterval(intervalId);
                        return 0;
                    }
                    return prevTimer - 1;
                });
            }, 1000);
            
            return () => clearInterval(intervalId);
        }
    }, [timer, step]);

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Step 1: Send OTP to email
    const handleSendOtp = async (e) => {
        e?.preventDefault();
        
        if (!email) {
            setMessageType('error');
            setMessage('Please enter your email');
            return;
        }
        
        if (!/\S+@\S+\.\S+/.test(email)) {
            setMessageType('error');
            setMessage('Please enter a valid email address');
            return;
        }
        
        setLoading(true);
        setMessage('');
        setMessageType('');
        
        try {
            const response = await fetch('https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/forgot-password/request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: email.toLowerCase().trim() })
            });
            
            const result = await response.json();
            
            
            if (response.ok) {
                setMessageType('success');
                setMessage(`OTP sent to ${email}`);
                setUserRole(result.role);
                setTimer(120); // 2 minutes
                setStep(2); // Move to OTP step
            } else {
                setMessageType('error');
                setMessage(result.error || 'Failed to send OTP');
            }
        } catch (error) {
            console.error('Error:', error);
            setMessageType('error');
            setMessage('Network error. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    // Handle OTP input
    const handleOtpChange = (index, value) => {
        if (value && !/^\d+$/.test(value)) return;
        
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);
        
        // Auto-submit when last digit entered
        if (value && index === 5) {
            const fullOtp = newOtp.join('');
            if (fullOtp.length === 6) {
                handleVerifyOtp();
            }
        }
    };

    // Step 2: Verify OTP
    const handleVerifyOtp = async () => {
        const fullOtp = otp.join('');
        if (fullOtp.length !== 6) {
            setMessageType('error');
            setMessage('Please enter all 6 digits');
            return;
        }
        
        setLoading(true);
        setMessage('Verifying OTP...');
        
        try {
            const response = await fetch('https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/forgot-password/verify-otp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: email.toLowerCase().trim(),
                    otp: fullOtp
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                setMessageType('success');
                setMessage('OTP verified! Enter your new password');
                setStep(3); // Move to password reset step
                setOtp(['', '', '', '', '', '']);
            } else {
                setMessageType('error');
                setMessage(`OTP verification failed: ${result.error}`);
                setOtp(['', '', '', '', '', '']);
            }
        } catch (error) {
            console.error('Verification error:', error);
            setMessageType('error');
            setMessage('Network error. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    // Step 3: Reset Password
    const handleResetPassword = async (e) => {
        e.preventDefault();
        
        if (!newPassword || !confirmPassword) {
            setMessageType('error');
            setMessage('Please enter and confirm your new password');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            setMessageType('error');
            setMessage('Passwords do not match');
            return;
        }
        
        // Validate password strength (same as signup)
        if (newPassword.length < 8) {
            setMessageType('error');
            setMessage('Password must be at least 8 characters');
            return;
        }
        
        if (!/[A-Z]/.test(newPassword)) {
            setMessageType('error');
            setMessage('Password must contain at least one uppercase letter');
            return;
        }
        
        if (!/[a-z]/.test(newPassword)) {
            setMessageType('error');
            setMessage('Password must contain at least one lowercase letter');
            return;
        }
        
        if (!/\d/.test(newPassword)) {
            setMessageType('error');
            setMessage('Password must contain at least one number');
            return;
        }
        
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
            setMessageType('error');
            setMessage('Password must contain at least one special character');
            return;
        }
        
        setLoading(true);
        setMessage('Resetting password...');
        
        try {
            const response = await fetch('https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/forgot-password/reset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: email.toLowerCase().trim(),
                    newPassword: newPassword,
                    confirmPassword: confirmPassword,
                    role: userRole
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                setMessageType('success');
                setMessage('Password reset successful! Redirecting to login...');
                
                setTimeout(() => {
                    navigate('/');
                }, 2000);
                
            } else {
                setMessageType('error');
                setMessage(`Password reset failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Reset error:', error);
            setMessageType('error');
            setMessage('Network error. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    // Resend OTP
    const handleResendOtp = async () => {
        if (loading || timer > 0) return;
        
        setLoading(true);
        setMessage('Sending new OTP...');
        
        try {
            const response = await fetch('https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app/api/forgot-password/resend-otp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: email.toLowerCase().trim() })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                setMessageType('success');
                setMessage('New OTP sent to your email!');
                setTimer(120);
                setOtp(['', '', '', '', '', '']);
            } else {
                setMessageType('error');
                setMessage(`Failed to resend OTP: ${result.error}`);
            }
        } catch (error) {
            console.error('Resend error:', error);
            setMessageType('error');
            setMessage('Network error. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const handleBackToLogin = () => {
        navigate('/');
    };

    const handleBack = () => {
        if (step === 2) {
            setStep(1);
            setOtp(['', '', '', '', '', '']);
            setMessage('');
        } else if (step === 3) {
            setStep(2);
            setNewPassword('');
            setConfirmPassword('');
            setMessage('');
        }
    };

    return (
        <div className="forgot-container">
            <h2>ClassMate</h2>
            <p>Virtual Classroom and Meeting Platform</p>

            <div className="forgot-box">
                <h3>Reset Your Password</h3>
                
                {/* Progress indicator */}
                <div className="progress-steps">
                    <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
                        <div className="step-circle">1</div>
                        <div className="step-label">Enter Email</div>
                    </div>
                    <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
                        <div className="step-circle">2</div>
                        <div className="step-label">Verify OTP</div>
                    </div>
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>
                        <div className="step-circle">3</div>
                        <div className="step-label">New Password</div>
                    </div>
                </div>
                
                <form className="forgot-form" onSubmit={
                    step === 1 ? handleSendOtp : 
                    step === 2 ? (e) => { e.preventDefault(); handleVerifyOtp(); } :
                    handleResetPassword
                }>
                    
                    {/* Step 1: Email Input */}
                    {step === 1 && (
                        <>
                            <p>Enter your registered email to reset password</p>
                            
                            <label htmlFor="email">Email:</label>
                            <input
                                type="email"
                                id="email"
                                placeholder="Enter your registered email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={loading}
                                required
                            />
                            
                            <button 
                                type="submit" 
                                className="reset-btn"
                                disabled={loading}
                            >
                                {loading ? 'Sending OTP...' : 'Send OTP'}
                            </button>
                        </>
                    )}
                    
                    {/* Step 2: OTP Verification */}
                    {step === 2 && (
                        <>
                            <div className="email-display">
                                <p>OTP sent to:</p>
                                <p className="email-text">{email}</p>
                            </div>
                            
                            <div className="otp-section">
                                <p>Enter 6-digit OTP:</p>
                                <div className="otp-boxes">
                                    {[0, 1, 2, 3, 4, 5].map((index) => (
                                        <input
                                            key={index}
                                            type="text"
                                            maxLength="1"
                                            className="otp-input"
                                            value={otp[index]}
                                            onChange={(e) => handleOtpChange(index, e.target.value)}
                                            disabled={loading}
                                        />
                                    ))}
                                </div>
                                
                                <div className="timer">
                                    <p>OTP expires in: <span className="timer-count">{formatTime(timer)}</span></p>
                                </div>
                            </div>
                            
                            <div className="forgot-buttons">
                                <button 
                                    type="button"
                                    onClick={handleResendOtp}
                                    className="resend-btn"
                                    disabled={loading || timer > 0}
                                >
                                    {loading ? 'Sending...' : 'Resend OTP'}
                                </button>
                                
                                <button 
                                    type="submit"
                                    className="verify-btn"
                                    disabled={loading || otp.join('').length !== 6}
                                >
                                    {loading ? 'Verifying...' : 'Verify OTP'}
                                </button>
                            </div>
                        </>
                    )}
                    
                    {/* Step 3: New Password */}
                    {step === 3 && (
                        <>
                            <p>Enter your new password</p>
                            
                            <div className="password-fields">
                                <label htmlFor="newPassword">New Password:</label>
                                <input
                                    type="password"
                                    id="newPassword"
                                    placeholder="Enter new password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    disabled={loading}
                                    required
                                />
                                
                                <label htmlFor="confirmPassword">Confirm Password:</label>
                                <input
                                    type="password"
                                    id="confirmPassword"
                                    placeholder="Confirm new password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    disabled={loading}
                                    required
                                />
                            </div>
                            
                            <button 
                                type="submit" 
                                className="reset-btn"
                                disabled={loading}
                            >
                                {loading ? 'Resetting Password...' : 'Reset Password'}
                            </button>
                        </>
                    )}
                    
                    {/* Message display */}
                    {message && (
                        <div className={`message ${messageType}`}>
                            {message}
                        </div>
                    )}
                </form>
                
                <div className="forgot-links">
                    {step > 1 && (
                        <a href="#" onClick={handleBack} style={{marginRight: '15px'}}>
                            ← Back
                        </a>
                    )}
                    <a href="#" onClick={handleBackToLogin}>
                        Back to Login →
                    </a>
                </div>
            </div>
        </div>
    );
}

export default ForgotPassword;
