import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getApiBase } from './apiBase';
import classMateLogo from './assets/Logo2.png';
import './LectureRecap.css';

const API_BASE = getApiBase();

export default function LectureRecap() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Resolve identity from localStorage — prefer teacher when both present
  const teacherId =
    localStorage.getItem('teacherId') || localStorage.getItem('teacher_id') || null;
  const studentId =
    localStorage.getItem('studentId') || localStorage.getItem('student_id') || null;
  const isTeacher = !!teacherId;
  const viewerId = isTeacher ? teacherId : studentId;
  const viewerType = isTeacher ? 'teacher' : 'student';

  // Session meta (passed via navigate state; gracefully degrade to empty)
  const sessionTitle = location.state?.sessionTitle || 'Class Session';
  const courseCode = location.state?.courseCode || '';
  const courseTitle = location.state?.courseTitle || '';
  const courseId = location.state?.courseId || null;

  // --- Summary state ---
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(null);
  const [generating, setGenerating] = useState(false);

  // --- Transcript state ---
  const [transcript, setTranscript] = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  // --- Quiz state ---
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizMsg, setQuizMsg] = useState(null);

  // Active tab for teacher summary view
  const [summaryTab, setSummaryTab] = useState('student');

  // ---- Loaders ----
  const loadSummary = useCallback(async () => {
    if (!sessionId || !viewerId) {
      setSummaryError('Session or user identity not found. Please log in.');
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/summary` +
          `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setSummary(d);
      } else {
        setSummaryError(d.error || 'Summary not yet generated for this session.');
      }
    } catch {
      setSummaryError('Could not reach the server. Try again later.');
    } finally {
      setSummaryLoading(false);
    }
  }, [sessionId, viewerId, viewerType]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleLoadTranscript = async () => {
    if (showTranscript) {
      setShowTranscript(false);
      return;
    }
    if (transcript) {
      setShowTranscript(true);
      return;
    }
    setTranscriptLoading(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript` +
          `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setTranscript(d);
        setShowTranscript(true);
      } else {
        alert(d.error || 'Could not load transcript.');
      }
    } catch {
      alert('Network error loading transcript.');
    } finally {
      setTranscriptLoading(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!teacherId) return;
    setGenerating(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/summarize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: teacherId }),
        }
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setSummary(d);
        setSummaryError(null);
      } else {
        alert(
          d.error ||
            'Could not generate summary. Ensure the class transcript has at least a few lines captured.'
        );
      }
    } catch {
      alert('Network error. Could not generate summary.');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!teacherId) return;
    setQuizLoading(true);
    setQuizMsg(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/generate-quiz`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: teacherId, num_questions: 5 }),
        }
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setQuizMsg({
          type: 'success',
          text: `Quiz created (ID: ${d.quiz_id}). Students can find it under "My Quizzes".`,
        });
      } else {
        setQuizMsg({
          type: 'error',
          text: d.error || 'Could not generate quiz. The class transcript may be empty.',
        });
      }
    } catch {
      setQuizMsg({ type: 'error', text: 'Network error generating quiz.' });
    } finally {
      setQuizLoading(false);
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

  // ---- Render helpers ----
  const renderSummaryText = (text) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => (
      <p key={i} className="recap-summary-line">
        {line}
      </p>
    ));
  };

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
            {courseCode && (
              <span className="recap-course-badge">{courseCode}</span>
            )}
            {courseTitle && (
              <span className="recap-course-title">{courseTitle}</span>
            )}
          </div>
          <h1 className="recap-title">{sessionTitle}</h1>
          <div className="recap-role-badge">
            {isTeacher ? '👩‍🏫 Teacher View' : '🎓 Student View'}
          </div>
        </div>

        {/* ---- Summary Card ---- */}
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
                  '↺ Regenerate'
                ) : (
                  '✦ Generate Summary'
                )}
              </button>
            )}
          </div>

          {summaryLoading && (
            <div className="recap-loader">
              <div className="recap-spinner-ring" />
              <p>Loading summary…</p>
            </div>
          )}

          {!summaryLoading && summaryError && (
            <div className="recap-empty-state">
              <div className="recap-empty-icon">📋</div>
              <p className="recap-empty-msg">{summaryError}</p>
              {isTeacher && (
                <p className="recap-empty-hint">
                  Generate a summary using the button above. The class must have transcript lines
                  saved during the session.
                </p>
              )}
              {!isTeacher && (
                <p className="recap-empty-hint">
                  Your instructor hasn't generated a summary for this session yet.
                </p>
              )}
            </div>
          )}

          {!summaryLoading && summary && (
            <>
              {/* Tab switcher — only teacher sees both tabs */}
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

        {/* ---- Teacher Actions Card ---- */}
        {isTeacher && (
          <div className="recap-card">
            <div className="recap-card-header">
              <h2>
                <i className="fas fa-magic" /> Quiz Generation
              </h2>
            </div>
            <p className="recap-action-description">
              Generate a multiple-choice quiz from this session's transcript. Students can find it
              under "My Quizzes" in their dashboard.
            </p>

            {quizMsg && (
              <div className={`recap-msg recap-msg-${quizMsg.type}`}>{quizMsg.text}</div>
            )}

            <div className="recap-action-row">
              <button
                type="button"
                className="recap-action-btn recap-quiz-btn"
                onClick={handleGenerateQuiz}
                disabled={quizLoading}
              >
                {quizLoading ? (
                  <>
                    <span className="recap-spinner" /> Generating quiz…
                  </>
                ) : (
                  '📝 Generate Quiz (5 questions)'
                )}
              </button>
            </div>
          </div>
        )}

        {/* ---- Student quick links ---- */}
        {!isTeacher && (
          <div className="recap-card recap-card-links">
            <div className="recap-card-header">
              <h2>
                <i className="fas fa-question-circle" /> Quizzes
              </h2>
            </div>
            <p className="recap-action-description">
              Your instructor may have created a quiz from this session's content.
            </p>
            <div className="recap-action-row">
              <button
                type="button"
                className="recap-action-btn recap-quiz-btn"
                onClick={() => navigate('/studentQuizzes')}
              >
                View My Quizzes
              </button>
              {courseId && (
                <button
                  type="button"
                  className="recap-action-btn recap-outline-btn"
                  onClick={() =>
                    navigate('/studentCourseProfile', {
                      state: { courseId },
                    })
                  }
                >
                  Go to Course
                </button>
              )}
            </div>
          </div>
        )}

        {/* ---- Transcript Card ---- */}
        <div className="recap-card">
          <div className="recap-card-header">
            <h2>
              <i className="fas fa-align-left" /> Class Transcript
            </h2>
            <button
              type="button"
              className="recap-action-btn recap-outline-btn"
              onClick={handleLoadTranscript}
              disabled={transcriptLoading}
            >
              {transcriptLoading
                ? 'Loading…'
                : showTranscript
                ? 'Hide Transcript'
                : 'Show Transcript'}
            </button>
          </div>

          {showTranscript && transcript && (
            <div className="recap-transcript-body">
              {transcript.lines && transcript.lines.length > 0 ? (
                <>
                  <p className="recap-transcript-meta">
                    {transcript.lines.length} line{transcript.lines.length !== 1 ? 's' : ''}{' '}
                    captured during this session
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
                  <p className="recap-empty-msg">No transcript lines were captured for this session.</p>
                  {isTeacher && (
                    <p className="recap-empty-hint">
                      Transcript capture requires Chrome/Edge with microphone permission. You can
                      also type lines manually during a live session.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!showTranscript && (
            <p className="recap-transcript-hint">
              Click "Show Transcript" to view the raw spoken content from this class session.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
