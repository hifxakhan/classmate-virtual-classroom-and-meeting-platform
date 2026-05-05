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
}) {
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechError, setSpeechError] = useState(null);
  const [listening, setListening] = useState(false);
  const [manualText, setManualText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [lastPosted, setLastPosted] = useState(null);
  const recRef = useRef(null);
  const queueRef = useRef([]);
  const flushTimerRef = useRef(null);

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
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setSpeechError('not-allowed');
        setListening(false);
      } else if (err !== 'no-speech' && err !== 'aborted') {
        console.warn('[transcript] speech error', err);
      }
    };

    rec.onend = () => {
      if (active && recRef.current === rec) {
        try {
          rec.start();
        } catch {
          /* ignore restart race */
        }
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
      recRef.current = null;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushQueue();
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
    </div>
  );
}
