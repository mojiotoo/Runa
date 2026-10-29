import { useEffect, useRef, useState } from 'react'
import './JouleDrawer.css'

// The supervisor's door to SAP Joule. Two ways in:
//  - "Buka Joule": opens SAP Joule itself (VITE_JOULE_URL), where the Runa
//    capability is installed. The question is copied first, ready to paste.
//  - the test box: asks Runa through the SAME A2A door Joule uses (/a2a on
//    runa-sap), so the team can check Runa's answer even if Joule is slow
//    or down. Read-only: nothing asked here can change SAP.

const JOULE_URL = import.meta.env.VITE_JOULE_URL || ''
const SUGGESTIONS = ['Ringkasan gudang hari ini', 'Bagaimana DO 4521?', 'Bagaimana DO 4602?', 'Bagaimana DO 4605?']

async function askRuna(api, question) {
  const id = `${Date.now()}`
  const response = await fetch(`${api}/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id, method: 'message/send',
      params: { message: { kind: 'message', role: 'user', messageId: `dash-${id}`, parts: [{ kind: 'text', text: question }] } },
    }),
  })
  const reply = await response.json()
  if (reply.error) throw new Error(reply.error.message || 'A2A error')
  const parts = reply.result?.artifacts?.flatMap((a) => a.parts || []) || reply.result?.parts || []
  return parts.map((p) => p.text).filter(Boolean).join('\n\n') || '(Runa tidak menjawab)'
}

// Runa answers in a little Markdown: **bold** and "- " lists, indented.
function Answer({ text }) {
  const bold = (line) => line.split(/(\*\*[^*]+\*\*)/).map((part, i) => (
    part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part))
  return <div className="jd-answer">{text.split('\n').map((line, i) => {
    const item = line.match(/^(\s*)- (.*)$/)
    if (!line.trim()) return <div key={i} className="jd-gap" />
    if (item) return <div key={i} className="jd-item" style={{ paddingLeft: `${10 + item[1].length * 4}px` }}>{bold(item[2])}</div>
    return <div key={i}>{bold(line)}</div>
  })}</div>
}

export default function JouleDrawer({ api, open, onClose, prompt }) {
  const [question, setQuestion] = useState('')
  const [chat, setChat] = useState([])            // [{ q, a, error }]
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const feed = useRef(null)
  const lastPrompt = useRef(null)

  const send = async (text) => {
    const q = (text ?? question).trim()
    if (!q || busy) return
    setQuestion('')
    setBusy(true)
    setChat((items) => [...items, { q, a: null }])
    try {
      const a = await askRuna(api, q)
      setChat((items) => items.map((item, i) => (i === items.length - 1 ? { ...item, a } : item)))
    } catch (e) {
      setChat((items) => items.map((item, i) => (i === items.length - 1 ? { ...item, error: e.message || 'Tidak terhubung' } : item)))
    } finally {
      setBusy(false)
    }
  }

  // Opened from a delivery ("Tanya Joule" on the calendar): ask right away.
  useEffect(() => {
    if (open && prompt && prompt.id !== lastPrompt.current) {
      lastPrompt.current = prompt.id
      send(prompt.text)
    }
  })
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }) }, [chat])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const openJoule = async () => {
    const text = question.trim() || chat[chat.length - 1]?.q || ''
    if (text) {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* no clipboard */ }
    }
    window.open(JOULE_URL, '_blank', 'noopener')
  }

  if (!open) return null
  return (
    <div className="jd-backdrop" onClick={onClose}>
      <aside className="jd" role="dialog" aria-label="Joule" onClick={(e) => e.stopPropagation()}>
        <header className="jd-head">
          <span className="jd-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" /><path d="M18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" /></svg>
          </span>
          <div>
            <strong>Joule × Runa</strong>
            <small>Supervisor bertanya, Runa menjawab dari SAP dan grup</small>
          </div>
          <button type="button" className="jd-close" aria-label="Tutup" onClick={onClose}>×</button>
        </header>

        <section className="jd-open">
          {JOULE_URL ? <>
            <button type="button" className="jd-primary" onClick={openJoule}>Buka SAP Joule ↗</button>
            <span>{copied ? 'Pertanyaan disalin, tinggal tempel di Joule.' : 'Pertanyaan terakhir disalin otomatis, tinggal tempel di Joule.'}</span>
          </> : <span>Alamat Joule belum diatur (VITE_JOULE_URL). Tes di bawah tetap jalan.</span>}
        </section>

        <div className="jd-feed" ref={feed}>
          {chat.length === 0 && <div className="jd-intro">
            <p>Tes jawaban Runa lewat pintu A2A yang sama dengan yang dipakai Joule. Hanya membaca: pertanyaan di sini tidak bisa mengubah SAP.</p>
            <div className="jd-chips">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>
          </div>}
          {chat.map((item, i) => <div key={i} className="jd-turn">
            <div className="jd-q">{item.q}</div>
            {item.error ? <div className="jd-error">Runa tidak bisa dihubungi: {item.error}</div>
              : item.a === null ? <div className="jd-wait">Runa membaca SAP…</div>
                : <Answer text={item.a} />}
          </div>)}
        </div>

        <form className="jd-ask" onSubmit={(e) => { e.preventDefault(); send() }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Tanya tentang DO, misalnya: Bagaimana DO 4521?" aria-label="Pertanyaan untuk Runa" />
          <button type="submit" disabled={busy || !question.trim()}>Tanya</button>
        </form>
        {chat.length > 0 && <div className="jd-chips jd-chips-foot">{SUGGESTIONS.map((s) => <button key={s} type="button" disabled={busy} onClick={() => send(s)}>{s}</button>)}</div>}
      </aside>
    </div>
  )
}
