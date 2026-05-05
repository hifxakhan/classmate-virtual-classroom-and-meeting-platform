import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from './apiBase';
import classMateLogo from './assets/Logo2.png';
import './studentCourseProfile.css';

const API_BASE = getApiBase();

export default function StudentQuizzes() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const email = localStorage.getItem('studentEmail');
    if (!email) {
      setError('Log in as a student to view quizzes.');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const cr = await fetch(
          `${API_BASE}/api/student/enrolled-courses?email=${encodeURIComponent(email)}`
        );
        const cd = await cr.json();
        if (!cd.success) throw new Error(cd.error || 'Could not load courses');
        const courses = cd.courses || [];
        const out = [];
        for (const c of courses) {
          const qr = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(c.course_id)}/quizzes`);
          const qd = await qr.json();
          if (qd.success && Array.isArray(qd.quizzes)) {
            for (const q of qd.quizzes) {
              const qid = q.id ?? q.quiz_id;
              out.push({
                quiz_id: qid,
                title: q.title || 'Quiz',
                course_code: c.course_code,
                course_title: c.title,
                course_id: c.course_id,
              });
            }
          }
        }
        out.sort((a, b) => Number(b.quiz_id) - Number(a.quiz_id));
        if (!cancelled) setItems(out);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load quizzes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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
          <button type="button" className="back-course-btn" onClick={() => navigate('/studentDashboard')}>
            ← Back
          </button>
        </div>
      </nav>

      <div className="course-content student-course-content" style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 8 }}>My quizzes</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>Quizzes from your enrolled courses.</p>

        {loading && (
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Loading…</p>
          </div>
        )}
        {!loading && error && (
          <div className="error-container">
            <p>{error}</p>
            <button type="button" className="back-course-btn" onClick={() => navigate('/')}>
              Go to login
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="no-students">No quizzes yet. Your instructor may add one after a class session.</p>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="section-card">
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {items.map((row) => (
                <li
                  key={row.quiz_id}
                  className="activity-item"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                >
                  <div>
                    <strong>{row.title}</strong>
                    <div style={{ fontSize: 13, color: '#666' }}>
                      {row.course_code} — {row.course_title}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="view-all-btn"
                    onClick={() => navigate(`/quiz/${row.quiz_id}`)}
                  >
                    Take
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
