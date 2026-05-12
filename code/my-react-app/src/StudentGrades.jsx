import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import classMateLogo from './assets/Logo2.png';
import './studentCourseProfile.css';
import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

export default function StudentGrades() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [grades, setGrades] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const sid = localStorage.getItem('studentId');
        if (!sid) throw new Error('Student not logged in');
        const r = await fetch(`${API_BASE}/api/student/${encodeURIComponent(sid)}/grades`);
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'Failed to load grades');
        setGrades(d.grades || []);
      } catch (e) {
        setError(e.message || 'Failed to load grades');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="course-profile student-course-profile">
      <nav className="course-navbar student-course-navbar">
        <div className="navbar-left">
          <div className="logo-container">
            <img src={classMateLogo} alt="logo" className="navbar-logo" />
            <span className="brand-name">classMate</span>
          </div>
        </div>
        <div className="navbar-right">
          <button type="button" className="back-course-btn" onClick={() => navigate('/studentDashboard')}>← Back</button>
        </div>
      </nav>

      <div className="course-content student-course-content" style={{ maxWidth: 920, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 8 }}>My Grades</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>All quiz attempts and results.</p>

        {loading && <div className="loading-container"><div className="loading-spinner" /><p>Loading…</p></div>}
        {!loading && error && <div className="error-container"><p>{error}</p></div>}

        {!loading && !error && grades.length === 0 && <p>No grades yet.</p>}

        {!loading && !error && grades.length > 0 && (
          <div className="section-card">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e6eef5' }}>
                  <th style={{ padding: '8px' }}>Course</th>
                  <th style={{ padding: '8px' }}>Session / Quiz</th>
                  <th style={{ padding: '8px' }}>Teacher</th>
                  <th style={{ padding: '8px' }}>Score</th>
                  <th style={{ padding: '8px' }}>Percentage</th>
                  <th style={{ padding: '8px' }}>Result</th>
                  <th style={{ padding: '8px' }}>Taken At</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.attempt_id} style={{ borderBottom: '1px solid #f4f8fb' }}>
                    <td style={{ padding: '8px' }}>{g.course_code || g.course_title || '-'}</td>
                    <td style={{ padding: '8px' }}>{g.session_title ? `${g.session_title} — ${g.quiz_title}` : g.quiz_title}</td>
                    <td style={{ padding: '8px' }}>{g.teacher_name || '-'}</td>
                    <td style={{ padding: '8px' }}>{g.score != null ? g.score : '-'}</td>
                    <td style={{ padding: '8px' }}>{g.percentage != null ? `${g.percentage}%` : '-'}</td>
                    <td style={{ padding: '8px', color: g.passed ? '#137333' : '#b91c1c', fontWeight: 700 }}>{g.passed ? 'Passed' : 'Failed'}</td>
                    <td style={{ padding: '8px' }}>{g.completed_at ? new Date(g.completed_at).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
