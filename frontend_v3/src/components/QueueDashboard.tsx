import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import type { QueueStatus } from '../types';
import { motion, AnimatePresence } from 'framer-motion';

const QueueDashboard: React.FC = () => {
    const [queues, setQueues] = useState<QueueStatus[]>([]);
    const [loading, setLoading] = useState(true);

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

    if (loading && queues.length === 0) {
        return <div className="loading-state">Syncing live data...</div>;
    }

    return (
        <div className="dashboard-section">
            <header className="top-bar">
                <h1>Queue Real-time Dashboard</h1>
                <button className="btn btn-icon" onClick={fetchStatus}>
                    <RefreshCw size={20} />
                </button>
            </header>

            <div className="dashboard-grid">
                <AnimatePresence mode="popLayout">
                    {queues.map((q) => (
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
                                <div className="status-online live-pulse" style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
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

                            <div style={{ marginBottom: '24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
                                    <span>Calls Waiting</span>
                                    <span>{q.callsWaiting}</span>
                                </div>
                                <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min((q.callsWaiting / 10) * 100, 100)}%` }}
                                        transition={{ duration: 0.5 }}
                                        style={{ height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--accent))' }}
                                    />
                                </div>
                            </div>

                            <div className="member-section" style={{ borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
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
                                                        <div className="avatar">{(m.name || m.number).charAt(0)}</div>
                                                        <div>
                                                            <div style={{ fontSize: '13px', fontWeight: 600 }}>{m.name || 'Unknown'}</div>
                                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>EXT: {m.number}</div>
                                                            {m.connectedParty && (
                                                                <div style={{ marginTop: '4px', padding: '4px 8px', background: 'rgba(6, 182, 212, 0.05)', borderRadius: '4px', fontSize: '10px', color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}>
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
