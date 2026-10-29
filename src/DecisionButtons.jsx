import { useState } from 'react'
import './DecisionButtons.css'

// The supervisor's buttons on a dock conflict. The options come from Runa
// (runa-sap's /_debug/state "decision"); a click asks for the supervisor PIN,
// runa-sap checks it, and the bot carries the choice out exactly like an
// "opsi a" typed in Telegram: same SAP write, same log, same /undo.

const PIN_KEY = 'runa-supervisor-pin'
const readPin = () => { try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } }
const savePin = (pin) => { try { sessionStorage.setItem(PIN_KEY, pin) } catch { /* private mode */ } }

export default function DecisionButtons({ api, decision }) {
  const [picked, setPicked] = useState(null)
  const [pin, setPin] = useState(readPin)
  const [state, setState] = useState({ busy: false, error: '', sent: null })

  if (!decision) {
    return <em>Menunggu supervisor membalas "opsi a" atau "opsi b" di Telegram.</em>
  }
  const waiting = state.sent || decision.requested

  const send = async (event) => {
    event.preventDefault()
    if (!pin.trim()) { setState((s) => ({ ...s, error: 'Masukkan PIN supervisor dulu.' })); return }
    setState({ busy: true, error: '', sent: null })
    try {
      const response = await fetch(`${api}/runa/decision/choose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery: decision.delivery, choice: picked, pin: pin.trim() }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || `Gagal (${response.status})`)
      savePin(pin.trim())
      setState({ busy: false, error: '', sent: picked })
      setPicked(null)
    } catch (e) {
      setState({ busy: false, error: e.message || 'Tidak terhubung ke Runa', sent: null })
    }
  }

  if (waiting) {
    return <div className="decision-wait"><span className="decision-spinner" aria-hidden="true" />
      Opsi {waiting} dikirim. Runa menjalankannya di SAP dan mengabari grup…</div>
  }

  return (
    <div className="decision">
      <div className="decision-options" role="group" aria-label="Pilih opsi">
        {decision.options.map((o) => (
          <button key={o.label} type="button" className={picked === o.label ? 'on' : ''}
            aria-pressed={picked === o.label} onClick={() => { setPicked(o.label); setState((s) => ({ ...s, error: '' })) }}>
            <b>{o.label}</b><span>{o.title}</span>
          </button>
        ))}
      </div>
      {picked && <form className="decision-confirm" onSubmit={send}>
        <label>
          <span>PIN supervisor</span>
          <input type="password" inputMode="numeric" autoComplete="off" value={pin}
            onChange={(e) => { setPin(e.target.value); setState((s) => ({ ...s, error: '' })) }} autoFocus />
        </label>
        <button type="submit" className="decision-go" disabled={state.busy}>{state.busy ? 'Mengirim…' : `Jalankan opsi ${picked}`}</button>
        <button type="button" className="decision-cancel" onClick={() => setPicked(null)}>Batal</button>
      </form>}
      {state.error && <p className="decision-error" role="alert">{state.error}</p>}
      <small className="decision-note">Atau balas "opsi a/b" di Telegram. Pilihan di sini tercatat sama seperti di grup, dan bisa /undo.</small>
    </div>
  )
}
