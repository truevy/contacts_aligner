import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'

const PAGE = (msg: string) =>
  `<!doctype html><meta charset=utf-8><title>Contacts Aligner</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;background:#0f172a;color:#e2e8f0"><div><h2>${msg}</h2><p>You can close this tab and return to Contacts Aligner.</p></div>`

/**
 * Starts a one-shot HTTP listener on 127.0.0.1 (RFC 8252 loopback redirect),
 * opens the consent page in the user's browser and resolves with the code.
 */
export async function loopbackAuthorize(buildUrl: (redirectUri: string) => string, timeoutMs = 5 * 60_000) {
  let server: Server | undefined
  try {
    return await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let redirectUri = ''
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (!code && !error) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE(code ? 'Signed in ✓' : `Sign-in failed: ${error}`))
        if (code) resolve({ code, redirectUri })
        else reject(new Error(`Authorization was denied (${error}).`))
      })
      server.listen(0, '127.0.0.1', () => {
        redirectUri = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
        shell.openExternal(buildUrl(redirectUri))
      })
      setTimeout(() => reject(new Error('Timed out waiting for sign-in.')), timeoutMs)
    })
  } finally {
    server?.close()
  }
}
