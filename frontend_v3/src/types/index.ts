export interface QueueMember {
    name: string;
    number: string;
    interface: string;
    status: string;
    penalty: number;
    paused?: boolean;
    connectedParty?: {
        name: string;
        num: string;
    } | null;
    spyStatus?: {
        spyer: string;
        mode: string;
    } | null;
}

export interface QueueStatus {
    name: string;
    strategy: string;
    callsWaiting: number;
    answered: number;
    abandoned: number;
    serviceLevel: number;
    members: QueueMember[];
}

export interface TableSchema {
    fields: string[];
    primary_keys: string[];
}
