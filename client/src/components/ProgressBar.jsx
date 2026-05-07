import React from 'react';

export default function ProgressBar({ value = 0, size = 'md' }) {
  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2.5';
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={`w-full bg-gray-700 rounded-full ${heightClass} overflow-hidden`}>
      <div
        className={`bg-emerald-500 ${heightClass} rounded-full transition-all duration-500`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
