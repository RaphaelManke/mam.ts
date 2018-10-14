/**
 * TODO: Add typing - Better use excisting typing in @iota/core and others?
 *
 * Enums:
 * - Security
 * - Mode (Done)
 *
 * Interfaces:
 * - Channel (Done)
 * - Transfers (Done)
 * - Return of Mam.createMessage
 * - Return of create
 *
 * Types:
 * - Seed?
 * - Address?
 */
export declare enum MAM_MODE {
    PUBLIC = "public",
    PRIVATE = "private",
    RESTRICTED = "restricted"
}
export interface channel {
    side_key: string | null;
    mode: MAM_MODE;
    next_root: string | null;
    security: number;
    start: number;
    count: number;
    next_count: number;
    index: number;
}
export declare class MamWriter {
    private provider;
    private channel;
    private seed;
    constructor(provider: string, seed?: string, security?: number);
    createAndAttach(message: string): Promise<{}>;
    changeMode(mode: MAM_MODE, sideKey?: string): void;
    create(message: string): {
        payload: string;
        root: string;
        address: string;
    };
    attach(trytes: string, root: string, depth?: number, mwm?: number): Promise<{}>;
    getRoot(): any;
}
export declare class MamReader {
    private provider;
    private sideKey;
    private mode;
    private next_root;
    constructor(provider: string, root: string, mode?: MAM_MODE, sideKey?: string);
    changeMode(root: string, mode: MAM_MODE, sideKey?: string): void;
    fetchSingle(root?: string, mode?: MAM_MODE, sidekey?: string, rounds?: number): Promise<{
        payload: string;
        nextRoot: string;
    }>;
    fetch(callback?: any, root?: string, mode?: MAM_MODE, sidekey?: string, rounds?: number): Promise<{
        nextRoot: string;
        messages: any[];
    }>;
}
export declare function decode(payload: string, side_key: string, root: string): {
    payload: any;
    next_root: any;
};
export declare function hash(data: any, rounds?: number): string;
export declare function keyGen(length: number): string;
