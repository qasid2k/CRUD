import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import QueueDashboard from './components/QueueDashboard';
import TableBrowser from './components/TableBrowser.tsx';
import CdrReport from './components/CdrReport';
import Toast from './components/Toast.tsx';
import Softphone from './components/Softphone';
import RecordingPanel from './components/RecordingPanel';
import { api } from './api/client';
import './index.css';

export type Page = 'dashboard' | 'browser' | 'cdr' | 'softphone';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isRecordingPanelOpen, setIsRecordingPanelOpen] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const fetchTables = async () => {
      try {
        const data = await api.getTables();
        setTables(data);
      } catch (err) {
        showToast('Error connecting to backend', 'error');
      }
    };
    fetchTables();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="dashboard-layout">
      <Sidebar
        currentPage={currentPage}
        setCurrentPage={(page) => {
          setCurrentPage(page);
          setSidebarOpen(false);
        }}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onOpenRecordings={() => setIsRecordingPanelOpen(true)}
      />

      <button
        className="mobile-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle Menu"
      >
        <span className="hamburger"></span>
      </button>

      <main className="main-content">
        {currentPage === 'dashboard' ? (
          <QueueDashboard />
        ) : currentPage === 'cdr' ? (
          <CdrReport />
        ) : currentPage === 'softphone' ? (
          <Softphone />
        ) : (
          <TableBrowser
            tables={tables}
            showToast={showToast}
          />
        )}
      </main>

      <RecordingPanel
        isOpen={isRecordingPanelOpen}
        onClose={() => setIsRecordingPanelOpen(false)}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default App;
