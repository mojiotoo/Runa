import { useEffect, useRef, useState } from 'react'
import './App.css'

const EVENTS = [
  { id: 1, ts: '10:31', sender: 'Andi (Driver)', media: 'text', text: 'ok bos siap', decision: 'ignored', e: 0, v: 0, note: 'Bukan kejadian bisnis.' },
  { id: 2, ts: '10:36', sender: 'Budi (Driver)', media: 'text', text: 'Pengiriman PO 4500001234 dari PT Sumber Makmur telat 2 jam, truk kena macet Tol Merak', decision: 'written', e: 0.97, v: 0.92, hedges: [], resolved: 'PO 4500001234 (PT Sumber Makmur)', doc: '180000123', note: 'Entity dan event di atas threshold. Ditulis langsung.' },
  { id: 3, ts: '10:42', sender: 'Sari (Gudang)', media: 'text', text: 'PO yang kemarin dari gudang lama kurang 20 dus kayaknya', decision: 'asked', e: 0.58, v: 0.64, hedges: ['kayaknya'], resolved: 'PO yang kemarin', cands: [['4500001240 - PT Kemas Jaya', 0.58], ['4500001236 - CV Dus Prima', 0.51]], q: 'Maksudnya PO 4500001240 (PT Kemas Jaya) atau 4500001236 (CV Dus Prima)?', note: 'Entity 0.58 < 0.85. Tanya dulu.' },
  { id: 4, ts: '10:44', sender: 'Sari (Gudang)', media: 'text', text: 'yang Kemas Jaya, kurang 20 dus', decision: 'written', e: 0.95, v: 0.88, hedges: [], resolved: 'PO 4500001240 (PT Kemas Jaya)', doc: '180000124', note: 'Jawaban digabung dengan pertanyaan awal, lalu diputuskan ulang.' },
  { id: 5, ts: '10:51', sender: 'Budi (Driver)', media: 'foto', text: '[foto surat jalan] SJ-7781, 300 PCS Kardus 40x30', decision: 'written', e: 0.94, v: 0.9, hedges: [], resolved: 'PO 4500001251 (PT Sumber Makmur)', doc: '180000125', note: 'Surat jalan dibaca lewat Claude multimodal.' },
  { id: 6, ts: '10:52', sender: 'Runa', media: 'sistem', text: 'ETA baru 17:30 melewati dock close 16:00 (Dock B)', decision: 'conflict', e: 1, v: 1, resolved: 'Delivery 180000123', opts: ['Pindah ke slot besok 08:00', 'Alihkan ke Dock C (tutup 19:00)', 'Hubungi supplier'], note: 'Cek konflik setelah write.' },
]

const DOCS = {
  '180000123': { po: '4500001234', sup: 'PT Sumber Makmur', plant: '1000', status: 'Delayed', eta: '01 Okt 17:30', reason: 'D002 Delay - transport', items: [['10', 'Kardus 40x30', '500 PCS']], ev: 2 },
  '180000124': { po: '4500001240', sup: 'PT Kemas Jaya', plant: '1000', status: 'GR Discrepancy', eta: '30 Sep 14:00', reason: 'G001 GR discrepancy', items: [['10', 'Dus 20x20', '-20 PCS']], ev: 4 },
  '180000125': { po: '4500001251', sup: 'PT Sumber Makmur', plant: '1000', status: 'Received', eta: '01 Okt 10:50', reason: '-', items: [['10', 'Kardus 40x30', '300 PCS']], ev: 5 },
}

const SAP_SCHEDULES = [
  { id: 'sap-1198', day: 28, start: 9, end: 10, title: 'Sinar Plastik', sub: 'PO 4500001198 - Dock A', type: 'scheduled' },
  { id: 'sap-1210', day: 29, start: 11, end: 12, title: 'CV Dus Prima', sub: 'PO 4500001210 - Dock C', type: 'scheduled' },
  { id: 'sap-1222', day: 30, start: 14, end: 15, title: 'PT Lem Nusantara', sub: 'PO 4500001222 - Dock A', type: 'scheduled' },
  { id: 'sap-1245', day: 2, start: 9, end: 10.5, title: 'PT Kemas Jaya', sub: 'PO 4500001245 - Dock A', type: 'scheduled' },
  { id: 'sap-1260', day: 2, start: 13, end: 14, title: 'Sinar Plastik', sub: 'PO 4500001260 - Dock B', type: 'scheduled' },
  { id: 'sap-1270', day: 3, start: 10, end: 11, title: 'CV Dus Prima', sub: 'PO 4500001270 - Dock C', type: 'scheduled' },
]

const WEEK_DAYS = [[28, 'Sen'], [29, 'Sel'], [30, 'Rab'], [1, 'Kam'], [2, 'Jum'], [3, 'Sab']]

const LABELS = { written: 'Written', asked: 'Asked', ignored: 'Ignored', conflict: 'Conflict' }

function TabIcon({ name }) {
  const paths = {
    console: <><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>,
    feed: <><path d="M4 12h3l2-6 4 12 2-6h5" /><path d="M4 4v16M20 4v16" /></>,
    pending: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    docs: <><path d="M7 3.5h7l4 4V20H7z" /><path d="M14 3.5V8h4M10 12h5M10 16h5" /></>,
    conf: <><path d="m12 3 9 17H3z" /><path d="M12 9v4M12 16h.01" /></>,
    stats: <><path d="M4 19V5M4 19h16" /><path d="M8 15v-4M12 15V7M16 15V9" /></>,
  }

  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Badge({ decision }) {
  return <span className={`badge ${decision}`}>{LABELS[decision]}</span>
}

function ScoreBar({ label, value }) {
  return (
    <span className="score">
      {label} <span className="bar"><i style={{ width: `${value * 100}%` }} /></span> {value.toFixed(2)}
    </span>
  )
}

function App() {
  const [list, setList] = useState(EVENTS)
  const [tab, setTab] = useState('console')
  const [selectedEvent, setSelectedEvent] = useState(2)
  const [playing, setPlaying] = useState(false)

  return (
    <Console
      list={list}
      setList={setList}
      tab={tab}
      setTab={setTab}
      selectedEvent={selectedEvent}
      setSelectedEvent={setSelectedEvent}
      playing={playing}
      setPlaying={setPlaying}
    />
  )
}

function Console({ list, setList, tab, setTab, selectedEvent, setSelectedEvent, playing, setPlaying }) {
  const timer = useRef(null)
  const telegramConnected = true
  const [filter, setFilter] = useState('all')
  const [detailTab, setDetailTab] = useState('reasoning')
  const [resolvedConflictIds, setResolvedConflictIds] = useState([])
  useEffect(() => () => clearInterval(timer.current), [timer])

  const count = (decision) => list.filter((event) => event.decision === decision).length
  const calendarTodayCount = SAP_SCHEDULES.filter((entry) => entry.day === 1).length + Object.keys(DOCS).filter((docNumber) => {
    const linkedEvents = list.filter((item) => item.doc === docNumber || item.resolved?.match(/\d{9}/)?.[0] === docNumber)
    if (!linkedEvents.length) return false
    const latest = linkedEvents.reduce((current, item) => item.id > current.id ? item : current)
    if (latest.text.includes('besok 08:00')) return false
    return Number(DOCS[docNumber].eta.match(/^(\d{1,2})/)?.[1]) === 1
  }).length
  const replay = () => {
    clearInterval(timer.current)
    setList([])
    setSelectedEvent(null)
    setResolvedConflictIds([])
    setFilter('all')
    setPlaying(true)
    let index = 0
    timer.current = setInterval(() => {
      const event = EVENTS[index]
      setList((current) => [...current, event])
      setSelectedEvent(event.id)
      index += 1
      if (index >= EVENTS.length) {
        clearInterval(timer.current)
        setPlaying(false)
      }
    }, 1600)
  }

  const feed = [...list].reverse()
  const pending = list.filter((event) => event.decision === 'asked' && !list.some((later) => later.id > event.id && later.decision === 'written' && later.sender === event.sender))
  const conflicts = list.filter((event) => event.decision === 'conflict' && !resolvedConflictIds.includes(event.id))
  const documents = list.filter((event) => event.doc).map((event) => event.doc)
  const event = list.find((item) => item.id === selectedEvent)
  const tabs = [
    ['console', 'Console', pending.length + conflicts.length],
    ['calendar', 'Calendar', null],
    ['stats', 'Stats', null],
  ]

  const filters = [
    ['all', 'Semua', list.length],
    ['need', 'Perlu tindakan', pending.length + conflicts.length],
    ['written', 'Written', count('written')],
    ['asked', 'Asked', pending.length],
    ['conflict', 'Conflict', conflicts.length],
    ['ignored', 'Ignored', count('ignored')],
    ['docs', 'Dokumen', documents.length],
  ]
  const visibleEvents = feed.filter((item) => {
    if (filter === 'all') return true
    if (filter === 'need') return pending.some((pendingEvent) => pendingEvent.id === item.id) || conflicts.some((conflict) => conflict.id === item.id)
    if (filter === 'asked') return pending.some((pendingEvent) => pendingEvent.id === item.id)
    if (filter === 'conflict') return conflicts.some((conflict) => conflict.id === item.id)
    if (filter === 'docs') return Boolean(item.doc)
    return item.decision === filter
  })

  const resolveConflict = (conflict, option) => {
    const nextId = Math.max(0, ...list.map((item) => item.id)) + 1
    const doc = conflict.resolved.match(/\d{9}/)?.[0]
    setResolvedConflictIds((ids) => [...ids, conflict.id])
    setList((items) => [...items, {
      id: nextId,
      ts: '10:53',
      sender: 'Runa',
      media: 'sistem',
      text: `Keputusan manusia: ${option}. Jadwal diperbarui di SAP, konfirmasi dikirim ke grup.`,
      decision: 'written',
      e: 1,
      v: 1,
      resolved: conflict.resolved,
      doc,
      note: 'Aksi dipilih dari panel Perlu tindakan.',
    }])
    setSelectedEvent(nextId)
  }
  return (
    <div className="console">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          <span>Runa</span>
        </div>
        {/* <div className="side-caption">WORKSPACE</div> */}
        <nav className="side-nav" role="tablist" aria-label="Runa views">
          {tabs.map(([key, label, count]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              <TabIcon name={key} />
              <span>{label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
            </button>
          ))}
        </nav>
        <section className="telegram-status" aria-label={`Koneksi Telegram ${telegramConnected ? 'aktif' : 'terputus'}`}>
          <span className={`connection-indicator ${telegramConnected ? 'connected' : 'disconnected'}`} role="status" aria-label={telegramConnected ? 'Terhubung' : 'Tidak terhubung'} />
          <span className="telegram-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 3.6 18.4 20c-.2 1.2-.9 1.5-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.5 1 12c-1.1-.3-1.1-1 .2-1.5L20 3.2c.9-.3 1.7.2 1.5.4Z" /></svg>
          </span>
          <span className="telegram-copy">
            <small>Logistik Gudang Cikarang</small>
            <small>@runa_ops_bot</small>
          </span>
        </section>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div className="page-heading">
            <span className="eyebrow">OPERATIONS OVERVIEW</span>
            <h1>{tab === 'calendar' ? 'Runa Calendar' : tab === 'stats' ? 'Runa Stats' : 'Runa Console'}</h1>
          </div>
          {tab === 'calendar' ? <div className="calendar-header-metrics">
            <span><small>Pengiriman hari ini</small><strong>{calendarTodayCount}</strong></span>
            <span><small>Diperbarui oleh Runa</small><strong>{list.length}</strong></span>
          </div> : <button className="primary" type="button" onClick={replay} disabled={playing}>
            {playing ? 'Memutar...' : 'Replay skenario'}
          </button>}
        </header>

        {tab === 'stats' ? (
          <main className="workspace stats-view">
            <section className="panel main-panel" aria-label="Stats">
              <StatsDashboard list={list} counts={{ written: count('written'), asked: count('asked'), ignored: count('ignored'), conflict: count('conflict') }} conflicts={conflicts} />
            </section>
          </main>
        ) : tab === 'calendar' ? (
          <main className="workspace calendar-view">
            <section className="panel main-panel" aria-label="Calendar">
              <CalendarDashboard
                list={list}
                pending={pending}
                conflicts={conflicts}
                selectedEvent={selectedEvent}
                onSelectEvent={setSelectedEvent}
                onOpenConsole={(eventId, targetTab = 'document') => { setSelectedEvent(eventId); setTab('console'); setDetailTab(targetTab) }}
              />
            </section>
          </main>
        ) : (
          <main className="console-main">
            {(pending.length > 0 || conflicts.length > 0) && <section className="action-section">
              <h2>Perlu tindakan</h2>
              <div className="action-grid">
                {pending.map((item) => <button className="action-card action-asked" key={item.id} onClick={() => setSelectedEvent(item.id)}>
                  <strong>Menunggu jawaban dari {item.sender}</strong>
                  <span>{item.q}</span>
                </button>)}
                {conflicts.map((item) => <article className="action-card action-conflict" key={item.id}>
                  <strong>{item.text}</strong>
                  <span>{item.resolved}. Pilih penyelesaian:</span>
                  <div className="action-options">{item.opts?.map((option) => <button key={option} type="button" onClick={() => resolveConflict(item, option)}>{option}</button>)}</div>
                </article>)}
              </div>
            </section>}

            <section className="console-columns">
              <div className="card message-card">
                <div className="filter-chips" role="tablist" aria-label="Filter pesan">
                  {filters.map(([key, label, amount]) => <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>
                    {label}<span>{amount}</span>
                  </button>)}
                </div>
                <div className="message-list">
                  {visibleEvents.length ? visibleEvents.map((item) => <button key={item.id} type="button" className="message-row" aria-pressed={selectedEvent === item.id} onClick={() => { setSelectedEvent(item.id); setDetailTab('reasoning') }}>
                    <span className="message-avatar">{item.sender.split(' ').slice(0, 2).map((part) => part[0]).join('').replace(/[()]/g, '').slice(0, 2)}</span>
                    <span className="message-body">
                      <span className="meta">{item.ts} - {item.sender}</span>
                      <span className="message-text">{item.text}</span>
                      <span className="message-tags"><Badge decision={item.decision} />{item.decision !== 'ignored' && <><ScoreBar label="Entity" value={item.e} /><ScoreBar label="Event" value={item.v} /></>}</span>
                    </span>
                  </button>) : <div className="empty">Tidak ada pesan di filter ini.</div>}
                </div>
              </div>

              <aside className="card detail-card">
                <div className="detail-tabs" role="tablist" aria-label="Detail pesan">
                  {[["reasoning", 'Reasoning'], ['document', 'Dokumen SAP'], ['audit', 'Audit']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={detailTab === key} onClick={() => setDetailTab(key)}>{label}</button>)}
                </div>
                <EventDetail event={event} detailTab={detailTab} />
              </aside>
            </section>
          </main>
        )}
      </div>
    </div>
  )
}

function CalendarDashboard({ list, pending, conflicts, selectedEvent, onSelectEvent, onOpenConsole }) {
  const [mode, setMode] = useState('week')
  const [selectedDay, setSelectedDay] = useState(1)
  const [activeEntryId, setActiveEntryId] = useState(null)
  const [search, setSearch] = useState('')

  const liveEntries = Object.keys(DOCS).flatMap((docNumber) => {
    const relatedEvents = list.filter((event) => {
      const linkedDoc = event.doc || event.resolved?.match(/\d{9}/)?.[0]
      return linkedDoc === docNumber
    })
    if (!relatedEvents.length) return []

    const latest = relatedEvents.reduce((current, event) => event.id > current.id ? event : current)
    const details = DOCS[docNumber]
    const eta = details.eta.match(/(\d{1,2})\s+(Sep|Okt)\s+(\d{2}):(\d{2})/)
    let day = Number(eta?.[1] || 1)
    let start = Number(eta?.[3] || 10) + Number(eta?.[4] || 0) / 60
    if (latest.text.includes('besok 08:00')) {
      day = 2
      start = 8
    }

    return [{
      id: `runa-${docNumber}`,
      day,
      start,
      end: start + 1,
      title: details.sup,
      sub: `PO ${details.po} - Delivery ${docNumber}`,
      type: conflicts.some((conflict) => conflict.id === latest.id) ? 'conflict' : latest.decision === 'asked' ? 'asked' : 'written',
      doc: docNumber,
      sourceEventId: latest.id,
      sourceEventIds: relatedEvents.map((event) => event.id),
      source: latest,
    }]
  })

  const entries = [...SAP_SCHEDULES, ...liveEntries]
  const searchMatches = search.trim()
    ? entries.filter((entry) => entry.sourceEventId && `${entry.doc} ${entry.title} ${entry.sub} ${entry.source?.text || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    : []
  const selectedWeekDay = WEEK_DAYS.find(([day]) => day === selectedDay)
  const weekdayLabels = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
  const visibleDays = mode === 'day'
    ? [selectedWeekDay || [selectedDay, weekdayLabels[new Date(2026, 9, selectedDay).getDay()]]]
    : WEEK_DAYS
  const selectedEntry = entries.find((entry) => entry.id === activeEntryId)
    || entries.find((entry) => entry.sourceEventIds?.includes(selectedEvent))
    || null
  const monthDates = [28, 29, 30, ...Array.from({ length: 31 }, (_, index) => index + 1), 1]
  const logEvents = [...list].filter((event) => event.doc || event.decision === 'conflict').slice(-5).reverse()
  const timeLabels = Array.from({ length: 11 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`)

  const selectEntry = (entry) => {
    setActiveEntryId(entry.id)
    if (entry.sourceEventId) onSelectEvent(entry.sourceEventId)
  }

  const entriesForDay = (day) => entries.filter((entry) => entry.day === day)

  return (
    <div className="calendar-page">
      <form className="calendar-search" role="search" onSubmit={(submitEvent) => {
        submitEvent.preventDefault()
        if (searchMatches[0]) onOpenConsole(searchMatches[0].sourceEventId, 'reasoning')
      }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari delivery, PO, supplier, atau isi pesan..." aria-label="Cari dokumen atau pesan" />
        {search && <button type="button" className="clear-search" aria-label="Hapus pencarian" onClick={() => setSearch('')}>×</button>}
        {search.trim() && <div className="calendar-search-results">
          {searchMatches.length ? searchMatches.map((entry) => <button key={entry.id} type="button" className="calendar-search-result" onClick={() => onOpenConsole(entry.sourceEventId, 'reasoning')}>
            <strong>{entry.doc}</strong><span>{entry.title} · {entry.sub}</span><small>Buka chat di Console</small>
          </button>) : <p>Tidak ada dokumen atau pesan yang cocok.</p>}
        </div>}
      </form>

      <div className="calendar-layout">
        <aside className="calendar-sidebar">
          <section className="calendar-widget mini-calendar-widget">
            <h3>Oktober 2026</h3>
            <div className="mini-calendar-grid">
              {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((day) => <span className="mini-weekday" key={day}>{day}</span>)}
              {monthDates.map((day, index) => {
                const outsideMonth = index < 3 || index === monthDates.length - 1
                const hasEvents = !outsideMonth && entriesForDay(day).length > 0
                return <button key={`${day}-${index}`} type="button" className={`${outsideMonth ? 'outside-month' : ''} ${day === selectedDay && !outsideMonth ? 'selected-day' : ''} ${hasEvents ? 'has-calendar-event' : ''}`} aria-pressed={day === selectedDay && !outsideMonth} onClick={() => { if (!outsideMonth) { setSelectedDay(day); setMode('day') } }} disabled={outsideMonth}>
                  {day}{hasEvents && <i />}
                </button>
              })}
            </div>
          </section>

          <section className="calendar-widget">
            <h3>Perubahan oleh Runa</h3>
            {logEvents.length ? logEvents.map((item) => <button className="calendar-log" key={item.id} onClick={() => onOpenConsole(item.id)}>
              <i className={`log-dot ${item.decision}`} />
              <span><b>{item.ts}</b> {item.text}</span>
            </button>) : <p className="calendar-muted">Belum ada perubahan.</p>}
          </section>

          <section className="calendar-widget">
            <h3>Perlu tindak lanjut</h3>
            {pending.length === 0 && conflicts.length === 0 && <p className="calendar-muted">Tidak ada tugas tertunda.</p>}
            {pending.map((item) => <button className="follow-up" key={item.id} onClick={() => onOpenConsole(item.id)}>
              <i className="follow-check" />
              <span>Konfirmasi PO ke {item.sender}</span>
            </button>)}
            {conflicts.map((item) => <button className="follow-up" key={item.id} onClick={() => onOpenConsole(item.id)}>
              <i className="follow-check" />
              <span>Putuskan konflik {item.resolved}</span>
            </button>)}
          </section>
        </aside>

        <div className="calendar-main">
          <section className="calendar-board">
            <div className="calendar-boardbar">
              <strong>{mode === 'month' ? 'Oktober 2026' : mode === 'day' ? `${selectedDay} Okt 2026` : 'Minggu 28 Sep - 3 Okt 2026'}</strong>
              <div className="calendar-legend">
                {[['written', 'Ditulis Runa'], ['asked', 'Menunggu jawaban'], ['conflict', 'Konflik'], ['scheduled', 'Jadwal SAP']].map(([key, label]) => <span className={`legend-${key}`} key={key}>{label}</span>)}
              </div>
            </div>
            <div className="calendar-view-switch" role="tablist" aria-label="Calendar view">
              {[['day', 'Harian'], ['week', 'Mingguan'], ['month', 'Bulanan']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}>{label}</button>)}
            </div>

            {mode === 'month' ? <div className="calendar-month-grid">
              {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((day) => <span className="month-weekday" key={day}>{day}</span>)}
              {monthDates.map((day, index) => {
                const outsideMonth = index < 3 || index === monthDates.length - 1
                const dayEntries = outsideMonth ? [] : entriesForDay(day)
                return <button key={`${day}-${index}`} type="button" className={`month-day ${outsideMonth ? 'outside-month' : ''} ${day === selectedDay && !outsideMonth ? 'selected-day' : ''}`} onClick={() => { if (!outsideMonth) { setSelectedDay(day); setMode('day') } }} disabled={outsideMonth}>
                  <b>{day}</b>
                  {dayEntries.slice(0, 2).map((entry) => <span className={`month-event ${entry.type}`} key={entry.id}>{entry.title}</span>)}
                  {dayEntries.length > 2 && <small>+{dayEntries.length - 2} lainnya</small>}
                </button>
              })}
            </div> : <div className="calendar-scroll">
              <div className="schedule-grid" style={{ '--calendar-day-count': visibleDays.length }}>
                <div className="schedule-corner" />
                {visibleDays.map(([day, name]) => <button key={day} type="button" className={`schedule-day-heading ${day === selectedDay ? 'current-day' : ''}`} onClick={() => { setSelectedDay(day); setMode('day') }}>
                  <strong>{day}</strong><small>{name}</small>
                </button>)}
                <div className="schedule-time-rail">{timeLabels.map((time, index) => <span key={time} style={{ top: `${index * 48}px` }}>{time}</span>)}</div>
                {visibleDays.map(([day]) => <div className="schedule-day-column" key={day}>
                  {day === 1 && <>
                    <div className="schedule-now-line" style={{ top: `${(10 + 52 / 60 - 8) * 48}px` }} />
                    <div className="schedule-dock-line" style={{ top: `${(16 - 8) * 48}px` }}><em>Dock B tutup 16:00</em></div>
                  </>}
                  {entriesForDay(day).map((entry) => <button type="button" key={entry.id} className={`calendar-event ${entry.type} ${selectedEntry?.id === entry.id ? 'selected-event' : ''}`} style={{ top: `${(entry.start - 8) * 48 + 3}px`, height: `${Math.max(34, (entry.end - entry.start) * 48 - 6)}px` }} onClick={() => selectEntry(entry)}>
                    <b>{entry.title}</b><span>{formatCalendarTime(entry.start)} - {formatCalendarTime(entry.end)}</span><small>{entry.sub}</small>
                  </button>)}
                </div>)}
              </div>
            </div>}
          </section>

          <section className="calendar-selection">
            {selectedEntry ? <>
              <div>
                <span className={`calendar-status ${selectedEntry.type}`}>{selectedEntry.type === 'scheduled' ? 'Jadwal SAP' : LABELS[selectedEntry.type]}</span>
                <h3>{selectedEntry.title}</h3>
                <p>{selectedEntry.sub}</p>
                {selectedEntry.source && <p className="calendar-muted">Sumber Runa: {selectedEntry.source.text}</p>}
              </div>
                {selectedEntry.sourceEventId && <button type="button" className="calendar-open-detail" onClick={() => onOpenConsole(selectedEntry.sourceEventId, 'document')}>Buka detail</button>}
            </> : <p className="calendar-muted">Pilih jadwal untuk melihat detail dan sumber perubahan.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}

function formatCalendarTime(value) {
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function StatsDashboard({ list, counts, conflicts }) {
  const total = list.length
  const distribution = [
    ['Auto-write', counts.written, 'var(--stat-write)'],
    ['Asked', counts.asked, 'var(--stat-asked)'],
    ['Conflict', counts.conflict, 'var(--stat-conflict)'],
    ['Ignored', counts.ignored, 'var(--stat-ignored)'],
  ]
  const circumference = 2 * Math.PI * 48
  let strokeOffset = 0
  const slots = ['10:30', '10:35', '10:40', '10:45', '10:50']
  const activity = slots.map((label, index) => {
    const [hour, minute] = label.split(':').map(Number)
    const from = hour * 60 + minute
    const messages = list.filter((event) => {
      const [eventHour, eventMinute] = event.ts.split(':').map(Number)
      const eventTime = eventHour * 60 + eventMinute
      return eventTime >= from && eventTime < from + 5
    })
    return { label, total: messages.length, written: messages.filter((event) => event.decision === 'written').length, x: 24 + index * 88 }
  })
  const maxActivity = Math.max(1, ...activity.map((slot) => slot.total))
  const totalPoints = activity.map((slot) => `${slot.x},${108 - (slot.total / maxActivity) * 72}`)
  const writtenPoints = activity.map((slot) => `${slot.x},${108 - (slot.written / maxActivity) * 72}`)
  const totalPath = `M${totalPoints.join(' L')}`
  const writtenPath = `M${writtenPoints.join(' L')}`
  const areaPath = `${totalPath} L376,116 L24,116 Z`
  const agents = [['Listener', 820], ['Resolver', 1900], ['Transactor', 450]]
  const suppliers = [
    ['PT Kemas Jaya', 'KJ', '1 klarifikasi terkait PO yang ambigu'],
    ['CV Dus Prima', 'DP', 'Kandidat alternatif PO yang ambigu'],
  ]

  return (
    <div className="stats-page">
      <div className="stats-intro">
      </div>

      <div className="stats-grid">
        <section className="stat-card stat-hero stat-span-two stat-row-two">
          <div className="stat-card-content">
            <h3>Ditulis otomatis ke SAP</h3>
            <div className="donut-layout">
              <div>
                <strong className="stat-number hero-number">{total ? Math.round((counts.written / total) * 100) : 0}%</strong>
                <p className="stat-note">Entity dan event di atas threshold</p>
              </div>
              <div className="donut-wrap">
                <svg viewBox="0 0 120 120" role="img" aria-label={`Distribusi ${total} pesan berdasarkan keputusan`}>
                  <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="15" />
                  {distribution.map(([label, value, color]) => {
                    const segmentLength = total ? (value / total) * circumference : 0
                    const offset = strokeOffset
                    strokeOffset += segmentLength
                    return <circle key={label} cx="60" cy="60" r="48" fill="none" stroke={color} strokeWidth="15" strokeDasharray={`${Math.max(0, segmentLength - 3)} ${circumference}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />
                  })}
                  <text x="60" y="57" textAnchor="middle" className="donut-total">{total}</text>
                  <text x="60" y="72" textAnchor="middle" className="donut-caption">pesan</text>
                </svg>
              </div>
            </div>
            <div className="stats-legend">
              {distribution.map(([label, value, color]) => <span key={label} style={{ '--legend-color': color }}>{label} <b>{value}</b></span>)}
            </div>
          </div>
        </section>

        <MetricCard label="Pesan hari ini" value={total} note="Pesan yang diproses" />
        <MetricCard label="Rata-rata respons" value={<>3.2<small> dtk</small></>} note="Listener sampai Transactor" />
        <MetricCard className="stat-asked" label="Asked" value={`${total ? Math.round((counts.asked / total) * 100) : 0}%`} note="Memerlukan klarifikasi" />
        <MetricCard className="stat-ignored" label="Ignored" value={`${total ? Math.round((counts.ignored / total) * 100) : 0}%`} note="Tidak perlu tindakan" />

        <section className="stat-card stat-span-two">
          <h3>Pesan masuk per 5 menit</h3>
          <svg className="activity-chart" viewBox="0 0 400 140" role="img" aria-label="Pesan masuk dan auto-write per lima menit">
            <path d="M24 108H376M24 72H376M24 36H376" className="chart-gridline" />
            <path d={areaPath} fill="var(--stat-area)" />
            <path d={totalPath} fill="none" stroke="var(--stat-brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d={writtenPath} fill="none" stroke="var(--stat-write)" strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round" />
            {activity.map((slot) => <g key={slot.label}>
              <circle cx={slot.x} cy={108 - (slot.total / maxActivity) * 72} r="4" fill="var(--stat-brand)" />
              <text x={slot.x} y="132" textAnchor="middle" className="chart-label">{slot.label}</text>
            </g>)}
          </svg>
          <div className="stats-legend chart-legend"><span className="legend-brand">Semua pesan</span><span className="legend-write">Ditulis otomatis</span></div>
        </section>

        <section className="stat-card stat-span-two">
          <h3>Waktu per agent</h3>
          <div className="agent-list">
            {agents.map(([name, milliseconds]) => <div className="agent-row" key={name}>
              <div><span>{name}</span><span>{(milliseconds / 1000).toFixed(2)} dtk</span></div>
              <div className="agent-track"><i style={{ width: `${(milliseconds / 1900) * 100}%` }} /></div>
            </div>)}
          </div>
          <p className="stat-note">Tiga agent, tiga batas kepercayaan, satu alur.</p>
        </section>

        <section className="stat-card stat-span-two">
          <h3>Supplier yang sering perlu klarifikasi</h3>
          <div className="supplier-list">
            {suppliers.map(([name, initials, note]) => <div className="supplier-row" key={name}>
              <span className="supplier-avatar">{initials}</span>
              <span><b>{name}</b><small>{note}</small></span>
            </div>)}
          </div>
        </section>

        <section className="stat-card stat-conflict stat-span-two">
          <h3>Perlu keputusan manusia</h3>
          {conflicts.length ? conflicts.map((conflict) => <div className="conflict-summary" key={conflict.id}>
            <strong>{conflict.text}</strong>
            <p className="stat-note">{conflict.resolved}. Pilih salah satu:</p>
            <div className="conflict-options">{conflict.opts?.map((option) => <span key={option}>{option}</span>)}</div>
          </div>) : <p className="stat-note">Tidak ada konflik yang menunggu keputusan.</p>}
        </section>
      </div>
    </div>
  )
}

function MetricCard({ className = '', label, value, note }) {
  return <section className={`stat-card ${className}`}>
    <h3>{label}</h3>
    <strong className="stat-number">{value}</strong>
    <p className="stat-note">{note}</p>
  </section>
}

function EventDetail({ event, detailTab }) {
  if (!event) return <div className="empty">Pilih pesan untuk melihat reasoning Runa.</div>

  if (detailTab === 'document') {
    return event.doc && DOCS[event.doc]
      ? <DocumentDetail number={event.doc} />
      : <div className="empty">Tidak ada dokumen SAP untuk pesan ini.</div>
  }

  if (detailTab === 'audit') {
    const steps = event.decision === 'ignored'
      ? [['Listener', 410, 'Bukan event bisnis, pesan diabaikan.']]
      : event.decision === 'asked'
        ? [['Listener', 780, 'Event selisih penerimaan terdeteksi.'], ['Resolver', 2100, 'Dua kandidat ditemukan dengan skor rendah.'], ['Transactor', 0, 'Ditahan sambil menunggu jawaban.']]
        : event.decision === 'conflict'
          ? [['Post-write check', 620, 'ETA melewati waktu dock close.']]
          : event.media === 'foto'
            ? [['Listener', 1500, 'Surat jalan dibaca.'], ['Resolver', 1700, 'PO 4500001251 dicocokkan.'], ['Transactor', 430, 'Delivery ditulis ke SAP.']]
            : event.id === 4
              ? [['Resolver', 1200, 'Jawaban digabung dan dicocokkan ulang.'], ['Transactor', 480, 'Delivery ditulis ke SAP.']]
              : [['Listener', 820, 'Event keterlambatan terdeteksi.'], ['Resolver', 1900, 'PO dicocokkan dengan skor tinggi.'], ['Transactor', 450, 'Delivery ditulis ke SAP.']]

    return <div className="detail-content">
      <h2>Jejak pemrosesan</h2>
      <div className="audit-timeline">
        {steps.map(([agent, milliseconds, description]) => <div className="audit-step" key={agent}>
          <div><strong>{agent}</strong><span>{milliseconds ? `${milliseconds} ms` : 'Menunggu'}</span></div>
          <p>{description}</p>
        </div>)}
      </div>
    </div>
  }

  return (
    <div className="detail-content">
      <h2>Reasoning</h2>
      <Badge decision={event.decision} />
      <h3>Pesan asli ({event.media})</h3><div>{event.text}</div>
      {event.resolved && <><h3>Referensi yang dicocokkan</h3><div>{event.resolved}</div></>}
      {event.cands && <><h3>Kandidat</h3>{event.cands.map(([candidate, score]) => <div key={candidate}>{candidate} ({score})</div>)}</>}
      {event.hedges?.length > 0 && <><h3>Hedge terdeteksi</h3><div>{event.hedges.join(', ')}</div></>}
      {event.decision !== 'ignored' && <><h3>Skor (threshold: entity 0.85, event 0.75)</h3><div className="scores"><ScoreBar label="Entity" value={event.e} /><ScoreBar label="Event" value={event.v} /></div></>}
      <h3>Alasan keputusan</h3><div>{event.note}</div>
      {event.q && <><h3>Pertanyaan ke grup</h3><div className="question">{event.q}</div></>}
      {event.doc && <><h3>Dokumen SAP</h3><div>{event.doc}</div></>}
    </div>
  )
}

function DocumentDetail({ number }) {
  const details = DOCS[number]
  const source = EVENTS.find((event) => event.id === details.ev)

  return (
    <div className="side-content">
      <h2>Delivery {number}</h2>
      <h3>Reason code</h3><div>{details.reason}</div>
      <h3>Items</h3>{details.items.map(([item, description, quantity]) => <div key={item}>{item} - {description} - {quantity}</div>)}
      <h3>Source (Runa)</h3><div className="question">{source.text}</div>
      <div className="scores"><ScoreBar label="Entity" value={source.e} /><ScoreBar label="Event" value={source.v} /></div>
    </div>
  )
}

export default App
