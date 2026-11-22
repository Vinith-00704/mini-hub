// Fills a scratch hub with made-up devices and events for development and tests. Never the owner's real data:
// it refuses any folder that is not under this repository's .minihub-home or the system's temp folder.
//
// Usage: node tools/seed.mjs <home> <dbKeyHex>

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeviceStore } from '../core/src/connectors/registry.ts'
import { Events } from '../core/src/events.ts'
import { Grants } from '../core/src/rules/grants.ts'
import { openStore } from '../core/src/store/db.ts'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [home, key] = process.argv.slice(2)

const inside = (child, parent) => {
  const c = resolve(child).toLowerCase() + sep
  const p = resolve(parent).toLowerCase() + sep
  return c.startsWith(p)
}

if (!home || !key || !(inside(home, join(repo, '.minihub-home')) || inside(home, tmpdir()))) {
  process.stderr.write('seed only fills a scratch folder: one under .minihub-home in this repository, or under the temp folder.\n')
  process.exit(1)
}

mkdirSync(home, { recursive: true })
const db = openStore(join(home, 'hub.db'), key)
const devices = new DeviceStore(db)
const grants = new Grants(db)
const events = new Events(db, grants, devices)

devices.upsert({ id: 'pc', connectorId: 'pc', kind: 'pc', name: 'This PC', state: { online: true } })
devices.upsert({ id: 'phone-test', connectorId: 'android', kind: 'phone', name: 'Test phone', state: { online: true, battery: 62, charging: true, network: 'wifi', brain: 'ok', appVersion: '0.2.0', lists: { mini: { 'phone.usage.read': 'ask' }, pc: { 'phone.usage.read': 'on', 'phone.calls.read': 'ask' } } }, info: { model: 'Test model', appVersion: '0.2.0' } })
devices.upsert({ id: 'mail-test', connectorId: 'mail', kind: 'mail-account', name: 'Mail (test)', info: { address: 'me@example.com' } })

// Collect is on for the made-up sources so the screens have something to show; Mini is given nothing.
for (const scope of ['phone.calls.read', 'phone.messages.read', 'phone.notifications.read', 'phone.usage.read']) grants.set('phone-test', scope, { collect: true })
grants.set('mail-test', 'mail.read', { collect: true })

const PEOPLE = [
  ['Asha', '+15550101'],
  ['Ravi', '+15550102'],
  ['Priya', 'priya@example.com'],
  ['Arjun', '+15550104'],
  ['Meera', '+15550105'],
  ['Kabir', 'kabir@example.com'],
  ['Zoya', '+15550107'],
  ['Dev', '+15550108'],
]
const LONG_NAME = `${'Someone with a very long display name '.repeat(5).trim()}`.slice(0, 180)
const now = Date.now()
const minutes = n => now - n * 60_000
let seq = 1
let hubSeq = 0
const phone = e => events.add('phone-test', seq++, e)
const mail = e => events.add('mail-test', seq++, e)
const hub = e => (hubSeq++, events.addHub(e))

const chats = [
  ['Ravi', 'WhatsApp', 'Are we still on for tonight?'],
  ['Team', 'WhatsApp', '3 new messages'],
  ['Zoya', 'Instagram', 'Sent you a reel 😄'],
  ['Meera', 'WhatsApp', 'இன்று மாலை சந்திக்கலாமா?'],
  [LONG_NAME, 'Telegram', 'A message from someone whose name does not fit anywhere'],
]
const sms = [
  ['Bank', 'Your OTP is 482913. Do not share it with anyone.'],
  ['Asha', 'Running 10 minutes late'],
  ['Arjun', 'Call me when you are free'],
]
const mails = [
  ['Priya', 'Invoice for November'],
  ['GitHub', '[mini-hub] Build failed on main'],
  ['University', 'Timetable change for next week'],
  ['Kabir', 'Photos from the trip'],
]

for (let i = 0; i < 12; i++) {
  const [name, key] = PEOPLE[i % PEOPLE.length]
  const missed = i % 3 === 0
  phone({ type: 'call', occurredAt: minutes(15 + i * 170), who: name, whoKey: key, title: missed ? 'Missed call' : `Incoming, ${2 + (i % 9)} min`, data: { direction: missed ? 'missed' : 'in', seconds: missed ? 0 : (2 + (i % 9)) * 60 } })
}
for (let i = 0; i < 12; i++) {
  const [name, text] = sms[i % sms.length]
  phone({ type: 'sms', occurredAt: minutes(8 + i * 150), who: name, whoKey: name, title: text, body: text, data: { direction: 'in' } })
}
for (let i = 0; i < 12; i++) {
  const [name, app, text] = chats[i % chats.length]
  phone({ type: 'chat', occurredAt: minutes(3 + i * 140), who: name, whoKey: name, app, title: text, body: text, data: { conversation: name, canReply: i < 3 } })
}
for (let i = 0; i < 6; i++) {
  phone({ type: 'notification', occurredAt: minutes(30 + i * 200), app: ['Calendar', 'Swiggy', 'Google Pay'][i % 3], title: ['Meeting at 4 pm', 'Your order is on the way', 'You received ₹500'][i % 3] })
}
for (let i = 0; i < 8; i++) {
  const [name, subject] = mails[i % mails.length]
  mail({ type: 'mail', occurredAt: minutes(20 + i * 230), who: name, whoKey: name, title: subject, body: `${subject}. This is made-up mail for development.`, data: { account: 'me@example.com', folder: 'INBOX', unread: i < 3 } })
}
for (let i = 0; i < 4; i++) {
  phone({ type: 'device_state', occurredAt: minutes(60 + i * 300), title: `Battery ${80 - i * 15}%`, data: { battery: 80 - i * 15 } })
}
const actions = ['Read 3 messages', 'Started computer control: open the browser', 'click the address bar', 'Finished: open the browser', 'Looked at the screen', 'Not allowed: send an SMS']
for (let i = 0; i < actions.length; i++) {
  hub({ type: 'mini_action', occurredAt: minutes(5 + i * 90), title: actions[i], data: { tool: 'computer', outcome: actions[i].startsWith('Not') ? 'refused' : 'done', on: 'pc' } })
}

db.close()
process.stdout.write(`seeded ${seq - 1 + hubSeq} events\n`)
