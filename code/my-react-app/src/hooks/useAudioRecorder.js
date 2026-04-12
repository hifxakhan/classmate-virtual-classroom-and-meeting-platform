import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultApiBaseUrl = () => {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv) return fromEnv;
  return 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app';
};

const withBoundedHistory = (items, maxItems = 1000) => {
  if (items.length <= maxItems) return items;
  return items.slice(items.length - maxItems);
};

export const useAudioRecorder = ({
  sessionId,
  speakerId,
  isRecording: shouldRecord,
  pollingEnabled = true,
  chunkMs = 30000,
  apiBaseUrl = defaultApiBaseUrl(),
}) => {
  const [transcripts, setTranscripts] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);

  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const isUploadingRef = useRef(false);
  const failedChunksRef = useRef([]);

  const endpointBase = useMemo(() => String(apiBaseUrl || '').replace(/\/$/, ''), [apiBaseUrl]);
  const pollIntervalMs = useMemo(() => {
    const raw = Number(import.meta.env.VITE_TRANSCRIPTION_POLL_INTERVAL || 2000);
    return Number.isFinite(raw) && raw > 0 ? raw : 2000;
  }, []);

  const appendTranscripts = useCallback((nextItems) => {
    setTranscripts((prev) => {
      const merged = [...prev, ...nextItems];
      return withBoundedHistory(merged, 1000);
    });
  }, []);

  const refreshTranscripts = useCallback(async () => {
    if (!sessionId || !endpointBase) return;

    try {
      const response = await fetch(`${endpointBase}/api/transcripts/${sessionId}?limit=1000&offset=0`);
      if (!response.ok) return;

      const payload = await response.json();
      if (!payload?.success || !Array.isArray(payload.transcripts)) return;

      setTranscripts(withBoundedHistory(payload.transcripts, 1000));
    } catch (err) {
      console.warn('[useAudioRecorder] polling failed:', err);
    }
  }, [endpointBase, sessionId]);

  const sendChunkWithRetry = useCallback(
    async (blob, maxRetries = 3, fromQueue = false) => {
      if (!blob || blob.size === 0 || !sessionId || !speakerId) return;
      if (isUploadingRef.current) return;

      isUploadingRef.current = true;

      try {
        let attempt = 0;
        let lastError = null;

        while (attempt < maxRetries) {
          attempt += 1;

          const formData = new FormData();
          formData.append('audio', blob, `audio_chunk_${Date.now()}.webm`);
          formData.append('session_id', String(sessionId));
          formData.append('speaker_id', String(speakerId));
          formData.append('language', 'en');

          console.log(`[useAudioRecorder] Uploading chunk attempt ${attempt}, size=${blob.size}`);

          const response = await fetch(`${endpointBase}/api/transcribe`, {
            method: 'POST',
            body: formData,
          });

          if (response.status === 429) {
            const payload = await response.json().catch(() => ({}));
            const retryAfterSec = Number(payload?.retry_after || 2) || 2;
            setError('Transcription queue full, waiting...');
            await wait(retryAfterSec * 1000 * attempt);
            continue;
          }

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            lastError = new Error(payload?.error || `Upload failed (${response.status})`);
            await wait(500 * 2 ** attempt);
            continue;
          }

          const payload = await response.json();
          if (payload?.success && typeof payload?.transcript === 'string') {
            appendTranscripts([
              {
                id: payload.id || `local-${Date.now()}`,
                session_id: Number(sessionId),
                speaker_id: String(speakerId),
                text: payload.transcript,
                timestamp: new Date().toISOString(),
                participant_name: null,
                is_fallback: Boolean(payload?.is_fallback),
              },
            ]);
          }

          setError(null);
          return;
        }

        if (lastError) {
          throw lastError;
        }
      } catch (err) {
        console.error('[useAudioRecorder] chunk upload failed:', err);
        setError(err.message || 'Failed to upload audio chunk');

        // Keep failed chunks for future retry instead of dropping audio.
        if (!fromQueue) {
          failedChunksRef.current.push({
            blob,
            retries: 0,
            createdAt: Date.now(),
          });
        }
      } finally {
        isUploadingRef.current = false;
      }
    },
    [appendTranscripts, endpointBase, sessionId, speakerId]
  );

  const retryFailedChunks = useCallback(async () => {
    if (!failedChunksRef.current.length) return;
    if (isUploadingRef.current) return;

    const pending = [...failedChunksRef.current];
    failedChunksRef.current = [];

    for (const item of pending) {
      if (item.retries >= 3) continue;
      try {
        await sendChunkWithRetry(item.blob, 2, true);
      } catch (_err) {
        failedChunksRef.current.push({ ...item, retries: item.retries + 1 });
      }
    }
  }, [sendChunkWithRetry]);

  const stopRecording = useCallback(() => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch (err) {
      console.warn('[useAudioRecorder] recorder stop warning:', err);
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording || !sessionId || !speakerId) return;

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType: preferredType });

      recorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size === 0) return;
        await sendChunkWithRetry(event.data, 3);
      };

      recorder.onerror = (event) => {
        console.error('[useAudioRecorder] recorder error:', event.error);
        setError(event.error?.message || 'Recorder error');
      };

      recorder.onstop = () => {
        setIsRecording(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(chunkMs);
      setIsRecording(true);
      console.log('[useAudioRecorder] recording started');
    } catch (err) {
      console.error('[useAudioRecorder] start failed:', err);
      setError('Microphone permission denied or unavailable');
      setIsRecording(false);
    }
  }, [chunkMs, isRecording, sendChunkWithRetry, sessionId, speakerId]);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
  }, []);

  useEffect(() => {
    if (shouldRecord) {
      void startRecording();
    } else {
      stopRecording();
    }
  }, [shouldRecord, startRecording, stopRecording]);

  useEffect(() => {
    if (!pollingEnabled || !sessionId) return;

    void refreshTranscripts();
    const id = setInterval(() => {
      void refreshTranscripts();
    }, pollIntervalMs);

    const retryId = setInterval(() => {
      void retryFailedChunks();
    }, 7000);

    return () => {
      clearInterval(id);
      clearInterval(retryId);
    };
  }, [pollingEnabled, refreshTranscripts, retryFailedChunks, sessionId, pollIntervalMs]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return {
    transcripts,
    isRecording,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
    refreshTranscripts,
  };
};

export default useAudioRecorder;
