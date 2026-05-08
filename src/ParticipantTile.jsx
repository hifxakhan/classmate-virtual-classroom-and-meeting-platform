import React, { useEffect, useRef } from 'react';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash } from 'react-icons/fa';

const ParticipantTile = ({ participant, canTeacherMute, onRequestMute, audioOnly = false }) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const tileName = participant.displayName || participant.name || participant.identity || 'Unknown';

  useEffect(() => {
    const el = videoRef.current;
    const track = participant.videoTrack;

    if (!el || audioOnly) return;

    if (!track || !participant.isVideoEnabled) {
      if (el.srcObject) {
        el.srcObject = null;
      }
      return;
    }

    track.attach(el);
    el.playsInline = true;
    el.autoplay = true;
    if (participant.isLocal) {
      el.muted = true;
    }

    const maybePlay = async () => {
      try {
        if (el.paused) await el.play();
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Participant video play error:', err);
        }
      }
    };

    maybePlay();

    return () => {
      track.detach(el);
      if (el.srcObject) {
        el.srcObject = null;
      }
    };
  }, [audioOnly, participant.isLocal, participant.videoTrack, participant.isVideoEnabled]);

  useEffect(() => {
    const el = audioRef.current;
    const track = participant.audioTrack;

    if (!el || !track) return;

    // Always reset element state before attaching a track.
    el.srcObject = null;
    track.attach(el);
    el.autoplay = true;
    el.playsInline = true;
    el.muted = !!participant.isLocal;
    el.volume = participant.isLocal ? 0 : 1;

    if (!participant.isLocal && typeof track.setVolume === 'function') {
      track.setVolume(1);
    }

    let retryListenerAttached = false;
    let resumePlaybackHandler = null;

    const maybePlay = async () => {
      try {
        if (el.paused) {
          await el.play();
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Participant audio play error:', err);

          // Browsers may block autoplay with sound; retry on first user gesture.
          if (!participant.isLocal && !retryListenerAttached && err?.name === 'NotAllowedError') {
            retryListenerAttached = true;
            const resumePlayback = async () => {
              try {
                await el.play();
              } catch (resumeErr) {
                console.error('Participant audio resume error:', resumeErr);
              } finally {
                window.removeEventListener('click', resumePlayback);
                window.removeEventListener('keydown', resumePlayback);
              }
            };
            resumePlaybackHandler = resumePlayback;

            window.addEventListener('click', resumePlayback, { once: true });
            window.addEventListener('keydown', resumePlayback, { once: true });
          }
        }
      }
    };

    maybePlay();

    return () => {
      if (resumePlaybackHandler) {
        window.removeEventListener('click', resumePlaybackHandler);
        window.removeEventListener('keydown', resumePlaybackHandler);
      }
      track.detach(el);
      if (el.srcObject) {
        el.srcObject = null;
      }
    };
  }, [participant.audioTrack, participant.isLocal, participant.identity]);

  return (
    <article className={`participant-tile ${participant.isLocal ? 'local' : ''}`}>
      {!audioOnly && participant.videoTrack && participant.isVideoEnabled ? (
        <video ref={videoRef} className="video-element" />
      ) : (
        <div className="video-off-state">
          <div className="video-off-content">
            <div className="participant-avatar">
              {(tileName || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="video-off-name">{tileName}</div>
            <div className="video-off-label">
              <FaVideoSlash />
              <span>Camera off</span>
            </div>
          </div>
        </div>
      )}

      {participant.audioTrack ? <audio ref={audioRef} /> : null}

      <div className="tile-overlay">
        <div className="participant-meta">
          <span className="participant-name">{tileName}{participant.isLocal ? ' (You)' : ''}</span>
          <span className={`speaking-dot ${participant.isAudioEnabled ? 'active' : ''}`} title={participant.isAudioEnabled ? 'Speaking enabled' : 'Mic muted'} />
        </div>

        <div className="participant-indicators">
          <span className={`indicator-chip ${participant.isAudioEnabled ? '' : 'off'}`} title={participant.isAudioEnabled ? 'Microphone on' : 'Microphone muted'}>
            {participant.isAudioEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}
          </span>
          <span className={`indicator-chip ${participant.isVideoEnabled ? '' : 'off'}`} title={participant.isVideoEnabled ? 'Camera on' : 'Camera off'}>
            {participant.isVideoEnabled ? <FaVideo /> : <FaVideoSlash />}
          </span>
          {canTeacherMute ? (
            <button className="tile-mute-btn" onClick={() => onRequestMute(participant.identity)} title="Mute participant">
              <FaMicrophoneSlash />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
};

export default ParticipantTile;
