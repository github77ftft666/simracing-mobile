import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OutboundMessage } from './protocol'

type Connection = 'offline' | 'connecting' | 'online'

const clamp = (value: number) => Math.max(-1, Math.min(1, value))
const STEERING_DEAD_ZONE = 5
const PEDAL_DEAD_ZONE = 7
const normalizedTilt = (angle: number, deadZone: number, fullScale: number) => {
  const abs = Math.abs(angle)
  if (abs < deadZone) return 0
  return clamp(Math.sign(angle) * ((abs - deadZone) / (fullScale - deadZone)))
}
const pedalAmount = (angle: number) => Math.max(0, Math.min(1, (Math.abs(angle) - PEDAL_DEAD_ZONE) / (25 - PEDAL_DEAD_ZONE)))

export default function App() {
  const [connection, setConnection] = useState<Connection>('offline')
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem('pitlink-endpoint') ?? 'ws://192.168.0.10:32100')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manual, setManual] = useState(false)
  const [steering, setSteering] = useState(0)
  const [throttle, setThrottle] = useState(0)
  const [brake, setBrake] = useState(0)
  const [clutch, setClutch] = useState(0)
  const [gear, setGear] = useState(1)
  const [sensor, setSensor] = useState({ roll: 0, pitch: 0 })
  const socket = useRef<WebSocket | null>(null)
  const sequence = useRef(0)
  const baseline = useRef({ beta: 0, gamma: 0, isSet: false })
  const latestOrientation = useRef({ beta: 0, gamma: 0, known: false })
  const controls = useRef({ steering: 0, throttle: 0, brake: 0, clutch: 0, gear: 1 })

  const send = useCallback((message: OutboundMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message))
  }, [])

  const connect = useCallback(() => {
    socket.current?.close()
    setConnection('connecting')
    try {
      const ws = new WebSocket(endpoint)
      socket.current = ws
      ws.onopen = () => { localStorage.setItem('pitlink-endpoint', endpoint); setConnection('online') }
      ws.onclose = () => setConnection('offline')
      ws.onerror = () => setConnection('offline')
    } catch { setConnection('offline') }
  }, [endpoint])

  const center = useCallback(async () => {
    const motion = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }
    if (motion.requestPermission && await motion.requestPermission() !== 'granted') {
      alert('Разрешите доступ к движению устройства, затем нажмите «ЦЕНТР» ещё раз.')
      return
    }
    baseline.current = latestOrientation.current.known
      ? { beta: latestOrientation.current.beta, gamma: latestOrientation.current.gamma, isSet: true }
      : { beta: 0, gamma: 0, isSet: false }
    setSteering(0); setThrottle(0); setBrake(0)
    setSensor({ roll: 0, pitch: 0 })
    controls.current.steering = 0; controls.current.throttle = 0; controls.current.brake = 0
    send({ type: 'event', action: 'center' })
  }, [send])

  const shift = useCallback((direction: 1 | -1) => {
    if (manual) return
    setGear(current => Math.max(0, Math.min(8, current + direction)))
    send({ type: 'event', action: direction > 0 ? 'gearUp' : 'gearDown' })
  }, [manual, send])

  useEffect(() => {
    const stateTimer = window.setInterval(() => {
      const current = controls.current
      send({ type: 'state', seq: sequence.current++, steering: current.steering, throttle: current.throttle, brake: current.brake, clutch: current.clutch, handbrake: false, manualGear: manual ? current.gear : gear })
    }, 16)
    return () => window.clearInterval(stateTimer)
  }, [gear, manual, send])

  useEffect(() => {
    const onOrientation = (event: DeviceOrientationEvent) => {
      const beta = event.beta ?? 0
      const gamma = event.gamma ?? 0
      latestOrientation.current = { beta, gamma, known: true }
      if (!baseline.current.isSet) baseline.current = { beta, gamma, isSet: true }
      const steeringAngle = beta - baseline.current.beta
      const pedalAngle = gamma - baseline.current.gamma
      const newSteering = normalizedTilt(steeringAngle, STEERING_DEAD_ZONE, 32)
      const newThrottle = pedalAngle > PEDAL_DEAD_ZONE ? pedalAmount(pedalAngle) : 0
      const newBrake = pedalAngle < -PEDAL_DEAD_ZONE ? pedalAmount(pedalAngle) : 0
      controls.current.steering = newSteering; controls.current.throttle = newThrottle; controls.current.brake = newBrake
      setSteering(newSteering); setThrottle(newThrottle); setBrake(newBrake)
      setSensor({ roll: steeringAngle, pitch: pedalAngle })
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => window.removeEventListener('deviceorientation', onOrientation)
  }, [])

  const turn = Math.round(steering * 90)
  const gearLabel = manual ? (gear === 0 ? 'N' : `${gear}`) : `D${gear}`
  const dialStyle = useMemo(() => ({ '--turn': `${turn}deg` }) as React.CSSProperties, [turn])

  return <main className="controller">
    <header>
      <div className="brand">PITLINK</div>
      <button className={`connection ${connection}`} onClick={connect}><i />{connection === 'online' ? 'ПК ПОДКЛЮЧЁН' : connection === 'connecting' ? 'ПОДКЛЮЧЕНИЕ…' : 'ПОДКЛЮЧИТЬ ПК'}</button>
      <button className="settings-button" aria-label="Настройки" onClick={() => setSettingsOpen(true)}>⚙</button>
    </header>
    <section className="left-controls" aria-label="Педали">
      <Meter label="ГАЗ" value={throttle} color="teal" />
      <Meter label="ТОРМОЗ" value={brake} color="red" />
      {manual && <Meter label="СЦЕПЛЕНИЕ" value={clutch} color="white" onChange={value => { controls.current.clutch = value; setClutch(value) }} />}
    </section>
    <section className="wheel-zone" aria-label="Руль">
      <div className="wheel" style={dialStyle}><div className="wheel-dot" /></div>
      <output>РУЛЬ {sensor.roll >= 0 ? '+' : ''}{Math.round(sensor.roll)}° · ПЕДАЛИ {sensor.pitch >= 0 ? '+' : ''}{Math.round(sensor.pitch)}°</output>
      <button className="center" onClick={center}>ЦЕНТР</button>
    </section>
    <section className="right-controls" aria-label="Передачи">
      {manual ? <HShifter gear={gear} onChange={value => { controls.current.gear = value; setGear(value) }} /> : <>
        <button className="paddle up" onPointerDown={() => shift(1)}>ПЕРЕДАЧА <strong>+</strong></button>
        <button className="paddle down" onPointerDown={() => shift(-1)}>ПЕРЕДАЧА <strong>−</strong></button>
      </>}
      <button className={`manual ${manual ? 'active' : ''}`} onClick={() => setManual(value => !value)}><span>H</span> МКПП</button>
      <div className="gear-readout">{gearLabel}</div>
    </section>
    {settingsOpen && <div className="sheet" role="dialog" aria-modal="true">
      <form onSubmit={event => { event.preventDefault(); setSettingsOpen(false); connect() }}>
        <h1>Подключение к ПК</h1>
        <p>Подключитесь к одной Wi‑Fi сети или включите USB‑модем на телефоне.</p>
        <label>Адрес ресивера <input value={endpoint} onChange={event => setEndpoint(event.target.value)} autoCapitalize="none" inputMode="url" /></label>
        <small>Порт: 32100 · Только локальная сеть</small>
        <div><button type="button" onClick={() => setSettingsOpen(false)}>Отмена</button><button type="submit">Сохранить и подключить</button></div>
      </form>
    </div>}
  </main>
}

function Meter({ label, value, color, onChange }: { label: string, value: number, color: 'teal' | 'red' | 'white', onChange?: (value: number) => void }) {
  const update = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!onChange) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onChange(Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height)))
  }
  return <button className={`meter ${color}`} onPointerDown={update} onPointerMove={event => event.currentTarget.hasPointerCapture(event.pointerId) && update(event)} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} aria-label={label}>
    <span>{label}</span><b style={{ height: `${value * 100}%` }} />
  </button>
}

function HShifter({ gear, onChange }: { gear: number, onChange: (gear: number) => void }) {
  return <div className="h-shifter" aria-label="Ручная коробка передач">
    {[1, 3, 5, 2, 4, 6, 0].map(value => <button key={value} className={gear === value ? 'selected' : ''} onClick={() => onChange(value)}>{value === 0 ? 'N' : value}</button>)}
  </div>
}
