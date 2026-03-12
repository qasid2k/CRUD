import React, { useState, useEffect, useMemo } from 'react';
import {
    RefreshCw, Search, Play, Pause, Trash2, Mail, MailOpen,
    Inbox, Archive, Clock, AlertCircle, ArrowRight, Voicemail,
    FolderPlus, X
} from 'lucide-react';
import { api } from '../api/client';
import ThemeToggle from './ThemeToggle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Mailbox {
    context: string;
    mailbox: string;
    fullname: string | null;
    email: string | null;
}

interface FolderInfo {
    name: string;
    count: number;
    is_custom?: boolean;
    is_protected?: boolean;
}

interface VoicemailMessage {
    id: number;
    msgnum: number;
    context: string;
    mailbox: string;
    folder: string;
    callerid: string;
    origtime: string;
    duration: number;
    msg_id: string;
    has_audio: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const VoicemailPanel: React.FC = () => {
    // State
    const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
    const [selectedMailbox, setSelectedMailbox] = useState<string>('');
    const [folders, setFolders] = useState<FolderInfo[]>([]);
    const [selectedFolder, setSelectedFolder] = useState<string>('INBOX');
    const [messages, setMessages] = useState<VoicemailMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [playingMsg, setPlayingMsg] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [actionLoading, setActionLoading] = useState<number | null>(null);
    const [counts, setCounts] = useState<{ new: number; old: number; total: number } | null>(null);
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderActionLoading, setFolderActionLoading] = useState(false);

    // ---- Fetch mailboxes on mount ----
    useEffect(() => {
        fetchMailboxes();
    }, []);

    // ---- When mailbox changes, load its folders and messages ----
    useEffect(() => {
        if (selectedMailbox) {
            fetchFolders();
            fetchMessages();
            fetchCounts();
        }
    }, [selectedMailbox, selectedFolder]);

    const fetchMailboxes = async () => {
        try {
            const data = await api.getVoicemailMailboxes();
            setMailboxes(data);
            if (data.length > 0 && !selectedMailbox) {
                setSelectedMailbox(data[0].mailbox);
            }
        } catch (err) {
            console.error('Failed to fetch mailboxes', err);
        }
    };

    const fetchFolders = async () => {
        try {
            const data = await api.getVoicemailFolders(selectedMailbox);
            setFolders(data);
        } catch (err) {
            console.error('Failed to fetch folders', err);
        }
    };

    const fetchMessages = async () => {
        setLoading(true);
        try {
            const data = await api.getVoicemailMessages(selectedMailbox, selectedFolder);
            setMessages(data);
        } catch (err) {
            console.error('Failed to fetch voicemail messages', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchCounts = async () => {
        try {
            const data = await api.getVoicemailCount(selectedMailbox);
            setCounts(data);
        } catch (err) {
            console.error('Failed to fetch counts', err);
        }
    };

    const handleRefresh = () => {
        fetchFolders();
        fetchMessages();
        fetchCounts();
    };

    // ---- Actions ----
    const handleDelete = async (msg: VoicemailMessage) => {
        if (!confirm(`Delete voicemail from "${msg.callerid}"?`)) return;
        setActionLoading(msg.msgnum);
        try {
            await api.deleteVoicemail(selectedMailbox, selectedFolder, msg.msgnum);
            if (playingMsg === msg.msgnum) setPlayingMsg(null);
            handleRefresh();
        } catch (err) {
            console.error('Failed to delete message', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleMarkRead = async (msg: VoicemailMessage) => {
        setActionLoading(msg.msgnum);
        try {
            await api.moveVoicemail(selectedMailbox, 'INBOX', 'Old', msg.msgnum);
            handleRefresh();
        } catch (err) {
            console.error('Failed to mark as read', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleMarkNew = async (msg: VoicemailMessage) => {
        setActionLoading(msg.msgnum);
        try {
            await api.moveVoicemail(selectedMailbox, 'Old', 'INBOX', msg.msgnum);
            handleRefresh();
        } catch (err) {
            console.error('Failed to mark as new', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleMove = async (msg: VoicemailMessage, toFolder: string) => {
        setActionLoading(msg.msgnum);
        try {
            await api.moveVoicemail(selectedMailbox, selectedFolder, toFolder, msg.msgnum);
            handleRefresh();
        } catch (err) {
            console.error('Failed to move message', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleCreateFolder = async () => {
        const name = newFolderName.trim();
        if (!name) return;
        setFolderActionLoading(true);
        try {
            await api.createVoicemailFolder(selectedMailbox, name);
            setNewFolderName('');
            setShowNewFolder(false);
            fetchFolders();
        } catch (err: any) {
            const detail = err?.response?.data?.detail || 'Failed to create folder';
            alert(detail);
        } finally {
            setFolderActionLoading(false);
        }
    };

    const handleDeleteFolder = async (folderName: string) => {
        if (!confirm(`Delete folder "${folderName}"? It must be empty.`)) return;
        setFolderActionLoading(true);
        try {
            await api.deleteVoicemailFolder(selectedMailbox, folderName);
            if (selectedFolder === folderName) setSelectedFolder('INBOX');
            fetchFolders();
        } catch (err: any) {
            const detail = err?.response?.data?.detail || 'Failed to delete folder';
            alert(detail);
        } finally {
            setFolderActionLoading(false);
        }
    };

    // ---- Helpers ----
    const formatDuration = (seconds: number) => {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (isoStr: string) => {
        try {
            const d = new Date(isoStr);
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            if (isToday) {
                return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return isoStr;
        }
    };

    const parseCallerName = (callerid: string) => {
        // Asterisk callerid often looks like: "Name" <number>
        const match = callerid.match(/^"?([^"<]*)"?\s*<?(\d*)>?$/);
        if (match) {
            return { name: match[1].trim() || 'Unknown', number: match[2] || '' };
        }
        return { name: callerid || 'Unknown', number: '' };
    };

    const getFolderIcon = (name: string) => {
        switch (name) {
            case 'INBOX': return <Inbox size={15} />;
            case 'Old': return <Archive size={15} />;
            case 'Urgent': return <AlertCircle size={15} />;
            default: return <Mail size={15} />;
        }
    };

    const filteredMessages = useMemo(() => {
        return messages.filter(m =>
            m.callerid?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.msg_id?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [messages, searchQuery]);

    const activeFolders = useMemo(() => {
        return folders.filter(f => f.count > 0 || ['INBOX', 'Old', 'Urgent'].includes(f.name) || f.is_custom);
    }, [folders]);

    // ---- Render ----
    return (
        <div className="content-area">
            {/* Header */}
            <header className="top-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Voicemail size={24} />
                        Voicemail
                    </h1>
                    {counts && (
                        <div style={{
                            display: 'flex', gap: '8px', alignItems: 'center',
                            fontSize: '12px', fontWeight: 600
                        }}>
                            {counts.new > 0 && (
                                <span className="vm-badge vm-badge-new">
                                    {counts.new} New
                                </span>
                            )}
                            <span className="vm-badge vm-badge-total">
                                {counts.total} Total
                            </span>
                        </div>
                    )}
                </div>
                <div className="actions">
                    <ThemeToggle />
                    <button className="btn btn-icon" onClick={handleRefresh}>
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </header>

            <div className="vm-layout">
                {/* Left Sidebar: Mailbox + Folder Navigation */}
                <div className="vm-sidebar">
                    {/* Mailbox Selector */}
                    <div className="vm-mailbox-selector">
                        <label className="vm-sidebar-label">Mailbox</label>
                        <select
                            className="vm-select"
                            value={selectedMailbox}
                            onChange={(e) => {
                                setSelectedMailbox(e.target.value);
                                setSelectedFolder('INBOX');
                                setPlayingMsg(null);
                            }}
                        >
                            {mailboxes.map(mb => (
                                <option key={mb.mailbox} value={mb.mailbox}>
                                    {mb.fullname || mb.mailbox} ({mb.mailbox})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Folder List */}
                    <div className="vm-folder-list">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px 0 0' }}>
                            <label className="vm-sidebar-label">Folders</label>
                            <button
                                className="vm-add-folder-btn"
                                onClick={() => setShowNewFolder(!showNewFolder)}
                                title="Create new folder"
                            >
                                {showNewFolder ? <X size={14} /> : <FolderPlus size={14} />}
                            </button>
                        </div>

                        {/* New Folder Input */}
                        {showNewFolder && (
                            <div className="vm-new-folder-row">
                                <input
                                    className="vm-new-folder-input"
                                    type="text"
                                    placeholder="Folder name..."
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                                    autoFocus
                                    maxLength={40}
                                />
                                <button
                                    className="vm-new-folder-save"
                                    onClick={handleCreateFolder}
                                    disabled={!newFolderName.trim() || folderActionLoading}
                                >
                                    {folderActionLoading ? '...' : '+'}
                                </button>
                            </div>
                        )}

                        {activeFolders.map(f => (
                            <div
                                key={f.name}
                                className={`vm-folder-item ${selectedFolder === f.name ? 'active' : ''}`}
                                onClick={() => {
                                    setSelectedFolder(f.name);
                                    setPlayingMsg(null);
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                                    {getFolderIcon(f.name)}
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    {f.count > 0 && (
                                        <span className={`vm-folder-count ${f.name === 'INBOX' && f.count > 0 ? 'highlight' : ''}`}>
                                            {f.count}
                                        </span>
                                    )}
                                    {f.is_custom && !f.is_protected && (
                                        <button
                                            className="vm-folder-delete-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteFolder(f.name);
                                            }}
                                            title={`Delete folder "${f.name}"`}
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Main Content: Message List */}
                <div className="vm-main">
                    {/* Search Bar */}
                    <div className="vm-search-bar">
                        <div className="search-box" style={{ flex: 1, maxWidth: '400px' }}>
                            <Search className="search-box-icon" />
                            <input
                                type="text"
                                placeholder="Search voicemails..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>
                            {filteredMessages.length} message{filteredMessages.length !== 1 ? 's' : ''}
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="vm-message-list">
                        {loading && messages.length === 0 ? (
                            <div className="vm-empty">
                                <RefreshCw className="animate-spin" size={32} />
                                <span>Loading voicemails...</span>
                            </div>
                        ) : filteredMessages.length === 0 ? (
                            <div className="vm-empty">
                                <Inbox size={48} style={{ opacity: 0.3 }} />
                                <span style={{ fontSize: '15px', fontWeight: 500 }}>
                                    {messages.length === 0
                                        ? `No voicemails in ${selectedFolder}`
                                        : 'No matching voicemails'}
                                </span>
                                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                                    {messages.length === 0
                                        ? 'When someone leaves a voicemail, it will appear here.'
                                        : 'Try a different search term.'}
                                </span>
                            </div>
                        ) : (
                            filteredMessages.map((msg) => {
                                const caller = parseCallerName(msg.callerid);
                                const isPlaying = playingMsg === msg.msgnum;
                                const isActionLoading = actionLoading === msg.msgnum;

                                return (
                                    <React.Fragment key={`${msg.folder}-${msg.msgnum}`}>
                                        <div className={`vm-message-card ${isPlaying ? 'playing' : ''} ${selectedFolder === 'INBOX' ? 'unread' : ''}`}>
                                            {/* Left: Caller Info */}
                                            <div className="vm-msg-info">
                                                <div className="vm-msg-avatar" style={{
                                                    background: selectedFolder === 'INBOX'
                                                        ? 'linear-gradient(135deg, var(--primary), var(--accent))'
                                                        : 'var(--hover-bg)',
                                                    color: selectedFolder === 'INBOX' ? 'white' : 'var(--text-muted)'
                                                }}>
                                                    {caller.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="vm-msg-details">
                                                    <div className="vm-msg-caller">
                                                        {caller.name}
                                                        {caller.number && (
                                                            <span className="vm-msg-number">{caller.number}</span>
                                                        )}
                                                    </div>
                                                    <div className="vm-msg-meta">
                                                        <Clock size={12} />
                                                        <span>{formatDate(msg.origtime)}</span>
                                                        <span className="vm-msg-dot">•</span>
                                                        <span>{formatDuration(msg.duration)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: Actions */}
                                            <div className="vm-msg-actions">
                                                {msg.has_audio && (
                                                    <button
                                                        className={`vm-action-btn play ${isPlaying ? 'active' : ''}`}
                                                        onClick={() => setPlayingMsg(isPlaying ? null : msg.msgnum)}
                                                        title={isPlaying ? 'Stop' : 'Play'}
                                                    >
                                                        {isPlaying ? <Pause size={16} fill="var(--accent)" /> : <Play size={16} />}
                                                    </button>
                                                )}

                                                {/* Mark as Read / New */}
                                                {selectedFolder === 'INBOX' ? (
                                                    <button
                                                        className="vm-action-btn"
                                                        onClick={() => handleMarkRead(msg)}
                                                        disabled={isActionLoading}
                                                        title="Mark as Read (move to Old)"
                                                    >
                                                        <MailOpen size={16} />
                                                    </button>
                                                ) : selectedFolder === 'Old' ? (
                                                    <button
                                                        className="vm-action-btn"
                                                        onClick={() => handleMarkNew(msg)}
                                                        disabled={isActionLoading}
                                                        title="Mark as New (move to INBOX)"
                                                    >
                                                        <Mail size={16} />
                                                    </button>
                                                ) : null}

                                                {/* Move dropdown */}
                                                <div className="vm-move-dropdown">
                                                    <button
                                                        className="vm-action-btn"
                                                        disabled={isActionLoading}
                                                        title="Move to folder"
                                                    >
                                                        <ArrowRight size={16} />
                                                    </button>
                                                    <div className="vm-move-menu">
                                                        {folders.filter(f => f.name !== selectedFolder).map(f => (
                                                            <div
                                                                key={f.name}
                                                                className="vm-move-option"
                                                                onClick={() => handleMove(msg, f.name)}
                                                            >
                                                                {getFolderIcon(f.name)}
                                                                <span>{f.name}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Delete */}
                                                <button
                                                    className="vm-action-btn delete"
                                                    onClick={() => handleDelete(msg)}
                                                    disabled={isActionLoading}
                                                    title="Delete"
                                                >
                                                    {isActionLoading
                                                        ? <RefreshCw size={16} className="animate-spin" />
                                                        : <Trash2 size={16} />}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Inline Audio Player */}
                                        {isPlaying && msg.has_audio && (
                                            <div className="vm-player-row">
                                                <audio
                                                    controls
                                                    autoPlay
                                                    src={api.getVoicemailStreamUrl(selectedMailbox, selectedFolder, msg.msgnum)}
                                                    style={{ width: '100%' }}
                                                    onEnded={() => setPlayingMsg(null)}
                                                />
                                            </div>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Scoped Styles */}
            <style>{`
                /* ---- Layout ---- */
                .vm-layout {
                    display: flex;
                    flex: 1;
                    gap: 0;
                    overflow: hidden;
                    border-radius: 12px;
                    border: 1px solid var(--border);
                    background: var(--card-bg);
                    backdrop-filter: blur(12px);
                }

                /* ---- Sidebar ---- */
                .vm-sidebar {
                    width: 240px;
                    min-width: 240px;
                    border-right: 1px solid var(--border);
                    padding: 16px 0;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                    overflow-y: auto;
                }

                .vm-sidebar-label {
                    display: block;
                    font-size: 10px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    color: var(--text-muted);
                    padding: 0 16px;
                    margin-bottom: 8px;
                }

                .vm-mailbox-selector {
                    padding: 0 12px;
                }

                .vm-select {
                    width: 100%;
                    background: var(--input-bg);
                    color: var(--text-main);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    padding: 10px 12px;
                    font-size: 13px;
                    font-family: inherit;
                    font-weight: 600;
                    outline: none;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }

                .vm-select:focus {
                    border-color: var(--primary);
                }

                .vm-folder-list {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .vm-add-folder-btn {
                    background: transparent;
                    border: 1px solid var(--border);
                    color: var(--text-muted);
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .vm-add-folder-btn:hover {
                    background: rgba(79, 70, 229, 0.1);
                    border-color: var(--primary);
                    color: var(--primary);
                }

                .vm-new-folder-row {
                    display: flex;
                    gap: 4px;
                    margin: 4px 8px 8px;
                }

                .vm-new-folder-input {
                    flex: 1;
                    background: var(--input-bg);
                    border: 1px solid var(--border);
                    color: var(--text-main);
                    padding: 7px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-family: inherit;
                    outline: none;
                    transition: border-color 0.2s;
                }

                .vm-new-folder-input:focus {
                    border-color: var(--primary);
                }

                .vm-new-folder-save {
                    background: var(--primary);
                    color: white;
                    border: none;
                    width: 30px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }

                .vm-new-folder-save:hover:not(:disabled) {
                    background: #4338ca;
                }

                .vm-new-folder-save:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                .vm-folder-delete-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-muted);
                    width: 20px;
                    height: 20px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    opacity: 0;
                    transition: all 0.15s;
                }

                .vm-folder-item:hover .vm-folder-delete-btn {
                    opacity: 1;
                }

                .vm-folder-delete-btn:hover {
                    color: var(--danger);
                    background: rgba(239, 68, 68, 0.1);
                }

                .vm-folder-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 16px;
                    margin: 0 8px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-muted);
                    transition: all 0.15s;
                }

                .vm-folder-item:hover {
                    background: var(--hover-bg);
                    color: var(--text-main);
                }

                .vm-folder-item.active {
                    background: rgba(79, 70, 229, 0.12);
                    color: var(--primary);
                    font-weight: 700;
                }

                .vm-folder-count {
                    background: var(--hover-bg);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: 700;
                    min-width: 22px;
                    text-align: center;
                }

                .vm-folder-count.highlight {
                    background: var(--primary);
                    color: white;
                    box-shadow: 0 2px 8px var(--primary-glow);
                }

                /* ---- Main Content ---- */
                .vm-main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .vm-search-bar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 20px;
                    border-bottom: 1px solid var(--border);
                }

                .vm-message-list {
                    flex: 1;
                    overflow-y: auto;
                }

                .vm-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 16px;
                    padding: 80px 20px;
                    color: var(--text-muted);
                }

                /* ---- Message Card ---- */
                .vm-message-card {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--border);
                    transition: background 0.15s;
                    gap: 16px;
                }

                .vm-message-card:hover {
                    background: var(--hover-bg);
                }

                .vm-message-card.playing {
                    background: rgba(6, 182, 212, 0.05);
                    border-left: 3px solid var(--accent);
                }

                .vm-message-card.unread {
                    border-left: 3px solid var(--primary);
                }

                .vm-message-card.unread .vm-msg-caller {
                    font-weight: 800;
                }

                .vm-msg-info {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    flex: 1;
                    min-width: 0;
                }

                .vm-msg-avatar {
                    width: 40px;
                    height: 40px;
                    min-width: 40px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    font-size: 16px;
                }

                .vm-msg-details {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    min-width: 0;
                }

                .vm-msg-caller {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-main);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .vm-msg-number {
                    font-size: 11px;
                    font-weight: 600;
                    background: var(--hover-bg);
                    padding: 1px 8px;
                    border-radius: 4px;
                    color: var(--text-muted);
                    border: 1px solid var(--border);
                }

                .vm-msg-meta {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    color: var(--text-muted);
                }

                .vm-msg-dot {
                    opacity: 0.4;
                }

                /* ---- Actions ---- */
                .vm-msg-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                }

                .vm-action-btn {
                    width: 34px;
                    height: 34px;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: transparent;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    color: var(--text-muted);
                }

                .vm-action-btn:hover {
                    border-color: var(--primary);
                    color: var(--primary);
                    background: rgba(79, 70, 229, 0.08);
                }

                .vm-action-btn.play:hover,
                .vm-action-btn.play.active {
                    color: var(--accent);
                    border-color: var(--accent);
                    background: rgba(6, 182, 212, 0.08);
                }

                .vm-action-btn.delete:hover {
                    color: var(--danger);
                    border-color: var(--danger);
                    background: rgba(239, 68, 68, 0.08);
                }

                .vm-action-btn:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                /* ---- Move Dropdown ---- */
                .vm-move-dropdown {
                    position: relative;
                }

                .vm-move-menu {
                    display: none;
                    position: absolute;
                    right: 0;
                    top: 100%;
                    margin-top: 4px;
                    background: var(--bg-dark);
                    border: 1px solid var(--border);
                    border-radius: 10px;
                    padding: 6px;
                    min-width: 160px;
                    z-index: 100;
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
                }

                .vm-move-dropdown:hover .vm-move-menu {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .vm-move-option {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 13px;
                    cursor: pointer;
                    color: var(--text-muted);
                    transition: all 0.15s;
                }

                .vm-move-option:hover {
                    background: var(--hover-bg);
                    color: var(--text-main);
                }

                /* ---- Player ---- */
                .vm-player-row {
                    padding: 0 20px 16px 20px;
                    background: rgba(6, 182, 212, 0.03);
                    border-bottom: 1px solid var(--border);
                }

                .vm-player-row audio {
                    border-radius: 8px;
                }

                /* ---- Badges ---- */
                .vm-badge {
                    display: inline-flex;
                    align-items: center;
                    padding: 3px 10px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 700;
                }

                .vm-badge-new {
                    background: rgba(79, 70, 229, 0.15);
                    color: var(--primary);
                    border: 1px solid rgba(79, 70, 229, 0.3);
                }

                .vm-badge-total {
                    background: var(--hover-bg);
                    color: var(--text-muted);
                    border: 1px solid var(--border);
                }

                /* ---- Responsive ---- */
                @media (max-width: 768px) {
                    .vm-layout {
                        flex-direction: column;
                    }

                    .vm-sidebar {
                        width: 100%;
                        min-width: 100%;
                        border-right: none;
                        border-bottom: 1px solid var(--border);
                        flex-direction: row;
                        padding: 12px;
                        gap: 12px;
                        overflow-x: auto;
                    }

                    .vm-folder-list {
                        flex-direction: row;
                        gap: 4px;
                    }

                    .vm-folder-item {
                        white-space: nowrap;
                        margin: 0;
                    }

                    .vm-mailbox-selector {
                        min-width: 200px;
                    }

                    .vm-sidebar-label {
                        display: none;
                    }

                    .vm-msg-actions {
                        gap: 4px;
                    }

                    .vm-action-btn {
                        width: 30px;
                        height: 30px;
                    }
                }
            `}</style>
        </div>
    );
};

export default VoicemailPanel;
