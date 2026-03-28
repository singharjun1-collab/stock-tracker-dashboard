'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import './globals.css';

export default function LoginPage() {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const inputRefs = useRef([]);
  const router = useRouter();

  // Check if already authenticated
  useEffect(() => {
    fetch('/api/alerts')
      .then(res => {
        if (res.ok) {
          router.replace('/dashboard');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  const handleChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    setError('');

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setPin(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleSubmit = async () => {
    const pinStr = pin.join('');
    if (pinStr.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinStr }),
      });

      if (res.ok) {
        router.push('/dashboard');
      } else {
        setError('Incorrect PIN. Please try again.');
        setPin(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="login-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-lock-icon">&#x1f512;</div>
        <h1>Stock <span>Intelligence</span></h1>
        <p className="login-subtitle">Enter your 6-digit PIN to access the dashboard</p>

        <div className="pin-input-row" onPaste={handlePaste}>
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={el => inputRefs.current[i] = el}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="pin-digit"
              autoFocus={i === 0}
            />
          ))}
        </div>

        <button
          className="login-btn"
          onClick={handleSubmit}
          disabled={loading || pin.join('').length !== 6}
        >
          {loading ? 'Verifying...' : 'Unlock Dashboard'}
        </button>

        <p className="login-error">{error}</p>
      </div>
    </div>
  );
}
