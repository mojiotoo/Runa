const BASE_URL = import.meta.env.VITE_RUNA_API || 'https://runa-sap-leiva230.cfapps.ap10.hana.ondemand.com'
const DELIVERY_PATH = '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV/A_InboundDelivery'
const SLOT_MINUTES = 60
const TELEGRAM_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'RunaAgenticAI_bot'

export async function fetchDeliveries() {
  const response = await fetch(`${BASE_URL}${DELIVERY_PATH}`)
  if (!response.ok) throw new Error(`SAP HTTP ${response.status}`)
  const payload = await response.json()
  return payload.d?.results || []
}

export async function fetchRunaEvents() {
  const response = await fetch(`${BASE_URL}/runa/events`)
  if (!response.ok) throw new Error(`Runa HTTP ${response.status}`)
  return response.json()
}

function parseRunaSnapshot(payload) {
  const events = Array.isArray(payload) ? payload : payload.events || payload.data || []
  const telegram = Array.isArray(payload) ? null : payload.telegram || payload.telegramAccount || payload.telegram_account || payload.account
  const eventTelegram = events.map((event) => event.telegram || event.chat || event.chat_info || event).find((account) => (
    account?.title || account?.chat_title || account?.chatTitle || account?.group_name || account?.groupName
  ))
  if (Array.isArray(payload)) return { events, telegram: eventTelegram || null }
  return {
    events,
    telegram: telegram || eventTelegram || null,
  }
}

export async function fetchRunaSnapshot() {
  const response = await fetch(`${BASE_URL}/runa/events`)
  if (!response.ok) throw new Error(`Runa HTTP ${response.status}`)
  return parseRunaSnapshot(await response.json())
}

export function parseLocalDateTime(value) {
  if (!value) return null
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0))
}

function parseTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function localDateKey(date) {
  return dateKey(date)
}

function latestEventFor(deliveryId, events) {
  // TODO Resolver must set resolved when it asks for clarification so this can match the delivery.
  return [...events].reverse().find((event) => event.resolved === deliveryId) || null
}

function getStatus(delivery, latestEvent, start, end, close) {
  if (end > close) return 'conflict'
  if (latestEvent?.decision === 'asked') return 'asked'
  if (latestEvent?.decision === 'written') return 'written'
  return 'scheduled'
}

export function mapDeliveriesToCalendar(deliveries, events, firstSeenStarts) {
  return deliveries.flatMap((delivery) => {
    const start = parseLocalDateTime(delivery.PlannedGoodsReceipt)
    if (!start) return []
    const closeMinutes = parseTime(delivery.DockClosingTime)
    if (closeMinutes === null) return []
    const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000)
    const close = new Date(start)
    close.setHours(Math.floor(closeMinutes / 60), closeMinutes % 60, 0, 0)
    const id = String(delivery.InboundDelivery)
    if (!firstSeenStarts.has(id)) firstSeenStarts.set(id, start.getTime())
    const latestEvent = latestEventFor(id, events)
    return [{
      id,
      inboundDelivery: id,
      dateKey: dateKey(start),
      startMinutes: start.getHours() * 60 + start.getMinutes(),
      endMinutes: start.getHours() * 60 + start.getMinutes() + SLOT_MINUTES,
      closeMinutes,
      title: delivery.SupplierName || delivery.Supplier || 'Supplier tidak diketahui',
      subtitle: `${id} · ${delivery.ReceivingDock || 'Dock belum ditentukan'}`,
      material: delivery.MaterialDescription || delivery.Material || '-',
      quantity: delivery.DeliveryQuantity,
      unit: delivery.DeliveryQuantityUnit || '',
      route: delivery.Route || '-',
      carrierContact: delivery.CarrierContact || '-',
      status: getStatus(delivery, latestEvent, start, end, close),
      plannedGoodsReceipt: delivery.PlannedGoodsReceipt,
      dockClosingTime: delivery.DockClosingTime,
      ghostStartMinutes: firstSeenStarts.get(id) === start.getTime() ? null : new Date(firstSeenStarts.get(id)).getHours() * 60 + new Date(firstSeenStarts.get(id)).getMinutes(),
      latestEvent,
    }]
  })
}

export function createLivePoller({ onData, onError, interval = 2500 }) {
  let stopped = false
  let running = false

  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const [deliveries, snapshot] = await Promise.all([fetchDeliveries(), fetchRunaSnapshot()])
      if (!stopped) onData({ deliveries, ...snapshot })
    } catch (error) {
      if (!stopped) onError(error)
    } finally {
      running = false
      if (!stopped) setTimeout(tick, interval)
    }
  }

  tick()
  return () => { stopped = true }
}

export { BASE_URL, SLOT_MINUTES, TELEGRAM_USERNAME }
