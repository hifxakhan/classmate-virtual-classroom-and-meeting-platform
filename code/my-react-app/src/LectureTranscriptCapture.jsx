import React, { useCallback, useEffect, useRef, useState } from 'react';
import './LectureTranscriptCapture.css';

/**
 * Teacher-side live transcript: Web Speech API finals → POST /api/sessions/:id/transcript/lines
 * Manual fallback when SpeechRecognition is missing or mic denied.
 */
export default function LectureTranscriptCapture({
  apiBase,
  sessionId,
  speakerId,
  speakerType,
  enabled,
  onEndMeeting,
}) {
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechError, setSpeechError] = useState(null);
  const [listening, setListening] = useState(false);
  const [manualText, setManualText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [lastPosted, setLastPosted] = useState(null);
  const [endingSession, setEndingSession] = useState(false);
  const [endedTranscript, setEndedTranscript] = useState('');
  const [endError, setEndError] = useState(null);
  const recRef = useRef(null);
  const queueRef = useRef([]);
  const flushTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const keepListeningRef = useRef(false);

  const postLine = useCallback(
    async (text) => {
      const t = String(text || '').trim();
      if (!t || !sessionId || !speakerId) return false;
      const url = `${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/transcript/lines`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: t,
          speaker_id: String(speakerId),
          speaker_type: speakerType || 'teacher',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setLastPosted(new Date());
        return true;
      }
      console.warn('[transcript] POST failed', res.status, data);
      return false;
    },
    [apiBase, sessionId, speakerId, speakerType]
  );

  const flushQueue = useCallback(() => {
    const q = queueRef.current.splice(0, queueRef.current.length);
    if (!q.length) return;
    const combined = q.join(' ').trim();
    if (combined) postLine(combined);
  }, [postLine]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushQueue();
    }, 2200);
  }, [flushQueue]);

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    flushQueue();
    const rec = recRef.current;
    if (rec) {
      rec.onend = null;
      recRef.current = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
  }, [flushQueue]);

  const endSession = useCallback(async () => {
    if (endingSession || !sessionId) return;
    setEndingSession(true);
    setEndError(null);
    stopListening();
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const url = `${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/transcript?viewer_id=${encodeURIComponent(
        String(speakerId || '')
      )}&viewer_type=${encodeURIComponent(String(speakerType || 'teacher'))}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Failed to fetch transcript (${res.status})`);
      }
      setEndedTranscript(String(data.full_text || '').trim());
      if (typeof onEndMeeting === 'function') {
        await onEndMeeting(data);
      }
    } catch (e) {
      setEndError(String(e?.message || e || 'Failed to fetch final transcript'));
    } finally {
      setEndingSession(false);
    }
  }, [endingSession, sessionId, stopListening, apiBase, speakerId, speakerType, onEndMeeting]);

  useEffect(() => {
    if (!enabled || !sessionId || !speakerId) {
      setListening(false);
      return undefined;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      setSpeechError('unsupported');
      setListening(false);
      return undefined;
    }

    let active = true;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    keepListeningRef.current = true;

    rec.onresult = (ev) => {
      if (!active) return;
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results[i];
        if (r.isFinal) {
          const transcript = String(r[0]?.transcript || '').trim();
          if (transcript) {
            queueRef.current.push(transcript);
            scheduleFlush();
          }
        }
      }
    };

    rec.onerror = (ev) => {
      const err = ev.error || 'unknown';
      if (err === 'no-speech') {
        return;
      }
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setSpeechError('not-allowed');
        keepListeningRef.current = false;
        setListening(false);
      } else if (err !== 'aborted') {
        console.warn('[transcript] speech error', err);
      }
    };

    rec.onend = () => {
      if (active && keepListeningRef.current && recRef.current === rec) {
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (!active || !keepListeningRef.current || recRef.current !== rec) return;
          try {
            rec.start();
          } catch {
            /* ignore restart race */
          }
        }, 300);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      setSpeechError(null);
    } catch (e) {
      console.warn('[transcript] could not start', e);
      setSpeechError('start-failed');
      setListening(false);
    }

    return () => {
      active = false;
      keepListeningRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      rec.onend = null;
      recRef.current = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      setListening(false);
    };
  }, [enabled, sessionId, speakerId, scheduleFlush, flushQueue]);

  const submitManual = async () => {
    const ok = await postLine(manualText);
    if (ok) setManualText('');
  };

  const banner =
    !speechSupported || speechError === 'not-allowed' || speechError === 'start-failed';

  return (
    <div className="lecture-transcript-panel" role="region" aria-label="Class transcript">
      {banner && (
        <div className="lecture-transcript-banner">
          Transcript capture is unavailable in this browser or the microphone was blocked. Use Chrome
          or Edge for live captions, or type key points below — they are saved to the class transcript
          the same way.
          <button type="button" className="lecture-transcript-linkbtn" onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'Hide manual entry' : 'Add manual lines'}
          </button>
        </div>
      )}

      {speechSupported && !banner && (
        <div className="lecture-transcript-status">
          <span className={`lecture-transcript-dot ${listening ? 'on' : ''}`} />
          {listening ? 'Listening for lecture (saved every few seconds)' : 'Starting…'}
          {lastPosted && (
            <span className="lecture-transcript-muted">
              Last saved {lastPosted.toLocaleTimeString()}
            </span>
          )}
          <button type="button" className="lecture-transcript-linkbtn" onClick={() => setShowManual((v) => !v)}>
            Manual line
          </button>
        </div>
      )}

      {(showManual || banner) && (
        <div className="lecture-transcript-manual">
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Type a short line of what you said (or paste notes), then Add to transcript"
            rows={3}
          />
          <button type="button" className="lecture-transcript-submit" onClick={submitManual} disabled={!manualText.trim()}>
            Add to transcript
          </button>
        </div>
      )}

      <div className="lecture-transcript-actions">
        <button type="button" className="lecture-transcript-submit" onClick={endSession} disabled={endingSession || !enabled}>
          {endingSession ? 'Ending…' : 'End Meeting'}
        </button>
      </div>

      {(endedTranscript || endError) && (
        <div className="lecture-transcript-ended" role="status" aria-live="polite">
          <h4>Final Transcript (Teacher Preview)</h4>
          {endError ? <p>{endError}</p> : <pre>{endedTranscript || 'No transcript lines captured.'}</pre>}
        </div>
      )}
    </div>
  );
}
