/**
 * Login Page — CBC Learning Ecosystem
 * Handles all user roles: super_admin / school_admin / teacher / parent / student
 */

import React, { useState } from 'react';
import { useAuthStore } from '../store/auth';

const NAVY  = '#1B3A6B';
const GOLD  = '#E8C840';
const TEAL  = '#028090';
const LGREY = '#F1F5F9';

const DEMO_ACCOUNTS = [
  { role: 'Admin',    email: 'admin@demo.cbclearning.co.ke',   hint: 'School dashboard + fee reports' },
  { role: 'Teacher',  email: 'teacher@demo.cbclearning.co.ke', hint: 'CBC competency tracking' },
  { role: 'Parent',   email: 'parent@demo.cbclearning.co.ke',  hint: 'M-Pesa fee payment' },
  { role: 'Student',  email: 'student@demo.cbclearning.co.ke', hint: 'Lab portal + offline access' },
];

export default function LoginPage() {
  const { login, isLoading, error, clearError } = useAuthStore();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    login(email, password);
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Demo@2026!');
    clearError();
  };

  return (
    <div style={{ minHeight: '100vh', background: NAVY, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>

      {/* Logo / branding */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 36, fontWeight: 900, color: GOLD, letterSpacing: 2 }}>CBC</div>
        <div style={{ fontSize: 18, color: '#CBD5E1', marginTop: 4 }}>Learning Ecosystem</div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>Kenya Competency-Based Curriculum</div>
      </div>

      {/* Login card */}
      <div style={{ background: '#fff', borderRadius: 12, padding: '32px 28px', width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <h2 style={{ margin: '0 0 24px', fontSize: 20, fontWeight: 700, color: NAVY }}>Sign in</h2>

        {error && (
          <div style={{ background: '#FEE2E2', color: '#DC2626', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Email address
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #D1D5DB', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              placeholder="your@school.ac.ke"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #D1D5DB', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{ width: '100%', padding: '12px', background: isLoading ? '#94A3B8' : NAVY, color: '#fff', border: 'none', borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer', letterSpacing: 0.5 }}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Demo quick-fill — shown in sandbox mode */}
        {import.meta.env.DEV || window.location.hostname.includes('vercel') || window.location.hostname.includes('railway') ? (
          <div style={{ marginTop: 28, borderTop: '1px solid #E5E7EB', paddingTop: 20 }}>
            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12, fontWeight: 600 }}>
              DEMO ACCOUNTS (password: Demo@2026!)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {DEMO_ACCOUNTS.map(({ role, email: demoEmail, hint }) => (
                <button
                  key={role}
                  onClick={() => fillDemo(demoEmail)}
                  title={hint}
                  style={{ padding: '8px 10px', background: LGREY, border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, fontWeight: 700, color: NAVY, cursor: 'pointer', textAlign: 'left' }}
                >
                  {role}
                  <span style={{ display: 'block', fontWeight: 400, color: '#64748B', fontSize: 10, marginTop: 2 }}>{hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* M-Pesa badge */}
      <div style={{ marginTop: 20, fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ background: '#00A550', color: '#fff', borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: 11 }}>M-PESA</span>
        Fee payments · ODPC compliant · CBC-native
      </div>
    </div>
  );
}
