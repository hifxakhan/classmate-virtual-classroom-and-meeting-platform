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
      const OPENAI_API_KEY = import.meta.env.OPENAI_API_KEY;
      if (!blob || !blob.size) {
        setSpeechError('empty-audio');
        return;
      }
      if (!OPENAI_API_KEY) {
        setSpeechError('no-api-key');
        return;
      }
      setTranscribing(true);
      setSpeechError(null);
      try {
        const formData = new FormData();
        formData.append('file', blob, 'audio.webm');
        formData.append('model', 'whisper-1');

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: formData,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn('[transcript] Whisper API error', res.status, data);
          setSpeechError('api-failed');
          return;
        }

        const text = String(data.text || '').trim();
        if (!text) {
          setSpeechError('empty-transcript');
          return;
        }

        await postLine(text);
      } catch (e) {
        console.warn('[transcript] Whisper request failed', e);
        setSpeechError('api-failed');
      } finally {
        setTranscribing(false);
      }
    },
    [postLine]
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
          <span className={`lecture-transcript-dot ${recording ? 'on recording' : ''}`} />
          {recording
            ? 'Recording… audio will be transcribed when you stop.'
            : transcribing
            ? 'Transcribing your audio with AI…'
            : 'Ready to record a summary with your mic or type manually.'}
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

      <div className="lecture-transcript-controls">
        <button
          type="button"
          className="lecture-transcript-submit"
          onClick={recording ? stopListening : startRecording}
          disabled={transcribing || !enabled}
        >
          {recording ? 'Stop Recording' : 'Start Recording'}
        </button>
        {transcribing && (
          <span className="lecture-transcript-spinner" aria-live="polite">
            Transcribing…
          </span>
        )}
        {speechError && (
          <span className="lecture-transcript-error" role="status" aria-live="polite">
            {speechError === 'unsupported' && 'Live transcription is not supported in this browser.'}
            {speechError === 'not-allowed' &&
              'Microphone permission was denied. Enable it in your browser settings to record.'}
            {speechError === 'start-failed' &&
              'Could not start recording. Try again or use manual text input.'}
            {speechError === 'record-error' &&
              'An error occurred while recording. Please try again.'}
            {speechError === 'api-failed' &&
              'Transcription service failed. Please retry after a moment or type manually.'}
            {speechError === 'empty-transcript' &&
              'No speech was detected in the recording. Try speaking closer to the mic.'}
            {speechError === 'empty-audio' &&
              'The audio recording was empty. Please try recording again.'}
            {speechError === 'no-api-key' &&
              'Missing OpenAI API key. Set OPENAI_API_KEY in your environment.'}
          </span>
        )}
      </div>

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
