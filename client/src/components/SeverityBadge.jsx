import React from 'react';

const SEVERITY_STYLES = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/40',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  informational: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
};

export default function SeverityBadge({ severity, size = 'sm' }) {
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.informational;
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`inline-block rounded border font-medium capitalize ${style} ${sizeClass}`}>
      {severity}
    </span>
  );
}
