import { useEffect, useMemo, useRef, useState } from 'react'
import './LogView.css'
import './CalendarView.css'
import {
  STAGE_LABEL, FIELD_LABEL, TODAY, useNow, short, whenLocal, addDays, weekday, arrival, valueText,
  flagsFor, latestNote, openConflict, originalPlan,
} from './warehouse'

// The dock calendar, filled from SAP: one block per inbound delivery at its
// planned arrival time, coloured by what Runa did with it. Moves by itself
// when Runa (or a supervisor's decision) changes an arrival time in SAP, and
// keeps a dashed outline where the delivery was first planned.

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const DAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const DAY_LONG = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const WEEK_HEAD = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const TYPE_LABEL = { written: 'Diubah Runa', asked: 'Menunggu jawaban', conflict: 'Konflik dock', scheduled: 'Jadwal SAP' }
const RAIL_START = 6          // the docks open at 06:00
const RAIL_END = 24
const HOUR = 48               // pixels per hour
const DEFAULT_CLOSE = '22:00'

const toHours = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}
const clock = (hours) => {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const top = (hours) => (Math.min(Math.max(hours, RAIL_START), RAIL_END) - RAIL_START) * HOUR
const dayNumber = (date) => Number(date.slice(8, 10))
const monthOf = (date) => Number(date.slice(5, 7)) - 1
const longDate = (date) => `${DAY_LONG[weekday(date)]}, ${dayNumber(date)} ${MONTHS_SHORT[monthOf(date)]} ${date.slice(0, 4)}`
const mondayOf = (date) => addDays(date, -((weekday(date) + 6) % 7))
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}
// Every day shown in a month grid: Monday before the 1st to Sunday after the last.
function monthDays(date) {
  const first = `${date.slice(0, 8)}01`
  const last = addDays(addMonths(first, 1), -1)
  const days = []
  for (let d = mondayOf(first); d <= last || weekday(d) !== 1; d = addDays(d, 1)) days.push(d)
  return days
}

// Side-by-side lanes for deliveries at overlapping times on one day.
function lanes(dayEntries) {
  const sorted = [...dayEntries].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  const placed = []
  let cluster = []
  let clusterEnd = -1
  const close = () => {
    const count = Math.max(...cluster.map((p) => p.lane)) + 1
    cluster.forEach((p) => { p.count = count })
    cluster = []
  }
  sorted.forEach((entry) => {
    if (cluster.length && entry.start >= clusterEnd) close()
    const busy = new Set(cluster.filter((p) => p.entry.end > entry.start).map((p) => p.lane))
    let lane = 0
    while (busy.has(lane)) lane += 1
    const item = { entry, lane, count: 1 }
    cluster.push(item)
    placed.push(item)
    clusterEnd = Math.max(clusterEnd, entry.end)
  })
  if (cluster.length) close()
  return placed
}

function changeText(entry) {
  const did = entry.delivery ? `DO ${short(entry.delivery)}` : ''
  if (entry.kind === 'undo') return `${did} · dibatalkan`
  const changes = Object.entries(entry.changes || {}).filter(([f]) => f !== 'Status')
  if (!changes.length) return `${did} · ${(entry.summary || '').replace(/^DO \d+\s*/, '')}`
  const [field, [before, after]] = changes[0]
  const what = `${FIELD_LABEL[field] || field} ${valueText(field, before)} → ${valueText(field, after)}`
  return entry.kind === 'decision' ? `${did} · opsi ${entry.source?.option || ''}: ${what}` : `${did} · ${what}`
}

export default function CalendarView({ warehouse, events, pending, onOpenConsole, onOpenLog }) {
  const { state, log, connected } = warehouse
  const [mode, setMode] = useState('week')
  const [picked, setSelected] = useState(null)   // null: follow today
  const now = useNow()
  const selected = picked || TODAY
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const scroller = useRef(null)
  const scrolledFor = useRef('')

  const entries = useMemo(() => Object.values(state?.deliveries || {})
    .filter((d) => d.PlannedGoodsReceipt)
    .map((d) => {
      const did = d.InboundDelivery
      const [date, time] = d.PlannedGoodsReceipt.split('T')
      const start = toHours(time)
      const asked = pending.find((e) => e.resolved === did)
      const lastChange = log.find((e) => e.delivery === did && ['sap', 'decision', 'undo'].includes(e.kind))
      const type = openConflict(did, log) ? 'conflict' : asked ? 'asked'
        : lastChange && lastChange.kind !== 'undo' ? 'written' : 'scheduled'
      const planned = originalPlan(did, state)
      const lastEvent = [...events].reverse().find((e) => e.resolved === did)
      return {
        id: did, d, date, start, end: Math.min(start + 1, RAIL_END), type,
        flags: flagsFor(d, state, log), note: latestNote(did, log, events),
        planned: planned && planned !== d.PlannedGoodsReceipt ? planned : null,
        sourceEventId: asked?.id || lastEvent?.id || null,
      }
    }), [state, log, events, pending])

  const visibleDays = mode === 'day' ? [selected]
    : mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(selected), i))
      : monthDays(selected)
  const onDay = (date) => entries.filter((e) => e.date === date)
  const ghostsOn = (date) => entries.filter((e) => e.planned?.startsWith(date))
  const selectedEntry = entries.find((e) => e.id === activeId) || null
  const nowTime = now.slice(11, 16)
  const nowHours = toHours(nowTime)

  // Scroll the time grid to "now" (or the first delivery) once per view.
  useEffect(() => {
    if (mode === 'month' || !scroller.current || !entries.length) return
    const key = `${mode}|${visibleDays[0]}`
    if (scrolledFor.current === key) return
    scrolledFor.current = key
    const first = Math.min(...visibleDays.flatMap((day) => onDay(day).map((e) => e.start)), 24)
    const focus = visibleDays.includes(TODAY) ? nowHours - 3 : (first < 24 ? first : 8)
    scroller.current.scrollTop = Math.max(0, top(focus) - HOUR * 1.5)
  })

  const q = search.trim().toLowerCase()
  const matches = q ? entries.filter((e) => [
    e.d.InboundDelivery, e.d.SupplierName, e.d.MaterialDescription, e.d.CarrierContact, e.d.ReceivingDock, e.note?.text,
    ...events.filter((ev) => ev.resolved === e.id).map((ev) => ev.text),
  ].some((x) => String(x || '').toLowerCase().includes(q))) : []

  const focusEntry = (entry) => {
    setActiveId(entry.id)
    setSelected(entry.date)
    if (mode === 'month') setMode('day')
  }
  const move = (step) => setSelected(mode === 'day' ? addDays(selected, step) : mode === 'week' ? addDays(selected, 7 * step) : addMonths(selected, step))
  const openDay = (date) => { setSelected(date); setMode('day') }

  const changes = log.filter((e) => ['sap', 'decision', 'undo'].includes(e.kind)).slice(0, 5)
  const followUps = [
    ...pending.map((e) => ({ key: `ask-${e.id}`, text: `Tunggu jawaban ${e.sender}${e.resolved ? ` (DO ${short(e.resolved)})` : ''}`, open: () => onOpenConsole(e.id, 'reasoning') })),
    ...entries.filter((e) => e.type === 'conflict').map((e) => ({ key: `c-${e.id}`, text: `Putuskan konflik dock DO ${short(e.id)}`, open: () => focusEntry(e) })),
    ...entries.filter((e) => e.type !== 'conflict' && e.flags.some(([t]) => !['TERLAMBAT', 'DIJADWAL ULANG'].includes(t)))
      .map((e) => ({ key: `p-${e.id}`, text: `Cek DO ${short(e.id)}: ${e.flags.map(([t]) => t.toLowerCase()).join(', ')}`, open: () => focusEntry(e) })),
  ]

  const boardTitle = mode === 'month' ? `${MONTHS[monthOf(selected)]} ${selected.slice(0, 4)}`
    : mode === 'day' ? longDate(selected)
      : (() => {
        const [a, b] = [visibleDays[0], visibleDays[6]]
        return `Minggu ${dayNumber(a)}${monthOf(a) !== monthOf(b) ? ` ${MONTHS_SHORT[monthOf(a)]}` : ''} – ${dayNumber(b)} ${MONTHS_SHORT[monthOf(b)]} ${b.slice(0, 4)}`
      })()
  const miniDays = monthDays(selected)
  const timeLabels = Array.from({ length: RAIL_END - RAIL_START + 1 }, (_, i) => RAIL_START + i)

  if (!state) {
    return <div className="calendar-page"><p className="calendar-muted cv-empty">{connected ? 'Memuat jadwal dari SAP…' : 'Tidak terhubung ke runa-sap.'}</p></div>
  }

  return (
    <div className="calendar-page cv">
      <form className="calendar-search" role="search" onSubmit={(ev) => { ev.preventDefault(); if (matches[0]) { focusEntry(matches[0]); setSearch('') } }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
        <input type="search" value={search} onChange={(ev) => setSearch(ev.target.value)} placeholder="Cari DO, supplier, barang, supir, atau isi pesan..." aria-label="Cari delivery atau pesan" />
        {search && <button type="button" className="clear-search" aria-label="Hapus pencarian" onClick={() => setSearch('')}>×</button>}
        {q && <div className="calendar-search-results">
          {matches.length ? matches.map((e) => <button key={e.id} type="button" className="calendar-search-result" onClick={() => { focusEntry(e); setSearch('') }}>
            <strong>DO {short(e.id)}</strong><span>{e.d.SupplierName} · {e.d.MaterialDescription}</span><small>{arrival(e.d.PlannedGoodsReceipt)} · {e.d.ReceivingDock}</small>
          </button>) : <p>Tidak ada delivery atau pesan yang cocok.</p>}
        </div>}
      </form>

      <div className="calendar-layout">
        <aside className="calendar-sidebar">
          <section className="calendar-widget mini-calendar-widget">
            <div className="cv-widget-head">
              <h3>{MONTHS[monthOf(selected)]} {selected.slice(0, 4)}</h3>
              <span className="cv-arrows">
                <button type="button" aria-label="Bulan sebelumnya" onClick={() => setSelected(addMonths(selected, -1))}>‹</button>
                <button type="button" aria-label="Bulan berikutnya" onClick={() => setSelected(addMonths(selected, 1))}>›</button>
              </span>
            </div>
            <div className="mini-calendar-grid">
              {WEEK_HEAD.map((d) => <span className="mini-weekday" key={d}>{d}</span>)}
              {miniDays.map((date) => {
                const outside = monthOf(date) !== monthOf(selected)
                const has = onDay(date).length > 0
                return <button key={date} type="button" title={longDate(date)}
                  className={`${outside ? 'outside-month' : ''} ${date === selected ? 'selected-day' : ''} ${has ? 'has-calendar-event' : ''} ${date === TODAY ? 'cv-today' : ''}`}
                  aria-pressed={date === selected} onClick={() => openDay(date)}>
                  {dayNumber(date)}{has && <i />}
                </button>
              })}
            </div>
          </section>

          <section className="calendar-widget">
            <h3>Perubahan oleh Runa</h3>
            {changes.length ? changes.map((e) => <button className="calendar-log" key={e.id} type="button"
              onClick={() => { const entry = entries.find((x) => x.id === e.delivery); if (entry) focusEntry(entry) }}>
              <i className={`log-dot ${e.kind === 'undo' ? 'ignored' : e.problem ? 'conflict' : ''}`} />
              <span><b>{whenLocal(e.at)}</b>{changeText(e)}</span>
            </button>) : <p className="calendar-muted">Belum ada perubahan di SAP.</p>}
            <button type="button" className="cv-link" onClick={() => onOpenLog(null)}>Lihat semua di Log →</button>
          </section>

          <section className="calendar-widget">
            <h3>Perlu tindak lanjut</h3>
            {followUps.length ? followUps.map((f) => <button className="follow-up" key={f.key} type="button" onClick={f.open}>
              <i className="follow-check" /><span>{f.text}</span>
            </button>) : <p className="calendar-muted">Tidak ada tugas tertunda.</p>}
          </section>
        </aside>

        <div className="calendar-main">
          <section className="calendar-board">
            <div className="calendar-boardbar">
              <span className="cv-nav">
                <button type="button" aria-label="Sebelumnya" onClick={() => move(-1)}>‹</button>
                <button type="button" aria-label="Berikutnya" onClick={() => move(1)}>›</button>
                <strong>{boardTitle}</strong>
                {!visibleDays.includes(TODAY) && <button type="button" className="cv-today-btn" onClick={() => setSelected(null)}>Hari ini</button>}
              </span>
              <div className="calendar-legend">
                {Object.entries(TYPE_LABEL).map(([key, label]) => <span className={`legend-${key}`} key={key}>{label}</span>)}
                <span className="legend-planned">Rencana awal</span>
              </div>
            </div>
            <div className="calendar-view-switch" role="tablist" aria-label="Tampilan kalender">
              {[['day', 'Harian'], ['week', 'Mingguan'], ['month', 'Bulanan']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}>{label}</button>)}
            </div>

            {mode === 'month' ? <div className="calendar-month-grid">
              {WEEK_HEAD.map((d) => <span className="month-weekday" key={d}>{d}</span>)}
              {visibleDays.map((date) => {
                const dayEntries = onDay(date).sort((a, b) => a.start - b.start)
                return <button key={date} type="button" onClick={() => openDay(date)}
                  className={`month-day ${monthOf(date) !== monthOf(selected) ? 'outside-month' : ''} ${date === selected ? 'selected-day' : ''} ${date === TODAY ? 'cv-today' : ''}`}>
                  <b>{dayNumber(date)}</b>
                  {dayEntries.slice(0, 3).map((e) => <span className={`month-event ${e.type} ${e.d.Stage === 'RECEIVED' ? 'cv-done' : ''}`} key={e.id}>{clock(e.start)} {e.d.SupplierName}</span>)}
                  {dayEntries.length > 3 && <small>+{dayEntries.length - 3} lainnya</small>}
                </button>
              })}
            </div> : <div className="calendar-scroll cv-scroll" ref={scroller}>
              <div className="schedule-grid" style={{ '--calendar-day-count': visibleDays.length, '--cv-height': `${(RAIL_END - RAIL_START) * HOUR}px` }}>
                <div className="schedule-corner" />
                {visibleDays.map((date) => <button key={date} type="button" className={`schedule-day-heading ${date === TODAY ? 'current-day' : ''}`} onClick={() => openDay(date)}>
                  <strong>{dayNumber(date)}</strong><small>{DAY_SHORT[weekday(date)]}{date === TODAY ? ' · hari ini' : ''}</small>
                </button>)}
                <div className="schedule-time-rail">{timeLabels.map((h) => <span key={h} style={{ top: `${top(h)}px` }}>{String(h).padStart(2, '0')}:00</span>)}</div>
                {visibleDays.map((date, column) => {
                  const dayEntries = onDay(date)
                  // Docks open past the usual 22:00 (e.g. a supervisor extended one).
                  const extended = [...new Map(dayEntries.filter((e) => e.d.DockClosingTime && e.d.DockClosingTime !== DEFAULT_CLOSE)
                    .map((e) => [e.d.ReceivingDock, e.d.DockClosingTime])).entries()]
                  return <div className="schedule-day-column" key={date}>
                    <div className="schedule-dock-line" style={{ top: `${top(toHours(DEFAULT_CLOSE))}px` }}>{column === 0 && <em>Dock tutup {DEFAULT_CLOSE}</em>}</div>
                    {extended.map(([dock, closes], i) => {
                      const hours = toHours(closes)
                      const nextDay = hours < toHours('06:00')
                      return <div className="schedule-dock-line cv-extended" key={dock} style={{ top: `${top(nextDay ? RAIL_END : hours) - i * 2}px` }}>
                        <em>{dock} buka s/d {closes}{nextDay ? ' (besok)' : ''}</em>
                      </div>
                    })}
                    {date === TODAY && <div className="schedule-now-line" style={{ top: `${top(nowHours)}px` }}><em className="cv-now">{nowTime}</em></div>}
                    {ghostsOn(date).map((e) => {
                      const from = toHours(e.planned.split('T')[1])
                      return <div key={`ghost-${e.id}`} className="cv-ghost" style={{ top: `${top(from) + 3}px`, height: `${HOUR - 6}px` }}>
                        <span>Rencana awal DO {short(e.id)} · {clock(from)}</span>
                      </div>
                    })}
                    {lanes(dayEntries).map(({ entry: e, lane, count }) => <button type="button" key={e.id}
                      className={`calendar-event ${e.type} ${e.d.Stage === 'RECEIVED' ? 'cv-done' : ''} ${activeId === e.id ? 'selected-event' : ''}`}
                      title={`DO ${short(e.id)} · ${e.d.SupplierName} · ${STAGE_LABEL[e.d.Stage] || e.d.Status}`}
                      style={{
                        top: `${top(e.start) + 3}px`, height: `${Math.max(34, (e.end - e.start) * HOUR - 6)}px`,
                        left: `calc(${(lane * 100) / count}% + 3px)`, width: `calc(${100 / count}% - 6px)`, right: 'auto',
                      }}
                      onClick={() => setActiveId(e.id)}>
                      <b>{e.d.SupplierName}</b>
                      <span>{clock(e.start)} · DO {short(e.id)} · {e.d.ReceivingDock}</span>
                      <small>{STAGE_LABEL[e.d.Stage] || e.d.Status}{e.flags.length ? ` · ${e.flags[0][0].toLowerCase()}` : ''}</small>
                    </button>)}
                  </div>
                })}
              </div>
            </div>}
          </section>

          <section className="calendar-selection">
            {selectedEntry ? <>
              <div className="cv-sel">
                <div className="cv-sel-tags">
                  <span className={`calendar-status ${selectedEntry.type}`}>{TYPE_LABEL[selectedEntry.type]}</span>
                  <span className={`lv-pill st-${(selectedEntry.d.Stage || 'none').toLowerCase()}`}>{STAGE_LABEL[selectedEntry.d.Stage] || selectedEntry.d.Status}</span>
                  {selectedEntry.flags.map(([text, tone]) => <span key={text} className={`lv-flag ${tone}`}>{text}</span>)}
                </div>
                <h3>{selectedEntry.d.SupplierName}</h3>
                <p>DO {short(selectedEntry.id)} · {selectedEntry.d.MaterialDescription} · {Number(selectedEntry.d.DeliveryQuantity).toLocaleString('id-ID')} {selectedEntry.d.DeliveryQuantityUnit}</p>
                <p className="cv-facts">
                  <span><small>Tiba</small>{arrival(selectedEntry.d.PlannedGoodsReceipt)}{selectedEntry.planned && <em> (rencana awal {arrival(selectedEntry.planned)})</em>}</span>
                  <span><small>Dock</small>{selectedEntry.d.ReceivingDock} · tutup {selectedEntry.d.DockClosingTime || DEFAULT_CLOSE}</span>
                  <span><small>Supir</small>{selectedEntry.d.CarrierContact || '-'}</span>
                  <span><small>Rute</small>{selectedEntry.d.Route || '-'}</span>
                </p>
                {selectedEntry.note && <p className="calendar-muted">💬 {selectedEntry.note.who}: “{selectedEntry.note.text}” · {selectedEntry.note.at}</p>}
              </div>
              <div className="cv-sel-actions">
                <button type="button" className="calendar-open-detail" onClick={() => onOpenLog(selectedEntry.id)}>Lihat riwayat</button>
                {selectedEntry.sourceEventId && <button type="button" className="cv-secondary" onClick={() => onOpenConsole(selectedEntry.sourceEventId, 'reasoning')}>Buka chat</button>}
              </div>
            </> : <p className="calendar-muted">Pilih jadwal untuk melihat detail delivery dan pesan yang mengubahnya.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
