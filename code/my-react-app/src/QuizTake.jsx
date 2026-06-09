import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getApiBase } from './apiBase';
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

  const studentId = localStorage.getItem('studentId') || localStorage.getItem('student_id');
  const startTimeRef = useRef(new Date().toISOString());

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
        if (!r.ok || !d.success) throw new Error(d.error || `Could not load exam (${r.status})`);
        if (!cancelled) {
          setQuiz(d);
          setAnswers({});
          setResult(null);
          setLoadError(null);
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

  const submit = async () => {
    if (!orderedQuestions.length || !studentId) return;
    const payload = orderedQuestions.map((q) => {
      const v = answers[q.question_order];
      return {
        question_order: q.question_order,
        answer: v !== undefined ? v : null,
      };
    });
    if (payload.some((x) => x.answer === null || x.answer === '')) {
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

        {!loading && !loadError && quiz && (
          <>
            <h1 style={{ marginBottom: 4 }}>{quiz.title || 'Exam'}</h1>
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
