import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitVCards, vcardFile } from './fileImport'

// Shape of a contacts.google.com → Export → vCard file
const EXPORT = [
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Matt Johnson', 'N:Johnson;Matt;;;', 'EMAIL;TYPE=INTERNET;TYPE=HOME:matt.johnson@gmail.com',
  'TEL;TYPE=CELL:+1 415-555-0100', 'item1.EMAIL;TYPE=INTERNET:mj@initech.com', 'item1.X-ABLabel:Old work', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Sarah Kim', 'N:Kim;Sarah;;;', 'EMAIL;TYPE=INTERNET:sarah@kim.io', 'END:VCARD', ''
].join('\r\n')

describe('Google contacts file import', () => {
  it('splits and parses an exported vCard file as Google contacts', async () => {
    expect(splitVCards(EXPORT)).toHaveLength(2)
    const path = join(mkdtempSync(join(tmpdir(), 'ca-vcf-')), 'contacts.vcf')
    writeFileSync(path, EXPORT)
    const c = vcardFile('google', () => path)
    expect(await c.test()).toBe('2 contacts in file')
    const [matt] = await c.fetchContacts!({ progress: () => undefined } as never)
    expect(matt).toMatchObject({ source: 'google', displayName: 'Matt Johnson' })
    expect(matt.emails).toEqual([{ value: 'matt.johnson@gmail.com', label: 'home' }, { value: 'mj@initech.com', label: 'old work' }])
    expect(c.apply).toBeUndefined()
  })
  it('explains a missing or empty file', async () => {
    await expect(vcardFile('google', () => undefined).test()).rejects.toThrow(/Choose a contacts file/)
  })
})
