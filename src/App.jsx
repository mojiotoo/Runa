import { useEffect, useRef, useState } from 'react'
import './App.css'
import LogView from './LogView'
import CalendarView from './CalendarView'
import JouleDrawer from './JouleDrawer'
import DecisionButtons from './DecisionButtons'
import Hero from './Hero'
import { useWarehouse, TODAY } from './warehouse'

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

const LABELS = { written: 'Written', asked: 'Asked', ignored: 'Ignored', conflict: 'Conflict', handoff: 'Handoff', undone: 'Undone' }

const API = import.meta.env.VITE_RUNA_API || 'http://127.0.0.1:8000'

const STEP_TEXT = {
  Listener: "Membaca pesan: kejadian bisnis atau obrolan biasa?",
  Resolver: "Mencocokkan ke delivery di SAP dan memberi dua skor",
  Rules: "Kode mengecek fakta dan aturan batas.",
  Transactor: "menulis ke SAP.",
  "Conflict check" : "Mengecek jadwal dock setelah menulis.", 
  Notebook: 'Mengusulkan catatan baru dari jawaban yang didapat.',
}

function fromRuna(event){
  return{
    ...event,
    media: event.sender === 'Runa' ? 'sistem' : 'text',
    hedges: event.hedges || [],
  }
}

// Did this event settle a delivery's schedule? A new arrival time, a
// supervisor's option, or an undo of either (not a shortage or a complaint).
const closesSchedule = (event) => {
  const note = event.note || ''
  if (event.media === 'sistem') return event.decision === 'written'   // demo replay
  return note.startsWith('Patched arrival time') || note.startsWith('Executed option')
    || (event.decision === 'undone' && (note.includes('estimasi tiba') || note.includes('opsi')))
}

const hasScores = (event) => event.e > 0 || event.v > 0



function TabIcon({ name }) {
  const paths = {
    console: <><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>,
    feed: <><path d="M4 12h3l2-6 4 12 2-6h5" /><path d="M4 4v16M20 4v16" /></>,
    pending: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    docs: <><path d="M7 3.5h7l4 4V20H7z" /><path d="M14 3.5V8h4M10 12h5M10 16h5" /></>,
    conf: <><path d="m12 3 9 17H3z" /><path d="M12 9v4M12 16h.01" /></>,
    stats: <><path d="M4 19V5M4 19h16" /><path d="M8 15v-4M12 15V7M16 15V9" /></>,
    notebook: <><path d="M6 3.5h11a1 1 0 0 1 1 1V20.5H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 1-2z" /><path d="M5 18.5a2 2 0 0 1 2-2h11M9 8h6M9 11.5h4" /></>,
    log: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    joule: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
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
  const [list, setList] = useState([])
  const [tab, setTab] = useState('console')
  // The front page (hero) first; "#app" in the address goes straight to the dashboard.
  const [home, setHome] = useState(() => !window.location.hash || window.location.hash === '#home')
  const [jouleOnOpen, setJouleOnOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [live, setLive] = useState(true)
  const [connected, setConnected] = useState(false)
  const [notes, setNotes] = useState([])        // Runa's notebook

  useEffect(() =>{
    if (!live) return
    let cancelled = false
    const load = async() => {
      try{
        const response = await fetch(`${API}/runa/events`)
        const events = await response.json()
        if(!cancelled){
          setList(events.map(fromRuna))
          setConnected(true)
        }
        // The notebook, read the same way. An older runa-sap has none: skip it.
        try {
          const book = await (await fetch(`${API}/runa/notebook`)).json()
          if (!cancelled && Array.isArray(book)) setNotes(book)
        } catch { /* no notebook yet */ }
      } catch {
        if(!cancelled) setConnected(false)
      }
    }
    load()
    const timer = setInterval(load, 2000)
    return () => {cancelled = true; clearInterval(timer)}
  }, [live])

  const enter = (target, joule = false) => {
    setTab(target)
    setJouleOnOpen(joule)
    setHome(false)
    try { window.history.replaceState(null, '', '#app') } catch { /* sandboxed */ }
  }
  if (home) {
    return <Hero api={API} onEnter={(target) => enter(target)} onAskJoule={() => enter('console', true)} />
  }

  return (
    <Console
      onHome={() => { setHome(true); try { window.history.replaceState(null, '', '#home') } catch { /* sandboxed */ } }}
      jouleOnOpen={jouleOnOpen}
      list={list}
      setList={setList}
      tab={tab}
      setTab={setTab}
      selectedEvent={selectedEvent}
      setSelectedEvent={setSelectedEvent}
      playing={playing}
      setPlaying={setPlaying}
      live={live}
      setLive={setLive}
      connected={connected}
      notes={notes}
    />
  )
}

// A long escalation from Runa: the problem in bold, the reasons folded under it.
function ConflictText({ text }) {
  const [open, setOpen] = useState(false)
  const [first, ...rest] = (text || '').split('\n')
  const detail = rest.join('\n').trim()
  const long = detail.length > 220
  return <>
    <strong>{first}</strong>
    {detail && <p className={`action-detail ${long && !open ? 'clamped' : ''}`}>{detail}</p>}
    {long && <button type="button" className="action-more" onClick={() => setOpen(!open)}>{open ? 'Ringkas' : 'Lihat semua alasan'}</button>}
  </>
}

function Console({ onHome, jouleOnOpen, list, setList, tab, setTab, selectedEvent, setSelectedEvent, playing, setPlaying, live, setLive, connected, notes }) {
  const timer = useRef(null)
  const telegramConnected = live ? connected : true
  const [filter, setFilter] = useState('all')
  const [detailTab, setDetailTab] = useState('reasoning')
  const [resolvedConflictIds, setResolvedConflictIds] = useState([])
  const [doneIds, setDoneIds] = useState([])   // handoffs a supervisor marked as done
  useEffect(() => () => clearInterval(timer.current), [timer])

  const count = (decision) => list.filter((event) => event.decision === decision).length
  const warehouse = useWarehouse(API)
  const [logFocus, setLogFocus] = useState(null)   // the Log tab, showing one DO's history
  const [jouleOpen, setJouleOpen] = useState(Boolean(jouleOnOpen))
  const [joulePrompt, setJoulePrompt] = useState(null)   // a question to ask as soon as it opens
  const askJoule = (text) => { if (text) setJoulePrompt({ id: Date.now(), text }); setJouleOpen(true) }
  const deliveries = Object.values(warehouse.state?.deliveries || {})
  const calendarTodayCount = deliveries.filter((d) => d.PlannedGoodsReceipt?.startsWith(TODAY)).length
  const runaUpdates = warehouse.log.filter((e) => ['sap', 'decision'].includes(e.kind)).length
  const replay = () => {
    setLive(false)
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
  const conflicts = list.filter((event) => event.decision === 'conflict' && !resolvedConflictIds.includes(event.id) && !list.some((later) => later.id > event.id && later.resolved === event.resolved && (later.decision === 'conflict' || closesSchedule(later))))
  const handoffs = list.filter((event) => event.decision === 'handoff' && !doneIds.includes(event.id))
  const needCount = pending.length + conflicts.length + handoffs.length
  const documents = list.filter((event) => event.doc).map((event) => event.doc)
  const event = list.find((item) => item.id === selectedEvent)
  const tabs = [
    ['console', 'Console', needCount],
    ['calendar', 'Calendar', null],
    ['stats', 'Stats', null],
    ['notebook', 'Catatan', notes.filter((note) => note.status === 'proposed').length],
    ['log', 'Log', null],
  ]

  const filters = [
    ['all', 'Semua', list.length],
    ['need', 'Perlu tindakan', needCount],
    ['written', 'Written', count('written')],
    ['asked', 'Asked', pending.length],
    ['conflict', 'Conflict', conflicts.length],
    ['handoff', 'Handoff', count('handoff')],
    ['ignored', 'Ignored', count('ignored')],
    ['docs', 'Dokumen', documents.length],
  ]
  const visibleEvents = feed.filter((item) => {
    if (filter === 'all') return true
        if (filter === 'need') return [...pending, ...conflicts, ...handoffs].some((open) => open.id === item.id)
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
        <button type="button" className="brand brand-home" onClick={onHome} title="Halaman depan">
          <img src="/logo.png" alt="" className="brand-logo" />
          <span>Runa</span>
        </button>
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
        <div className="side-nav side-extra">
          <button type="button" onClick={() => askJoule(null)} aria-haspopup="dialog">
            <TabIcon name="joule" />
            <span>Tanya Joule</span>
          </button>
        </div>
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
            <h1>{tab === 'calendar' ? 'Runa Calendar' : tab === 'stats' ? 'Runa Stats' : tab === 'notebook' ? 'Runa Notebook' : tab === 'log' ? 'Runa Log' : 'Runa Console'}</h1>
          </div>
          {tab === 'calendar' ? <div className="calendar-header-metrics">
            <span><small>Pengiriman hari ini</small><strong>{calendarTodayCount}</strong></span>
            <span><small>Diperbarui oleh Runa</small><strong>{runaUpdates}</strong></span>
            </div> : tab === 'log' ? null : <div className="header-actions">
              {!live && !playing && <button type="button" onClick={() => { setList([]); setLive(true) }}>Kembali ke live</button>}
              <button className="primary" type="button" onClick={replay} disabled={playing}>
                {playing ? 'Memutar...' : 'Replay skenario'}
            </button>
          </div>}
        </header>

        {tab === 'log' ? (
          <LogView warehouse={warehouse} events={list} focus={logFocus} onFocus={setLogFocus} />
        ) : tab === 'notebook' ? (
          <main className="workspace stats-view">
            <section className="panel main-panel" aria-label="Notebook">
              <NotebookPanel notes={notes} />
            </section>
          </main>
        ) : tab === 'stats' ? (
          <main className="workspace stats-view">
            <section className="panel main-panel" aria-label="Stats">
              <StatsDashboard list={list} counts={{ written: count('written'), asked: count('asked'), ignored: count('ignored'), conflict: count('conflict'), handoff: count('handoff'), undone: count('undone') }} conflicts={conflicts} />
            </section>
          </main>
        ) : tab === 'calendar' ? (
          <main className="workspace calendar-view">
            <section className="panel main-panel" aria-label="Calendar">
              <CalendarView
                warehouse={warehouse}
                events={list}
                pending={pending}
                onOpenConsole={(eventId, targetTab = 'document') => { setSelectedEvent(eventId); setTab('console'); setDetailTab(targetTab) }}
                onOpenLog={(did) => { setLogFocus(did); setTab('log') }}
                onAskJoule={askJoule}
              />
            </section>
          </main>
        ) : (
          <main className="console-main">
              {needCount > 0 && <section className="action-section">
              <h2>Perlu tindakan</h2>
              <div className="action-grid">
                {pending.map((item) => <button className="action-card action-asked" key={item.id} onClick={() => setSelectedEvent(item.id)}>
                  <strong>Menunggu jawaban dari {item.sender}</strong>
                  <span>{item.q}</span>
                </button>)}
                {conflicts.map((item) => <article className="action-card action-conflict" key={item.id}>
                  <ConflictText text={item.text} />
                  <span>{item.opts ? `${item.resolved}. Pilih penyelesaian:` : `DO ${item.resolved}`}</span>
                  <div className="action-options">{item.opts
                    ? item.opts.map((option) => <button key={option} type="button" onClick={() => resolveConflict(item, option)}>{option}</button>)
                    : <DecisionButtons api={API} decision={warehouse.state?.decision?.delivery === item.resolved ? warehouse.state.decision : null} />}</div>
                </article>)}
                {handoffs.map((item) => <article className="action-card action-handoff" key={item.id}>
                  <strong>Diteruskan ke supervisor: pesan dari {item.sender}</strong>
                  <span>"{item.text}"</span>
                  <div className="action-options">
                    <button type="button" onClick={() => { setSelectedEvent(item.id); setDetailTab('reasoning') }}>Lihat alasan</button>
                    <button type="button" onClick={() => setDoneIds((ids) => [...ids, item.id])}>Tandai selesai</button>
                  </div>
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
                      <span className="message-tags"><Badge decision={item.decision} />{hasScores(item) && <><ScoreBar label="Entity" value={item.e} /><ScoreBar label="Event" value={item.v} /></>}</span>
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
      <JouleDrawer api={API} open={jouleOpen} onClose={() => setJouleOpen(false)} prompt={joulePrompt} />
    </div>
  )
}

function StatsDashboard({ list, counts, conflicts }) {
  const total = list.length
  const distribution = [
    ['Auto-write', counts.written, 'var(--stat-write)'],
    ['Asked', counts.asked, 'var(--stat-asked)'],
    ['Conflict', counts.conflict, 'var(--stat-conflict)'],
    ['Ignored', counts.ignored, 'var(--stat-ignored)'],
    ['Handoff', counts.handoff, 'var(--stat-handoff)'],
    ['Undone', counts.undone, 'var(--stat-undone)'],
  ]
  const circumference = 2 * Math.PI * 48
  let strokeOffset = 0
  // Five 5-minute slots ending at the newest message (or now, if there are none)
  const toMinutes = (ts) => { const [hour, minute] = ts.split(':').map(Number); return hour * 60 + minute }
  const now = new Date()
  const newest = list.length ? Math.max(...list.map((event) => toMinutes(event.ts))) : now.getHours() * 60 + now.getMinutes()
  const lastSlot = Math.floor(newest / 5) * 5
  const slots = [20, 15, 10, 5, 0].map((back) => {
    const minutes = (lastSlot - back + 1440) % 1440
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
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
  // Real timings from Runa: average per step, and average total per message
  const timed = list.filter((event) => event.timings && Object.keys(event.timings).length)
  const agents = Object.keys(STEP_TEXT).map((name) => {
    const values = timed.filter((event) => name in event.timings).map((event) => event.timings[name])
    return [name, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null]
  }).filter(([, average]) => average !== null)
  const slowest = Math.max(1, ...agents.map(([, average]) => average))
  const totals = timed.map((event) => Object.values(event.timings).reduce((a, b) => a + b, 0))
  const averageResponse = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null

  // Which deliveries needed a human or a question most often
  const unclear = {}
  list.filter((event) => (event.decision === 'asked' || event.decision === 'handoff') && event.resolved).forEach((event) => {
    unclear[event.resolved] = unclear[event.resolved] || { asked: 0, handoff: 0 }
    unclear[event.resolved][event.decision] += 1
  })
  const unclearList = Object.entries(unclear)
    .sort(([, a], [, b]) => (b.asked + b.handoff) - (a.asked + a.handoff))
    .slice(0, 4)

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
        <MetricCard label="Rata-rata respons" value={averageResponse === null ? '–' : <>{(averageResponse / 1000).toFixed(1)}<small> dtk</small></>} note={totals.length ? `Pesan masuk sampai keputusan, dari ${totals.length} pesan` : 'Belum ada data waktu dari Runa'} />
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
              <div className="agent-track"><i style={{ width: `${(milliseconds / slowest) * 100}%` }} /></div>
            </div>)}
          </div>
          <p className="stat-note">{agents.length ? 'Rata-rata waktu nyata tiap langkah. Listener dan Resolver adalah AI; Rules dan Transactor adalah kode.' : 'Belum ada data waktu dari Runa.'}</p>
        </section>

        <section className="stat-card stat-span-two">
          <h3>Delivery yang sering perlu klarifikasi</h3>
          {unclearList.length ? <div className="supplier-list">
            {unclearList.map(([delivery, { asked, handoff }]) => <div className="supplier-row" key={delivery}>
              <span className="supplier-avatar">DO</span>
              <span><b>{delivery}</b><small>{asked} pertanyaan, {handoff} diteruskan ke supervisor</small></span>
            </div>)}
          </div> : <p className="stat-note">Belum ada delivery yang perlu klarifikasi.</p>}
        </section>

        <section className="stat-card stat-conflict stat-span-two">
          <h3>Perlu keputusan manusia</h3>
          {conflicts.length ? conflicts.map((conflict) => <div className="conflict-summary" key={conflict.id}>
            <strong>{conflict.text}</strong>
            <p className="stat-note">{conflict.opts ? `${conflict.resolved}. Pilih salah satu:` : `DO ${conflict.resolved}. Menunggu supervisor membalas di Telegram.`}</p>
            {conflict.opts && <div className="conflict-options">{conflict.opts.map((option) => <span key={option}>{option}</span>)}</div>}
          </div>) : <p className="stat-note">Tidak ada konflik yang menunggu keputusan.</p>}
        </section>
      </div>
    </div>
  )
}

// Runa's notebook: what it knows about this company, and what it has learned.
const NOTE_SOURCE = { seed: 'Bawaan', supervisor: 'Ditulis supervisor', learned: 'Dipelajari Runa' }

function NotebookPanel({ notes }) {
  const groups = [
    ['proposed', 'Menunggu persetujuan', 'Supervisor membalas /setuju atau /tolak di Telegram.'],
    ['approved', 'Dipakai Runa', 'Catatan ini membantu Runa mengenali orang, rute dan delivery.'],
    ['rejected', 'Ditolak', 'Tetap tercatat, tapi tidak pernah dipakai.'],
    ['removed', 'Dihapus', 'Tidak dipakai lagi.'],
  ]
  const learned = notes.filter((note) => note.source === 'learned' && note.status === 'approved').length

  return <div className="notebook-page">
    <section className="stat-card notebook-intro">
      <h3>Buku catatan Runa</h3>
      <p className="stat-note">Runa mengusulkan catatan dari jawaban di obrolan. Hanya catatan yang disetujui supervisor yang dipakai.
        Catatan membantu Runa tahu <b>delivery yang mana</b>; aturan dan batas tetap di kode.</p>
      <p className="stat-note"><b>{learned}</b> catatan dipelajari dari obrolan dan disetujui.</p>
    </section>
    {groups.map(([status, title, hint]) => {
      const items = notes.filter((note) => note.status === status)
      if (!items.length && status !== 'approved') return null
      return <section className={`stat-card notebook-group notebook-${status}`} key={status}>
        <h3>{title} <span className="notebook-count">{items.length}</span></h3>
        <p className="stat-note">{hint}</p>
        {items.length ? items.map((note) => <div className="notebook-row" key={note.id}>
          <span className="notebook-id">#{note.id}</span>
          <span className="notebook-text">{note.text}
            <small>{NOTE_SOURCE[note.source] || note.source}{note.reviewed_by && note.source !== 'seed' ? ` · ${note.status === 'approved' ? 'disetujui' : 'oleh'} ${note.reviewed_by}` : ''}</small>
          </span>
        </div>) : <p className="stat-note">Belum ada.</p>}
      </section>
    })}
  </div>
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

    if (detailTab === 'audit' && event.timings) {
    const steps = Object.entries(event.timings)
    const total = steps.reduce((sum, [, milliseconds]) => sum + milliseconds, 0)
    return <div className="detail-content">
      <h2>Jejak pemrosesan</h2>
      {steps.length ? <div className="audit-timeline">
        {steps.map(([agent, milliseconds]) => <div className="audit-step" key={agent}>
          <div><strong>{agent}</strong><span>{milliseconds} ms</span></div>
          <p>{STEP_TEXT[agent] || ''}</p>
        </div>)}
      </div> : <div className="empty">Dibuat otomatis oleh Runa. Waktunya tercatat di pesan yang memicunya.</div>}
      {total > 0 && <p className="stat-note">Total {(total / 1000).toFixed(1)} detik dari pesan masuk sampai keputusan.</p>}
    </div>
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
      {hasScores(event) && <><h3>Skor (threshold: 0.85 untuk keduanya)</h3><div className="scores"><ScoreBar label="Entity" value={event.e} /><ScoreBar label="Event" value={event.v} /></div></>}
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
