import React from 'react';
import { LayoutDashboard, Database, Server, BarChart3 } from 'lucide-react';
import type { Page } from '../App';

interface SidebarProps {
    currentPage: Page;
    setCurrentPage: (page: Page) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, setCurrentPage }) => {
    return (
        <aside className="sidebar">
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
            </div>
        </aside>
    );
};

export default Sidebar;
