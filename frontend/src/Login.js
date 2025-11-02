import { useState } from 'react';
import axios from 'axios';

function Login({ onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (isRegistering) {
      // Registration validation
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters long');
        setLoading(false);
        return;
      }
    }

    try {
      const endpoint = isRegistering ? '/api/register' : '/api/login';
      const payload = isRegistering 
        ? { email, password, fullName }
        : { email, password };

      const response = await axios.post(endpoint, payload, {
        withCredentials: true
      });

      if (response.data.success) {
        if (isRegistering) {
          setSuccess('Registration successful! You can now log in.');
          setIsRegistering(false);
          setPassword('');
          setConfirmPassword('');
          setFullName('');
        } else {
          // Login successful, call onLogin with user data
          console.log('Login successful, user data:', response.data.user);
          onLogin(response.data.user);
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || `${isRegistering ? 'Registration' : 'Login'} failed`);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegistering(!isRegistering);
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
    setFullName('');
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>🎙️ Voice Transcription App</h1>
          <p>{isRegistering ? 'Create your account' : 'Please log in to continue'}</p>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          {isRegistering && (
            <div className="form-group">
              <label htmlFor="fullName">Full Name:</label>
              <input
                type="text"
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                required
              />
            </div>
          )}
          
          <div className="form-group">
            <label htmlFor="email">Email:</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password:</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegistering ? "At least 6 characters" : "Enter password"}
              required
            />
          </div>

          {isRegistering && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password:</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
              />
            </div>
          )}
          
          {error && (
            <div className="error">
              {error}
            </div>
          )}

          {success && (
            <div className="success">
              {success}
            </div>
          )}
          
          <button 
            type="submit" 
            className="login-button"
            disabled={loading}
          >
            {loading 
              ? (isRegistering ? 'Creating Account...' : 'Logging in...') 
              : (isRegistering ? 'Create Account' : 'Login')
            }
          </button>
        </form>

        <div className="auth-toggle">
          <p>
            {isRegistering ? 'Already have an account?' : "Don't have an account?"}
            <button 
              type="button" 
              className="toggle-button" 
              onClick={toggleMode}
              disabled={loading}
            >
              {isRegistering ? 'Login' : 'Sign Up'}
            </button>
          </p>
        </div>

        <div className="login-footer">
          <p>&copy; 2024 Voice Transcription App. All rights reserved.</p>
          <p>Contact: <a href="mailto:ponrawat@neuralnet.co.th">ponrawat@neuralnet.co.th</a></p>
        </div>
      </div>
    </div>
  );
}

export default Login;