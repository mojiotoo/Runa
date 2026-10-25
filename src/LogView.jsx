import { useEffect, useMemo, useState } from 'react'
import './LogView.css'

// The warehouse log: where every delivery is, and everything that changed.
// Data: runa-sap's /_debug/state (deliveries, documents) and /runa/log (the
// log runa-sap writes itself on every SAP change, decision, undo, conflict
// and note). Read-only; refreshed every 2 seconds like the rest.

const STAGES = [
  ['PRODUCTION', 'Diproduksi'], ['PACKING', 'Dikemas'], ['READY', 'Siap kirim'],
  ['IN_TRANSIT', 'Dalam perjalanan'], ['AT_GATE', 'Di gerbang'], ['UNLOADING', 'Dibongkar'],
  ['RECEIVED', 'Diterima'],
]
const STAGE_LABEL = Object.fromEntries(STAGES)
const STATUS_LABEL = {
  Planned: 'Terjadwal', 'In transit': 'Dalam perjalanan', Delayed: 'Terlambat', Early: 'Lebih cepat',
  Rescheduled: 'Dijadwal ulang', Received: 'Diterima',
}
const FIELD_LABEL = {
  PlannedGoodsReceipt: 'estimasi tiba', Status: 'status', Stage: 'tahap',
  DockClosingTime: 'dock tutup', CarrierContact: 'supir', ReceivingDock: 'dock',
}
const KIND = {
  sap: ['SAP', 'sap'], decision: ['KEPUTUSAN', 'dec'], undo: ['DIBATALKAN', 'undo'],
  conflict: ['KONFLIK', 'bad'], problem: ['PERLU PERHATIAN', 'bad'], chat: ['DARI GRUP', 'chat'],
}
const FILTERS = [
  ['all', 'Semua'], ['sap', 'Ditulis ke SAP'], ['chat', 'Dari grup'], ['problem', 'Masalah'], ['undo', 'Dibatalkan'],
]
// The demo story takes place on this day (the seed data matches it).
const TODAY = import.meta.env.VITE_RUNA_TODAY || '2026-09-09'

const short = (did) => (did || '').replace(/^0+80+/, '').slice(-4) || did
const whenLocal = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}
const dayLocal = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const label = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })
  return d.toDateString() === new Date().toDateString() ? `Hari ini · ${label}` : label
}
function arrival(iso) {
  if (!iso) return '-'
  const [date, time] = iso.split('T')
  if (date === TODAY) return time.slice(0, 5)
  const [y, m, d] = TODAY.split('-').map(Number)
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  if (date === tomorrow) return `Besok ${time.slice(0, 5)}`
  return `${date.slice(8, 10)}/${date.slice(5, 7)} ${time.slice(0, 5)}`
}
const valueText = (field, value) => {
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'PlannedGoodsReceipt') return arrival(value)
  if (field === 'Stage') return STAGE_LABEL[value] || value
  if (field === 'Status') return STATUS_LABEL[value] || value
  return String(value)
}

function flagsFor(d, state, log) {
  const did = d.InboundDelivery
  const flags = []
  if (d.Status === 'Delayed') flags.push(['TERLAMBAT', 'bad'])
  if (d.Status === 'Rescheduled') flags.push(['DIJADWAL ULANG', 'warn'])
  const missing = (state.material_documents || [])
    .filter((m) => m.InboundDelivery === did && !m.ReversalDocument && !m.ReversedMaterialDocument)
    .reduce((sum, m) => sum + Number(m.QuantityInDeliveryUnit || 0), 0)
  if (missing > 0) flags.push([`KURANG ${missing}`, "bad"])
  if ((state.quality_notifications || []).some((q) => q.InboundDelivery === did && q.NotificationStatus !== 'CANCELLED'))
    flags.push(['KELUHAN KUALITAS', 'bad'])
  const mine = log.filter((e) => e.delivery === did)           // newest first
  const conflict = mine.findIndex((e) => e.kind === 'conflict')
  const settled = mine.findIndex((e) => e.kind === 'decision' || (e.kind === 'sap' && e.changes?.PlannedGoodsReceipt))
  if (conflict !== -1 && (settled === -1 || conflict < settled)) flags.push(['MENUNGGU KEPUTUSAN', 'bad'])
  const problem = mine.find((e) => e.kind === 'problem')
  if (problem && !flags.length) flags.push(['PERLU PERHATIAN', 'warn'])
  return flags
}

function latestNote(did, log, events) {
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

function EntryLine({ entry }) {
  const did = entry.delivery ? `DO ${short(entry.delivery)}` : ''
  if (entry.kind === 'decision') {
    const changes = Object.entries(entry.changes || {}).filter(([f]) => f !== 'Status')
    return (
      <>
        <b>{did}</b> · {entry.source?.sender || 'Supervisor'} memilih opsi {entry.source?.option || ''}
        {changes.length > 0 && <>: {changes.map(([f, [a, b]], i) => <span key={f}>{i ? ', ' : ''}{FIELD_LABEL[f] || f} <span className="lv-from">{valueText(f, a)} →</span> <b>{valueText(f, b)}</b></span>)}</>}
      </>
    )
  }
  if (entry.changes && Object.keys(entry.changes).length) {
    return (
      <>
        <b>{did}</b> · {Object.entries(entry.changes).map(([f, [a, b]], i) => (
          <span key={f}>{i ? ' · ' : ''}{FIELD_LABEL[f] || f} <span className="lv-from">{valueText(f, a)} →</span> <b>{valueText(f, b)}</b></span>
        ))}
      </>
    )
  }
  const text = (entry.summary || '').replace(/^DO \d+\s*/, '')
  return <><b>{did}</b>{did && ' · '}{text}</>
}

function entryFoot(entry) {
  const s = entry.source || {}
  const agent = s.agent || ''
  const reader = agent.match(/\((.*)\)/)?.[1] || 'stage reader'
  if (agent.startsWith('stages') && ['problem', 'chat'].includes(entry.kind)) return `Catatan dari grup, dibaca oleh ${reader} · tidak mengubah SAP`
  if (agent.startsWith('stages')) return `Dibaca oleh ${reader} · ditulis ke SAP · bisa /undo`
  if (entry.kind === 'undo') return 'Lewat /undo · dokumen lama tetap tercatat'
  if (entry.kind === 'decision') return 'Ditulis ke SAP oleh Runa · bisa dibatalkan dengan /undo'
  if (entry.kind === 'conflict') return 'Runa menyusun opsi untuk supervisor'
  if (entry.kind === 'problem') return 'Diteruskan ke supervisor'
  if (s.scores?.length === 2) return `Runa · yakin ${s.scores.map((x) => x.toFixed(2).replace('.', ',')).join(' / ')}`
  return ''
}

export default function LogView({ api, events }) {
  const [state, setState] = useState(null)
  const [log, setLog] = useState([])
  const [connected, setConnected] = useState(true)
  const [updated, setUpdated] = useState(null)
  const [search, setSearch] = useState('')
  const [boardFilter, setBoardFilter] = useState('all')
  const [kind, setKind] = useState('all')
  const [focus, setFocus] = useState(null)          // one DO's history only

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [s, l] = await Promise.all([
          fetch(`${api}/_debug/state`).then((r) => r.json()),
          fetch(`${api}/runa/log?limit=300`).then((r) => (r.ok ? r.json() : [])),
        ])
        if (cancelled) return
        setState(s)
        setLog(Array.isArray(l) ? l : [])
        setConnected(true)
        setUpdated(new Date())
      } catch {
        if (!cancelled) setConnected(false)
      }
    }
    load()
    const timer = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [api])

  const deliveries = useMemo(() => Object.values(state?.deliveries || {}), [state])
  const rows = useMemo(() => deliveries.map((d) => ({
    d, flags: flagsFor(d, state || {}, log), note: latestNote(d.InboundDelivery, log, events || []),
    planned: (state?.change_log || []).find((c) => c.entity === `A_InboundDelivery('${d.InboundDelivery}')` && 'PlannedGoodsReceipt' in (c.changes || {}))?.before?.PlannedGoodsReceipt,
  })).sort((a, b) => (b.flags.length > 0) - (a.flags.length > 0)
    || STAGES.findIndex(([k]) => k === b.d.Stage) - STAGES.findIndex(([k]) => k === a.d.Stage)), [deliveries, state, log, events])

  const today = log.filter((e) => Date.now() - new Date(e.at).getTime() < 24 * 3600 * 1000).length
  const problems = rows.filter((r) => r.flags.length).length
  const stageCount = (keys) => deliveries.filter((d) => keys.includes(d.Stage)).length
  const strip = [
    ['Diproduksi', stageCount(['PRODUCTION'])], ['Dikemas', stageCount(['PACKING'])],
    ['Siap kirim', stageCount(['READY'])], ['Dalam perjalanan', stageCount(['IN_TRANSIT'])],
    ['Di gerbang / dibongkar', stageCount(['AT_GATE', 'UNLOADING'])], ['Diterima', stageCount(['RECEIVED'])],
  ]

  const q = search.trim().toLowerCase()
  const shownRows = rows.filter((r) => (boardFilter !== 'problem' || r.flags.length)
    && (!q || [r.d.InboundDelivery, r.d.SupplierName, r.d.MaterialDescription, r.d.CarrierContact]
      .some((x) => String(x || '').toLowerCase().includes(q))))

  const shownLog = log.filter((e) => (!focus || e.delivery === focus) && (
    kind === 'all'
    || (kind === 'sap' && ['sap', 'decision'].includes(e.kind))
    || (kind === 'chat' && ['chat', 'problem'].includes(e.kind))
    || (kind === 'problem' && (['problem', 'conflict'].includes(e.kind) || e.problem))
    || (kind === 'undo' && e.kind === 'undo')))
  const days = []
  shownLog.forEach((e) => {
    const day = dayLocal(e.at)
    if (!days.length || days[days.length - 1][0] !== day) days.push([day, []])
    days[days.length - 1][1].push(e)
  })

  if (!state) {
    return <main className="workspace lv"><section className="panel lv-empty">{connected ? 'Memuat log gudang…' : 'Tidak terhubung ke runa-sap.'}</section></main>
  }

  return (
    <main className="workspace lv">
      <div className="lv-live"><span className={`lv-dot ${connected ? '' : 'off'}`} />
        {connected ? `Live · diperbarui ${updated ? updated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}` : 'Tidak terhubung, mencoba lagi…'}
      </div>
      <div className="lv-strip">
        {strip.map(([label, n]) => <div key={label} className="lv-stat"><strong>{n}</strong><small>{label}</small></div>)}
        <button type="button" className={`lv-stat alert ${boardFilter === 'problem' ? 'on' : ''}`} onClick={() => setBoardFilter(boardFilter === 'problem' ? 'all' : 'problem')}>
          <strong>{problems}</strong><small>Bermasalah</small>
        </button>
        <div className="lv-stat"><strong>{today}</strong><small>Perubahan 24 jam</small></div>
      </div>

      <div className="lv-grid">
        <section className="panel lv-card" aria-label="Status semua delivery">
          <h2>Status semua delivery</h2>
          <p className="lv-sub">Satu baris per DO. Status dari SAP, catatan terakhir dari grup Telegram. Klik baris untuk riwayatnya.</p>
          <div className="lv-tools">
            <input className="lv-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari DO, supplier, barang, supir…" aria-label="Cari delivery" />
            <button type="button" className={`lv-chip ${boardFilter === 'all' ? 'on' : ''}`} onClick={() => setBoardFilter('all')}>Semua {rows.length}</button>
            <button type="button" className={`lv-chip ${boardFilter === 'problem' ? 'on' : ''}`} onClick={() => setBoardFilter('problem')}>Bermasalah {problems}</button>
          </div>
          <div className="lv-table-wrap">
            <table className="lv-table">
              <thead><tr><th>DO</th><th>Supplier · barang</th><th>Tahap</th><th>Tiba / dock</th><th>Catatan terakhir dari grup</th></tr></thead>
              <tbody>
                {shownRows.map(({ d, flags, note, planned }) => (
                  <tr key={d.InboundDelivery} className={focus === d.InboundDelivery ? 'sel' : ''} onClick={() => setFocus(focus === d.InboundDelivery ? null : d.InboundDelivery)}>
                    <td className="lv-do" title={d.InboundDelivery}>{short(d.InboundDelivery)}</td>
                    <td>{d.SupplierName}<div className="lv-small">{d.MaterialDescription} · {Number(d.DeliveryQuantity).toLocaleString('id-ID')} {d.DeliveryQuantityUnit}</div></td>
                    <td><span className={`lv-pill st-${(d.Stage || 'none').toLowerCase()}`}>{STAGE_LABEL[d.Stage] || d.Status}</span>
                      {flags.map(([text, tone]) => <span key={text} className={`lv-flag ${tone}`}>{text}</span>)}</td>
                    <td>{d.Stage === 'RECEIVED' ? `Diterima` : arrival(d.PlannedGoodsReceipt)}
                      {planned && planned !== d.PlannedGoodsReceipt && <span className="lv-small"> (rencana {arrival(planned)})</span>}
                      <div className="lv-small">{d.ReceivingDock}{d.DockClosingTime && d.DockClosingTime !== '22:00' ? ` · buka s/d ${d.DockClosingTime}` : ''} · {d.CarrierContact}</div></td>
                    <td className="lv-note">{note ? <><q>{note.text}</q><div className="lv-small">{note.who} · {note.at}{note.what ? ` · ${note.what}` : ''}</div></> : <span className="lv-small">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel lv-card" aria-label="Riwayat perubahan">
          <h2>Riwayat perubahan</h2>
          <p className="lv-sub">Semua yang berubah, terbaru di atas, dengan pesan yang menyebabkannya.</p>
          <div className="lv-tools">
            {FILTERS.map(([key, label]) => <button key={key} type="button" className={`lv-chip ${kind === key ? 'on' : ''}`} onClick={() => setKind(key)}>{label}</button>)}
            {focus && <button type="button" className="lv-chip focus" onClick={() => setFocus(null)}>DO {short(focus)} ✕</button>}
          </div>
          <div className="lv-feed">
            {days.length === 0 && <p className="lv-small lv-none">Belum ada perubahan. Semua yang Runa ubah di SAP, dan setiap catatan dari grup, muncul di sini.</p>}
            {days.map(([day, entries]) => (
              <div key={day}>
                <div className="lv-day">{day}</div>
                {entries.map((e) => {
                  const [tag, tone] = KIND[e.kind] || ['LOG', 'chat']
                  const red = e.problem && e.kind === 'sap' ? 'bad' : tone
                  const foot = entryFoot(e)
                  return (
                    <div key={e.id} className="lv-ev">
                      <span className="lv-time">{whenLocal(e.at)}</span>
                      <span className={`lv-bar ${red}`} />
                      <div className="lv-what">
                        <span className={`lv-tag ${tone}`}>{tag}</span><EntryLine entry={e} />
                        {e.source?.text && e.source?.sender && e.kind !== 'undo' && (
                          <div className="lv-quote">💬 {e.source.sender}: “{e.source.text}”</div>)}
                        {foot && <div className="lv-small">{foot}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="lv-legend">
            <span><i className="sap" />Ditulis ke SAP</span><span><i className="chat" />Dari grup</span>
            <span><i className="bad" />Masalah / konflik</span><span><i className="dec" />Keputusan supervisor</span>
            <span><i className="undo" />Dibatalkan</span>
          </div>
        </section>
      </div>
    </main>
  )
}
