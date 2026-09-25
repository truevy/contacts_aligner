// contacts-helper: tiny bridge between Contacts Aligner and the macOS Contacts framework.
//   contacts-helper containers                         -> JSON array of accounts (iCloud, Google, Exchange, On My Mac…)
//   contacts-helper list   [--include ids] [--exclude ids] -> JSON array of contacts, each tagged with its container
//   contacts-helper backup [--include ids] [--exclude ids] -> vCard of those contacts on stdout
//   contacts-helper apply < ops.json                   -> JSON array of results on stdout
// Contacts are fetched un-unified so each card maps to exactly one account.
import Contacts
import Foundation

struct LV: Codable { var label: String?; var value: String }
struct Card: Codable {
    var id: String?
    var given: String?; var middle: String?; var family: String?; var nickname: String?
    var org: String?; var title: String?
    var emails: [LV]; var phones: [LV]; var addresses: [LV]?
    var birthday: String?
    var container: String?
}
struct Op: Codable { var op: String; var id: String?; var card: Card?; var vcard: String?; var container: String? }
struct Container: Codable { var id: String; var name: String; var type: String; var count: Int }
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
        birthday: bday, container: nil)
}

func containerIds(_ flag: String) -> Set<String>? {
    let args = Array(CommandLine.arguments)
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return Set(args[i + 1].split(separator: ",").map(String.init))
}

func contacts(in containerId: String, _ keys: [CNKeyDescriptor]) throws -> [CNContact] {
    let req = CNContactFetchRequest(keysToFetch: keys)
    req.predicate = CNContact.predicateForContactsInContainer(withIdentifier: containerId)
    req.unifyResults = false
    var out: [CNContact] = []
    try store.enumerateContacts(with: req) { c, _ in out.append(c) }
    return out
}

/// Contacts grouped by container, honoring --include / --exclude.
func selected(_ keys: [CNKeyDescriptor]) throws -> [(String, CNContact)] {
    let include = containerIds("--include"), exclude = containerIds("--exclude") ?? []
    var out: [(String, CNContact)] = []
    for c in try store.containers(matching: nil) {
        if let inc = include, !inc.contains(c.identifier) { continue }
        if exclude.contains(c.identifier) { continue }
        for contact in try contacts(in: c.identifier, keys) { out.append((c.identifier, contact)) }
    }
    return out
}

func fetchOne(_ id: String, _ keys: [CNKeyDescriptor]) throws -> CNContact {
    let req = CNContactFetchRequest(keysToFetch: keys)
    req.predicate = CNContact.predicateForContacts(withIdentifiers: [id])
    req.unifyResults = false
    var found: CNContact?
    try store.enumerateContacts(with: req) { c, stop in found = c; stop.pointee = true }
    guard let c = found else { throw NSError(domain: "helper", code: 3, userInfo: [NSLocalizedDescriptionKey: "contact \(id) not found"]) }
    return c
}

func typeName(_ t: CNContainerType) -> String {
    switch t {
    case .local: return "local"
    case .exchange: return "exchange"
    case .cardDAV: return "cardDAV"
    default: return "unassigned"
    }
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
case "containers":
    do {
        emit(try store.containers(matching: nil).map { c in
            Container(id: c.identifier, name: c.name, type: typeName(c.type),
                      count: (try? contacts(in: c.identifier, [CNContactIdentifierKey as CNKeyDescriptor]).count) ?? 0)
        })
    } catch { fail("\(error)") }
case "list":
    do { emit(try selected(keys).map { (cid, c) in var card = toCard(c); card.container = cid; return card }) } catch { fail("\(error)") }
case "backup":
    do {
        let all = try selected([CNContactVCardSerialization.descriptorForRequiredKeys()]).map { $0.1 }
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
                let m = try fetchOne(id, keys).mutableCopy() as! CNMutableContact
                fill(m, card)
                req.update(m)
            case "create":
                if let v = op.vcard, let data = v.data(using: .utf8), let c = try CNContactVCardSerialization.contacts(with: data).first {
                    let m = c.mutableCopy() as! CNMutableContact
                    req.add(m, toContainerWithIdentifier: op.container); newId = m.identifier
                } else if let card = op.card {
                    let m = CNMutableContact(); fill(m, card)
                    req.add(m, toContainerWithIdentifier: op.container); newId = m.identifier
                }
            case "delete":
                guard let id = op.id else { throw NSError(domain: "helper", code: 1, userInfo: [NSLocalizedDescriptionKey: "missing id"]) }
                req.delete(try fetchOne(id, [CNContactIdentifierKey as CNKeyDescriptor]).mutableCopy() as! CNMutableContact)
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
    fail("usage: contacts-helper containers|list|backup|apply")
}
