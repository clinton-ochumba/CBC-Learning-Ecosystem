/**
 * Student Computer Lab Portal
 * Optimized for computer lab sessions with time-limited access
 *
 * FIXES APPLIED:
 *   BUG-08: All three data-loading functions replaced with real API calls
 *   BUG-09: Session warning timer uses a ref to avoid stale closure bug
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, Book, FileText, Award, LogOut, AlertTriangle } from 'lucide-react';

const API_BASE_URL = import.meta?.env?.VITE_API_BASE_URL || 'http://localhost:5000';

interface StudentLabPortalProps {
  studentId: number;
  studentName: string;
  gradeLevel: string;
  sessionTimeMinutes?: number;
}

interface Assignment {
  id: number;
  title: string;
  subject: string;
  dueDate: string;
  status: string;
}

interface Grade {
  id: number;
  subject: string;
  assessment: string;
  grade: number;
  level: string;
}

interface Competency {
  name: string;
  level: number;
  maxLevel: number;
}

async function apiFetch<T>(path: string): Promise<T> {
  const token = localStorage.getItem('authToken');
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(path: string, body?: object): Promise<void> {
  const token = localStorage.getItem('authToken');
  await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const StudentLabPortal: React.FC<StudentLabPortalProps> = ({
  studentId,
  studentName,
  gradeLevel,
  sessionTimeMinutes = 30,
}) => {
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(
    sessionTimeMinutes * 60,
  );
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [recentGrades, setRecentGrades] = useState<Grade[]>([]);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sessionStartRef = useRef<Date>(new Date());

  // FIX BUG-09: Use a ref to track live remaining time so that the warning
  // setTimeout closure always reads the current value, not the stale initial value.
  const timeRemainingRef = useRef(sessionTimeMinutes * 60);

  const handleSessionTimeout = useCallback(() => {
    alert('Your computer lab session has ended. Please log out now.');
    window.location.href = '/logout';
  }, []);

  const logSessionEnd = useCallback(() => {
    const durationSeconds = Math.round(
      (Date.now() - sessionStartRef.current.getTime()) / 1000,
    );
    apiPost(`/api/v1/students/${studentId}/sessions/end`, {
      durationSeconds,
      endedAt: new Date().toISOString(),
    }).catch(() => {/* Non-fatal */});
  }, [studentId]);

  useEffect(() => {
    // Log session start via API
    apiPost(`/api/v1/students/${studentId}/sessions/start`, {
      startedAt: sessionStartRef.current.toISOString(),
    }).catch(() => {/* Non-fatal */});

    loadDashboardData();

    // Countdown timer — also keeps timeRemainingRef in sync (FIX BUG-09)
    const timer = setInterval(() => {
      setSessionTimeRemaining((prev) => {
        const next = prev - 1;
        timeRemainingRef.current = next; // Keep ref up-to-date
        if (next <= 0) {
          handleSessionTimeout();
          return 0;
        }
        return next;
      });
    }, 1000);

    // FIX BUG-09: Warning timeout reads from ref, not from stale closure.
    // Previously the closure captured the initial sessionTimeRemaining value,
    // so the condition `if (sessionTimeRemaining > 0)` was always true.
    const warningDelay = Math.max(0, (sessionTimeMinutes - 5) * 60 * 1000);
    const warningTimer = setTimeout(() => {
      if (timeRemainingRef.current > 0) {
        alert('Your session will end in 5 minutes. Please save your work.');
      }
    }, warningDelay);

    return () => {
      clearInterval(timer);
      clearTimeout(warningTimer);
      logSessionEnd();
    };
  }, [studentId, sessionTimeMinutes, handleSessionTimeout, logSessionEnd]);

  // ── FIX BUG-08: Real API calls replace all mock data ─────────────────────

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      await Promise.all([
        loadAssignments(),
        loadRecentGrades(),
        loadCompetencies(),
      ]);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      setLoadError('Failed to load your data. Please refresh or ask your teacher for help.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAssignments = async () => {
    // FIX BUG-08: Real API call — was hardcoded mock data
    const data = await apiFetch<{ assignments: Assignment[] }>(
      `/api/v1/students/${studentId}/assignments?status=pending&limit=10`,
    );
    setAssignments(data.assignments ?? []);
  };

  const loadRecentGrades = async () => {
    // FIX BUG-08: Real API call — was hardcoded mock data
    const data = await apiFetch<{ grades: Grade[] }>(
      `/api/v1/students/${studentId}/grades?limit=5&orderBy=date_desc`,
    );
    setRecentGrades(data.grades ?? []);
  };

  const loadCompetencies = async () => {
    // FIX BUG-08: Real API call — was hardcoded mock data
    const data = await apiFetch<{ competencies: Competency[] }>(
      `/api/v1/students/${studentId}/competencies`,
    );
    setCompetencies(data.competencies ?? []);
  };

  const handleLogout = () => {
    if (confirm('Are you sure you want to log out?')) {
      logSessionEnd();
      window.location.href = '/logout';
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimeColor = (): string => {
    if (sessionTimeRemaining > 600) return 'text-green-600';
    if (sessionTimeRemaining > 300) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <p className="text-gray-800 font-semibold mb-2">Could not load your data</p>
          <p className="text-gray-500 text-sm mb-4">{loadError}</p>
          <button
            onClick={loadDashboardData}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome, {studentName}!</h1>
            <p className="text-sm text-gray-600">{gradeLevel}</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg">
              <Clock className={`w-5 h-5 ${getTimeColor()}`} />
              <span className={`font-mono font-bold ${getTimeColor()}`}>
                {formatTime(sessionTimeRemaining)}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        </div>

        {sessionTimeRemaining <= 300 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <span className="text-sm text-amber-900">
              Your session is ending soon. Please save your work!
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Assignments */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-bold text-gray-900">Pending Assignments</h2>
            <span className="ml-auto text-sm text-gray-500">
              {assignments.length} pending
            </span>
          </div>

          <div className="space-y-3">
            {assignments.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500">No pending assignments — well done!</p>
              </div>
            ) : (
              assignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{assignment.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{assignment.subject}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Due: {new Date(assignment.dueDate).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-full">
                      {assignment.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="space-y-6">
          {/* Recent Grades */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center gap-2 mb-4">
              <Book className="w-6 h-6 text-blue-600" />
              <h2 className="text-lg font-bold text-gray-900">Recent Grades</h2>
            </div>

            {recentGrades.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No grades recorded yet</p>
            ) : (
              <div className="space-y-3">
                {recentGrades.map((grade) => (
                  <div key={grade.id} className="border-l-4 border-blue-500 pl-3">
                    <p className="font-semibold text-gray-900">{grade.subject}</p>
                    <p className="text-sm text-gray-600">{grade.assessment}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-2xl font-bold text-blue-600">{grade.grade}%</span>
                      <span className="text-xs text-gray-500">{grade.level}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CBC Competencies */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-6 h-6 text-green-600" />
              <h2 className="text-lg font-bold text-gray-900">CBC Competencies</h2>
            </div>

            {competencies.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No competency data yet</p>
            ) : (
              <div className="space-y-3">
                {competencies.map((comp, index) => (
                  <div key={index}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">{comp.name}</span>
                      <span className="text-xs text-gray-500">
                        {comp.level}/{comp.maxLevel}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${(comp.level / comp.maxLevel) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">💡 Computer Lab Tips:</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Save your work frequently</li>
          <li>• Download or screenshot important information before time runs out</li>
          <li>• Log out properly when finished — another student may need this computer</li>
          <li>• Ask the ICT teacher if you need help</li>
        </ul>
      </div>
    </div>
  );
};

export default StudentLabPortal;
