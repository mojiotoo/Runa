import './Hero.css'
import { useWarehouse, TODAY } from './warehouse'

// The front page: what Runa is, in one screen, with live numbers from SAP.
// "Open dashboard" goes to the Console; the dashboard's logo comes back here.

const STEPS = [
  ['Listens', 'Reads the warehouse group chat on Telegram: drivers, dock crew, supervisors.'],
  ['Checks', 'Two AI models judge each message. Plain code decides if it may touch SAP.'],
  ['Writes', 'Updates SAP S/4HANA, flags conflicts with options, and can always /undo.'],
]

export default function Hero({ api, onEnter, onAskJoule }) {
  const { state, log, connected } = useWarehouse(api)
  const deliveries = Object.values(state?.deliveries || {})
  const today = deliveries.filter((d) => d.PlannedGoodsReceipt?.startsWith(TODAY)).length
  const writes = log.filter((e) => ['sap', 'decision'].includes(e.kind)).length
  const waiting = state?.decision ? 1 : 0
  const stats = [
    [deliveries.length, 'Inbound deliveries in SAP'],
    [today, 'Arriving today'],
    [writes, 'Changes written by Runa'],
    [waiting, 'Waiting for a supervisor'],
  ]

  return (
    <main className="hero-page">
      <section className="hero">
        <img className="hero-logo" src="/runa-wordmark.png" alt="Runa" />
        <p className="hero-kicker">AI operations agent · Intelligent Supply Chain</p>
        <h1>Your warehouse chat,<br />written into SAP.</h1>
        <p className="hero-lead">
          Runa listens to the operations group, understands delays, shortages and damage in everyday
          Indonesian, and keeps SAP up to date. When a truck will miss the dock, it gives the supervisor
          options that respect driver hours, crew and stock.
        </p>
        <div className="hero-actions">
          <button type="button" className="hero-primary" onClick={() => onEnter('console')}>Open dashboard</button>
          <button type="button" className="hero-secondary" onClick={() => onEnter('calendar')}>See the calendar</button>
          <button type="button" className="hero-ghost" onClick={onAskJoule}>Ask with Joule</button>
        </div>
        <div className="hero-live" aria-live="polite">
          <span className={`hero-dot ${connected && state ? '' : 'off'}`} />
          {state ? 'Live from SAP' : connected ? 'Connecting to SAP…' : 'SAP not reachable right now'}
        </div>
        <div className="hero-stats">
          {stats.map(([n, label]) => <div key={label} className="hero-stat"><strong>{state ? n : '–'}</strong><small>{label}</small></div>)}
        </div>
      </section>

      <section className="hero-steps" aria-label="How Runa works">
        {STEPS.map(([title, text], i) => (
          <article key={title} className="hero-step">
            <span className="hero-step-n">{i + 1}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <footer className="hero-foot">
        Built on SAP BTP · SAP AI Core · SAP Joule · Amazon Bedrock · Amazon DynamoDB
      </footer>
    </main>
  )
}
