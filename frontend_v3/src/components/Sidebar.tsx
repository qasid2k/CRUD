import React from 'react';
import { LayoutDashboard, Database, Server, BarChart3, Phone } from 'lucide-react';
import type { Page } from '../App';

interface SidebarProps {
    currentPage: Page;
    setCurrentPage: (page: Page) => void;
    isOpen: boolean;
    onToggle: () => void;
    onOpenRecordings: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, setCurrentPage, isOpen, onToggle, onOpenRecordings }) => {
    return (
        <>
            <div
                className={`sidebar-overlay ${isOpen ? 'show' : ''}`}
                onClick={onToggle}
            />
            <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
                <div className="logo">
                    <Server className="logo-icon" />
                    <span>Asterisk DB</span>
                </div>

                <div className="nav-label">Main</div>
                <div className="nav-list">
                    <div
                        className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('dashboard')}
                    >
                        <LayoutDashboard size={18} />
                        <span>Queue Dashboard</span>
                    </div>
                    <div
                        className={`nav-item ${currentPage === 'cdr' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('cdr')}
                    >
                        <BarChart3 size={18} />
                        <span>CDR Reports</span>
                    </div>
                    <div
                        className={`nav-item ${currentPage === 'browser' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('browser')}
                    >
                        <Database size={18} />
                        <span>Table Browser</span>
                    </div>
                    <div
                        className={`nav-item ${currentPage === 'softphone' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('softphone')}
                    >
                        <Phone size={18} />
                        <span>Softphone</span>
                    </div>
                </div>

                <div className="nav-label">Utilities</div>
                <div className="nav-list">
                    <div className="nav-item" onClick={onOpenRecordings}>
                        <Phone size={18} style={{ color: '#10b981' }} />
                        <span>Call Recordings</span>
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
