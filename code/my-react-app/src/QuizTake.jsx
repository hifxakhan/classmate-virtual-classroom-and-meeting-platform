import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getApiBase } from './apiBase';
import { formatPKTDateTime } from './utils/dateUtils';
import classMateLogo from './assets/Logo2.png';
import './studentCourseProfile.css';
import './LectureRecap.css';

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
  const [alreadyAttempted, setAlreadyAttempted] = useState(false);
  const [forcedClose, setForcedClose] = useState(false);

  const studentId = localStorage.getItem('studentId') || localStorage.getItem('student_id');
  const startTimeRef = useRef(new Date().toISOString());
  const [secondsLeft, setSecondsLeft] = useState(null);
  const submitRef = useRef(null);
  const autoSubmittedRef = useRef(false);
  const answersRef = useRef(answers);

  // Keep answersRef current so the beforeunload handler doesn't capture stale state.
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const orderedQuestions = useMemo(() => {
    if (!quiz?.questions?.length) return [];
    return [...quiz.questions].sort((a, b) => Number(a.question_order) - Number(b.question_order));
  }, [quiz]);

  // Long-answer questions get 5 minutes each; everything else gets 1 minute.
  const totalSeconds = useMemo(() => {
    return orderedQuestions.reduce((sum, q) => {
      const type = q.question_type || 'multiple_choice';
      const perQuestion = type === 'short_answer' || type === 'essay' ? 5 * 60 : 60;
      return sum + perQuestion;
    }, 0);
  }, [orderedQuestions]);

  // Check localStorage on mount for forced-close state.
  useEffect(() => {
    if (!quizId) return;
    if (localStorage.getItem(`quiz_closed_${quizId}`) === 'true') {
      setForcedClose(true);
    }
  }, [quizId]);

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
        if (!r.ok || !d.success) throw new Error(d.error || `Could not load exam (${r.status})`);
        if (!cancelled) {
          setQuiz(d);
          setAnswers({});
          setResult(null);
          setLoadError(null);
          if (d.already_attempted) {
            setAlreadyAttempted(true);
            // Clear any stale forced-close flag since the attempt is recorded.
            localStorage.removeItem(`quiz_closed_${quizId}`);
          } else {
            // Mark exam as started so navigating away triggers the lock.
            localStorage.setItem(`quiz_started_${quizId}`, 'true');
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Failed to load exam');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quizId, studentId]);

  const submit = async (auto = false) => {
    if (!orderedQuestions.length || !studentId) return;
    if (result || submitting) return;
    const payload = orderedQuestions.map((q) => {
      const v = answers[q.question_order];
      return {
        question_order: q.question_order,
        answer: v !== undefined ? v : null,
      };
    });
    // Manual submit requires every question answered; auto-submit sends whatever is there.
    if (!auto && payload.some((x) => x.answer === null || x.answer === '')) {
      alert('Please answer every question.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/quizzes/${encodeURIComponent(quizId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, answers: payload, started_at: startTimeRef.current }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || 'Submit failed');
      setResult(d);
      // Clear forced-close flag; mark as properly submitted.
      localStorage.removeItem(`quiz_closed_${quizId}`);
      localStorage.setItem(`quiz_submitted_${quizId}`, 'true');
    } catch (e) {
      alert(e.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Keep a ref to the latest submit so the timer can auto-submit without stale closures.
  useEffect(() => {
    submitRef.current = submit;
  });

  // Initialise the countdown once the exam has loaded (not for closed/past-due exams).
  useEffect(() => {
    if (!quiz || result || quiz.is_past_due || alreadyAttempted || forcedClose) return;
    if (secondsLeft === null && totalSeconds > 0) {
      setSecondsLeft(totalSeconds);
    }
  }, [quiz, result, secondsLeft, totalSeconds, alreadyAttempted, forcedClose]);

  // Tick the countdown down every second while the exam is active.
  useEffect(() => {
    if (secondsLeft === null || result) return undefined;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s === null) return s;
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft === null, result]);

  // Auto-submit when the timer hits zero.
  useEffect(() => {
    if (secondsLeft === 0 && !result && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      submitRef.current?.(true);
    }
  }, [secondsLeft, result]);

  // Auto-submit with 0 if the student navigates away before submitting.
  useEffect(() => {
    if (!quiz || result || quiz.is_past_due || alreadyAttempted || forcedClose) return undefined;

    const handleBeforeUnload = () => {
      if (result || autoSubmittedRef.current) return;
      autoSubmittedRef.current = true;
      localStorage.setItem(`quiz_closed_${quizId}`, 'true');
      // Build payload from the latest answers (use ref to avoid stale closure).
      const payload = orderedQuestions.map((q) => ({
        question_order: q.question_order,
        answer: answersRef.current[q.question_order] !== undefined
          ? answersRef.current[q.question_order]
          : null,
      }));
      try {
        const body = JSON.stringify({
          student_id: studentId,
          answers: payload,
          started_at: startTimeRef.current,
          auto_close: true,
        });
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(`${API_BASE}/api/quizzes/${encodeURIComponent(quizId)}/submit`, blob);
      } catch (_) { /* best-effort */ }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [quiz, result, alreadyAttempted, forcedClose, orderedQuestions, studentId, quizId]);

  const formatClock = (s) => {
    const safe = Math.max(0, Number(s) || 0);
    const m = Math.floor(safe / 60);
    const sec = safe % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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
          <button type="button" className="back-course-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>
      </nav>

      <div className="course-content student-course-content" style={{ maxWidth: 720, margin: '0 auto' }}>
        {loading && (
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Loading exam…</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="error-container">
            <p>{loadError}</p>
            <button type="button" className="back-course-btn" onClick={() => navigate(-1)}>
              Back
            </button>
          </div>
        )}

        {/* Already submitted */}
        {!loading && !loadError && (alreadyAttempted || forcedClose) && !result && (
          <div className="section-card" style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}>
            <h2 style={{ margin: 0, color: '#9b1c1c' }}>Exam already submitted</h2>
            <p style={{ margin: '8px 0 0', color: '#7f1d1d' }}>
              {forcedClose && !alreadyAttempted
                ? 'You left the exam before submitting. Your score has been recorded as 0.'
                : 'You have already submitted this exam. Retakes are not allowed.'}
            </p>
            <button
              type="button"
              className="back-course-btn"
              style={{ marginTop: 14 }}
              onClick={() => navigate('/studentDashboard')}
            >
              Return to Dashboard
            </button>
          </div>
        )}

        {/* Past due */}
        {!loading && !loadError && quiz && quiz.is_past_due && !result && !alreadyAttempted && !forcedClose && (
          <div className="section-card" style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}>
            <h2 style={{ margin: 0, color: '#9b1c1c' }}>Exam closed</h2>
            <p style={{ margin: '8px 0 0', color: '#7f1d1d' }}>
              This exam passed its due date{quiz.due_date ? ` (${formatPKTDateTime(quiz.due_date)} PKT)` : ''} and is no longer open.
              Exams that were not submitted are marked 0.
            </p>
            <button
              type="button"
              className="back-course-btn"
              style={{ marginTop: 14 }}
              onClick={() => navigate('/studentDashboard')}
            >
              Return to Dashboard
            </button>
          </div>
        )}

        {/* Active exam */}
        {!loading && !loadError && quiz && !alreadyAttempted && !forcedClose && !(quiz.is_past_due && !result) && (
          <>
            <h1 style={{ marginBottom: 4 }}>{quiz.title || 'Exam'}</h1>
            <p style={{ color: '#666', marginBottom: 20 }}>
              {orderedQuestions.length} questions
              {quiz.due_date ? ` · Due ${formatPKTDateTime(quiz.due_date)} PKT` : ''}
            </p>

            {!result && secondsLeft !== null && (
              <div
                style={{
                  position: 'sticky',
                  top: 8,
                  zIndex: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 20,
                  padding: '12px 18px',
                  borderRadius: 12,
                  fontWeight: 700,
                  color: secondsLeft <= 60 ? '#9b1c1c' : '#1e3a8a',
                  background: secondsLeft <= 60 ? '#fee2e2' : '#e0e7ff',
                  border: `1px solid ${secondsLeft <= 60 ? '#fca5a5' : '#a5b4fc'}`,
                }}
              >
                <span>⏱ Time remaining — closing early will submit your current answers with 0 for unanswered questions</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 20, whiteSpace: 'nowrap' }}>
                  {formatClock(secondsLeft)}
                </span>
              </div>
            )}

            {result && (
              <div
                className="section-card"
                style={{
                  marginBottom: 20,
                  background: '#e8f6ee',
                  border: '1px solid #9cdbc0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>Submitted</strong>
                  <p style={{ margin: '8px 0 0' }}>
                    Score: {result.score} / {result.total} ({result.percentage}%)
                  </p>
                </div>
                <button
                  type="button"
                  className="back-course-btn"
                  onClick={() => navigate('/studentDashboard')}
                  style={{ background: '#065f46', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px' }}
                >
                  Return to Dashboard
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {orderedQuestions.map((q) => {
                const qOrder = q.question_order;
                const qtype = q.question_type || 'multiple_choice';
                const resultDetail = result?.details?.find(d => d.question_order === qOrder);
                return (
                <div key={qOrder} className={`section-card recap-quiz-question recap-q-${qtype}`}>
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>{q.question_text}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(qtype === 'multiple_choice' || qtype === 'true_false') && (q.options || []).map((opt, idx) => {
                      const isSelected = answers[qOrder] === idx;
                      const isCorrectOpt = resultDetail && resultDetail.correct_index === idx;
                      const isWrong = resultDetail && isSelected && !isCorrectOpt;
                      let color = 'inherit';
                      if (resultDetail) {
                          if (isCorrectOpt) color = 'green';
                          else if (isWrong) color = 'red';
                      }
                      return (
                      <label
                        key={`${qOrder}-${idx}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color }}
                      >
                        <input
                          type="radio"
                          name={`q-${qOrder}`}
                          checked={isSelected}
                          onChange={() =>
                            setAnswers((prev) => ({
                              ...prev,
                              [qOrder]: idx,
                            }))
                          }
                          disabled={!!result}
                        />
                        <span>{opt} {isCorrectOpt && '✓'} {isWrong && '✗'}</span>
                      </label>
                    )})}
                    {qtype === 'fill_in_the_blank' && (
                      <div className="recap-fitb-wrapper">
                        <input
                          type="text"
                          className={`recap-fitb-input${
                            resultDetail != null
                              ? resultDetail.is_correct
                                ? ' correct'
                                : ' wrong'
                              : ''
                          }`}
                          placeholder="Type your answer here…"
                          value={
                            typeof answers[qOrder] === 'string'
                              ? answers[qOrder]
                              : ''
                          }
                          disabled={!!result}
                          onChange={(e) => {
                            if (!result) {
                              setAnswers((prev) => ({
                                ...prev,
                                [qOrder]: e.target.value,
                              }));
                            }
                          }}
                        />
                        {resultDetail != null && (
                          <p className={`recap-quiz-answer-hint ${resultDetail.is_correct ? 'recap-hint-correct' : 'recap-hint-wrong'}`}>
                            {resultDetail.is_correct
                              ? '✓ Correct!'
                              : `✗ Correct answer: ${resultDetail.correct_text}`}
                          </p>
                        )}
                      </div>
                    )}
                    {qtype === 'short_answer' && (
                      <div className="recap-sa-wrapper">
                        <textarea
                          className="recap-sa-textarea"
                          rows={4}
                          placeholder="Write your answer here…"
                          value={
                            typeof answers[qOrder] === 'string'
                              ? answers[qOrder]
                              : ''
                          }
                          disabled={!!result}
                          onChange={(e) => {
                            if (!result) {
                              setAnswers((prev) => ({
                                ...prev,
                                [qOrder]: e.target.value,
                              }));
                            }
                          }}
                        />
                        {resultDetail != null && (
                          <div className="recap-sa-result">
                            <p className="recap-sa-marks">
                              Marks: <strong>{resultDetail.marks_awarded}/{resultDetail.max_marks}</strong>
                            </p>
                            {resultDetail.feedback && (
                              <div className="recap-sa-ai-feedback">
                                <p className="recap-sa-ai-label">🤖 AI Feedback:</p>
                                <p className="recap-sa-ai-text">{resultDetail.feedback}</p>
                              </div>
                            )}
                            <div className="recap-sa-model-answer">
                              <p className="recap-sa-model-label">Model Answer:</p>
                              <p className="recap-sa-model-text">{resultDetail.correct_text}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )})}
            </div>

            {!result && (
              <button
                type="button"
                className="pre-join-join-btn"
                style={{ marginTop: 24, width: '100%', maxWidth: 320 }}
                disabled={submitting}
                onClick={() => submit()}
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
