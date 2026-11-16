import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('selector', {
  done: (region: { x: number; y: number; w: number; h: number }) =>
    ipcRenderer.send('selector:done', region),
  cancel: () => ipcRenderer.send('selector:cancel'),
  onImage: (callback: (url: string) => void) => {
    ipcRenderer.on('selector:image', (_event, url: string) => callback(url))
  },
})
