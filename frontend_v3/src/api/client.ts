import axios from 'axios';

const API_URL = 'http://localhost:8000';

const client = axios.create({
    baseURL: API_URL,
});

export const api = {
    getTables: async () => {
        const { data } = await client.get<{ tables: string[] }>('/');
        return data.tables;
    },
    getTableData: async (table: string, skip = 0, limit = 100) => {
        const { data } = await client.get<any[]>(`/api/${table}`, {
            params: { skip, limit },
        });
        return data;
    },
    getTableSchema: async (table: string) => {
        const { data } = await client.get<{ fields: string[]; primary_keys: string[] }>(`/api/${table}/schema`);
        return data;
    },
    createRecord: async (table: string, record: any) => {
        const { data } = await client.post(`/api/${table}`, record);
        return data;
    },
    updateRecord: async (table: string, pkValue: string | number, record: any) => {
        const { data } = await client.put(`/api/${table}/${encodeURIComponent(pkValue)}`, record);
        return data;
    },
    deleteRecord: async (table: string, id: string | number) => {
        const { data } = await client.delete(`/api/${table}/${encodeURIComponent(id)}`);
        return data;
    },
    getQueueStatus: async () => {
        const { data } = await client.get<any[]>('/api/queues/status');
        return data;
    },
};
