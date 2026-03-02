import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, Calendar, User, Clock, Phone, PhoneOff, PhoneMissed, BarChart3, Filter, ChevronLeft, ChevronRight, Layers, Play } from 'lucide-react';
import { api } from '../api/client';
import ThemeToggle from './ThemeToggle';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface HeatmapRow {
    agent: string;
    date: string;
    hours: Record<string, number>;
    total_minutes: number;
}

interface AgentSummary {
    agent: string;
    total_calls: number;
    total_duration_sec: number;
    total_duration_min: number;
    answered: number;
    abandoned: number;
    no_answer: number;
    busy: number;
    failed: number;
}

interface HourlyVolume {
    hour: number;
    calls: number;
}

interface CdrData {
    agents: string[];
    queues: string[];
    dates: string[];
    heatmap: HeatmapRow[];
    agent_summary: AgentSummary[];
    hourly_volume: HourlyVolume[];
    total_records: number;
    generated_at: string;
}

/* ------------------------------------------------------------------ */
/* Color helper – maps minutes → heatmap color                        */
/* ------------------------------------------------------------------ */
function getHeatColor(minutes: number): string {
    if (minutes === 0) return 'transparent';
    if (minutes < 1) return '#c6efce';       // very light green
    if (minutes < 5) return '#6bcf7f';       // green
    if (minutes < 15) return '#a8d945';      // yellow-green
    if (minutes < 30) return '#ffd644';      // yellow
    if (minutes < 60) return '#ffaa33';      // orange
    if (minutes < 120) return '#ff6633';     // dark orange
    return '#e8352e';                         // red
}

function getHeatTextColor(minutes: number): string {
    if (minutes === 0) return 'transparent';
    if (minutes >= 60) return '#fff';
    return '#1a1a2e';
}

/* ------------------------------------------------------------------ */
/* Day name helper                                                     */
/* ------------------------------------------------------------------ */
function getDayName(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
const CdrReport: React.FC = () => {
    const [data, setData] = useState<CdrData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedAgent, setSelectedAgent] = useState<string>('all');
    const [selectedQueue, setSelectedQueue] = useState<string>('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [activeTab, setActiveTab] = useState<'heatmap' | 'summary' | 'hourly' | 'logs'>('heatmap');
    const [availableAgents, setAvailableAgents] = useState<string[]>([]);
    const [availableQueues, setAvailableQueues] = useState<string[]>([]);
    const [callLogs, setCallLogs] = useState<any[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);

    /* ---------- fetch data ---------- */
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            let result: CdrData;
            if (selectedAgent !== 'all') {
                result = await api.getCdrAgent(selectedAgent, startDate || undefined, endDate || undefined);
            } else if (startDate && endDate) {
                result = await api.getCdrTimeRange(startDate, endDate, selectedQueue !== 'all' ? selectedQueue : undefined);
            } else {
                result = await api.getCdrSummary(startDate || undefined, endDate || undefined, selectedQueue !== 'all' ? selectedQueue : undefined);
            }

            setData(result);

            // Persist lists... (keeping existing logic)
            if (result.queues.length > 0) {
                setAvailableQueues(prev => Array.from(new Set([...prev, ...result.queues])).sort());
            }
            if (result.agents.length > 0 && (selectedAgent === 'all' || availableAgents.length === 0)) {
                setAvailableAgents(prev => Array.from(new Set([...prev, ...result.agents])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to load CDR data');
        } finally {
            setLoading(false);
        }
    }, [selectedAgent, selectedQueue, startDate, endDate, availableAgents.length]);

    const fetchLogs = useCallback(async () => {
        setLogsLoading(true);
        try {
            // Fetch raw CDR records from the generic table endpoint
            const logs = await api.getTableData('cdr', 0, 50);
            setCallLogs(logs);
        } catch (err) {
            console.error('Failed to fetch call logs', err);
        } finally {
            setLogsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        if (activeTab === 'logs') fetchLogs();
    }, [fetchData, fetchLogs, activeTab]);

    /* ---------- (rest of hooks remains same) ---------- */

    /* ---------- derived data ---------- */
    const heatmapByAgent = useMemo(() => {
        if (!data) return {};
        const map: Record<string, HeatmapRow[]> = {};
        for (const row of data.heatmap) {
            if (!map[row.agent]) map[row.agent] = [];
            map[row.agent].push(row);
        }
        return map;
    }, [data]);

    const displayAgents = useMemo(() => {
        if (!data) return [];
        if (selectedAgent !== 'all') return data.agents.filter(a => a === selectedAgent);
        return data.agents;
    }, [data, selectedAgent]);

    const rangeLabel = useMemo(() => {
        if (loading) return 'Loading...';
        if (!data || !data.dates || data.dates.length === 0) return 'No data';

        const start = data.dates[0];
        const end = data.dates[data.dates.length - 1];

        const formatDateShort = (dStr: string) => {
            const d = new Date(dStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };

        const year = new Date(start + 'T00:00:00').getFullYear();
        return `${formatDateShort(start)} - ${formatDateShort(end)}, ${year} `;
    }, [data, loading]);

    const hours = Array.from({ length: 24 }, (_, i) => i);

    /* ---------- week navigation ---------- */
    const shiftWeek = (direction: 'prev' | 'next') => {
        // Find current start or default to today
        const baseDate = startDate ? new Date(startDate + 'T00:00:00') : new Date();

        // Find the Monday of that week
        const currentMonday = new Date(baseDate);
        const day = currentMonday.getDay(); // 0 is Sunday, 1 is Monday...
        const diff = (day === 0 ? -6 : 1 - day); // Distance to Monday
        currentMonday.setDate(currentMonday.getDate() + diff);

        const offset = direction === 'next' ? 7 : -7;
        const newStart = new Date(currentMonday);
        newStart.setDate(newStart.getDate() + offset);

        const newEnd = new Date(newStart);
        newEnd.setDate(newEnd.getDate() + 6);

        setStartDate(newStart.toISOString().split('T')[0]);
        setEndDate(newEnd.toISOString().split('T')[0]);
    };

    const resetToThisWeek = () => {
        setStartDate('');
        setEndDate('');
        setSelectedQueue('all');
    };

    /* ---------- manual refresh ---------- */
    const handleRefresh = async () => {
        try {
            await api.refreshCdr();
        } catch { /* ignore */ }
        fetchData();
    };

    /* ================================================================ */
    /* RENDER                                                            */
    /* ================================================================ */
    return (
        <div className="content-area">
            {/* ---- Top bar ---- */}
            <header className="top-bar">
                <h1>
                    <BarChart3 size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />
                    Asterisk CDR Reports
                </h1>
                <div className="actions">
                    <ThemeToggle />
                    <button className="btn btn-icon" onClick={handleRefresh} title="Refresh data">
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </header>

            {/* ---- Filters ---- */}
            <div className="cdr-filters">
                <div className="cdr-filter-group">
                    <Filter size={16} />
                    <label>Agent:</label>
                    <select
                        value={selectedAgent}
                        onChange={e => setSelectedAgent(e.target.value)}
                        className="cdr-select"
                    >
                        <option value="all">All Agents</option>
                        {availableAgents.map(a => (
                            <option key={a} value={a}>Extension {a}</option>
                        ))}
                    </select>
                </div>

                <div className="cdr-filter-group">
                    <Layers size={16} />
                    <label>Queue:</label>
                    <select
                        value={selectedQueue}
                        onChange={e => {
                            setSelectedQueue(e.target.value);
                            setSelectedAgent('all'); // Reset agent when queue changes
                        }}
                        className="cdr-select"
                    >
                        <option value="all">All Queues</option>
                        {availableQueues.map(q => (
                            <option key={q} value={q}>{q}</option>
                        ))}
                    </select>
                </div>

                <div className="cdr-filter-group">
                    <Calendar size={16} />
                    <label>From:</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="cdr-input"
                    />
                    <label>To:</label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="cdr-input"
                    />
                </div>

                <div className="cdr-filter-group" style={{ marginLeft: 'auto' }}>
                    <div className="cdr-nav-container">
                        <div className="cdr-nav-group">
                            <button className="cdr-nav-btn" onClick={() => shiftWeek('prev')} title="Previous Week">
                                <ChevronLeft size={18} />
                            </button>
                            <button className={`cdr-nav-btn today ${!startDate ? 'active' : ''}`} onClick={resetToThisWeek}>
                                This Week
                            </button>
                            <button className="cdr-nav-btn" onClick={() => shiftWeek('next')} title="Next Week">
                                <ChevronRight size={18} />
                            </button>
                        </div>
                        <div className="cdr-nav-label">
                            <Calendar size={14} />
                            <span>{rangeLabel}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ---- Tabs ---- */}
            <div className="cdr-tabs">
                <button
                    className={`cdr-tab ${activeTab === 'heatmap' ? 'active' : ''}`}
                    onClick={() => setActiveTab('heatmap')}
                >
                    <Clock size={16} /> Heatmap
                </button>
                <button
                    className={`cdr-tab ${activeTab === 'summary' ? 'active' : ''}`}
                    onClick={() => setActiveTab('summary')}
                >
                    <User size={16} /> Agent Summary
                </button>
                <button
                    className={`cdr-tab ${activeTab === 'hourly' ? 'active' : ''}`}
                    onClick={() => setActiveTab('hourly')}
                >
                    <BarChart3 size={16} /> Hourly Volume
                </button>
                <button
                    className={`cdr-tab ${activeTab === 'logs' ? 'active' : ''}`}
                    onClick={() => setActiveTab('logs')}
                >
                    <Clock size={16} /> Call Logs
                </button>
            </div>

            {/* ---- Error ---- */}
            {error && <div className="cdr-error">{error}</div>}

            {/* ---- Loading ---- */}
            {loading && !data && (
                <div className="cdr-loading">
                    <RefreshCw size={32} className="animate-spin" />
                    <p>Loading CDR data...</p>
                </div>
            )}

            {/* ================================================================ */}
            {/* HEATMAP TAB                                                       */}
            {/* ================================================================ */}
            {activeTab === 'heatmap' && data && (
                <div className="cdr-heatmap-section">
                    {displayAgents.length === 0 && (
                        <div className="cdr-empty">No agent data found for the selected filters.</div>
                    )}

                    {displayAgents.map(agent => (
                        <div key={agent} className="cdr-agent-block">
                            <h2 className="cdr-agent-title">
                                <User size={18} /> Extension {agent}
                            </h2>

                            <div className="cdr-heatmap-scroll">
                                <table className="cdr-heatmap-table">
                                    <thead>
                                        <tr>
                                            <th className="cdr-date-col">Date</th>
                                            {hours.map(h => (
                                                <th key={h} className="cdr-hour-col">{h}</th>
                                            ))}
                                            <th className="cdr-total-col">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(heatmapByAgent[agent] || []).map(row => (
                                            <tr key={row.date}>
                                                <td className="cdr-date-cell" title={formatDate(row.date)}>
                                                    <span className="cdr-day-name">{getDayName(row.date)}</span>
                                                    <span className="cdr-date-text">{row.date}</span>
                                                </td>
                                                {hours.map(h => {
                                                    const val = row.hours[String(h)] || 0;
                                                    return (
                                                        <td
                                                            key={h}
                                                            className="cdr-heat-cell"
                                                            style={{
                                                                backgroundColor: getHeatColor(val),
                                                                color: getHeatTextColor(val),
                                                            }}
                                                            title={`${formatDate(row.date)} ${h}:00 — ${val} min`}
                                                        >
                                                            {val > 0 ? Math.round(val) : ''}
                                                        </td>
                                                    );
                                                })}
                                                <td className="cdr-total-cell">
                                                    {Math.round(row.total_minutes)} min
                                                </td>
                                            </tr>
                                        ))}
                                        {(!heatmapByAgent[agent] || heatmapByAgent[agent].length === 0) && (
                                            <tr>
                                                <td colSpan={26} className="cdr-empty-row">
                                                    No call data for this agent.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Color legend */}
                            <div className="cdr-legend">
                                <span className="cdr-legend-label">Minutes:</span>
                                {[
                                    { min: 0.5, label: '<1' },
                                    { min: 3, label: '1-5' },
                                    { min: 10, label: '5-15' },
                                    { min: 20, label: '15-30' },
                                    { min: 45, label: '30-60' },
                                    { min: 90, label: '60-120' },
                                    { min: 150, label: '120+' },
                                ].map(item => (
                                    <span
                                        key={item.label}
                                        className="cdr-legend-item"
                                        style={{ backgroundColor: getHeatColor(item.min), color: getHeatTextColor(item.min) }}
                                    >
                                        {item.label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ================================================================ */}
            {/* AGENT SUMMARY TAB                                                */}
            {/* ================================================================ */}
            {activeTab === 'summary' && data && (
                <div className="cdr-summary-section">
                    <div className="cdr-stats-grid">
                        {data.agent_summary.map(agent => (
                            <div key={agent.agent} className="cdr-stat-card">
                                <div className="cdr-stat-header">
                                    <User size={20} />
                                    <span>Extension {agent.agent}</span>
                                </div>
                                <div className="cdr-stat-body">
                                    <div className="cdr-stat-row">
                                        <Phone size={14} />
                                        <span>Total Calls</span>
                                        <strong>{agent.total_calls}</strong>
                                    </div>
                                    <div className="cdr-stat-row">
                                        <Clock size={14} />
                                        <span>Talk Time</span>
                                        <strong>{agent.total_duration_min} min</strong>
                                    </div>
                                    <div className="cdr-stat-row answered">
                                        <Phone size={14} />
                                        <span>Answered</span>
                                        <strong>{agent.answered}</strong>
                                    </div>
                                    <div className="cdr-stat-row abandoned">
                                        <PhoneOff size={14} />
                                        <span>Abandoned</span>
                                        <strong>{agent.abandoned}</strong>
                                    </div>
                                    <div className="cdr-stat-row no-answer">
                                        <PhoneMissed size={14} />
                                        <span>No Answer</span>
                                        <strong>{agent.no_answer}</strong>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {data.agent_summary.length === 0 && (
                        <div className="cdr-empty">No agent data for the selected filters.</div>
                    )}
                </div>
            )}

            {/* ================================================================ */}
            {/* HOURLY VOLUME TAB                                                */}
            {/* ================================================================ */}
            {activeTab === 'hourly' && data && (
                <div className="cdr-hourly-section">
                    <h2 className="cdr-section-title">Call Volume by Hour of Day</h2>
                    <div className="cdr-bar-chart">
                        {data.hourly_volume.map(item => {
                            const maxCalls = Math.max(...data.hourly_volume.map(v => v.calls), 1);
                            const heightPct = (item.calls / maxCalls) * 100;
                            return (
                                <div key={item.hour} className="cdr-bar-wrapper">
                                    <span className="cdr-bar-value">{item.calls || ''}</span>
                                    <div
                                        className="cdr-bar"
                                        style={{
                                            height: `${heightPct}% `,
                                            backgroundColor: item.calls > 0
                                                ? `hsl(${140 - (heightPct * 1.2)}, 75 %, 50 %)`
                                                : 'var(--border)',
                                            minHeight: item.calls > 0 ? '4px' : '2px',
                                        }}
                                        title={`${item.hour}:00 — ${item.calls} calls`}
                                    />
                                    <span className="cdr-bar-label">{item.hour}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ================================================================ */}
            {/* CALL LOGS TAB                                                    */}
            {/* ================================================================ */}
            {activeTab === 'logs' && (
                <div className="cdr-logs-section">
                    <h2 className="cdr-section-title">Individual Call Records</h2>
                    <div className="table-container">
                        <div className="table-scroll">
                            <table className="cdr-heatmap-table" style={{ width: '100%' }}>
                                <thead>
                                    <tr>
                                        <th>Date/Time</th>
                                        <th>Source</th>
                                        <th>Destination</th>
                                        <th>Duration</th>
                                        <th>Status</th>
                                        <th style={{ textAlign: 'center' }}>Play</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logsLoading ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px' }}>Loading records...</td></tr>
                                    ) : callLogs.length === 0 ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px' }}>No records found.</td></tr>
                                    ) : (
                                        callLogs.map((log, idx) => (
                                            <tr key={idx}>
                                                <td>{new Date(log.calldate).toLocaleString()}</td>
                                                <td>{log.src}</td>
                                                <td>{log.dst}</td>
                                                <td>{log.duration}s</td>
                                                <td>
                                                    <span className={`status-pill ${log.disposition?.toLowerCase()}`}>
                                                        {log.disposition}
                                                    </span>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {log.has_recording && (
                                                        <button
                                                            className="rec-btn play"
                                                            style={{ margin: '0 auto' }}
                                                            onClick={() => {
                                                                const filename = log.userfield || `${log.uniqueid}.wav`;
                                                                window.open(api.getRecordingUrl(filename), '_blank');
                                                            }}
                                                        >
                                                            <Play size={16} fill="#10b981" />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ---- Footer ---- */}
            {data && (
                <div className="cdr-footer">
                    <span>Total queue_log records processed: {data.total_records}</span>
                    <span>Last generated: {new Date(data.generated_at).toLocaleString()}</span>
                </div>
            )}
        </div>
    );
};

export default CdrReport;
