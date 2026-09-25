// contacts-helper: tiny bridge between Contacts Aligner and the macOS Contacts framework.
//   contacts-helper list            -> JSON array of contacts on stdout
//   contacts-helper backup          -> vCard of every contact on stdout
//   contacts-helper apply < ops.json -> JSON array of results on stdout
import Contacts
import Foundation

struct LV: Codable { var label: String?; var value: String }
struct Card: Codable {
    var id: String?
    var given: String?; var middle: String?; var family: String?; var nickname: String?
    var org: String?; var title: String?
    var emails: [LV]; var phones: [LV]; var addresses: [LV]?
    var birthday: String?
}
struct Op: Codable { var op: String; var id: String?; var card: Card?; var vcard: String? }
struct Result: Codable { var ok: Bool; var id: String?; var error: String? }

let store = CNContactStore()

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

func requireAccess() {
    let sem = DispatchSemaphore(value: 0)
    var granted = false
    store.requestAccess(for: .contacts) { ok, _ in granted = ok; sem.signal() }
    sem.wait()
    if !granted { fail("ACCESS_DENIED: Allow Contacts access in System Settings > Privacy & Security > Contacts.") }
}

func clean(_ label: String?) -> String? {
    guard let l = label else { return nil }
    return CNLabeledValue<NSString>.localizedString(forLabel: l).lowercased()
}

func appleLabel(_ label: String?, phone: Bool) -> String? {
    switch label?.lowercased() {
    case "home": return CNLabelHome
    case "work": return CNLabelWork
    case "other": return CNLabelOther
    case "mobile", "cell": return phone ? CNLabelPhoneNumberMobile : CNLabelOther
    case "iphone": return phone ? CNLabelPhoneNumberiPhone : CNLabelOther
    case "main": return phone ? CNLabelPhoneNumberMain : CNLabelOther
    case nil: return nil
    default: return label
    }
}

let keys: [CNKeyDescriptor] = [
    CNContactIdentifierKey, CNContactGivenNameKey, CNContactMiddleNameKey, CNContactFamilyNameKey,
    CNContactNicknameKey, CNContactOrganizationNameKey, CNContactJobTitleKey, CNContactEmailAddressesKey,
    CNContactPhoneNumbersKey, CNContactPostalAddressesKey, CNContactBirthdayKey,
].map { $0 as CNKeyDescriptor }

func toCard(_ c: CNContact) -> Card {
    var bday: String? = nil
    if let b = c.birthday, let m = b.month, let d = b.day {
        bday = b.year.map { String(format: "%04d-%02d-%02d", $0, m, d) } ?? String(format: "--%02d-%02d", m, d)
    }
    let fmt = CNPostalAddressFormatter()
    return Card(
        id: c.identifier, given: c.givenName, middle: c.middleName, family: c.familyName, nickname: c.nickname,
        org: c.organizationName, title: c.jobTitle,
        emails: c.emailAddresses.map { LV(label: clean($0.label), value: $0.value as String) },
        phones: c.phoneNumbers.map { LV(label: clean($0.label), value: $0.value.stringValue) },
        addresses: c.postalAddresses.map { LV(label: clean($0.label), value: fmt.string(from: $0.value).replacingOccurrences(of: "\n", with: ", ")) },
        birthday: bday)
}

func allContacts(_ keys: [CNKeyDescriptor]) throws -> [CNContact] {
    var out: [CNContact] = []
    try store.enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { c, _ in out.append(c) }
    return out
}

func fill(_ m: CNMutableContact, _ card: Card) {
    m.givenName = card.given ?? ""; m.middleName = card.middle ?? ""; m.familyName = card.family ?? ""
    m.organizationName = card.org ?? ""; m.jobTitle = card.title ?? ""
    m.emailAddresses = card.emails.map { CNLabeledValue(label: appleLabel($0.label, phone: false), value: $0.value as NSString) }
    m.phoneNumbers = card.phones.map { CNLabeledValue(label: appleLabel($0.label, phone: true), value: CNPhoneNumber(stringValue: $0.value)) }
}

func emit<T: Encodable>(_ v: T) {
    let data = try! JSONEncoder().encode(v)
    FileHandle.standardOutput.write(data)
}

let cmd = CommandLine.arguments.dropFirst().first ?? ""
requireAccess()
switch cmd {
case "list":
    do { emit(try allContacts(keys).map(toCard)) } catch { fail("\(error)") }
case "backup":
    do {
        let all = try allContacts([CNContactVCardSerialization.descriptorForRequiredKeys()])
        FileHandle.standardOutput.write(try CNContactVCardSerialization.data(with: all))
    } catch { fail("\(error)") }
case "apply":
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let ops = try? JSONDecoder().decode([Op].self, from: input) else { fail("Invalid ops JSON") }
    var results: [Result] = []
    for op in ops {
        let req = CNSaveRequest()
        do {
            var newId: String? = nil
            switch op.op {
            case "update":
                guard let id = op.id, let card = op.card else { throw NSError(domain: "helper", code: 1, userInfo: [NSLocalizedDescriptionKey: "missing id/card"]) }
                let c = try store.unifiedContact(withIdentifier: id, keysToFetch: keys)
                let m = c.mutableCopy() as! CNMutableContact
                fill(m, card)
                req.update(m)
            case "create":
                if let v = op.vcard, let data = v.data(using: .utf8), let c = try CNContactVCardSerialization.contacts(with: data).first {
                    let m = c.mutableCopy() as! CNMutableContact
                    req.add(m, toContainerWithIdentifier: nil); newId = m.identifier
                } else if let card = op.card {
                    let m = CNMutableContact(); fill(m, card)
                    req.add(m, toContainerWithIdentifier: nil); newId = m.identifier
                }
            case "delete":
                guard let id = op.id else { throw NSError(domain: "helper", code: 1, userInfo: [NSLocalizedDescriptionKey: "missing id"]) }
                let c = try store.unifiedContact(withIdentifier: id, keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
                req.delete(c.mutableCopy() as! CNMutableContact)
            default:
                throw NSError(domain: "helper", code: 2, userInfo: [NSLocalizedDescriptionKey: "unknown op \(op.op)"])
            }
            try store.execute(req)
            results.append(Result(ok: true, id: newId ?? op.id, error: nil))
        } catch {
            results.append(Result(ok: false, id: op.id, error: error.localizedDescription))
        }
    }
    emit(results)
default:
    fail("usage: contacts-helper list|backup|apply")
}
