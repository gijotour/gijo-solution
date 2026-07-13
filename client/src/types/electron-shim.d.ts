// 최소 타입 셸 — 실제 개발 시 `npm install electron`으로 공식 타입 정의를 사용할 것.
declare module "electron" {
  export interface IpcMainInvokeEvent {
    sender: WebContents;
  }
  export interface IpcMain {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
    on(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => void): void;
  }
  export interface WebContents {
    send(channel: string, ...args: any[]): void;
  }
  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    backgroundColor?: string;
    title?: string;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
    };
  }
  export class BrowserWindow {
    constructor(opts: BrowserWindowConstructorOptions);
    webContents: WebContents;
    loadFile(path: string): Promise<void>;
    on(event: string, cb: (...args: any[]) => void): void;
    static getAllWindows(): BrowserWindow[];
    static fromWebContents(wc: WebContents): BrowserWindow | null;
  }
  export const app: {
    whenReady(): Promise<void>;
    on(event: string, cb: (...args: any[]) => void): void;
    quit(): void;
  };
  export const ipcMain: IpcMain;
  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on(channel: string, cb: (event: unknown, ...args: any[]) => void): void;
  };
  export const contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
  export const process: { platform: string };
}
