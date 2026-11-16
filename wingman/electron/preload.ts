import { contextBridge, ipcRenderer } from 'electron'

interface ChunkPayload {
  id: string
  text: string
}

interface DonePayload {
  id: string
  firstTokenMs: number
  totalMs: number
  stopped: boolean
  fallback: boolean
}

interface ErrorPayload {
  id: string
  message: string
}

interface NoticePayload {
  id: string
  message: string
}

contextBridge.exposeInMainWorld('wingman', {
  ask: (text: string, withScreenshot: boolean, id: string) =>
    ipcRenderer.invoke('ai:ask', { text, withScreenshot, id }),
  askRegion: (text: string, id: string) => ipcRenderer.invoke('ai:ask-region', { text, id }),
  cancel: () => ipcRenderer.invoke('ai:cancel'),
  hide: () => ipcRenderer.invoke('ui:hide'),
  quit: () => ipcRenderer.invoke('ui:quit'),
  describeProvider: () => ipcRenderer.invoke('ui:provider'),
  capabilities: () => ipcRenderer.invoke('ui:capabilities'),
  screenSettings: () => ipcRenderer.invoke('ui:screen-settings'),

  onChunk: (callback: (payload: ChunkPayload) => void) => {
    ipcRenderer.on('ai:chunk', (_event, payload: ChunkPayload) => callback(payload))
  },
  onDone: (callback: (payload: DonePayload) => void) => {
    ipcRenderer.on('ai:done', (_event, payload: DonePayload) => callback(payload))
  },
  onError: (callback: (payload: ErrorPayload) => void) => {
    ipcRenderer.on('ai:error', (_event, payload: ErrorPayload) => callback(payload))
  },
  onNotice: (callback: (payload: NoticePayload) => void) => {
    ipcRenderer.on('ai:notice', (_event, payload: NoticePayload) => callback(payload))
  },
  onAskScreenshot: (callback: () => void) => {
    ipcRenderer.on('ui:ask-screenshot', () => callback())
  },
  onAskRegion: (callback: () => void) => {
    ipcRenderer.on('ui:ask-region', () => callback())
  },
  onAskClipboard: (
    callback: (payload: { text: string; truncated: boolean; originalLength: number }) => void,
  ) => {
    ipcRenderer.on('ui:ask-clipboard', (_event, payload) => callback(payload))
  },
  onFocusInput: (callback: () => void) => {
    ipcRenderer.on('ui:focus-input', () => callback())
  },
})
