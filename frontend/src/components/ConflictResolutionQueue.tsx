/**
 * ConflictResolutionQueue Component
 * NEW — FIX GAP-04: Provides teachers with a UI to review and resolve offline sync conflicts.
 *
 * When teachers edit data offline (e.g. grades, attendance) and sync fails due to
 * conflicting concurrent edits, this queue surfaces those conflicts for manual resolution.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, GitMerge, ChevronDown, ChevronUp } from 'lucide-react';

type RequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
};

const API_BASE_URL = import.meta?.env?.VITE_API_BASE_URL || 'http://localhost:5000';

type ResolutionWinner = 'local' | 'server' | 'merged';

interface SyncConflict {
  id: string;
  entity_type: 'student' | 'assessment' | 'attendance' | 'class';
  entity_id: string;
  local_version: Record<string, unknown>;
  server_version: Record<string, unknown>;
  resolution_strategy: 'last_write_wins' | 'field_merge' | 'manual';
  resolved: boolean;
  created_at: string;
}

interface ConflictResolutionQueueProps {
  onResolved?: (conflictId: string) => void;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('authToken');
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

const ENTITY_LABELS: Record<string, string> = {
  student: 'Student Record',
  assessment: 'Assessment Grade',
  attendance: 'Attendance Record',
  class: 'Class Data',
};

function ValueDisplay({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between py-1 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-xs text-gray-900 font-semibold text-right max-w-[60%] break-words">
        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
      </span>
    </div>
  );
}

function VersionPanel({
  title,
  data,
  highlight,
}: {
  title: string;
  data: Record<string, any>;
  highlight: 'blue' | 'green';
}) {
  const color = highlight === 'blue' ? 'border-blue-300 bg-blue-50' : 'border-green-300 bg-green-50';
  const headerColor = highlight === 'blue' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';

  return (
    <div className={`flex-1 border rounded-lg overflow-hidden ${color}`}>
      <div className={`px-3 py-2 text-xs font-bold uppercase tracking-wide ${headerColor}`}>
        {title}
      </div>
      <div className="p-3 space-y-1">
        {Object.entries(data).map(([k, v]) => (
          <ValueDisplay key={k} label={k} value={v} />
        ))}
      </div>
    </div>
  );
}

export const ConflictResolutionQueue: React.FC<ConflictResolutionQueueProps> = ({
  onResolved,
}) => {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [mergedData, setMergedData] = useState<Record<string, Record<string, string>>>({});

  const loadConflicts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{ conflicts: SyncConflict[] }>(
        '/api/v1/sync/conflicts?status=unresolved&limit=50',
      );
      setConflicts(data.conflicts ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load conflicts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConflicts();
  }, [loadConflicts]);

  const resolveConflict = async (
    conflict: SyncConflict,
    winner: ResolutionWinner,
  ) => {
    setResolving((prev) => new Set(prev).add(conflict.id));

    try {
      const body: Record<string, any> = { winner };
      if (winner === 'merged') {
        body.merged_data = mergedData[conflict.id] ?? {};
      }

      await apiFetch(`/api/v1/sync/conflicts/${conflict.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setConflicts((prev) => prev.filter((c) => c.id !== conflict.id));
      onResolved?.(conflict.id);
    } catch (err: any) {
      setError(`Failed to resolve conflict: ${err.message}`);
    } finally {
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(conflict.id);
        return next;
      });
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const updateMergedField = (conflictId: string, field: string, value: string) => {
    setMergedData((prev) => ({
      ...prev,
      [conflictId]: { ...(prev[conflictId] ?? {}), [field]: value },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-6 h-6 animate-spin text-purple-600 mr-3" />
        <span className="text-gray-600">Loading sync conflicts…</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Sync Conflict Queue
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {conflicts.length} unresolved conflict{conflicts.length !== 1 ? 's' : ''} require your attention
          </p>
        </div>
        <button
          onClick={loadConflicts}
          className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {conflicts.length === 0 && !error ? (
        <div className="text-center py-16">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <p className="font-semibold text-gray-800">All caught up!</p>
          <p className="text-sm text-gray-500 mt-1">No pending sync conflicts</p>
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.map((conflict) => {
            const isExpanded = expanded.has(conflict.id);
            const isResolving = resolving.has(conflict.id);
            const allFields = new Set([
              ...Object.keys(conflict.local_version),
              ...Object.keys(conflict.server_version),
            ]);

            return (
              <div
                key={conflict.id}
                className="border border-amber-200 rounded-xl overflow-hidden bg-white shadow-sm"
              >
                {/* Conflict Header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => toggleExpand(conflict.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">
                        {ENTITY_LABELS[conflict.entity_type] ?? conflict.entity_type} #{conflict.entity_id}
                      </p>
                      <p className="text-xs text-gray-500">
                        Detected {new Date(conflict.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    {/* Side-by-side comparison */}
                    <div className="flex gap-3 mt-4">
                      <VersionPanel
                        title="Your version (local)"
                        data={conflict.local_version}
                        highlight="blue"
                      />
                      <VersionPanel
                        title="Server version"
                        data={conflict.server_version}
                        highlight="green"
                      />
                    </div>

                    {/* Merge editor (show conflicting fields) */}
                    {conflict.resolution_strategy === 'manual' && (
                      <div className="mt-4">
                        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                          <GitMerge className="w-3 h-3" /> Custom Merge (edit values below)
                        </p>
                        <div className="space-y-2">
                          {Array.from(allFields).map((field) => {
                            const localVal = conflict.local_version[field];
                            const serverVal = conflict.server_version[field];
                            if (localVal === serverVal) return null;
                            return (
                              <div key={field} className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 w-24 flex-shrink-0">{field}</span>
                                <input
                                  type="text"
                                  defaultValue={String(localVal ?? serverVal ?? '')}
                                  onChange={(e) =>
                                    updateMergedField(conflict.id, field, e.target.value)
                                  }
                                  className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-purple-400"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Resolution buttons */}
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => resolveConflict(conflict, 'local')}
                        disabled={isResolving}
                        className="flex-1 py-2 text-xs font-semibold border-2 border-blue-400 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                      >
                        Keep Mine
                      </button>
                      <button
                        onClick={() => resolveConflict(conflict, 'server')}
                        disabled={isResolving}
                        className="flex-1 py-2 text-xs font-semibold border-2 border-green-400 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50"
                      >
                        Keep Server
                      </button>
                      {conflict.resolution_strategy === 'manual' && (
                        <button
                          onClick={() => resolveConflict(conflict, 'merged')}
                          disabled={isResolving}
                          className="flex-1 py-2 text-xs font-semibold border-2 border-purple-400 text-purple-700 rounded-lg hover:bg-purple-50 disabled:opacity-50"
                        >
                          {isResolving ? '…' : 'Save Merge'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ConflictResolutionQueue;
