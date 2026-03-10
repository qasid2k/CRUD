import axios from 'axios';

// Dynamically determine the base URL
// In development, you might still want http://localhost:8000
// In production (Nginx), we use relative paths for everything
const isDev = window.location.port === "3000";
const API_URL = isDev ? `http://${window.location.hostname}:8000/api` : "/api";

const client = axios.create({
    baseURL: API_URL,
});

export const api = {
    getTables: async () => {
        const { data } = await client.get<{ tables: string[] }>('/');
        return data.tables;
    },
    getTableData: async (table: string, skip = 0, limit = 100) => {
        const { data } = await client.get<any[]>(`/${table}`, {
            params: { skip, limit },
        });
        return data;
    },
    getTableSchema: async (table: string) => {
        const { data } = await client.get<{ fields: string[]; primary_keys: string[] }>(`/${table}/schema`);
        return data;
    },
    createRecord: async (table: string, record: any) => {
        const { data } = await client.post(`/${table}`, record);
        return data;
    },
    updateRecord: async (table: string, pkValue: string | number, record: any) => {
        const { data } = await client.put(`/${table}/${encodeURIComponent(pkValue)}`, record);
        return data;
    },
    deleteRecord: async (table: string, id: string | number) => {
        const { data } = await client.delete(`/${table}/${encodeURIComponent(id)}`);
        return data;
    },
    getQueueStatus: async () => {
        const { data } = await client.get<any[]>('/queues/status');
        return data;
    },
    post: async (url: string, payload: any) => {
        const { data } = await client.post(url, payload);
        return data;
    },

    // CDR Report endpoints
    getCdrSummary: async (start?: string, end?: string, queue?: string, allTime?: boolean) => {
        const params: any = {};
        if (start) params.start = start;
        if (end) params.end = end;
        if (queue) params.queue = queue;
        if (allTime) params.all_time = true;
        const { data } = await client.get('/cdr/summary', { params });
        return data;
    },
    getCdrAgent: async (agentId: string, start?: string, end?: string, queue?: string, allTime?: boolean) => {
        const params: any = {};
        if (start) params.start = start;
        if (end) params.end = end;
        if (queue) params.queue = queue;
        if (allTime) params.all_time = true;
        const { data } = await client.get(`/cdr/agent/${agentId}`, { params });
        return data;
    },
    getCdrTimeRange: async (start: string, end: string, queue?: string, allTime?: boolean) => {
        const params: any = { start, end };
        if (queue) params.queue = queue;
        if (allTime) params.all_time = true;
        const { data } = await client.get('/cdr/time_range', { params });
        return data;
    },
    refreshCdr: async () => {
        const { data } = await client.post('/cdr/refresh', {});
        return data;
    },

    // Recording endpoints
    getRecordings: async (limit = 50) => {
        const { data } = await client.get<any[]>('/recordings/list', { params: { limit } });
        return data;
    },
    getRecordingUrl: (filename: string) => {
        return `${client.defaults.baseURL}/recordings/stream/${encodeURIComponent(filename)}`;
    },
};
