import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './TranscriptPanel.css';

const TranscriptPanel = ({
  sessionId,
  isOpen,
  onClose,
  apiBaseUrl = import.meta.env.VITE_API_URL || 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app',
  liveTranscripts = [],
}) => {
  const [transcripts, setTranscripts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const transcriptsEndRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const lastTranscriptIdRef = useRef(0);
  const endpointBase = useMemo(() => String(apiBaseUrl || '').replace(/\/$/, ''), [apiBaseUrl]);
  const pollIntervalMs = useMemo(() => {
    const raw = Number(import.meta.env.VITE_TRANSCRIPTION_POLL_INTERVAL || 2000);
    return Number.isFinite(raw) && raw > 0 ? raw : 2000;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (autoScroll && transcriptsEndRef.current) {
      transcriptsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [autoScroll]);

  const fetchTranscripts = useCallback(async (showLoading = false) => {
    if (!sessionId) return;

    if (showLoading) setIsLoading(true);

    try {
      const response = await fetch(`${endpointBase}/api/transcripts/${sessionId}?limit=100`);
      const data = await response.json();

      if (data.success && data.transcripts) {
        const newTranscripts = data.transcripts;

        if (newTranscripts.length > 0) {
          const latestId = newTranscripts[newTranscripts.length - 1].id;
          if (latestId !== lastTranscriptIdRef.current) {
            setTranscripts(newTranscripts);
            lastTranscriptIdRef.current = latestId;
            setTimeout(scrollToBottom, 100);
          }
        } else {
          setTranscripts([]);
        }

        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch transcripts:', err);
      setError(err.message || 'Failed to fetch transcripts');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [sessionId, endpointBase, scrollToBottom]);

  useEffect(() => {
    if (!isOpen || !sessionId) return;

    void fetchTranscripts(true);

    pollingIntervalRef.current = setInterval(() => {
      void fetchTranscripts(false);
    }, pollIntervalMs);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [isOpen, sessionId, fetchTranscripts, pollIntervalMs]);

  useEffect(() => {
    if (!liveTranscripts || liveTranscripts.length === 0) return;

    const latestLive = liveTranscripts[liveTranscripts.length - 1];
    if (latestLive?.id && latestLive.id !== lastTranscriptIdRef.current) {
      setTranscripts((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const incoming = liveTranscripts.filter((t) => !existingIds.has(t.id));
        return [...prev, ...incoming];
      });
      lastTranscriptIdRef.current = latestLive.id;
      setTimeout(scrollToBottom, 100);
    }
  }, [liveTranscripts, scrollToBottom]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const groupBySpeaker = () => {
    const grouped = {};
    transcripts.forEach((transcript) => {
      const speaker = transcript.speaker_id || transcript.participant_name || 'Unknown';
      if (!grouped[speaker]) grouped[speaker] = [];
      grouped[speaker].push(transcript);
    });
    return grouped;
  };

  if (!isOpen) return null;

  const groupedTranscripts = groupBySpeaker();

  return (
    <div className="transcript-panel">
      <div className="transcript-header">
        <h3>
          Live Captions
          <span className="transcript-count">({transcripts.length})</span>
        </h3>
        <div className="transcript-controls">
          <button
            className={`auto-scroll-btn ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
          >
            Pin
          </button>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>
      </div>

      <div className="transcript-content">
        {isLoading && transcripts.length === 0 && (
          <div className="transcript-loading">Loading captions...</div>
        )}

        {error && (
          <div className="transcript-error">
            Error: {error}
            <button onClick={() => void fetchTranscripts(true)}>Retry</button>
          </div>
        )}

        {!isLoading && transcripts.length === 0 && !error && (
          <div className="transcript-empty">
            <p>No captions yet</p>
            <small>Captions will appear here when someone speaks</small>
          </div>
        )}

        {Object.entries(groupedTranscripts).map(([speaker, speakerTranscripts]) => (
          <div key={speaker} className="transcript-speaker-group">
            <div className="speaker-name">
              <span className="speaker-icon">Mic</span>
              {speaker}
            </div>
            {speakerTranscripts.map((transcript) => (
              <div key={transcript.id} className="transcript-message">
                <div className="transcript-time">{formatTime(transcript.timestamp)}</div>
                <div className="transcript-text">
                  {transcript.text}
                  {transcript.is_translated && (
                    <span className="translated-badge">Translated</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

        <div ref={transcriptsEndRef} />
      </div>

      <div className="transcript-footer">
        <small>Live transcription in progress</small>
      </div>
    </div>
  );
};

export default TranscriptPanel;
