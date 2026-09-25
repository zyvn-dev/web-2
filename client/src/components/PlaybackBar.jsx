import React, { useState, useEffect } from 'react';

export default function PlaybackBar({ history, index, onChange, onClose }) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let interval = null;
    if (isPlaying) {
      interval = setInterval(() => {
        onChange((prevIndex) => {
          if (prevIndex >= history.length - 1) {
            setIsPlaying(false);
            return prevIndex;
          }
          return prevIndex + 1;
        });
      }, 800);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, history.length, onChange]);

  if (!history || history.length === 0) return null;

  const current = history[index];
  const oldest = history[0];
  const newest = history[history.length - 1];

  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString() : '--';

  return (
    <div className="playback-bar animate-slide-up">
      <div className="playback-controls">
        <button 
          className="play-btn"
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? '⏸️' : '▶️'}
        </button>
        
        <span className="time-label">{formatTime(oldest?.timestamp)}</span>
        
        <input
          type="range"
          min={0}
          max={history.length - 1}
          value={index}
          onChange={(e) => {
            setIsPlaying(false);
            onChange(Number(e.target.value));
          }}
        />

        <span className="time-label">{formatTime(newest?.timestamp)}</span>
      </div>

      <div className="playback-info">
        <span className="current-snapshot-time font-mono">
          ⏱️ {current ? formatTime(current.timestamp) : '--'}
        </span>
        <button className="btn btn-sm btn-primary" onClick={onClose}>
          🔴 Exit Playback (Live)
        </button>
      </div>
    </div>
  );
}
