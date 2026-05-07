import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Setup from './pages/Setup';
import Scope from './pages/Scope';
import Audit from './pages/Audit';
import Findings from './pages/Findings';
import Export from './pages/Export';

const navItems = [
  { path: '/', label: 'Setup' },
  { path: '/scope', label: 'Scope' },
  { path: '/audit', label: 'Audit' },
  { path: '/findings', label: 'Findings' },
  { path: '/export', label: 'Export' },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <nav className="border-b border-gray-800 bg-gray-900">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-8">
            <span className="text-lg font-bold text-emerald-400 tracking-tight">
              Daybreak Solana
            </span>
            <div className="flex gap-1">
              {navItems.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Setup />} />
            <Route path="/scope" element={<Scope />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/findings" element={<Findings />} />
            <Route path="/export" element={<Export />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
