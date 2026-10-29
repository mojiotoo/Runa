import { useEffect, useReducer, useState } from 'react'

// What the Log tab and the Calendar both read from runa-sap: the SAP records
// (/_debug/state) and the warehouse log (/runa/log). Read once, every 2
// seconds, and shared, so both views always show the same thing.

export const STAGES = [
  ['PRODUCTION', 'Diproduksi'], ['PACKING', 'Dikemas'], ['READY', 'Siap kirim'],
  ['IN_TRANSIT', 'Dalam perjalanan'], ['AT_GATE', 'Di gerbang'], ['UNLOADING', 'Dibongkar'],
  ['RECEIVED', 'Diterima'],
]
export const STAGE_LABEL = Object.fromEntries(STAGES)
export const STATUS_LABEL = {
  Planned: 'Terjadwal', 'In transit': 'Dalam perjalanan', Delayed: 'Terlambat', Early: 'Lebih cepat',
  Rescheduled: 'Dijadwal ulang', Received: 'Diterima',
}
export const FIELD_LABEL = {
  PlannedGoodsReceipt: 'estimasi tiba', Status: 'status', Stage: 'tahap',
  DockClosingTime: 'dock tutup', CarrierContact: 'supir', ReceivingDock: 'dock',
}

// Runa's clock. runa-sap sends it with every state read ("now"): the demo
// evening (2026-09-09 19:42) by default, or the real Jakarta time when the
// apps run with RUNA_NOW=live. Between reads the clock ticks on here.
// TODAY is a live binding: it follows the clock, so every view agrees.
const FALLBACK_NOW = `${import.meta.env.VITE_RUNA_TODAY || '2026-09-09'}T${import.meta.env.VITE_RUNA_NOW || '19:42'}:00`
let clock = { base: FALLBACK_NOW, at: Date.now(), live: false }
export let TODAY = FALLBACK_NOW.slice(0, 10)

// "YYYY-MM-DDTHH:MM:SS", Runa's local time, no time zone (like SAP's fields).
export function currentNow() {
  if (!clock.live) return clock.base
  return new Date(Date.parse(`${clock.base}Z`) + (Date.now() - clock.at)).toISOString().slice(0, 19)
}
function setClock(iso, live) {
  if (!iso) return
  clock = { base: iso.slice(0, 19), at: Date.now(), live: Boolean(live) }
  TODAY = currentNow().slice(0, 10)
}
// Re-renders every 20 seconds when the clock is real, and returns "now".
export function useNow() {
  const [, tick] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    const timer = setInterval(() => { if (clock.live) { TODAY = currentNow().slice(0, 10); tick() } }, 20000)
    return () => clearInterval(timer)
  }, [])
  return currentNow()
}

export const short = (did) => (did || '').replace(/^0+80+/, '').slice(-4) || did
export const whenLocal = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

// Dates as 'YYYY-MM-DD' strings, counted in UTC so the browser's time zone
// never shifts a delivery to another day.
export const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
export const weekday = (date) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()     // 0 = Sunday
}

export function arrival(iso) {
  if (!iso) return '-'
  const [date, time = ''] = iso.split('T')
  if (date === TODAY) return time.slice(0, 5)
  if (date === addDays(TODAY, 1)) return `Besok ${time.slice(0, 5)}`
  return `${date.slice(8, 10)}/${date.slice(5, 7)} ${time.slice(0, 5)}`
}

export const valueText = (field, value) => {
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'PlannedGoodsReceipt') return arrival(value)
  if (field === 'Stage') return STAGE_LABEL[value] || value
  if (field === 'Status') return STATUS_LABEL[value] || value
  return String(value)
}

// Is a dock conflict still waiting for the supervisor? (log is newest first)
export function openConflict(did, log) {
  const mine = log.filter((e) => e.delivery === did)
  const conflict = mine.findIndex((e) => e.kind === 'conflict')
  const settled = mine.findIndex((e) => e.kind === 'decision' || (e.kind === 'sap' && e.changes?.PlannedGoodsReceipt))
  return conflict !== -1 && (settled === -1 || conflict < settled)
}

export function flagsFor(d, state, log) {
  const did = d.InboundDelivery
  const flags = []
  if (d.Status === 'Delayed') flags.push(['TERLAMBAT', 'bad'])
  if (d.Status === 'Rescheduled') flags.push(['DIJADWAL ULANG', 'warn'])
  const missing = (state.material_documents || [])
    .filter((m) => m.InboundDelivery === did && !m.ReversalDocument && !m.ReversedMaterialDocument)
    .reduce((sum, m) => sum + Number(m.QuantityInDeliveryUnit || 0), 0)
  if (missing > 0) flags.push([`KURANG ${missing}`, 'bad'])
  if ((state.quality_notifications || []).some((q) => q.InboundDelivery === did && q.NotificationStatus !== 'CANCELLED'))
    flags.push(['KELUHAN KUALITAS', 'bad'])
  if (openConflict(did, log)) flags.push(['MENUNGGU KEPUTUSAN', 'bad'])
  const problem = log.find((e) => e.delivery === did && e.kind === 'problem')
  if (problem && !flags.length) flags.push(['PERLU PERHATIAN', 'warn'])
  return flags
}

export function latestNote(did, log, events) {
  const entry = log.find((e) => e.delivery === did && e.source?.text && e.source?.sender && e.source.sender !== 'Runa')
  if (entry) {
    const what = entry.kind === 'decision' ? `keputusan ${entry.source.option || ''}`.trim()
      : entry.kind === 'undo' ? 'dibatalkan' : entry.kind === 'problem' ? entry.summary
        : entry.changes ? Object.keys(entry.changes).map((f) => FIELD_LABEL[f] || f).join(', ') + ' diubah' : entry.summary
    return { text: entry.source.text, who: entry.source.sender, at: whenLocal(entry.at), what }
  }
  const event = [...events].reverse().find((e) => e.resolved === did && e.sender !== 'Runa')
  return event ? { text: event.text, who: event.sender, at: event.ts, what: '' } : null
}

// The arrival time SAP had before Runa first changed it, if it changed.
export function originalPlan(did, state) {
  const first = (state?.change_log || []).find((c) => c.entity === `A_InboundDelivery('${did}')`
    && 'PlannedGoodsReceipt' in (c.before || {}))
  return first?.before?.PlannedGoodsReceipt
}

export function useWarehouse(api, enabled = true) {
  const [data, setData] = useState({ state: null, log: [], connected: true, updated: null })
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const load = async () => {
      try {
        const [state, log] = await Promise.all([
          fetch(`${api}/_debug/state`).then((r) => r.json()),
          fetch(`${api}/runa/log?limit=300`).then((r) => (r.ok ? r.json() : [])),
        ])
        if (!cancelled) setClock(state?.now, state?.live_clock)
        if (!cancelled) setData({ state, log: Array.isArray(log) ? log : [], connected: true, updated: new Date() })
      } catch {
        if (!cancelled) setData((d) => ({ ...d, connected: false }))
      }
    }
    load()
    const timer = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [api, enabled])
  return data
}
