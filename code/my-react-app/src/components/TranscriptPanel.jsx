import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

const formatTime = (value) => {
  if (!value) return '--:--';
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_e) {
    return '--:--';
  }
};

const getCurrentUserRole = () => {
  try {
    const raw = localStorage.getItem('currentUser') || localStorage.getItem('user');
    if (!raw) return 'student';
    const parsed = JSON.parse(raw);
    return String(parsed?.type || parsed?.role || 'student').toLowerCase();
  } catch (_e) {
    return 'student';
  }
};

const TranscriptPanel = ({
  sessionId,
  isOpen,
  onClose,
  className = '',
  apiBaseUrl = import.meta.env.VITE_API_URL || 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app',
  liveTranscripts = [],
}) => {
  const [transcripts, setTranscripts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSpeaker, setFilterSpeaker] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState('');

  const listRef = useRef(null);
  const role = useMemo(() => getCurrentUserRole(), []);
  const canDelete = role === 'teacher' || role === 'admin';
  const endpointBase = useMemo(() => String(apiBaseUrl || '').replace(/\/$/, ''), [apiBaseUrl]);

  const fetchTranscripts = async () => {
    if (!sessionId || !isOpen) return;

    setIsLoading(true);
    try {
      const response = await fetch(`${endpointBase}/api/transcripts/${sessionId}?limit=1000&offset=0`);
      if (!response.ok) {
        throw new Error(`Failed to load transcripts (${response.status})`);
      }

      const payload = await response.json();
      if (!payload?.success) {
        throw new Error(payload?.error || 'Failed to load transcripts');
      }

      setTranscripts(Array.isArray(payload.transcripts) ? payload.transcripts : []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load transcripts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void fetchTranscripts();
  }, [isOpen, sessionId]);

  useEffect(() => {
    if (!isOpen || !sessionId) return;

    const id = setInterval(() => {
      void fetchTranscripts();
    }, 5000);

    return () => clearInterval(id);
  }, [isOpen, sessionId, endpointBase]);

  useEffect(() => {
    if (!liveTranscripts?.length) return;

    setTranscripts((prev) => {
      const byId = new Map(prev.map((t) => [String(t.id), t]));
      for (const item of liveTranscripts) {
        byId.set(String(item.id), item);
      }
      return Array.from(byId.values()).slice(-1000);
    });
  }, [liveTranscripts]);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [transcripts, autoScroll]);

  const speakers = useMemo(() => {
    const set = new Set();
    for (const item of transcripts) {
      const key = String(item.speaker_id || 'unknown');
      set.add(key);
    }
    return Array.from(set);
  }, [transcripts]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return transcripts.filter((item) => {
      const speakerMatch = filterSpeaker === 'all' || String(item.speaker_id) === filterSpeaker;
      const textMatch = !query || String(item.text || '').toLowerCase().includes(query);
      return speakerMatch && textMatch;
    });
  }, [filterSpeaker, searchQuery, transcripts]);

  const rendered = filtered.length > 200 ? filtered.slice(filtered.length - 200) : filtered;

  const copyAll = async () => {
    const payload = filtered
      .map((t) => `[${formatTime(t.timestamp)}] ${t.participant_name || t.speaker_id}: ${t.text}`)
      .join('\n');

    await navigator.clipboard.writeText(payload);
  };

  const exportTxt = () => {
    const payload = filtered
      .map((t) => `[${formatTime(t.timestamp)}] ${t.participant_name || t.speaker_id}: ${t.text}`)
      .join('\n');

    const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcript_session_${sessionId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id) => {
    if (!canDelete) return;

    const response = await fetch(`${endpointBase}/api/transcripts/${id}`, {
      method: 'DELETE',
      headers: {
        'x-user-role': role,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload?.error || 'Failed to delete transcript');
      return;
    }

    setTranscripts((prev) => prev.filter((item) => item.id !== id));
  };

  if (!isOpen) return null;

  return (
    <aside
      className={className}
      style={{
        width: 300,
        maxWidth: '90vw',
        borderLeft: '1px solid rgba(159,176,201,0.22)',
        background: 'rgba(10,16,28,0.95)',
        color: '#e8eef8',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: 12, borderBottom: '1px solid rgba(159,176,201,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong>Live Transcript</strong>
          <button onClick={onClose} style={{ background: 'transparent', color: '#e8eef8', border: 0, cursor: 'pointer' }}>
            Close
          </button>
        </div>

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search transcript..."
          style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid rgba(159,176,201,0.25)' }}
        />

        <select
          value={filterSpeaker}
          onChange={(e) => setFilterSpeaker(e.target.value)}
          style={{ width: '100%', marginBottom: 8, padding: 8, borderRadius: 8, border: '1px solid rgba(159,176,201,0.25)' }}
        >
          <option value="all">All speakers</option>
          {speakers.map((speaker) => (
            <option key={speaker} value={speaker}>
              {speaker}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={copyAll}>Copy all</button>
          <button onClick={exportTxt}>Export TXT</button>
          <button onClick={() => setAutoScroll((v) => !v)}>{autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}</button>
        </div>
      </div>

      {error ? <div style={{ color: '#ff8ca0', padding: 10 }}>{error}</div> : null}
      {isLoading ? <div style={{ padding: 10 }}>Loading...</div> : null}
      {!isLoading && transcripts.length === 0 ? <div style={{ padding: 10, color: '#9fb0c9' }}>No transcript yet.</div> : null}
      {filtered.length > 200 ? (
        <div style={{ fontSize: 12, color: '#9fb0c9', padding: '6px 10px' }}>Showing latest 200 lines for performance</div>
      ) : null}

      <div ref={listRef} style={{ overflowY: 'auto', flex: 1, padding: 10 }}>
        {rendered.map((item, index) => (
          <div
            key={item.id || `${item.timestamp}-${index}`}
            style={{
              marginBottom: 8,
              padding: 8,
              borderRadius: 8,
              background: index % 2 === 0 ? 'rgba(26,41,66,0.6)' : 'rgba(17,28,47,0.6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <strong>{item.participant_name || item.speaker_id}</strong>
              <span style={{ fontSize: 11, color: '#9fb0c9' }}>{formatTime(item.timestamp)}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.4 }}>{item.text}</div>
            {canDelete ? (
              <button onClick={() => handleDelete(item.id)} style={{ marginTop: 6, fontSize: 12 }}>
                Delete
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
};

export default memo(TranscriptPanel);
