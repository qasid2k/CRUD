import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import QueueDashboard from './components/QueueDashboard';
import TableBrowser from './components/TableBrowser.tsx';
import Toast from './components/Toast.tsx';
import { api } from './api/client';
import './index.css';

export type Page = 'dashboard' | 'browser';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
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
        setCurrentPage={setCurrentPage}
      />

      <main className="main-content">
        {currentPage === 'dashboard' ? (
          <QueueDashboard />
        ) : (
          <TableBrowser
            tables={tables}
            showToast={showToast}
          />
        )}
      </main>

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
