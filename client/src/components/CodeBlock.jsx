import React from 'react';

export default function CodeBlock({ code, language = 'rust', file, line }) {
  return (
    <div className="rounded border border-gray-700 overflow-hidden">
      {(file || line) && (
        <div className="bg-gray-800 px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700 font-mono">
          {file}{line ? `:${line}` : ''}
        </div>
      )}
      <pre className="bg-gray-900 p-3 text-xs text-gray-300 overflow-x-auto font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
