import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getApiBase } from './apiBase';
import classMateLogo from './assets/Logo2.png';
import './studentCourseProfile.css';

const API_BASE = getApiBase();

export default function QuizTake() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const studentId = localStorage.getItem('studentId') || localStorage.getItem('student_id');

  const orderedQuestions = useMemo(() => {
    if (!quiz?.questions?.length) return [];
    return [...quiz.questions].sort((a, b) => Number(a.question_order) - Number(b.question_order));
  }, [quiz]);

  useEffect(() => {
    if (!quizId) {
      setLoadError('Missing quiz id');
      setLoading(false);
      return undefined;
    }
    if (!studentId) {
      setLoadError('Log in as a student to take this quiz.');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `${API_BASE}/api/quizzes/${encodeURIComponent(quizId)}?viewer_id=${encodeURIComponent(
            studentId
          )}&viewer_type=student`
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) throw new Error(d.error || `Could not load quiz (${r.status})`);
        if (!cancelled) {
          setQuiz(d);
          setAnswers({});
          setResult(null);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Failed to load quiz');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quizId, studentId]);

  const submit = async () => {
    if (!orderedQuestions.length || !studentId) return;
    const payload = orderedQuestions.map((q) => {
      const v = answers[q.question_order];
      return typeof v === 'number' ? v : parseInt(v, 10);
    });
    if (payload.some((x) => Number.isNaN(x))) {
      alert('Please select an answer for every question.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/quizzes/${encodeURIComponent(quizId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, answers: payload }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || 'Submit failed');
      setResult(d);
    } catch (e) {
      alert(e.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

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
          <button type="button" className="back-course-btn" onClick={() => navigate('/studentQuizzes')}>
            ← Quizzes
          </button>
        </div>
      </nav>

      <div className="course-content student-course-content" style={{ maxWidth: 720, margin: '0 auto' }}>
        {loading && (
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Loading quiz…</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="error-container">
            <p>{loadError}</p>
            <button type="button" className="back-course-btn" onClick={() => navigate('/studentQuizzes')}>
              Back
            </button>
          </div>
        )}

        {!loading && !loadError && quiz && (
          <>
            <h1 style={{ marginBottom: 4 }}>{quiz.title || 'Quiz'}</h1>
            <p style={{ color: '#666', marginBottom: 20 }}>{orderedQuestions.length} questions</p>

            {result && (
              <div
                className="section-card"
                style={{
                  marginBottom: 20,
                  background: '#e8f6ee',
                  border: '1px solid #9cdbc0',
                }}
              >
                <strong>Submitted</strong>
                <p style={{ margin: '8px 0 0' }}>
                  Score: {result.score} / {result.total} ({result.percentage}%)
                </p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {orderedQuestions.map((q) => (
                <div key={q.question_order} className="section-card">
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>{q.question_text}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(q.options || []).map((opt, idx) => (
                      <label
                        key={`${q.question_order}-${idx}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                      >
                        <input
                          type="radio"
                          name={`q-${q.question_order}`}
                          checked={answers[q.question_order] === idx}
                          onChange={() =>
                            setAnswers((prev) => ({
                              ...prev,
                              [q.question_order]: idx,
                            }))
                          }
                          disabled={!!result}
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {!result && (
              <button
                type="button"
                className="pre-join-join-btn"
                style={{ marginTop: 24, width: '100%', maxWidth: 320 }}
                disabled={submitting}
                onClick={submit}
              >
                {submitting ? 'Submitting…' : 'Submit answers'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
