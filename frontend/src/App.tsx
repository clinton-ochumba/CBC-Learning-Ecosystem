/**
 * App — CBC Learning Ecosystem
 *
 * Role-based routing:
 *   /login                → LoginPage (public)
 *   /admin/*              → SchoolAdmin dashboard
 *   /teacher/*            → TeacherClassroomPortal
 *   /parent/*             → Parent portal + M-Pesa payment
 *   /student/*            → StudentLabPortal
 *
 * All authenticated routes require a valid JWT (via AuthStore).
 * The offline banner is global and appears above all routes.
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import LoginPage from './components/LoginPage';

// ── Lazy imports (code-split per role — smaller initial bundle) ────────────────
const TeacherClassroomPortal = React.lazy(
  () => import('./components/TeacherClassroomPortal'),
);
const StudentLabPortal = React.lazy(
  () => import('./components/StudentLabPortal'),
);
const MpesaPayment = React.lazy(
  () => import('./components/MpesaPayment'),
);

// ── Loading spinner ────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ fontSize: 14, color: '#64748B' }}>Loading…</div>
    </div>
  );
}

// ── Offline banner ─────────────────────────────────────────────────────────────
function OfflineBanner({ isOnline }: { isOnline: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setVisible(true);
    } else {
      // Keep "back online" message briefly visible
      const handler = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(handler);
    }
  }, [isOnline]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: isOnline ? '#D1FAE5' : '#FEF3C7',
      color:      isOnline ? '#065F46' : '#92400E',
      textAlign: 'center', fontSize: 13, fontWeight: 600, padding: '8px 16px',
    }}>
      {isOnline
        ? '✅ Back online — syncing changes…'
        : '📶 You\'re offline. Changes will sync when connection is restored.'}
    </div>
  );
}

// ── Protected route wrapper ────────────────────────────────────────────────────
function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />;

  return <>{children}</>;
}

// ── Role-based home redirect ───────────────────────────────────────────────────
function HomeRedirect() {
  const { user, isAuthenticated } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  switch (user?.role) {
  case 'super_admin':
  case 'school_admin': return <Navigate to="/admin"   replace />;
  case 'teacher':      return <Navigate to="/teacher" replace />;
  case 'parent':       return <Navigate to="/parent"  replace />;
  case 'student':      return <Navigate to="/student" replace />;
  default:             return <Navigate to="/login"   replace />;
  }
}

// ── Admin dashboard placeholder (expand with full admin UI) ───────────────────
function AdminDashboard() {
  const { user, logout } = useAuthStore();
  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, color: '#1B3A6B' }}>School Admin Dashboard</h1>
        <button onClick={logout} style={{ padding: '8px 16px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 6, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
      <p style={{ color: '#64748B' }}>Welcome, {user?.firstName}. School dashboard coming — teacher and parent portals are live.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 24 }}>
        {[
          { label: 'Total Students', value: '520', color: '#1B3A6B' },
          { label: 'Active Teachers', value: '34', color: '#028090' },
          { label: 'Fee Collection', value: '87%', color: '#02C39A' },
          { label: 'CBC Compliance', value: '94%', color: '#E8C840' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Parent portal placeholder ──────────────────────────────────────────────────
function ParentPortal() {
  const { user, logout } = useAuthStore();
  return (
    <div style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0, color: '#1B3A6B' }}>Parent Portal</h2>
        <button onClick={logout} style={{ padding: '6px 12px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 6, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
      <p style={{ color: '#64748B', marginBottom: 24 }}>Welcome, {user?.firstName}.</p>
      <React.Suspense fallback={<Spinner />}>
        <MpesaPayment
          student={{
            id: 90100,
            firstName: 'Brian',
            lastName: 'Mwangi',
            admissionNumber: 'ADM-90100',
            gradeLevel: 'Grade 7',
            feeBalance: 15000,
            school: { name: 'Demo School', code: 'DEM-001' },
          }}
          onPaymentComplete={(receipt, amount) => console.warn('Payment result:', receipt, amount)}
          onSuccess={(receipt, amount) => console.warn('Payment succeeded:', receipt, amount)}
          onError={(err) => console.error('Payment error:', err)}
        />
      </React.Suspense>
    </div>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  const isOnline = useOnlineStatus();

  return (
    <BrowserRouter>
      <OfflineBanner isOnline={isOnline} />
      <React.Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login"   element={<LoginPage />} />
          <Route path="/"        element={<HomeRedirect />} />

          <Route path="/admin/*" element={
            <ProtectedRoute roles={['school_admin', 'super_admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          } />

          <Route path="/teacher/*" element={
            <ProtectedRoute roles={['teacher']}>
              <TeacherClassroomPortal />
            </ProtectedRoute>
          } />

          <Route path="/parent/*" element={
            <ProtectedRoute roles={['parent']}>
              <ParentPortal />
            </ProtectedRoute>
          } />

          <Route path="/student/*" element={
            <ProtectedRoute roles={['student']}>
              <StudentLabPortal
                studentId={90100}
                studentName="Brian Mwangi"
                gradeLevel="Grade 8"
                sessionTimeMinutes={45}
              />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </React.Suspense>
    </BrowserRouter>
  );
}
