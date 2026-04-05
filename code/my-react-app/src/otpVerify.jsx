import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './otpVerify.css';

function OtpVerify() {
    const navigate = useNavigate();
    const location = useLocation();
    
    const userEmail = location.state?.email || 'user@example.com';
    
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState(''); 
    const [timer, setTimer] = useState(120); 

    useEffect(() => {
        if (timer > 0) {
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
    }, [timer]);

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleOtpChange = (index, value) => {
        if (value && !/^\d+$/.test(value)) return;
        
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);
    };

    const handleVerifyOtp = async () => {
        const fullOtp = otp.join('');
        if (fullOtp.length !== 6) {
            setMessageType('error');
            setMessage('Please enter all 6 digits');
            return;
        }
        
        setLoading(true);
        setMessage('Verifying OTP...');
        
        try 
        {
        const verifyResponse = await fetch('https://classmate-backend-eysi.onrender.com/api/signup/verify-otp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: userEmail,
                otp: fullOtp
            })
        });
        
        const verifyResult = await verifyResponse.json();
        
        if (!verifyResponse.ok) {
            setLoading(false);
            setMessageType('error');
            setMessage(`OTP verification failed: ${verifyResult.error || 'Invalid OTP'}`);
            setOtp(['', '', '', '', '', '']); 
            return;
        }
        
        setMessage('OTP verified! Completing registration...');
        
        const userData = {
            email: userEmail,
            role: location.state?.role || 'student',
            fullName: location.state?.name || '',
            password: location.state?.password || ''
        };
        
        const completeResponse = await fetch('https://classmate-backend-eysi.onrender.com/api/signup/complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userData)
        });
        
        const completeResult = await completeResponse.json();
        
        if (completeResponse.ok) {
            setMessageType('success');
            setMessage('Registration completed successfully! Redirecting to login...');
            
            // Wait 2 seconds then go to login
            setTimeout(() => {
                navigate('/');
            }, 2000);
            
        } else {
            setMessageType('error');
            setMessage(`Registration failed: ${completeResult.error || 'Unknown error'}`);
        }
        
    } catch (error) {
        console.error('Verification error:', error);
        setMessageType('error');
        setMessage('Network error. Please check your connection.');
    } finally {
        setLoading(false);
    }};

    const handleSendAgain = async () => {
    if (loading || timer > 0) return;
    
    setLoading(true);
    setMessage('Sending new OTP...');
    setMessageType('');
    
    try {
        // Send request to resend OTP
        const response = await fetch('https://classmate-backend-eysi.onrender.com/api/signup/resend-otp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                email: userEmail,
                name: location.state?.name || '',
                role: location.state?.role || 'student'
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            setMessageType('success');
            setMessage('New OTP sent to your email!');
            setTimer(120);
            setOtp(['', '', '', '', '', '']);
            
            setTimeout(() => {
                const firstInput = document.querySelector('.otp-input');
                if (firstInput) firstInput.focus();
            }, 100);
            
        } else {
            setMessageType('error');
            setMessage(`${result.error || 'Failed to resend OTP'}`);
        }
        
    } catch (error) {
        console.error('Resend OTP error:', error);
        setMessageType('error');
        setMessage('Network error. Please check your connection.');
    } finally {
        setLoading(false);
    }
};

    const handleBackToSignup = () => {
        navigate('/signup');
    };

    const handleBackToLogin = () => {
        navigate('/');
    };

    return (
        <div className="login-container">
            <h2>ClassMate</h2>
            <p>Virtual Classroom and Meeting Platform</p>

            <div className="form-box">
                <h3>Verify Your Email</h3>
                
                <div className="email-display">
                    <p>OTP sent to:</p>
                    <p className="email-text">{userEmail}</p>
                    <p className="change-email-link">
                        <a href="#" onClick={handleBackToSignup}>
                            Not your email? Go back to signup
                        </a>
                    </p>
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
                
                {message && (
                    <div className={`message ${messageType}`}>
                        {message}
                    </div>
                )}
                
                <div className="otp-buttons">
                    <button 
                        onClick={handleSendAgain}
                        className="send-again-btn"
                        disabled={loading || timer > 0}
                    >
                        {loading ? 'Sending...' : 'Send Again'}
                    </button>
                    
                    <button 
                        onClick={handleVerifyOtp}
                        className="verify-btn"
                        disabled={loading || otp.join('').length !== 6}
                    >
                        {loading ? 'Verifying...' : 'Verify OTP'}
                    </button>
                </div>
                
                <div className="form-links">
                    <a href="#" onClick={handleBackToLogin}>
                        ← Back to Login
                    </a>
                </div>
            </div>
        </div>
    );
}

export default OtpVerify;
