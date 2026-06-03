import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getApiBase } from './apiBase';
import classMateLogo from './assets/Logo2.png';
import './LectureRecap.css';

const API_BASE = getApiBase();
const inFlightJsonGetRequests = new Map();

async function fetchJsonGetDedupe(url) {
  const key = `GET:${url}`;
  if (inFlightJsonGetRequests.has(key)) {
    return inFlightJsonGetRequests.get(key);
  }
  const promise = (async () => {
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    return { response, data };
  })().finally(() => {
    inFlightJsonGetRequests.delete(key);
  });
  inFlightJsonGetRequests.set(key, promise);
  return promise;
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

  // ── Quiz/Exam ─────────────────────────────────────────────────────────────────
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizMsg, setQuizMsg] = useState(null);
  const [quizData, setQuizData] = useState(null);
  // studentAnswers: { [question_order]: answer } where answer is int (MCQ/TF index) or string (FITB/SA)
  const [studentAnswers, setStudentAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  // ── Translation ───────────────────────────────────────────────────────────────
  const [translatedText, setTranslatedText] = useState(null);
  const [translationStatus, setTranslationStatus] = useState('pending'); // 'pending' | 'done' | 'error'
  const [translating, setTranslating] = useState(false);
  const [transcriptTab, setTranscriptTab] = useState('original'); // 'original' | 'english'

  // ── Load transcript on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !viewerId) {
      setTranscriptLoading(false);
      return;
    }
    const load = async () => {
      setTranscriptLoading(true);
      try {
        const url =
          `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript` +
          `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`;
        const { response: r, data: d } = await fetchJsonGetDedupe(url);
        if (r.ok && d.success) {
          setTranscript(d);
          // Phase 1: hydrate translation state from the API response
          if (d.translated_text) {
            setTranslatedText(d.translated_text);
          }
          if (d.translation_status) {
            setTranslationStatus(d.translation_status);
          }
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
      try {
        const url =
          `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/summary` +
          `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`;
        const { response: r, data: d } = await fetchJsonGetDedupe(url);
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
        const url =
          `${API_BASE}/api/quizzes/${quizId}` +
          `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`;
        const { response: r, data: d } = await fetchJsonGetDedupe(url);
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
        const url =
          `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/quizzes` +
          `?viewer_id=${encodeURIComponent(viewerId)}&viewer_type=${encodeURIComponent(viewerType)}`;
        const { response: r, data: d } = await fetchJsonGetDedupe(url);
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

  // ── Translate Transcript ──────────────────────────────────────────────────────
  const handleTranslate = async () => {
    if (!teacherId) return;
    setTranslating(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript/translate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: teacherId }),
        }
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setTranslatedText(d.translated_text);
        setTranslationStatus('done');
        setTranscriptTab('english');
      } else {
        setTranslationStatus('error');
        alert(d.error || 'Could not translate the transcript. Please try again.');
      }
    } catch {
      setTranslationStatus('error');
      alert('Network error. Could not translate transcript.');
    } finally {
      setTranslating(false);
    }
  };

  // ── Generate Exam ─────────────────────────────────────────────────────────────
  const handleGenerateQuiz = async () => {
    if (!teacherId) return;
    if (translationStatus !== 'done') {
      setQuizMsg({ type: 'error', text: 'Please translate the transcript to English first before generating the exam.' });
      return;
    }
    setQuizLoading(true);
    setQuizMsg(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/generate-quiz`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: teacherId }),
        }
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        setQuizMsg({
          type: 'success',
          text: `Exam generated! ${d.question_count} questions · ${d.total_marks} marks total.`,
        });
        await loadQuizById(d.quiz_id);
      } else {
        setQuizMsg({
          type: 'error',
          text: d.error || 'Could not generate exam.',
        });
      }
    } catch {
      setQuizMsg({ type: 'error', text: 'Network error generating exam.' });
    } finally {
      setQuizLoading(false);
    }
  };

  // ── Submit Exam (student) ─────────────────────────────────────────────────────
  const handleSubmitQuiz = async () => {
    if (!studentId || !quizData) return;
    // Build answers array with question_order + typed answer
    const answers = quizData.questions.map((q) => ({
      question_order: q.question_order,
      answer: studentAnswers[q.question_order] !== undefined
        ? studentAnswers[q.question_order]
        : null,
    }));
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
        alert(d.error || 'Could not submit exam.');
      }
    } catch {
      alert('Network error submitting exam.');
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
            {/* Translate button — teacher only, shown when there are lines to translate */}
            {isTeacher && transcript && transcript.lines && transcript.lines.length > 0 && (
              <button
                type="button"
                className="recap-action-btn recap-translate-btn"
                onClick={handleTranslate}
                disabled={translating}
                title="Translate Hinglish transcript to English using AI"
              >
                {translating ? (
                  <><span className="recap-spinner" /> Translating…</>
                ) : translationStatus === 'done' ? (
                  '↺ Re-translate to English'
                ) : (
                  '🌐 Translate to English'
                )}
              </button>
            )}
          </div>

          {/* Language tabs — only shown when transcript has lines */}
          {!transcriptLoading && transcript && transcript.lines && transcript.lines.length > 0 && (
            <div className="recap-tabs">
              <button
                type="button"
                className={`recap-tab ${transcriptTab === 'original' ? 'active' : ''}`}
                onClick={() => setTranscriptTab('original')}
              >
                🗣️ Original (Hinglish)
              </button>
              <button
                type="button"
                className={`recap-tab ${transcriptTab === 'english' ? 'active' : ''}`}
                onClick={() => setTranscriptTab('english')}
                disabled={translationStatus !== 'done' && !translating}
                title={translationStatus !== 'done' ? 'Translate first to see the English version' : ''}
              >
                🇬🇧 English Translation
                {translationStatus === 'done' && (
                  <span className="recap-translation-ready-dot"> ✓</span>
                )}
              </button>
            </div>
          )}

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

          {/* ── ORIGINAL (Hinglish) tab ── */}
          {!transcriptLoading && transcript && transcriptTab === 'original' && (
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
                  {isTeacher && translationStatus !== 'done' && (
                    <p className="recap-translate-hint">
                      💡 Click "Translate to English" above to generate a clean English version — required before generating an exam.
                    </p>
                  )}
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

          {/* ── ENGLISH TRANSLATION tab ── */}
          {!transcriptLoading && transcript && transcriptTab === 'english' && (
            <div className="recap-transcript-body">
              {translating && (
                <div className="recap-loader">
                  <div className="recap-spinner-ring" />
                  <p>AI is translating the transcript… this may take a moment.</p>
                </div>
              )}
              {!translating && translationStatus === 'done' && translatedText ? (
                <>
                  <p className="recap-transcript-meta">
                    English translation · generated by AI · original meaning preserved
                  </p>
                  <div className="recap-translated-body">
                    {translatedText.split('\n').map((para, i) =>
                      para.trim() ? (
                        <p key={i} className="recap-translated-para">{para}</p>
                      ) : null
                    )}
                  </div>
                </>
              ) : !translating && (
                <div className="recap-empty-state">
                  <div className="recap-empty-icon">🌐</div>
                  <p className="recap-empty-msg">
                    {isTeacher
                      ? 'No English translation yet. Click "Translate to English" above to generate one.'
                      : 'The English translation has not been generated yet by your instructor.'}
                  </p>
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

        {/* ── Exam Card ── */}
        <div className="recap-card">
          <div className="recap-card-header">
            <h2>
              <i className="fas fa-question-circle" /> Exam
            </h2>
            {isTeacher && (
              <button
                type="button"
                className="recap-action-btn recap-quiz-btn"
                onClick={handleGenerateQuiz}
                disabled={quizLoading}
              >
                {quizLoading ? (
                  <><span className="recap-spinner" /> Generating…</>
                ) : quizData ? (
                  '↺ Regenerate Exam'
                ) : (
                  '📝 Generate Exam'
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
                  ? 'No exam yet. Translate the transcript first, then click "Generate Exam".'
                  : 'No exam available for this session yet.'}
              </p>
            </div>
          )}

          {quizLoading && (
            <div className="recap-loader">
              <div className="recap-spinner-ring" />
              <p>AI is generating your exam questions…</p>
            </div>
          )}

          {quizData && quizData.questions && !quizLoading && (
            <div className="recap-quiz-body">
              {/* Exam meta row */}
              <div className="recap-exam-meta-row">
                <span>{quizData.questions.length} questions</span>
                {quizData.total_marks > 0 && (
                  <span className="recap-exam-marks-badge">
                    {quizData.total_marks} marks total
                  </span>
                )}
                {isTeacher && (
                  <span className="recap-exam-teacher-badge">Answer Key Visible</span>
                )}
              </div>

              {/* ── Question List ── */}
              {quizData.questions.map((q, qi) => {
                const qOrder = q.question_order;
                const qtype = q.question_type || 'multiple_choice';

                // Result detail for this question (after submit)
                const resultDetail = quizResult?.details?.find(
                  (d) => d.question_order === qOrder
                );

                return (
                  <div key={qOrder} className={`recap-quiz-question recap-q-${qtype}`}>
                    {/* Question type badge */}
                    <div className="recap-q-type-badge">
                      {qtype === 'multiple_choice' && '🔘 Multiple Choice'}
                      {qtype === 'true_false' && '✅ True / False'}
                      {qtype === 'fill_in_the_blank' && '✏️ Fill in the Blank'}
                      {qtype === 'short_answer' && '📝 Short Answer'}
                      {qtype === 'short_answer' && (
                        <span className="recap-q-marks-hint"> · 2 marks</span>
                      )}
                    </div>

                    <p className="recap-quiz-question-text">
                      <strong>{qi + 1}.</strong> {q.question_text}
                    </p>

                    {/* ── MCQ / True-False ── */}
                    {(qtype === 'multiple_choice' || qtype === 'true_false') && q.options && (
                      <div className="recap-quiz-options">
                        {q.options.map((opt, oi) => {
                          const isSelected = studentAnswers[qOrder] === oi;
                          // After submit: colour options from result detail
                          const isCorrectOpt = resultDetail != null && resultDetail.correct_index === oi;
                          const isWrong = resultDetail != null && isSelected && !isCorrectOpt;
                          // Teacher always see correct highlighted (from API correct_index)
                          const teacherCorrect = isTeacher && q.correct_index === oi;
                          let cls = 'recap-quiz-option';
                          if (isSelected) cls += ' selected';
                          if (isCorrectOpt || teacherCorrect) cls += ' correct';
                          if (isWrong) cls += ' wrong';
                          return (
                            <button
                              key={oi}
                              type="button"
                              className={cls}
                              disabled={!!quizResult || isTeacher}
                              onClick={() => {
                                if (!quizResult && !isTeacher) {
                                  setStudentAnswers((prev) => ({ ...prev, [qOrder]: oi }));
                                }
                              }}
                            >
                              <span className="recap-quiz-option-letter">
                                {optionLetters[oi]}
                              </span>
                              {opt}
                              {(isCorrectOpt || teacherCorrect) && (
                                <span className="recap-quiz-correct-badge"> ✓</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* ── Fill in the Blank ── */}
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
                            typeof studentAnswers[qOrder] === 'string'
                              ? studentAnswers[qOrder]
                              : ''
                          }
                          disabled={!!quizResult || isTeacher}
                          onChange={(e) => {
                            if (!quizResult && !isTeacher) {
                              setStudentAnswers((prev) => ({
                                ...prev,
                                [qOrder]: e.target.value,
                              }));
                            }
                          }}
                        />
                        {/* Teacher sees correct answer immediately */}
                        {isTeacher && q.correct_text && (
                          <p className="recap-quiz-answer-hint">
                            Expected answer: <strong>{q.correct_text}</strong>
                          </p>
                        )}
                        {/* Student result feedback */}
                        {resultDetail != null && (
                          <p className={`recap-quiz-answer-hint ${resultDetail.is_correct ? 'recap-hint-correct' : 'recap-hint-wrong'}`}>
                            {resultDetail.is_correct
                              ? '✓ Correct!'
                              : `✗ Correct answer: ${resultDetail.correct_text}`}
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── Short Answer ── */}
                    {qtype === 'short_answer' && (
                      <div className="recap-sa-wrapper">
                        <textarea
                          className="recap-sa-textarea"
                          rows={4}
                          placeholder="Write your answer here…"
                          value={
                            typeof studentAnswers[qOrder] === 'string'
                              ? studentAnswers[qOrder]
                              : ''
                          }
                          disabled={!!quizResult || isTeacher}
                          onChange={(e) => {
                            if (!quizResult && !isTeacher) {
                              setStudentAnswers((prev) => ({
                                ...prev,
                                [qOrder]: e.target.value,
                              }));
                            }
                          }}
                        />
                        {/* Teacher sees model answer */}
                        {isTeacher && q.correct_text && (
                          <div className="recap-sa-model-answer">
                            <p className="recap-sa-model-label">Model Answer:</p>
                            <p className="recap-sa-model-text">{q.correct_text}</p>
                          </div>
                        )}
                        {/* Student result: marks + model answer + AI feedback */}
                        {resultDetail != null && (
                          <div className="recap-sa-result">
                            <p className="recap-sa-marks">
                              Marks: <strong>{resultDetail.marks_awarded}/{resultDetail.max_marks}</strong>
                              {!resultDetail.ai_graded && (
                                <span className="recap-sa-ai-note"> (provisional)</span>
                              )}
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
                );
              })}

              {/* ── Student Submit Row ── */}
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
                    {submittingQuiz ? (
                      <><span className="recap-spinner" /> AI Grading…</>
                    ) : (
                      'Submit Exam'
                    )}
                  </button>
                  <span className="recap-quiz-progress">
                    {Object.keys(studentAnswers).length}/{quizData.questions.length} answered
                  </span>
                </div>
              )}

              {/* ── Score Result Banner ── */}
              {quizResult && (
                <div
                  className={`recap-quiz-result ${
                    quizResult.percentage >= 70 ? 'pass' : 'fail'
                  }`}
                >
                  <div className="recap-quiz-grade-letter">
                    {quizResult.grade || 'C'}
                  </div>
                  <div>
                    <strong>
                      Score: {quizResult.score}/{quizResult.total}
                    </strong>{' '}
                    ({quizResult.percentage}%)
                    <br />
                    {quizResult.percentage >= 90 && ' 🏆 Excellent!'}
                    {quizResult.percentage >= 70 && quizResult.percentage < 90 && ' 🎉 Well done!'}
                    {quizResult.percentage < 70 && ' 📚 Keep studying!'}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

