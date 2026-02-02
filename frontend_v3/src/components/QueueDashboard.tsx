import React, { useState, useEffect } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '../api/client';
import type { QueueStatus } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import ThemeToggle from './ThemeToggle';

const getAvatarColor = (name: string) => {
    const colors = [
        '#4f46e5', // Indigo
        '#06b6d4', // Cyan
        '#10b981', // Emerald
        '#f59e0b', // Amber
        '#ef4444', // Red
        '#8b5cf6', // Violet
        '#ec4899', // Pink
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
};

const QueueDashboard: React.FC = () => {
    const [queues, setQueues] = useState<QueueStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    const fetchStatus = async () => {
        try {
            const data = await api.getQueueStatus();
            setQueues(data);
        } catch (err) {
            console.error('Failed to fetch queue status', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 3000);
        return () => clearInterval(interval);
    }, []);

    const filteredQueues = queues.filter(q =>
        q.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (loading && queues.length === 0) {
        return <div className="loading-state">Syncing live data...</div>;
    }

    return (
        <div className="dashboard-section">
            <header className="top-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <h1>Live Queues</h1>
                    <div className="search-box">
                        <Search className="search-box-icon" />
                        <input
                            type="text"
                            placeholder="Filter queues..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
                <div className="actions">
                    <ThemeToggle />
                    <button className="btn btn-icon" onClick={fetchStatus}>
                        <RefreshCw size={20} />
                    </button>
                </div>
            </header>

            <div className="dashboard-grid">
                <AnimatePresence mode="popLayout">
                    {filteredQueues.map((q) => (
                        <motion.div
                            key={q.name}
                            layout
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="queue-card"
                        >
                            <div className="queue-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                                <div>
                                    <h3 style={{ fontSize: '20px', fontWeight: 700 }}>{q.name}</h3>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{q.strategy}</span>
                                </div>
                                <div className="status-online live-pulse" style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--border)', background: 'var(--status-bg)' }}>
                                    ● {q.serviceLevel}% SL
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Answered</div>
                                    <div style={{ fontSize: '28px', fontWeight: 700 }}>{q.answered}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Abandoned</div>
                                    <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--danger)' }}>{q.abandoned}</div>
                                </div>
                            </div>

                            <div className="progress-container">
                                <div className="progress-header">
                                    <span style={{ color: q.callsWaiting > 0 ? 'var(--accent)' : 'inherit' }}>
                                        Calls Waiting
                                    </span>
                                    <span style={{ fontWeight: 800, color: q.callsWaiting > 0 ? 'var(--accent)' : 'inherit' }}>
                                        {q.callsWaiting}
                                    </span>
                                </div>
                                <div className={`progress-track ${q.callsWaiting > 0 ? 'pulse-glow' : ''}`}>
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min((q.callsWaiting / 10) * 100, 100)}%` }}
                                        transition={{ duration: 0.5 }}
                                        className="progress-fill"
                                        style={{
                                            background: q.callsWaiting > 5
                                                ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                                                : 'linear-gradient(90deg, var(--primary), var(--accent))'
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="member-section">
                                <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '16px' }}>AGENTS BY PENALTY</h4>
                                <div className="member-list">
                                    {Object.entries(
                                        q.members.reduce((acc, m) => {
                                            const p = m.penalty || 0;
                                            if (!acc[p]) acc[p] = [];
                                            acc[p].push(m);
                                            return acc;
                                        }, {} as Record<number, typeof q.members>)
                                    ).sort(([a], [b]) => Number(a) - Number(b)).map(([penalty, members]) => (
                                        <div key={penalty} style={{ marginBottom: '20px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                                <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: 800,
                                                    background: Number(penalty) === 0 ? 'var(--primary)' : 'var(--secondary)',
                                                    color: 'white',
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Tier {penalty}
                                                </span>
                                                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }}></div>
                                            </div>
                                            {members.map((m, idx) => (
                                                <div key={idx} className="member-item" style={{ marginBottom: '12px', borderBottom: members.length - 1 === idx ? 'none' : '1px solid var(--border)', paddingBottom: '12px' }}>
                                                    <div className="member-info">
                                                        <div
                                                            className="avatar"
                                                            style={{
                                                                background: `linear-gradient(135deg, ${getAvatarColor(m.name || m.number)}, rgba(0,0,0,0.3))`,
                                                                color: 'white',
                                                                border: 'none',
                                                                textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                                            }}
                                                        >
                                                            {(m.name || m.number).charAt(0)}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontSize: '13px', fontWeight: 600 }}>{m.name || 'Unknown'}</div>
                                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>EXT: {m.number}</div>
                                                            {m.connectedParty && (
                                                                <div style={{ marginTop: '4px', padding: '4px 8px', background: 'var(--talking-bg)', borderRadius: '4px', fontSize: '10px', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}>
                                                                    TALKING TO: {m.connectedParty.name || m.connectedParty.num}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className={`status-indicator status-${m.status.toLowerCase()}`}>
                                                        <div className="dot" /> {m.status}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default QueueDashboard;
