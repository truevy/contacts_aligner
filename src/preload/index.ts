import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!res.ok) throw new Error(res.error)
  return res.value
}

const api = {
  invoke: call,
  onProgress(fn: (p: { source: string; message: string; count?: number }) => void) {
    const listener = (_: unknown, p: { source: string; message: string; count?: number }) => fn(p)
    ipcRenderer.on('progress', listener)
    return () => {
      ipcRenderer.removeListener('progress', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
