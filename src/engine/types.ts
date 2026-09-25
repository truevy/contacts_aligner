// Shared data model. Everything in src/engine is pure TypeScript so it runs in
// the main process, the renderer, and vitest alike.

export type SourceKind =
  | 'google'
  | 'microsoft'
  | 'exchange'
  | 'icloud'
  | 'yahoo'
  | 'apple'
  | 'macmail'
  | 'messages'
  | 'calls'
  | 'iphoneBackup'

/** Sources that hold contacts (and can therefore be pushed to). */
export const CONTACT_SOURCES: SourceKind[] = ['google', 'microsoft', 'exchange', 'icloud', 'yahoo', 'apple']

export interface LabeledValue {
  value: string
  label?: string
}

export interface Contact {
  /** Globally unique: `${source}:${recordId}` */
  uid: string
  source: SourceKind
  recordId: string
  etag?: string
  displayName: string
  firstName?: string
  middleName?: string
  lastName?: string
  nickname?: string
  organization?: string
  title?: string
  emails: LabeledValue[]
  phones: LabeledValue[]
  addresses: LabeledValue[]
  birthday?: string
  notes?: string
  /** Vendor-native payload (vCard text, API JSON) used to patch without losing fields. */
  raw?: string
}

export type Channel = 'email' | 'call' | 'message'
export type Direction = 'in' | 'out'

/** Aggregated usage for one identifier on one channel. Never contains message content. */
export interface UsageStat {
  /** Normalized identifier: lowercase email or E.164 phone. */
  key: string
  channel: Channel
  lastOut?: number
  lastIn?: number
  countOut: number
  countIn: number
  /** Month (YYYY-MM) → count */
  months: Record<string, number>
  sources: SourceKind[]
}

export type UsageIndex = Record<string, UsageStat> // key: `${channel}|${identifier}`

export interface SourceSummary {
  source: SourceKind
  total: number
  noPhoneNoEmail: number
  emailNoPhone: number
  multipleEmails: number
  multiplePhones: number
}

export type FieldName = 'displayName' | 'organization' | 'title' | 'birthday' | 'notes'

export interface FieldDiff {
  field: FieldName
  /** uid → value */
  values: Record<string, string | undefined>
  suggested: string | undefined
}

export interface Cluster {
  id: string
  memberUids: string[]
  /** auto: merged with confidence; review: needs a human look; single: no duplicates */
  confidence: 'auto' | 'review' | 'single'
  score: number
  reasons: string[]
  diffs: FieldDiff[]
}

export type ValueStatus = 'primary' | 'active' | 'stale' | 'no-evidence'

export interface ValueProposal {
  value: string
  key: string
  status: ValueStatus
  keep: boolean
  lastUsed?: number
  count12mo: number
  countAll: number
  /** Last 24 months, oldest first */
  spark: number[]
  /** Which contact sources carry this value */
  carriedBy: SourceKind[]
  label?: string
}

export interface ClusterProposal {
  clusterId: string
  emails: ValueProposal[]
  phonesCalls: ValueProposal[]
  phonesMessages: ValueProposal[]
  /** Calls + messages combined; this is what drives the final phone keep/remove. */
  phones: ValueProposal[]
}

export interface Decisions {
  /** clusterId → field → chosen value */
  fields: Record<string, Partial<Record<FieldName, string>>>
  /** clusterId → email key → keep */
  emails: Record<string, Record<string, boolean>>
  /** clusterId → phone key → keep */
  phones: Record<string, Record<string, boolean>>
  /**
   * clusterId → merge? Overrides the default, which is to merge confident
   * matches and keep "review" matches separate until the user approves them.
   */
  merge: Record<string, boolean>
}

export interface AlignedContact {
  clusterId: string
  memberUids: string[]
  displayName: string
  firstName?: string
  middleName?: string
  lastName?: string
  nickname?: string
  organization?: string
  title?: string
  birthday?: string
  notes?: string
  emails: LabeledValue[]
  phones: LabeledValue[]
  addresses: LabeledValue[]
}

export interface RecentEntry {
  rowId: number
  address: string
  displayName?: string
  lastDate?: number
  count?: number
}

export type PlanOp =
  | { op: 'update'; source: SourceKind; recordId: string; etag?: string; before: Contact; after: AlignedContact }
  | { op: 'create'; source: SourceKind; after: AlignedContact; /** Undo of a delete: vendor-native original */ restoreRaw?: string }
  | { op: 'delete'; source: SourceKind; recordId: string; etag?: string; before: Contact }

export interface ChangePlan {
  source: SourceKind
  ops: PlanOp[]
}

export interface AnalysisResult {
  clusters: Cluster[]
  proposals: Record<string, ClusterProposal>
  overlap: Record<number, number> // number of sources a person appears in → people
}
