import React, { useState, useMemo } from 'react';
import { Search, Plus, RefreshCw, Trash2, Edit3, Database, ChevronUp, ChevronDown, Play } from 'lucide-react';
import { api } from '../api/client';
import type { TableSchema } from '../types';
import Modal from './Modal.tsx';

import ThemeToggle from './ThemeToggle';

interface TableBrowserProps {
    tables: string[];
    showToast: (msg: string, type?: 'success' | 'error') => void;
}

const TableBrowser: React.FC<TableBrowserProps> = ({ tables, showToast }) => {
    const [currentTable, setCurrentTable] = useState<string>('');
    const [data, setData] = useState<any[]>([]);
    const [schema, setSchema] = useState<TableSchema | null>(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRecord, setEditingRecord] = useState<any | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

    const isReadOnly = useMemo(() => {
        return ['queue_log', 'cdr'].includes(currentTable.toLowerCase());
    }, [currentTable]);

    const loadTableData = async (tableName: string) => {
        if (!tableName) return;
        setLoading(true);
        setSortConfig(null); // Reset sort when changing tables
        try {
            const [records, tableSchema] = await Promise.all([
                api.getTableData(tableName),
                api.getTableSchema(tableName)
            ]);
            setData(records);
            setSchema(tableSchema);
            setCurrentTable(tableName);
        } catch (err) {
            showToast('Failed to load table data', 'error');
        } finally {
            setLoading(false);
        }
    };

    const filteredData = useMemo(() => {
        let processed = [...data];

        // 1. Filter
        if (searchQuery) {
            const lowQuery = searchQuery.toLowerCase();
            processed = processed.filter(row =>
                Object.values(row).some(cell =>
                    String(cell).toLowerCase().includes(lowQuery)
                )
            );
        }

        // 2. Sort
        if (sortConfig) {
            processed.sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];

                if (aVal === bVal) return 0;

                const result = aVal < bVal ? -1 : 1;
                return sortConfig.direction === 'asc' ? result : -result;
            });
        }

        return processed;
    }, [data, searchQuery, sortConfig]);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleEdit = (record: any) => {
        setEditingRecord(record);
        setIsModalOpen(true);
    };

    const handleAdd = () => {
        setEditingRecord(null);
        setIsModalOpen(true);
    };

    const handleDelete = async (record: any) => {
        if (!schema) return;

        // Get all PK values and join them with :::
        const pkValues = schema.primary_keys.map(pk => record[pk]);
        const combinedId = pkValues.join(':::');

        if (pkValues.some(val => val === undefined || val === null)) {
            showToast('Could not find complete unique identifier', 'error');
            return;
        }

        if (!confirm(`Are you sure you want to delete record?`)) return;

        try {
            await api.deleteRecord(currentTable, combinedId);
            showToast('Record deleted successfully');
            loadTableData(currentTable);
        } catch (err) {
            showToast('Failed to delete record', 'error');
        }
    };

    const handleSave = async (formData: any) => {
        try {
            if (editingRecord && schema) {
                // Get all PK values for the update
                const pkValues = schema.primary_keys.map(pk => editingRecord[pk]);
                const combinedId = pkValues.join(':::');

                await api.updateRecord(currentTable, combinedId, formData);
                showToast('Record updated successfully');
            } else {
                await api.createRecord(currentTable, formData);
                showToast('Record created successfully');
            }
            setIsModalOpen(false);
            loadTableData(currentTable);
        } catch (err: any) {
            showToast(err.response?.data?.detail || 'Failed to save record', 'error');
        }
    };

    return (
        <div className="content-area">
            <header className="top-bar">
                <h1>{currentTable || 'Select a Table'}</h1>
                <div className="actions">
                    {currentTable && (
                        <>
                            <div className="search-box">
                                <Search className="search-box-icon" />
                                <input
                                    type="text"
                                    placeholder="Search records..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            {!isReadOnly && (
                                <button className="btn btn-primary" onClick={handleAdd}>
                                    <Plus size={18} /> New Record
                                </button>
                            )}
                        </>
                    )}
                    <ThemeToggle />
                    <button className="btn btn-icon" onClick={() => loadTableData(currentTable)}>
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </header>

            <div className="browser-controls">
                <div className="dropdown-wrapper">
                    <label className="dropdown-label">Switch Database Table</label>
                    <select
                        className="table-dropdown"
                        value={currentTable}
                        onChange={(e) => loadTableData(e.target.value)}
                    >
                        <option value="">Select a table to open...</option>
                        {tables.map(t => (
                            <option key={t} value={t}>{t.toUpperCase()}</option>
                        ))}
                    </select>
                </div>
            </div>

            {currentTable ? (
                <div className="table-container">
                    <div className="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    {schema?.fields.map(f => (
                                        <th
                                            key={f}
                                            onClick={() => handleSort(f)}
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {f}
                                                {sortConfig?.key === f ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                ) : (
                                                    <ChevronUp size={14} style={{ opacity: 0.2 }} />
                                                )}
                                            </div>
                                        </th>
                                    ))}
                                    <th style={{ width: '100px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredData.length > 0 ? (
                                    filteredData.map((row, idx) => (
                                        <tr key={idx}>
                                            {schema?.fields.map(f => (
                                                <td key={f} title={String(row[f])}>
                                                    {f === 'uniqueid' && ['cdr', 'queue_log'].includes(currentTable.toLowerCase()) ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <span>{String(row[f])}</span>
                                                            <button
                                                                className="btn-icon"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const filename = row.userfield || `${row.uniqueid}.wav`;
                                                                    window.open(api.getRecordingUrl(filename), '_blank');
                                                                }}
                                                                title="Play Recording"
                                                                style={{ color: '#10b981', padding: '2px' }}
                                                            >
                                                                <Play size={14} fill="#10b981" />
                                                            </button>
                                                        </div>
                                                    ) : String(row[f])}
                                                </td>
                                            ))}
                                            <td>
                                                {!isReadOnly && (
                                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                        <button className="btn-icon" onClick={() => handleEdit(row)}>
                                                            <Edit3 size={14} />
                                                        </button>
                                                        <button className="btn-icon" onClick={() => handleDelete(row)} style={{ color: 'var(--danger)' }}>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={100} style={{ textAlign: 'center', padding: '40px' }}>
                                            No records found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="empty-state">
                    <Database className="empty-icon" />
                    <p>Select a table from the menu above to start managing your data.</p>
                </div>
            )}

            {isModalOpen && schema && (
                <Modal
                    isOpen={isModalOpen}
                    title={editingRecord ? 'Edit Record' : 'New Record'}
                    fields={schema.fields}
                    primaryKeys={schema.primary_keys}
                    record={editingRecord}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                />
            )}
        </div>
    );
};

export default TableBrowser;
