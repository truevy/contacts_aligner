import { useMemo } from 'react'
import { alignContacts, droppedEmails } from '@engine/align'
import { suggestRecentsCleanup, type RecentsSuggestion } from '@engine/proposals'
import { emailMatchKey } from '@engine/normalize'
import { useStore } from './store'

export function useAligned() {
  const { data, analysis, decisions } = useStore()
  return useMemo(() => (data && analysis ? alignContacts(data.contacts, analysis, decisions) : []), [data, analysis, decisions])
}

export interface RecentsPlan {
  suggestions: RecentsSuggestion[]
  isRemoved: (s: RecentsSuggestion) => boolean
  rowIds: number[]
  removedAddresses: Set<string>
}

/** Previous Recipients entries to remove: suggestion defaults, overridden by the user's clicks. */
export function useRecentsPlan(): RecentsPlan {
  const { data, analysis, decisions, staleYears, recentsOverride, cleanRecents } = useStore()
  return useMemo(() => {
    if (!data || !analysis || !data.recents.length) return { suggestions: [], isRemoved: () => false, rowIds: [], removedAddresses: new Set() }
    const dropped = droppedEmails(analysis, decisions)
    const known = new Set(data.contacts.flatMap((c) => c.emails.map((e) => emailMatchKey(e.value))))
    const suggestions = suggestRecentsCleanup(data.recents, dropped, known, { now: Date.now(), staleYears })
    const isRemoved = (s: RecentsSuggestion) => cleanRecents && (recentsOverride[s.entry.address] ?? s.defaultRemove)
    const removed = suggestions.filter(isRemoved)
    return {
      suggestions,
      isRemoved,
      rowIds: removed.map((s) => s.entry.rowId),
      removedAddresses: new Set(removed.map((s) => emailMatchKey(s.entry.address)))
    }
  }, [data, analysis, decisions, staleYears, recentsOverride, cleanRecents])
}
