import type { SourceKind } from '@engine/types'

export type FieldSpec =
  | { key: string; label: string; type: 'text' | 'password' | 'email' | 'url'; placeholder?: string; hint?: string }
  | { key: string; label: string; type: 'checkbox'; hint?: string; default?: boolean }

export interface SetupStep {
  text: string
  link?: { label: string; url: string }
}

export interface SourceMeta {
  kind: SourceKind
  name: string
  short: string
  color: string
  monogram: string
  group: 'contacts' | 'usage'
  macOnly?: boolean
  tagline: string
  gives: string[]
  auth: 'oauth-google' | 'oauth-microsoft' | 'app-password' | 'exchange' | 'local' | 'fda' | 'backup'
  steps: SetupStep[]
  fields?: FieldSpec[]
  privacy: string
}

export const SOURCES: SourceMeta[] = [
  {
    kind: 'google',
    name: 'Gmail / Google Contacts',
    short: 'Google',
    color: '#EA4335',
    monogram: 'G',
    group: 'contacts',
    tagline: 'Google Contacts, plus optional Gmail history',
    gives: ['Contacts', 'Email recency'],
    auth: 'oauth-google',
    steps: [
      { text: 'Create a Google Cloud project (free). Any name works, e.g. "Contacts Aligner".', link: { label: 'Open Cloud Console', url: 'https://console.cloud.google.com/projectcreate' } },
      { text: 'Enable the People API and the Gmail API for the project.', link: { label: 'Enable APIs', url: 'https://console.cloud.google.com/flows/enableapi?apiid=people.googleapis.com,gmail.googleapis.com' } },
      { text: 'Configure the OAuth consent screen: User type "External", then add your own Gmail address under Test users.', link: { label: 'Consent screen', url: 'https://console.cloud.google.com/auth/audience' } },
      { text: 'Create an OAuth client ID of type "Desktop app" and download its JSON.', link: { label: 'Create credentials', url: 'https://console.cloud.google.com/auth/clients/create' } },
      { text: 'Load that JSON below (or paste the client ID and secret), then sign in with Google in your browser.' }
    ],
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: '1234-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'Client secret', type: 'password', placeholder: 'GOCSPX-…', hint: 'For desktop apps Google calls this a secret, but it only identifies your app. Your password never touches this app.' }
    ],
    privacy: 'The Mac option signs in through Apple’s Internet Accounts, so this app never sees your Google password. App passwords and tokens are encrypted with your macOS Keychain. Only From/To/Cc/Date mail headers are read, never message bodies.'
  },
  {
    kind: 'icloud',
    name: 'iCloud',
    short: 'iCloud',
    color: '#CBD5E1',
    monogram: 'iC',
    group: 'contacts',
    tagline: 'iCloud Contacts (CardDAV) + iCloud Mail headers (IMAP)',
    gives: ['Contacts', 'Email recency'],
    auth: 'app-password',
    steps: [
      { text: 'Sign in to your Apple Account and open Sign-In and Security → App-Specific Passwords.', link: { label: 'Open Apple Account', url: 'https://account.apple.com/account/manage' } },
      { text: 'Generate a password named "Contacts Aligner". It looks like abcd-efgh-ijkl-mnop.' },
      { text: 'Enter your Apple ID email and that app-specific password below. Your real Apple ID password is never used.' }
    ],
    fields: [
      { key: 'username', label: 'Apple ID email', type: 'email', placeholder: 'you@icloud.com' },
      { key: 'password', label: 'App-specific password', type: 'password', placeholder: 'abcd-efgh-ijkl-mnop' },
      { key: 'scanMail', label: 'Also scan iCloud Mail headers for email recency', type: 'checkbox', default: true }
    ],
    privacy: 'App-specific passwords can be revoked anytime at account.apple.com. Only envelope headers are fetched from IMAP.'
  },
  {
    kind: 'yahoo',
    name: 'Yahoo Mail',
    short: 'Yahoo',
    color: '#8B5CF6',
    monogram: 'Y!',
    group: 'contacts',
    tagline: 'Yahoo Contacts (CardDAV) + Yahoo Mail headers (IMAP)',
    gives: ['Contacts', 'Email recency'],
    auth: 'app-password',
    steps: [
      { text: 'Open Yahoo Account Security.', link: { label: 'Account security', url: 'https://login.yahoo.com/account/security' } },
      { text: 'Choose "Generate app password", name it "Contacts Aligner", and copy the 16-character password.' },
      { text: 'Enter your Yahoo email and that app password below.' }
    ],
    fields: [
      { key: 'username', label: 'Yahoo email', type: 'email', placeholder: 'you@yahoo.com' },
      { key: 'password', label: 'App password', type: 'password', placeholder: '16 characters' },
      { key: 'scanMail', label: 'Also scan Yahoo Mail headers for email recency', type: 'checkbox', default: true }
    ],
    privacy: 'App passwords can be revoked in Yahoo Account Security. Only envelope headers are fetched.'
  },
  {
    kind: 'microsoft',
    name: 'Outlook.com / Hotmail',
    short: 'Outlook',
    color: '#3B82F6',
    monogram: 'O',
    group: 'contacts',
    tagline: 'Outlook.com contacts + mail headers via Microsoft Graph',
    gives: ['Contacts', 'Email recency'],
    auth: 'oauth-microsoft',
    steps: [
      { text: 'Open Microsoft Entra "App registrations" and choose New registration (a free personal Azure account works).', link: { label: 'App registrations', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' } },
      { text: 'Supported account types: "Personal Microsoft accounts only" (or "Any Entra ID tenant + personal accounts").' },
      { text: 'Redirect URI: platform "Public client/native (mobile & desktop)", value http://localhost' },
      { text: 'Under Authentication, set "Allow public client flows" to Yes. No client secret is needed.' },
      { text: 'Copy the Application (client) ID from the Overview page and paste it below.' }
    ],
    fields: [{ key: 'clientId', label: 'Application (client) ID', type: 'text', placeholder: '00000000-0000-0000-0000-000000000000' }],
    privacy: 'Requests Contacts.ReadWrite and Mail.ReadBasic. Mail.ReadBasic cannot read message bodies. Tokens are encrypted with your Keychain.'
  },
  {
    kind: 'exchange',
    name: 'Microsoft Exchange',
    short: 'Exchange',
    color: '#14B8A6',
    monogram: 'Ex',
    group: 'contacts',
    tagline: 'Microsoft 365 / Exchange Online (Graph), or on-prem Exchange (EWS)',
    gives: ['Contacts', 'Email recency'],
    auth: 'exchange',
    steps: [
      { text: 'Microsoft 365 / Exchange Online: register an app like for Outlook.com, but with account type "Accounts in any organizational directory". Your IT admin may need to approve it.', link: { label: 'App registrations', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' } },
      { text: 'On-premises Exchange: enter your EWS URL, usually https://mail.company.com/EWS/Exchange.asmx, with your username and password. Basic auth must be enabled.' }
    ],
    privacy: 'Deleted contacts are moved to Deleted Items, so you can still recover them in Outlook.'
  },
  {
    kind: 'apple',
    name: 'Apple Contacts',
    short: 'Contacts',
    color: '#F59E0B',
    monogram: '☺',
    group: 'contacts',
    macOnly: true,
    tagline: 'Contacts.app on this Mac (all accounts it shows)',
    gives: ['Contacts'],
    auth: 'local',
    steps: [
      { text: 'Click Connect. macOS will ask to let Contacts Aligner access your contacts; choose Allow.' },
      { text: 'Includes every account in Contacts.app (iCloud, On My Mac, …), except a Google account you connect through the Google tile, which is counted there instead.' }
    ],
    privacy: 'Contacts are read through Apple’s Contacts framework and nothing leaves your Mac.'
  },
  {
    kind: 'macmail',
    name: 'Mail.app history',
    short: 'Mail',
    color: '#60A5FA',
    monogram: '✉',
    group: 'usage',
    macOnly: true,
    tagline: 'When you last emailed each address, from Mail’s local index',
    gives: ['Email recency', 'Previous Recipients cleanup'],
    auth: 'fda',
    steps: [
      { text: 'Grant Full Disk Access to Contacts Aligner in System Settings → Privacy & Security.' },
      { text: 'Covers every account configured in Mail, including ones not listed here. It is also the fastest email-recency source.' }
    ],
    privacy: 'Only sender/recipient addresses and dates are read. Subjects and bodies are never queried.'
  },
  {
    kind: 'messages',
    name: 'Messages (iMessage & SMS)',
    short: 'Messages',
    color: '#22C55E',
    monogram: '💬',
    group: 'usage',
    macOnly: true,
    tagline: 'Which numbers you actually text, from Messages on this Mac',
    gives: ['Phone recency (messages)'],
    auth: 'fda',
    steps: [
      { text: 'Messages in iCloud (iPhone → Settings → Apple Account → iCloud → Messages) keeps this Mac in sync with your iPhone.' },
      { text: 'Grant Full Disk Access so the app can read ~/Library/Messages/chat.db.' }
    ],
    privacy: 'Reads only handle, timestamp and direction. Message text is never read.'
  },
  {
    kind: 'calls',
    name: 'iPhone call history',
    short: 'Calls',
    color: '#A3E635',
    monogram: '☎',
    group: 'usage',
    macOnly: true,
    tagline: 'Calls synced to this Mac through Continuity',
    gives: ['Phone recency (calls)'],
    auth: 'fda',
    steps: [
      { text: 'On iPhone: Settings → Apps → Phone → Calls on Other Devices → allow this Mac.' },
      { text: 'Grant Full Disk Access so the app can read the synced call history database.' }
    ],
    privacy: 'Reads only number, date and direction for each call.'
  },
  {
    kind: 'iphoneBackup',
    name: 'iPhone backup',
    short: 'Backup',
    color: '#EC4899',
    monogram: '📱',
    group: 'usage',
    macOnly: true,
    tagline: 'SMS and call history from an unencrypted Finder backup',
    gives: ['Phone recency (calls + messages)'],
    auth: 'backup',
    steps: [
      { text: 'Use this if Messages in iCloud or call sync isn’t on. In Finder, select your iPhone and choose "Back up all the data… to this Mac" with encryption turned off.' },
      { text: 'Pick the backup below. Full Disk Access is required to read the backups folder.' }
    ],
    privacy: 'Only sms.db and the call history database are opened, read-only.'
  }
]

export const SOURCE_BY_KIND = Object.fromEntries(SOURCES.map((s) => [s.kind, s])) as Record<SourceKind, SourceMeta>

export const sourceColor = (k: SourceKind) => SOURCE_BY_KIND[k]?.color ?? '#94a3b8'
