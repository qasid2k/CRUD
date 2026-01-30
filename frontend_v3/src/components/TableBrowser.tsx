import React, { useState, useMemo } from 'react';
import { Search, Plus, RefreshCw, Trash2, Edit3, Database } from 'lucide-react';
import { api } from '../api/client';
import type { TableSchema } from '../types';
import Modal from './Modal.tsx';

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

    const loadTableData = async (tableName: string) => {
        if (!tableName) return;
        setLoading(true);
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
        if (!searchQuery) return data;
        const lowQuery = searchQuery.toLowerCase();
        return data.filter(row =>
            Object.values(row).some(cell =>
                String(cell).toLowerCase().includes(lowQuery)
            )
        );
    }, [data, searchQuery]);

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
                            <button className="btn btn-primary" onClick={handleAdd}>
                                <Plus size={18} /> New Record
                            </button>
                        </>
                    )}
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
                                    {schema?.fields.map(f => <th key={f}>{f}</th>)}
                                    <th style={{ width: '100px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredData.length > 0 ? (
                                    filteredData.map((row, idx) => (
                                        <tr key={idx}>
                                            {schema?.fields.map(f => (
                                                <td key={f} title={String(row[f])}>{String(row[f])}</td>
                                            ))}
                                            <td>
                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                    <button className="btn-icon" onClick={() => handleEdit(row)}>
                                                        <Edit3 size={14} />
                                                    </button>
                                                    <button className="btn-icon" onClick={() => handleDelete(row)} style={{ color: 'var(--danger)' }}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
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
