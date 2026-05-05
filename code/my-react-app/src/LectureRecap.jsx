import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getApiBase } from './apiBase';
import classMateLogo from './assets/Logo2.png';
import './LectureRecap.css';

const API_BASE = getApiBase();
const DEBUG_ENDPOINT = 'http://127.0.0.1:7478/ingest/daef078b-ff12-463d-ad54-ec4a3a57f46a';

function debugLog(hypothesisId, location, message, data = {}, runId = 'initial') {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '2ab5ed',
    },
    body: JSON.stringify({
      sessionId: '2ab5ed',
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export default function LectureRecap() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const teacherId =
    localStorage.getItem('teacherId') || localStorage.getItem('teacher_id') || null;
  const studentId =
    localStorage.getItem('studentId') || localStorage.getItem('student_id') || null;
  const isTeacher = !!teacherId;
  const viewerId = isTeacher ? teacherId : studentId;
  const viewerType = isTeacher ? 'teacher' : 'student';

  const sessionTitle = location.state?.sessionTitle || 'Class Session';
  const courseCode = location.state?.courseCode || '';
  const courseTitle = location.state?.courseTitle || '';

  // ── Transcript ──────────────────────────────────────────────────────────────
  const [transcript, setTranscript] = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(true);
  const [transcriptError, setTranscriptError] = useState(null);

  // ── Summary ──────────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState(null);
  const [summaryChecking, setSummaryChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [summaryTab, setSummaryTab] = useState('student');

  // ── Quiz ─────────────────────────────────────────────────────────────────────
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizMsg, setQuizMsg] = useState(null);
  const [quizData, setQuizData] = useState(null);
  const [studentAnswers, setStudentAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  // ── Load transcript on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !viewerId) {
      setTranscriptLoading(false);
      return;
    }
    const load = async () => {
      setTranscriptLoading(true);
      debugLog('H1', 'LectureRecap.jsx:loadTranscript:start', 'Transcript effect started', {
        sessionId,
        viewerId,
        viewerType,
      });
      try {
        const r = await fetch(
          `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript` +
            `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`
        );
        const d = await r.json().catch(() => ({}));
        debugLog('H1', 'LectureRecap.jsx:loadTranscript:response', 'Transcript response received', {
          status: r.status,
          ok: r.ok,
          success: !!d.success,
        });
        if (r.ok && d.success) {
          setTranscript(d);
        } else {
          setTranscriptError(d.error || 'No transcript found for this session.');
        }
      } catch {
        setTranscriptError('Could not load transcript. Check your connection.');
      } finally {
        setTranscriptLoading(false);
      }
    };
    load();
  }, [sessionId, viewerId, viewerType]);

  // ── Silently check for existing summary on mount ─────────────────────────────
  useEffect(() => {
    if (!sessionId || !viewerId) {
      setSummaryChecking(false);
      return;
    }
    const load = async () => {
      setSummaryChecking(true);
      debugLog('H2', 'LectureRecap.jsx:loadSummary:start', 'Summary effect started', {
        sessionId,
        viewerId,
        viewerType,
      });
      try {
        const r = await fetch(
          `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/summary` +
            `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`
        );
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.success) {
          setSummary(d);
        }
        // 404 = summary not yet generated, that is fine — show empty state
      } catch {
        // silent
      } finally {
        setSummaryChecking(false);
      }
    };
    load();
  }, [sessionId, viewerId, viewerType]);

  // ── Load quiz helper ──────────────────────────────────────────────────────────
  const loadQuizById = useCallback(
    async (quizId) => {
      try {
        const r = await fetch(
          `${API_BASE}/api/quizzes/${quizId}` +
            `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`
        );
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.success) {
          setQuizData(d);
          setStudentAnswers({});
          setQuizResult(null);
        }
      } catch {
        // silent
      }
    },
    [viewerId, viewerType]
  );

  // ── Silently check for existing quiz on mount ────────────────────────────────
  useEffect(() => {
    if (!sessionId || !viewerId) return;
    const load = async () => {
      try {
        const r = await fetch(
          `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/quizzes` +
            `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`
        );
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.success && d.quizzes && d.quizzes.length > 0) {
          // Load the most recent quiz automatically
          await loadQuizById(d.quizzes[0].quiz_id);
        }
      } catch {
        // silent
      }
    };
    load();
  }, [sessionId, viewerId, viewerType, loadQuizById]);

  // ── Generate Summary ──────────────────────────────────────────────────────────
  const handleGenerateSummary = async () => {
    if (!teacherId) return;
    setGenerating(true);
    try {
      debugLog('H4', 'LectureRecap.jsx:generateSummary:click', 'Generate summary invoked', {
        sessionId,
        teacherId: !!teacherId,
      });
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/summarize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: teacherId }),
        }
      );
      const d = await r.json().catch(() => ({}));
      debugLog('H4', 'LectureRecap.jsx:generateSummary:response', 'Generate summary response', {
        status: r.status,
        ok: r.ok,
        error: d?.error || null,
      });
      if (r.ok && d.success) {
        setSummary(d);
      } else {
        alert(
          d.error ||
            'Could not generate summary. Make sure the transcript has captured content.'
        );
      }
    } catch {
      alert('Network error. Could not generate summary.');
    } finally {
      setGenerating(false);
    }
  };

  // ── Generate Quiz ─────────────────────────────────────────────────────────────
  const handleGenerateQuiz = async () => {
    if (!teacherId) return;
    setQuizLoading(true);
    setQuizMsg(null);
    try {
      debugLog('H3', 'LectureRecap.jsx:generateQuiz:click', 'Generate quiz invoked', {
        sessionId,
        teacherId: !!teacherId,
      });
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/generate-quiz`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: teacherId, num_questions: 5 }),
        }
      );
      const d = await r.json().catch(() => ({}));
      debugLog('H3', 'LectureRecap.jsx:generateQuiz:response', 'Generate quiz response', {
        status: r.status,
        ok: r.ok,
        error: d?.error || null,
        quizId: d?.quiz_id || null,
      });
      if (r.ok && d.success) {
        setQuizMsg({ type: 'success', text: 'Quiz generated! Questions are shown below.' });
        await loadQuizById(d.quiz_id);
      } else {
        setQuizMsg({
          type: 'error',
          text: d.error || 'Could not generate quiz. The transcript may be empty.',
        });
      }
    } catch {
      setQuizMsg({ type: 'error', text: 'Network error generating quiz.' });
    } finally {
      setQuizLoading(false);
    }
  };

  // ── Submit Quiz (student) ─────────────────────────────────────────────────────
  const handleSubmitQuiz = async () => {
    if (!studentId || !quizData) return;
    const answers = quizData.questions.map((_, i) =>
      studentAnswers[i] !== undefined ? studentAnswers[i] : -1
    );
    setSubmittingQuiz(true);
    try {
      const r = await fetch(`${API_BASE}/api/quizzes/${quizData.quiz_id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, answers }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setQuizResult(d);
      } else {
        alert(d.error || 'Could not submit quiz.');
      }
    } catch {
      alert('Network error submitting quiz.');
    } finally {
      setSubmittingQuiz(false);
    }
  };

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else if (isTeacher) {
      navigate('/teacherDashboard');
    } else {
      navigate('/studentDashboard');
    }
  };

  const renderSummaryText = (text) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => (
      <p key={i} className="recap-summary-line">
        {line}
      </p>
    ));
  };

  const optionLetters = ['A', 'B', 'C', 'D'];

  return (
    <div className="recap-page">
      {/* Navbar */}
      <nav className="recap-navbar">
        <div className="recap-navbar-left">
          <img src={classMateLogo} alt="logo" className="recap-navbar-logo" />
          <span className="recap-brand">classMate</span>
        </div>
        <div className="recap-navbar-right">
          <button type="button" className="recap-back-btn" onClick={goBack}>
            ← Back
          </button>
        </div>
      </nav>

      <div className="recap-container">
        {/* Header */}
        <div className="recap-header">
          <div className="recap-header-meta">
            {courseCode && <span className="recap-course-badge">{courseCode}</span>}
            {courseTitle && <span className="recap-course-title">{courseTitle}</span>}
          </div>
          <h1 className="recap-title">{sessionTitle}</h1>
          <div className="recap-role-badge">
            {isTeacher ? '👩‍🏫 Teacher View' : '🎓 Student View'}
          </div>
        </div>

        {/* ── Transcript Card (primary content) ── */}
        <div className="recap-card">
          <div className="recap-card-header">
            <h2>
              <i className="fas fa-align-left" /> Class Transcript
            </h2>
          </div>

          {transcriptLoading && (
            <div className="recap-loader">
              <div className="recap-spinner-ring" />
              <p>Loading transcript…</p>
            </div>
          )}

          {!transcriptLoading && transcriptError && (
            <div className="recap-empty-state">
              <div className="recap-empty-icon">🎙️</div>
              <p className="recap-empty-msg">{transcriptError}</p>
              {isTeacher && (
                <p className="recap-empty-hint">
                  Transcript is captured automatically during the class. Start the class as the
                  teacher and allow microphone access in Chrome or Edge. You can also type lines
                  manually during a live session.
                </p>
              )}
            </div>
          )}

          {!transcriptLoading && transcript && (
            <div className="recap-transcript-body">
              {transcript.lines && transcript.lines.length > 0 ? (
                <>
                  <p className="recap-transcript-meta">
                    {transcript.lines.length} line
                    {transcript.lines.length !== 1 ? 's' : ''} captured during this session
                  </p>
                  <div className="recap-transcript-scroll">
                    {transcript.lines.map((line, i) => (
                      <div key={i} className="recap-transcript-line">
                        <span className="recap-line-num">{line.line_index ?? i + 1}</span>
                        <span className="recap-line-text">{line.text}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="recap-empty-state">
                  <div className="recap-empty-icon">🎙️</div>
                  <p className="recap-empty-msg">
                    No transcript lines were captured for this session.
                  </p>
                  {isTeacher && (
                    <p className="recap-empty-hint">
                      Make sure the class was started as the teacher role and microphone
                      permission was granted.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Summary Card ── */}
        <div className="recap-card">
          <div className="recap-card-header">
            <h2>
              <i className="fas fa-file-alt" /> Session Summary
            </h2>
            {isTeacher && (
              <button
                type="button"
                className="recap-action-btn recap-generate-btn"
                onClick={handleGenerateSummary}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <span className="recap-spinner" /> Generating…
                  </>
                ) : summary ? (
                  '↺ Regenerate Summary'
                ) : (
                  '✦ Generate Summary'
                )}
              </button>
            )}
          </div>

          {summaryChecking && (
            <div className="recap-loader">
              <div className="recap-spinner-ring" />
              <p>Checking for summary…</p>
            </div>
          )}

          {!summaryChecking && !summary && !generating && (
            <div className="recap-empty-state">
              <div className="recap-empty-icon">📋</div>
              <p className="recap-empty-msg">
                {isTeacher
                  ? 'No summary yet. Click "Generate Summary" above to create one from the transcript.'
                  : 'Your instructor has not generated a summary for this session yet.'}
              </p>
            </div>
          )}

          {summary && (
            <>
              {isTeacher && (
                <div className="recap-tabs">
                  <button
                    type="button"
                    className={`recap-tab ${summaryTab === 'student' ? 'active' : ''}`}
                    onClick={() => setSummaryTab('student')}
                  >
                    Student Summary
                  </button>
                  <button
                    type="button"
                    className={`recap-tab ${summaryTab === 'teacher' ? 'active' : ''}`}
                    onClick={() => setSummaryTab('teacher')}
                  >
                    Teacher Summary
                  </button>
                </div>
              )}
              <div className="recap-summary-body">
                {(summaryTab === 'student' || !isTeacher) && (
                  <div className="recap-summary-section">
                    {!isTeacher && (
                      <h3 className="recap-summary-label">Key Takeaways for You</h3>
                    )}
                    <div className="recap-summary-text">
                      {renderSummaryText(summary.student_summary)}
                    </div>
                  </div>
                )}
                {isTeacher && summaryTab === 'teacher' && (
                  <div className="recap-summary-section">
                    <div className="recap-summary-text">
                      {renderSummaryText(summary.teacher_summary)}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Quiz Card ── */}
        <div className="recap-card">
          <div className="recap-card-header">
            <h2>
              <i className="fas fa-question-circle" /> Quiz
            </h2>
            {isTeacher && (
              <button
                type="button"
                className="recap-action-btn recap-quiz-btn"
                onClick={handleGenerateQuiz}
                disabled={quizLoading}
              >
                {quizLoading ? (
                  <>
                    <span className="recap-spinner" /> Generating…
                  </>
                ) : quizData ? (
                  '↺ Regenerate Quiz'
                ) : (
                  '📝 Generate Quiz'
                )}
              </button>
            )}
          </div>

          {quizMsg && (
            <div className={`recap-msg recap-msg-${quizMsg.type}`}>{quizMsg.text}</div>
          )}

          {!quizData && !quizLoading && (
            <div className="recap-empty-state">
              <div className="recap-empty-icon">📝</div>
              <p className="recap-empty-msg">
                {isTeacher
                  ? 'No quiz yet. Click "Generate Quiz" above to create one from the transcript.'
                  : 'No quiz available for this session yet.'}
              </p>
            </div>
          )}

          {quizData && quizData.questions && (
            <div className="recap-quiz-body">
              <p className="recap-transcript-meta">
                {quizData.questions.length} multiple-choice question
                {quizData.questions.length !== 1 ? 's' : ''}
              </p>

              {quizData.questions.map((q, qi) => (
                <div key={qi} className="recap-quiz-question">
                  <p className="recap-quiz-question-text">
                    <strong>{qi + 1}.</strong> {q.question_text}
                  </p>
                  <div className="recap-quiz-options">
                    {q.options.map((opt, oi) => {
                      const isSelected = studentAnswers[qi] === oi;
                      const isCorrect = quizResult != null && q.correct_index === oi;
                      const isWrong =
                        quizResult != null && isSelected && q.correct_index !== oi;
                      let cls = 'recap-quiz-option';
                      if (isSelected) cls += ' selected';
                      if (isCorrect) cls += ' correct';
                      if (isWrong) cls += ' wrong';
                      return (
                        <button
                          key={oi}
                          type="button"
                          className={cls}
                          disabled={!!quizResult || isTeacher}
                          onClick={() => {
                            if (!quizResult && !isTeacher) {
                              setStudentAnswers((prev) => ({ ...prev, [qi]: oi }));
                            }
                          }}
                        >
                          <span className="recap-quiz-option-letter">
                            {optionLetters[oi]}
                          </span>
                          {opt}
                          {isCorrect && quizResult != null && (
                            <span className="recap-quiz-correct-badge"> ✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {/* Teacher sees the correct answer label immediately */}
                  {isTeacher && (
                    <p className="recap-quiz-answer-hint">
                      Correct answer:{' '}
                      <strong>{optionLetters[q.correct_index]}</strong>
                    </p>
                  )}
                </div>
              ))}

              {/* Student submit row */}
              {!isTeacher && !quizResult && (
                <div className="recap-action-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="recap-action-btn recap-generate-btn"
                    onClick={handleSubmitQuiz}
                    disabled={
                      submittingQuiz ||
                      Object.keys(studentAnswers).length < quizData.questions.length
                    }
                  >
                    {submittingQuiz ? 'Submitting…' : 'Submit Quiz'}
                  </button>
                  <span className="recap-quiz-progress">
                    {Object.keys(studentAnswers).length}/{quizData.questions.length} answered
                  </span>
                </div>
              )}

              {/* Score result */}
              {quizResult && (
                <div
                  className={`recap-quiz-result ${
                    quizResult.percentage >= 70 ? 'pass' : 'fail'
                  }`}
                >
                  <strong>
                    Score: {quizResult.score}/{quizResult.total}
                  </strong>{' '}
                  ({quizResult.percentage}%)
                  {quizResult.percentage >= 70 ? ' 🎉 Great job!' : ' Keep studying!'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
