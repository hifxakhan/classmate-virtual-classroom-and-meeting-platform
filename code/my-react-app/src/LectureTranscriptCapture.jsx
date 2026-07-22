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
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [manualText, setManualText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [lastPosted, setLastPosted] = useState(null);
  const [endingSession, setEndingSession] = useState(false);
  const [endedTranscript, setEndedTranscript] = useState('');
  const [endError, setEndError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const transcribingRef = useRef(false);

  useEffect(() => {
    transcribingRef.current = transcribing;
  }, [transcribing]);

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
    // Kept for backward compatibility with any queued text posting usage.
    // Currently not used by the MediaRecorder + Whisper flow.
    return undefined;
  }, [postLine]);

  const scheduleFlush = useCallback(() => {
    // No-op for Whisper-based transcription, kept to avoid changing call sites.
    return undefined;
  }, [flushQueue]);

  const stopListening = useCallback(() => {
    // Web Speech API integration removed in favor of MediaRecorder + OpenAI Whisper.
    // This function is now a thin wrapper around stopping any active recording.
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    const stream = mediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    chunksRef.current = [];
    setRecording(false);
  }, []);

  const endSession = useCallback(async () => {
    if (endingSession || !sessionId) return;
    setEndingSession(true);
    setEndError(null);

    // If transcription is still in-flight, wait briefly so the latest line can be persisted.
    const waitStart = Date.now();
    while (transcribingRef.current && Date.now() - waitStart < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

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

  const sendToWhisper = useCallback(
    async (blob) => {
      if (!blob || !blob.size) {
        setSpeechError('empty-audio');
        return;
      }
      setTranscribing(true);
      setSpeechError(null);
      try {
        const formData = new FormData();
        formData.append('file', blob, 'audio.webm');

        const response = await fetch(
          `${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/transcript/transcribe`,
          {
          method: 'POST',
            body: formData,
          },
        );

        const { text, error } = await response.json().catch(() => ({}));
        if (!response.ok) {
          console.warn('[transcript] Whisper API error', response.status, { error });
          if (String(error || '').includes('OPENAI_API_KEY')) {
            setSpeechError('no-api-key');
            return;
          }
          setSpeechError('api-failed');
          return;
        }

        if (!String(text || '').trim()) {
          setSpeechError('empty-transcript');
          return;
        }
        const saved = await postLine(text);
        if (!saved) {
          setSpeechError('api-failed');
        }
      } catch (e) {
        console.warn('[transcript] Whisper request failed', e);
        setSpeechError('api-failed');
      } finally {
        setTranscribing(false);
      }
    },
    [apiBase, sessionId, postLine]
  );

  const startRecording = useCallback(async () => {
    if (!enabled || !sessionId || !speakerId) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSpeechSupported(false);
      setSpeechError('unsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = {};
      // Prefer audio/webm when supported for Whisper.
      if (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      }
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = () => {
        setSpeechError('record-error');
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        mediaStreamRef.current = null;
        setRecording(false);
        if (blob.size > 0) {
          sendToWhisper(blob);
        }
      };

      recorder.start();
      setRecording(true);
      setSpeechError(null);
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
        setSpeechError('not-allowed');
      } else {
        setSpeechError('start-failed');
      }
      setRecording(false);
    }
  }, [enabled, sessionId, speakerId, sendToWhisper]);

  useEffect(() => {
    // Cleanup any active recording tracks on unmount.
    return () => {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      const stream = mediaStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  const submitManual = async () => {
    const ok = await postLine(manualText);
    if (ok) setManualText('');
  };

  const banner =
    !speechSupported || speechError === 'not-allowed' || speechError === 'start-failed';

  const errorText = {
    unsupported: 'Live transcription is not supported in this browser.',
    'not-allowed': 'Microphone permission was denied. Enable it to record.',
    'start-failed': 'Could not start recording. Try again or type manually.',
    'record-error': 'An error occurred while recording. Please try again.',
    'api-failed': 'Transcription service failed. Retry or type manually.',
    'empty-transcript': 'No speech detected. Try speaking closer to the mic.',
    'empty-audio': 'The audio recording was empty. Please try again.',
    'no-api-key': 'Missing OpenAI API key on the backend.',
  }[speechError];

  // Rendered as a fragment so the buttons flow inline inside the call control bar.
  return (
    <>
      {/* Status / error line floats just above the control bar */}
      {(recording || transcribing || errorText) && (
        <div className="ltb-inline-status" role="status" aria-live="polite">
          {recording && (
            <span className="ltb-status-item">
              <span className="ltb-dot recording" /> Recording… stop to transcribe
            </span>
          )}
          {!recording && transcribing && <span className="ltb-status-item">Transcribing with AI…</span>}
          {errorText && <span className="ltb-status-item ltb-error">{errorText}</span>}
        </div>
      )}

      {/* Manual line popover */}
      {(showManual || banner) && (
        <div className="ltb-manual-pop">
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Type a short line of what you said, then Add to transcript"
            rows={3}
          />
          <button type="button" className="ltb-add-btn" onClick={submitManual} disabled={!manualText.trim()}>
            Add to transcript
          </button>
        </div>
      )}

      <button
        type="button"
        className={`control-btn icon-only ${recording ? 'recording-active' : ''}`}
        onClick={recording ? stopListening : startRecording}
        disabled={transcribing || !enabled}
        title={recording ? 'Stop transcribing' : 'Start transcribing'}
        aria-label={recording ? 'Stop transcribing' : 'Start transcribing'}
      >
        <span style={{ fontWeight: 800, fontSize: 13 }}>{recording ? '■' : 'CC'}</span>
      </button>
      <button
        type="button"
        className={`control-btn icon-only ${showManual ? 'active' : ''}`}
        onClick={() => setShowManual((v) => !v)}
        title="Add a manual transcript line"
        aria-label="Add a manual transcript line"
      >
        <span style={{ fontWeight: 800, fontSize: 16 }}>✎</span>
      </button>
    </>
  );
}
