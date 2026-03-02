import React, { useState, useEffect, useMemo } from 'react';
import { Play, Download, Trash2, Search, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import ThemeToggle from './ThemeToggle';

interface Recording {
    filename: string;
    size: number;
    created_at: string;
    path: string;
}

const RecordingPanel: React.FC = () => {
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [loading, setLoading] = useState(false);
    const [playingFile, setPlayingFile] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [rowsPerPage, setRowsPerPage] = useState(100);

    const fetchRecordings = async () => {
        setLoading(true);
        try {
            const data = await api.getRecordings(200); // Fetch more for better filtering
            setRecordings(data);
        } catch (error) {
            console.error('Failed to fetch recordings', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecordings();
    }, []);

    const filteredRecordings = useMemo(() => {
        return recordings
            .filter(r => r.filename.toLowerCase().includes(searchQuery.toLowerCase()))
            .slice(0, rowsPerPage);
    }, [recordings, searchQuery, rowsPerPage]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return (
        <div className="content-area">
            {/* Header matching screenshot style */}
            <header className="top-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Call Center</h1>
                    <div style={{ width: '1px', height: '20px', background: 'var(--border)' }}></div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>Recordings</span>
                </div>
                <div className="actions">
                    <ThemeToggle />
                    <button className="btn btn-icon" onClick={fetchRecordings}>
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </header>

            <div className="recordings-container">
                {/* Search and Controls */}
                <div className="recordings-controls">
                    <select
                        className="cdr-select"
                        value={rowsPerPage}
                        onChange={(e) => setRowsPerPage(Number(e.target.value))}
                        style={{ width: '80px' }}
                    >
                        <option value={10}>10</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>

                    <div className="search-box">
                        <Search className="search-box-icon" />
                        <input
                            type="text"
                            placeholder="Search Here..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* Main Table */}
                <div className="table-container">
                    <div className="table-scroll">
                        <table className="recordings-table-modern">
                            <thead>
                                <tr>
                                    <th style={{ width: '60px' }}>Sr#</th>
                                    <th>Title</th>
                                    <th style={{ textAlign: 'center' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && recordings.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="empty-row">
                                            <div className="loading-state">
                                                <RefreshCw className="animate-spin" />
                                                <span>Loading recordings...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredRecordings.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="empty-row">
                                            No recordings found.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredRecordings.map((rec, index) => (
                                        <React.Fragment key={rec.filename}>
                                            <tr className={playingFile === rec.filename ? 'row-playing' : ''}>
                                                <td>{index + 1}</td>
                                                <td>
                                                    <div className="rec-title-cell">
                                                        <span className="rec-filename">{rec.filename}</span>
                                                        <span className="rec-info">{new Date(rec.created_at).toLocaleString()} • {formatSize(rec.size)}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="rec-actions-cell">
                                                        <button
                                                            className={`rec-btn play ${playingFile === rec.filename ? 'active' : ''}`}
                                                            onClick={() => setPlayingFile(playingFile === rec.filename ? null : rec.filename)}
                                                        >
                                                            <Play size={18} fill={playingFile === rec.filename ? "#10b981" : "none"} />
                                                        </button>
                                                        <a href={api.getRecordingUrl(rec.filename)} download className="rec-btn download">
                                                            <Download size={18} />
                                                        </a>
                                                        <button className="rec-btn delete">
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {playingFile === rec.filename && (
                                                <tr className="player-row">
                                                    <td colSpan={3}>
                                                        <div className="inline-player">
                                                            <audio controls autoPlay src={api.getRecordingUrl(rec.filename)} style={{ width: '100%' }} />
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <footer className="recordings-footer">
                    Copyright © 2026 CRM By Tech Bridge Consultancy. All Right Reserved.
                </footer>
            </div>

            <style>{`
                .recordings-container {
                    padding: 24px;
                    background: var(--bg-hover);
                    min-height: calc(100vh - 100px);
                }

                .recordings-controls {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    background: var(--bg-primary);
                    padding: 16px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                }

                .recordings-table-modern {
                    width: 100%;
                    border-collapse: collapse;
                    background: var(--bg-primary);
                    border-radius: 8px;
                    overflow: hidden;
                }

                .recordings-table-modern th {
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                    font-weight: 600;
                    text-align: left;
                    padding: 16px;
                    border-bottom: 2px solid var(--border);
                }

                .recordings-table-modern td {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--border);
                    vertical-align: middle;
                }

                .row-playing {
                    background: var(--bg-hover) !important;
                }

                .rec-title-cell {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .rec-filename {
                    font-weight: 500;
                    color: var(--text-primary);
                }

                .rec-info {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                }

                .rec-actions-cell {
                    display: flex;
                    justify-content: center;
                    gap: 12px;
                }

                .rec-btn {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 1px solid var(--border);
                    background: transparent;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    color: var(--text-muted);
                }

                .rec-btn:hover {
                    border-color: var(--accent);
                    color: var(--accent);
                    background: var(--bg-hover);
                }

                .rec-btn.play:hover, .rec-btn.play.active {
                    color: #10b981;
                    border-color: #10b981;
                }

                .rec-btn.delete:hover {
                    color: #ef4444;
                    border-color: #ef4444;
                }

                .player-row td {
                    padding: 0 16px 16px 16px;
                    background: var(--bg-hover);
                }

                .inline-player {
                    padding: 12px;
                    background: var(--bg-primary);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                }

                .recordings-footer {
                    margin-top: 40px;
                    text-align: center;
                    color: var(--text-muted);
                    font-size: 0.85rem;
                    padding-bottom: 20px;
                }

                .empty-row {
                    height: 200px;
                    text-align: center;
                    color: var(--text-muted);
                }

                .loading-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 12px;
                }
            `}</style>
        </div>
    );
};

export default RecordingPanel;
