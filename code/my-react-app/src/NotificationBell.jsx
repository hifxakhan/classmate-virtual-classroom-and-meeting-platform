import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from './apiBase';
import './NotificationBell.css';

const API_BASE = getApiBase();

const TYPE_ICON = {
  assignment:    '📋',
  quiz:          '📝',
  session:       '📅',
  session_start: '🔴',
  enrollment:    '🎓',
  submission:    '📤',
  download:      '⬇️',
};

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell({ userId, userType = 'student' }) {
  const [open, setOpen]       = useState(false);
  const [notifs, setNotifs]   = useState([]);
  const [count, setCount]     = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  const fetchCount = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(
        `${API_BASE}/api/notifications/unread-count?user_id=${encodeURIComponent(userId)}&user_type=${userType}`
      );
      const d = await r.json();
      if (d.success) setCount(d.count);
    } catch { /* silent */ }
  }, [userId, userType]);

  const fetchNotifs = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/notifications?user_id=${encodeURIComponent(userId)}&user_type=${userType}&limit=30`
      );
      const d = await r.json();
      if (d.success) setNotifs(d.notifications || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [userId, userType]);

  // Poll unread count every 30 s
  useEffect(() => {
    fetchCount();
    const t = setInterval(fetchCount, 30000);
    return () => clearInterval(t);
  }, [fetchCount]);

  // Fetch list when panel opens
  useEffect(() => {
    if (open) fetchNotifs();
  }, [open, fetchNotifs]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markRead = async (id) => {
    try {
      await fetch(`${API_BASE}/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifs(prev => prev.map(n => n.notification_id === id ? { ...n, is_read: true } : n));
      setCount(prev => Math.max(0, prev - 1));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    try {
      await fetch(
        `${API_BASE}/api/notifications/mark-all-read?user_id=${encodeURIComponent(userId)}&user_type=${userType}`,
        { method: 'PATCH' }
      );
      setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
      setCount(0);
    } catch { /* silent */ }
  };

  const handleClick = (n) => {
    if (!n.is_read) markRead(n.notification_id);
    if (n.notif_type === 'session_start' || n.notif_type === 'session') {
      if (userType === 'student') navigate('/studentDashboard');
    } else if (n.notif_type === 'assignment' && userType === 'student') {
      navigate('/studentPerformance?tab=pending');
    } else if (n.notif_type === 'quiz' && userType === 'student') {
      navigate('/studentPerformance?tab=pending');
    } else if (n.notif_type === 'submission' && userType === 'teacher') {
      navigate('/courseProfile');
    }
    setOpen(false);
  };

  if (!userId) return null;

  return (
    <div className="nb-wrap" ref={panelRef}>
      <button className="nb-bell" onClick={() => setOpen(o => !o)} aria-label="Notifications">
        <i className="fas fa-bell" />
        {count > 0 && <span className="nb-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="nb-panel">
          <div className="nb-header">
            <span className="nb-title">Notifications</span>
            {count > 0 && (
              <button className="nb-mark-all" onClick={markAllRead}>Mark all read</button>
            )}
          </div>

          <div className="nb-list">
            {loading && <div className="nb-empty">Loading…</div>}
            {!loading && notifs.length === 0 && (
              <div className="nb-empty">No notifications yet.</div>
            )}
            {!loading && notifs.map(n => (
              <div
                key={n.notification_id}
                className={`nb-item ${n.is_read ? 'read' : 'unread'}`}
                onClick={() => handleClick(n)}
              >
                <span className="nb-icon">{TYPE_ICON[n.notif_type] || '🔔'}</span>
                <div className="nb-body">
                  <div className="nb-item-title">{n.title}</div>
                  {n.message && <div className="nb-item-msg">{n.message}</div>}
                  <div className="nb-item-time">{timeAgo(n.created_at)}</div>
                </div>
                {!n.is_read && <span className="nb-dot" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
