import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import classMateLogo from './assets/Logo2.png';
import { getApiBase } from './apiBase';
import { formatPKTDateTime } from './utils/dateUtils';
import './StudentPerformance.css';

const API_BASE = getApiBase();

function formatDue(iso) {
  if (!iso) return 'No due date';
  try { return formatPKTDateTime(iso) + ' PKT'; } catch { return new Date(iso).toLocaleString(); }
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function StudentPerformance() {
  const navigate = useNavigate();
  const studentId = localStorage.getItem('studentId');

  const [tab, setTab] = useState('results');

  // Exam results
  const [grades, setGrades] = useState([]);
  const [gradesLoading, setGradesLoading] = useState(true);
  const [gradesError, setGradesError] = useState(null);

  // Pending work
  const [pendingQuizzes, setPendingQuizzes] = useState([]);
  const [pendingAssignments, setPendingAssignments] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState(null);

  // Submitted assignments
  const [submissions, setSubmissions] = useState([]);
  const [subsLoading, setSubsLoading] = useState(true);

  // Upload state per assignment
  const [uploadState, setUploadState] = useState({});
  const fileInputRefs = useRef({});

  useEffect(() => {
    if (!studentId) return;
    loadGrades();
    loadPending();
    loadSubmissions();
  }, [studentId]);

  const loadGrades = async () => {
    setGradesLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/student/${encodeURIComponent(studentId)}/grades`);
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Failed to load grades');
      setGrades(d.grades || []);
    } catch (e) {
      setGradesError(e.message);
    } finally {
      setGradesLoading(false);
    }
  };

  const loadPending = async () => {
    setPendingLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/student/${encodeURIComponent(studentId)}/pending-work`);
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Failed to load pending work');
      setPendingQuizzes(d.pending_quizzes || []);
      setPendingAssignments(d.pending_assignments || []);
    } catch (e) {
      setPendingError(e.message);
    } finally {
      setPendingLoading(false);
    }
  };

  const loadSubmissions = async () => {
    setSubsLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/student/${encodeURIComponent(studentId)}/my-submissions`);
      const d = await r.json();
      if (r.ok && d.success) setSubmissions(d.submissions || []);
    } catch { /* non-critical */ }
    finally { setSubsLoading(false); }
  };

  const handleFileChange = (assignmentId, file) => {
    setUploadState(prev => ({ ...prev, [assignmentId]: { ...prev[assignmentId], file } }));
  };

  const submitAssignment = async (assignmentId) => {
    const state = uploadState[assignmentId] || {};
    if (!state.file) {
      setUploadState(prev => ({ ...prev, [assignmentId]: { ...prev[assignmentId], error: 'Please select a file first.' } }));
      return;
    }
    setUploadState(prev => ({ ...prev, [assignmentId]: { ...prev[assignmentId], loading: true, error: null, success: null } }));
    try {
      const form = new FormData();
      form.append('student_id', studentId);
      form.append('file', state.file);
      const r = await fetch(`${API_BASE}/api/assignments/${assignmentId}/submit`, { method: 'POST', body: form });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Upload failed');
      setUploadState(prev => ({ ...prev, [assignmentId]: { file: null, loading: false, success: 'Submitted successfully!' } }));
      loadPending();
      loadSubmissions();
    } catch (e) {
      setUploadState(prev => ({ ...prev, [assignmentId]: { ...prev[assignmentId], loading: false, error: e.message } }));
    }
  };

  const overallPct = grades.length > 0
    ? Math.round(grades.reduce((s, g) => s + (Number(g.percentage) || 0), 0) / grades.length)
    : null;

  return (
    <div className="sp-page">
      <nav className="sp-nav">
        <div className="sp-nav-left">
          <img src={classMateLogo} alt="logo" className="sp-logo" />
          <span className="sp-brand">classMate</span>
        </div>
        <button className="sp-back-btn" onClick={() => navigate('/studentDashboard')}>← Back</button>
      </nav>

      <div className="sp-content">
        <div className="sp-header">
          <h1 className="sp-title">My Performance</h1>
          {overallPct != null && (
            <div className="sp-overall">
              <span className="sp-overall-pct" style={{ color: overallPct >= 50 ? '#10b981' : '#ef4444' }}>{overallPct}%</span>
              <span className="sp-overall-label">Overall Average</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="sp-tabs">
          <button className={`sp-tab ${tab === 'results' ? 'active' : ''}`} onClick={() => setTab('results')}>
            Exam Results {grades.length > 0 && <span className="sp-tab-badge">{grades.length}</span>}
          </button>
          <button className={`sp-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
            Pending Work
            {(pendingQuizzes.length + pendingAssignments.length) > 0 && (
              <span className="sp-tab-badge urgent">{pendingQuizzes.length + pendingAssignments.length}</span>
            )}
          </button>
          <button className={`sp-tab ${tab === 'assignments' ? 'active' : ''}`} onClick={() => setTab('assignments')}>
            My Assignments {submissions.length > 0 && <span className="sp-tab-badge">{submissions.length}</span>}
          </button>
        </div>

        {/* ── Exam Results Tab ── */}
        {tab === 'results' && (
          <div className="sp-section">
            {gradesLoading && <div className="sp-loading">Loading results…</div>}
            {!gradesLoading && gradesError && <div className="sp-error">{gradesError}</div>}
            {!gradesLoading && !gradesError && grades.length === 0 && (
              <div className="sp-empty">No exam results yet. Results will appear once you attempt a quiz.</div>
            )}
            {!gradesLoading && !gradesError && grades.length > 0 && (
              <div className="sp-table-wrap">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th>Session / Quiz</th>
                      <th>Course</th>
                      <th>Teacher</th>
                      <th>Score</th>
                      <th>%</th>
                      <th>Result</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grades.map((g, i) => {
                      const pct = g.percentage != null ? Math.round(Number(g.percentage)) : null;
                      const passed = (pct ?? 0) >= 50;
                      const missed = g.missed;
                      return (
                        <tr key={g.attempt_id || i} className={missed ? 'sp-row-missed' : ''}>
                          <td className="sp-col-title">
                            {g.session_title || g.quiz_title || 'Exam'}
                            {missed && <span className="sp-missed-tag">Missed</span>}
                          </td>
                          <td>{g.course_code || g.course_title || '—'}</td>
                          <td>{g.teacher_name || '—'}</td>
                          <td>{g.score != null ? g.score : '0'}{g.total ? `/${g.total}` : ''}</td>
                          <td>
                            <span className="sp-pct-pill" style={{
                              background: missed ? '#fee2e2' : pct >= 50 ? '#d1fae5' : '#fee2e2',
                              color: missed ? '#b91c1c' : pct >= 50 ? '#065f46' : '#b91c1c',
                            }}>
                              {pct != null ? pct + '%' : '—'}
                            </span>
                          </td>
                          <td>
                            <span className={`sp-badge ${missed ? 'fail' : passed ? 'pass' : 'fail'}`}>
                              {missed ? 'Missed' : passed ? 'Pass' : 'Fail'}
                            </span>
                          </td>
                          <td>{g.completed_at ? formatPKTDateTime(g.completed_at) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Pending Work Tab ── */}
        {tab === 'pending' && (
          <div className="sp-section">
            {pendingLoading && <div className="sp-loading">Loading pending work…</div>}
            {!pendingLoading && pendingError && <div className="sp-error">{pendingError}</div>}

            {!pendingLoading && !pendingError && pendingQuizzes.length === 0 && pendingAssignments.length === 0 && (
              <div className="sp-empty">Nothing pending. You're all caught up!</div>
            )}

            {!pendingLoading && !pendingError && pendingQuizzes.length > 0 && (
              <div className="sp-pending-group">
                <h2 className="sp-group-title">Quizzes to Attempt ({pendingQuizzes.length})</h2>
                {pendingQuizzes.map((q) => (
                  <div key={q.quiz_id} className="sp-pending-card">
                    <div className="sp-pending-info">
                      <div className="sp-pending-name">{q.title}</div>
                      <div className="sp-pending-meta">
                        {q.course_code && <span className="sp-meta-chip">{q.course_code}</span>}
                        {q.session_title && <span className="sp-meta-chip">{q.session_title}</span>}
                        {q.teacher_name && <span className="sp-meta-chip">{q.teacher_name}</span>}
                      </div>
                      <div className="sp-pending-due" style={{ color: q.due_date ? '#ef4444' : '#888' }}>
                        Due: {formatDue(q.due_date)}
                      </div>
                    </div>
                    <button
                      className="sp-action-btn"
                      onClick={() => navigate(`/quiz/${q.quiz_id}`)}
                    >
                      Take Quiz →
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!pendingLoading && !pendingError && pendingAssignments.length > 0 && (
              <div className="sp-pending-group">
                <h2 className="sp-group-title">Assignments to Submit ({pendingAssignments.length})</h2>
                {pendingAssignments.map((a) => {
                  const us = uploadState[a.assignment_id] || {};
                  return (
                    <div key={a.assignment_id} className="sp-pending-card sp-assignment-card">
                      <div className="sp-pending-info">
                        <div className="sp-pending-name">{a.title}</div>
                        {a.description && <div className="sp-pending-desc">{a.description}</div>}
                        <div className="sp-pending-meta">
                          {a.course_code && <span className="sp-meta-chip">{a.course_code}</span>}
                          {a.teacher_name && <span className="sp-meta-chip">{a.teacher_name}</span>}
                        </div>
                        <div className="sp-pending-due" style={{ color: a.due_date ? '#ef4444' : '#888' }}>
                          Due: {formatDue(a.due_date)}
                        </div>
                        {a.has_teacher_file && (
                          <a
                            href={`${API_BASE}${a.teacher_file_url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sp-view-link"
                          >
                            View Assignment PDF
                          </a>
                        )}
                      </div>

                      <div className="sp-upload-area">
                        {us.success ? (
                          <div className="sp-success-msg">{us.success}</div>
                        ) : (
                          <>
                            <label className="sp-file-label">
                              <input
                                type="file"
                                style={{ display: 'none' }}
                                ref={el => { fileInputRefs.current[a.assignment_id] = el; }}
                                onChange={e => handleFileChange(a.assignment_id, e.target.files?.[0] || null)}
                                accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.zip"
                              />
                              <span className="sp-file-btn" onClick={() => fileInputRefs.current[a.assignment_id]?.click()}>
                                {us.file ? us.file.name : 'Choose file…'}
                              </span>
                            </label>
                            {us.error && <div className="sp-err-msg">{us.error}</div>}
                            <button
                              className="sp-action-btn"
                              disabled={us.loading}
                              onClick={() => submitAssignment(a.assignment_id)}
                            >
                              {us.loading ? 'Uploading…' : 'Submit'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── My Assignments Tab ── */}
        {tab === 'assignments' && (
          <div className="sp-section">
            {subsLoading && <div className="sp-loading">Loading submissions…</div>}
            {!subsLoading && submissions.length === 0 && (
              <div className="sp-empty">You haven't submitted any assignments yet.</div>
            )}
            {!subsLoading && submissions.length > 0 && (
              <div className="sp-table-wrap">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th>Assignment</th>
                      <th>Course</th>
                      <th>Submitted</th>
                      <th>Marks</th>
                      <th>Feedback</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.submission_id}>
                        <td className="sp-col-title">
                          {s.title}
                          {s.file_name && (
                            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{s.file_name}</div>
                          )}
                        </td>
                        <td>{s.course_code || '—'}</td>
                        <td>{s.submitted_at ? formatPKTDateTime(s.submitted_at) : '—'}</td>
                        <td>
                          {s.marks_obtained != null
                            ? `${s.marks_obtained}${s.total_marks ? `/${s.total_marks}` : ''}`
                            : '—'}
                        </td>
                        <td className="sp-feedback-cell">{s.feedback || '—'}</td>
                        <td>
                          <span className={`sp-badge ${s.graded ? 'pass' : 'pending'}`}>
                            {s.graded ? 'Graded' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
