import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
    isOpen: boolean;
    title: string;
    fields: string[];
    primaryKeys: string[];
    record?: any;
    onClose: () => void;
    onSave: (data: any) => void;
}

const Modal: React.FC<ModalProps> = ({
    isOpen, title, fields, primaryKeys, record, onClose, onSave
}) => {
    const [formData, setFormData] = useState<any>({});

    useEffect(() => {
        if (record) {
            setFormData(record);
        } else {
            setFormData({});
        }
    }, [record, isOpen]);

    const handleChange = (field: string, value: string) => {
        setFormData((prev: any) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="modal-overlay">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="modal-content"
                    >
                        <div className="modal-header">
                            <h2 style={{ fontSize: '18px', fontWeight: 700 }}>{title}</h2>
                            <button className="btn-icon" onClick={onClose}>
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                {fields.map(field => {
                                    const isPK = (primaryKeys || []).some(pk => pk.toLowerCase() === field.toLowerCase());
                                    const isReadOnly = isPK && !!record;

                                    return (
                                        <div key={field} className="form-field">
                                            <label>{field}</label>
                                            <input
                                                type="text"
                                                value={formData[field] || ''}
                                                onChange={(e) => handleChange(field, e.target.value)}
                                                readOnly={isReadOnly}
                                                style={isReadOnly ? {
                                                    backgroundColor: '#020617',
                                                    cursor: 'not-allowed',
                                                    opacity: 0.6
                                                } : {}}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn" onClick={onClose} style={{ color: 'var(--text-muted)' }}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default Modal;
