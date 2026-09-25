# Contacts Aligner

A macOS-first Electron app that reconciles contacts across **Gmail, iCloud, Yahoo, Outlook.com, Microsoft 365 / Exchange and Apple Contacts**. It uses your real **mail, call and iMessage/SMS history** to show which email address and phone number each person actually uses today, then exports the cleaned-up result or pushes it back to the accounts you choose.

It exists because typing "Matt" in Mail shows a dozen addresses, most of them dead.

## Quick start

```bash
npm install
npm run dev          # builds the Swift Contacts helper on first run
```

Choose **Explore with demo data** to walk the whole flow with synthetic contacts, including a crowd of Matts. Nothing real is touched.

| Script | What it does |
|---|---|
| `npm test` | Engine and local-reader unit tests (vitest) |
| `npm run e2e` | Builds, then drives the real app through the entire demo flow with Playwright |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run app` | Builds and opens the standalone “Contacts Aligner.app” (own name and permissions) |
| `npm run dist` | Signed `.dmg` via electron-builder (set up a Developer ID to sign) |

## Flow

1. **Sources**: a tile per source, each with a setup helper that walks you through getting credentials. Every source is optional.
2. **Summary**: per source, the number of contacts, with no phone and no email, with email but no phone, with multiple emails, and with multiple phones. Includes charts.
3. **Preview Alignment Options**:
   - **Duplicates**: cross-source clusters with a field-by-field diff; click a value to pick it.
   - **Emails**: every address with its last-used date, a 24-month sparkline and a stale/keep toggle.
   - **Phones · Calls** and **Phones · Messages**: the same view, ranked by call history and by iMessage/SMS history.
   - **Mail Autocomplete**: type "Matt" and compare what Mail suggests before and after alignment. Stale *Previous Recipients* entries can be removed as well.
4. **Destination**: Google CSV, Outlook CSV, a detailed CSV (with last-used dates) or vCard. You can also push to any or all connected accounts.
5. **Review & Push**:
   - A dry-run diff of every change.
   - A full backup of each account is taken before anything is written, and then the push runs.
   - **Undo** restores the previous state, and past pushes can be undone too.

## Sources and credentials

| Source | Contacts | Usage signal | Auth |
|---|---|---|---|
| Gmail | People API | Gmail `gmail.metadata` scope: headers only, bodies can't be read | OAuth desktop client you register (guided) |
| Outlook.com | Microsoft Graph | Graph `Mail.ReadBasic`: no bodies | Entra app registration you create (guided) |
| Exchange | Graph (M365) or EWS (on-prem, Basic auth) | Sent and Inbox headers | Same as above, or username/password |
| iCloud | CardDAV | IMAP envelopes | App-specific password |
| Yahoo | CardDAV | IMAP envelopes | App password |
| Apple Contacts | Swift helper (`native/contacts-helper`) | — | macOS Contacts permission |
| Mail.app | — | `Envelope Index`: addresses and dates only | Full Disk Access |
| Messages | — | `chat.db`: handle, date and direction only, never text | Full Disk Access |
| iPhone calls | — | `CallHistory.storedata`, synced via Continuity | Full Disk Access |
| iPhone backup | — | `sms.db` and call history from an unencrypted Finder backup | Full Disk Access |

### Running as “Contacts Aligner”

`npm run dev` runs inside the generic Electron binary. macOS then asks for Contacts and Full Disk Access on behalf of whichever app launched it (Terminal, your IDE, or Claude). To get prompts and a Full Disk Access entry named **Contacts Aligner**, run the standalone app:

```bash
npm run app   # builds an ad-hoc-signed dist/mac*/Contacts Aligner.app and opens it
```

Ad-hoc signatures change on every build, so macOS may ask for permissions again after a rebuild. A Developer ID-signed `npm run dist` build keeps its permissions.

## Privacy and safety

- Everything runs locally. Credentials, tokens and the cached import are encrypted with Electron `safeStorage`, which is backed by the macOS Keychain. The renderer never sees them.
- Apple databases are copied to a temp folder and opened read-only. Queries never touch subjects, bodies or message text.
- Pushes are opt-in per account. Before each one:
  - a full native backup is written to the app’s `backups/<timestamp>/` folder (the **Show backups** button opens it)
  - a journal records every operation so it can be inverted.
- Contacts deleted on Exchange go to Deleted Items rather than being purged.
- "Needs review" matches, such as a shared number with different names or a name-only match, are **kept separate unless you approve the merge**.

## Architecture

```
src/engine/          pure TypeScript, shared by main, renderer (web worker) and tests
  normalize.ts       E.164 phones, Gmail dot/+tag folding, nickname table, Jaro-Winkler
  match.ts           blocking + pair scoring + union-find clustering, field diffs
  recency.ts         UsageAggregator: per identifier/channel last-in/out, counts, monthly buckets
  proposals.ts       primary / active / stale / no-evidence ranking; Previous Recipients suggestions
  align.ts           merge decisions → aligned contacts → per-vendor ChangePlans
  vcard.ts export.ts demo.ts stats.ts
src/main/            Electron main: IPC, vault, session cache, push/undo journal
  connectors/        google, microsoft (Graph), ews, carddav, imap, apple, localMac
src/renderer/        React 19 + Tailwind 4 + framer-motion
native/contacts-helper/main.swift   CNContactStore list/backup/apply
```

## Status and known limits

- **Verified**:
  - The engine, which is unit tested.
  - The Mail, Messages and call-history readers, tested against synthetic databases that use Apple's schema.
  - The full demo flow end to end, including push and undo, in dev and in the packaged app.
- **Not yet exercised against live accounts**: the Google, Microsoft Graph, EWS, CardDAV/IMAP and Apple Contacts write paths, and the Previous Recipients (CoreRecents) cleanup. The CoreRecents schema is undocumented, so the reader detects tables at runtime and backs up before writing. Try pushes on a test account first.
- Pushes rewrite name, company, title, emails and phones. Other fields, such as photos, addresses and notes, are left as each vendor has them.
- Outlook and Exchange contacts hold at most 3 emails and fixed phone slots, so extra values don't fit.
- Encrypted iPhone backups aren't supported.
