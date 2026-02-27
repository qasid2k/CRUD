import React, { useState, useEffect } from 'react';
import { Play, Download, X, Clock, FileAudio, RefreshCw } from 'lucide-react';
import { api } from '../api/client';

interface Recording {
    filename: string;
    size: number;
    created_at: string;
    path: string;
}

interface RecordingPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

const RecordingPanel: React.FC<RecordingPanelProps> = ({ isOpen, onClose }) => {
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [loading, setLoading] = useState(false);
    const [playingFile, setPlayingFile] = useState<string | null>(null);

    const fetchRecordings = async () => {
        setLoading(true);
        try {
            const data = await api.getRecordings(50);
            setRecordings(data);
        } catch (error) {
            console.error('Failed to fetch recordings', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchRecordings();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString();
    };

    return (
        <>
            <div className="modal-overlay" onClick={onClose} />
            <div className="side-panel">
                <div className="side-panel-header">
                    <h2>
                        <FileAudio size={20} style={{ marginRight: 8 }} />
                        Call Recordings
                    </h2>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-icon" onClick={fetchRecordings} title="Refresh">
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button className="btn-icon" onClick={onClose}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="side-panel-content">
                    {loading && recordings.length === 0 ? (
                        <div className="panel-loading">
                            <RefreshCw className="animate-spin" />
                            <p>Fetching recordings...</p>
                        </div>
                    ) : recordings.length === 0 ? (
                        <div className="panel-empty">
                            <FileAudio size={48} style={{ opacity: 0.2 }} />
                            <p>No recordings found.</p>
                            <small>Ensure Asterisk is recording to the volume mount.</small>
                        </div>
                    ) : (
                        <div className="recording-list">
                            {recordings.map((rec) => (
                                <div key={rec.filename} className={`recording-item ${playingFile === rec.filename ? 'active' : ''}`}>
                                    <div className="recording-info">
                                        <div className="recording-name" title={rec.filename}>
                                            {rec.filename.length > 30 ? rec.filename.substring(0, 27) + '...' : rec.filename}
                                        </div>
                                        <div className="recording-meta">
                                            <span><Clock size={12} /> {formatDate(rec.created_at)}</span>
                                            <span>| {formatSize(rec.size)}</span>
                                        </div>
                                    </div>
                                    <div className="recording-actions">
                                        <button
                                            className="btn-icon action-play"
                                            onClick={() => setPlayingFile(playingFile === rec.filename ? null : rec.filename)}
                                            title="Play"
                                        >
                                            <Play size={16} fill={playingFile === rec.filename ? "currentColor" : "none"} />
                                        </button>
                                        <a
                                            href={api.getRecordingUrl(rec.filename)}
                                            download
                                            className="btn-icon"
                                            title="Download"
                                        >
                                            <Download size={16} />
                                        </a>
                                    </div>

                                    {playingFile === rec.filename && (
                                        <div className="mini-player">
                                            <audio controls autoPlay src={api.getRecordingUrl(rec.filename)}>
                                                Your browser does not support the audio element.
                                            </audio>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .side-panel {
                    position: fixed;
                    right: 0;
                    top: 0;
                    bottom: 0;
                    width: 400px;
                    background: var(--bg-secondary);
                    box-shadow: -5px 0 15px rgba(0,0,0,0.3);
                    z-index: 1000;
                    display: flex;
                    flex-direction: column;
                    border-left: 1px solid var(--border);
                    animation: slideIn 0.3s ease-out;
                }

                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }

                .side-panel-header {
                    padding: 20px;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .side-panel-header h2 {
                    display: flex;
                    align-items: center;
                    margin: 0;
                    font-size: 1.2rem;
                    color: var(--text-primary);
                }

                .side-panel-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                }

                .recording-list {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .recording-item {
                    background: var(--bg-primary);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    transition: all 0.2s;
                }

                .recording-item:hover {
                    border-color: var(--accent);
                    transform: translateY(-2px);
                }

                .recording-item.active {
                    border-color: var(--accent);
                    background: var(--bg-hover);
                }

                .recording-info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .recording-name {
                    font-weight: 500;
                    font-size: 0.9rem;
                    color: var(--text-primary);
                }

                .recording-meta {
                    display: flex;
                    gap: 10px;
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                }

                .recording-meta span {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .recording-actions {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                }

                .btn-icon {
                    padding: 6px;
                    border-radius: 4px;
                    color: var(--text-secondary);
                    transition: all 0.2s;
                    cursor: pointer;
                    background: none;
                    border: none;
                }

                .btn-icon:hover {
                    color: var(--accent);
                    background: var(--bg-hover);
                }

                .action-play:hover {
                    color: #10b981;
                }

                .mini-player {
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid var(--border);
                }

                .mini-player audio {
                    width: 100%;
                    height: 32px;
                }

                .panel-empty, .panel-loading {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 200px;
                    color: var(--text-secondary);
                    text-align: center;
                    padding: 20px;
                }

                .modal-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.5);
                    z-index: 999;
                    backdrop-filter: blur(2px);
                }
            `}</style>
        </>
    );
};

export default RecordingPanel;
