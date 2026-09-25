import { analyze, proposeAll } from '@engine/proposals'
import { setDefaultRegion } from '@engine/normalize'
import type { Cluster, Contact, UsageIndex } from '@engine/types'

// Clustering thousands of contacts takes long enough to freeze the UI, so it runs here.
type Msg =
  | { type: 'analyze'; contacts: Contact[]; usage: UsageIndex; staleYears: number; region: string }
  | { type: 'repropose'; clusters: Cluster[]; contacts: Contact[]; usage: UsageIndex; staleYears: number; region: string }

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  setDefaultRegion(m.region)
  const opts = { now: Date.now(), staleYears: m.staleYears }
  if (m.type === 'analyze') self.postMessage(analyze(m.contacts, m.usage, opts))
  else self.postMessage({ clusters: m.clusters, ...proposeAll(m.clusters, m.contacts, m.usage, opts) })
}
