import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
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
  const [pairingToken, setPairingToken] = useState(() => localStorage.getItem('pitlink-pairing-token') ?? '')
  const [relaySession, setRelaySession] = useState(() => localStorage.getItem('pitlink-relay-session') ?? '')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerError, setScannerError] = useState('')
  const [setupUrl, setSetupUrl] = useState('')
  const [portrait, setPortrait] = useState(() => window.matchMedia('(orientation: portrait)').matches)
  const [manual, setManual] = useState(false)
  const [steering, setSteering] = useState(0)
  const [throttle, setThrottle] = useState(0)
  const [brake, setBrake] = useState(0)
  const [clutch, setClutch] = useState(0)
  const [gear, setGear] = useState(1)
  const [sensor, setSensor] = useState({ roll: 0, pitch: 0 })
  const socket = useRef<WebSocket | null>(null)
  const scanner = useRef<Html5Qrcode | null>(null)
  const sequence = useRef(0)
  const baseline = useRef({ beta: 0, gamma: 0, isSet: false })
  const latestOrientation = useRef({ beta: 0, gamma: 0, known: false })
  const controls = useRef({ steering: 0, throttle: 0, brake: 0, clutch: 0, gear: 1 })
  const autoReconnect = useRef(localStorage.getItem('pitlink-autoconnect') === 'true')

  const send = useCallback((message: OutboundMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message))
  }, [])

  const connect = useCallback((targetEndpoint = endpoint, targetToken = pairingToken, targetSession = relaySession) => {
    socket.current?.close()
    setConnection('connecting')
    try {
      const ws = new WebSocket(targetEndpoint)
      socket.current = ws
      ws.onopen = () => {
        localStorage.setItem('pitlink-endpoint', targetEndpoint)
        if (targetToken && targetSession) ws.send(JSON.stringify({ type: 'register', role: 'phone', session: targetSession, secret: targetToken }))
        else if (targetToken) ws.send(JSON.stringify({ type: 'pair', token: targetToken }))
        else setConnection('online')
      }
      ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'paired' || message.type === 'registered') {
            localStorage.setItem('pitlink-autoconnect', 'true')
            autoReconnect.current = true
            setConnection('online')
            setScannerError('')
          }
          if (message.type === 'error') { setScannerError(message.message); ws.close() }
        } catch { /* Ignore non-protocol messages. */ }
      }
      ws.onclose = () => setConnection('offline')
      ws.onerror = () => { setScannerError(`Не удалось открыть WSS по адресу ${targetEndpoint}. Запустите Controller и проверьте, что телефон в той же Wi‑Fi сети.`); setConnection('offline') }
    } catch { setConnection('offline') }
  }, [endpoint, pairingToken, relaySession])

  const requestMotionPermission = useCallback(async () => {
    const motion = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }
    if (!motion.requestPermission) return true
    const granted = await motion.requestPermission() === 'granted'
    if (!granted) alert('Разрешите доступ к движению устройства в настройках Safari, чтобы использовать руль и педали.')
    return granted
  }, [])

  const startController = useCallback(async () => {
    if (!await requestMotionPermission()) return
    if (endpoint && pairingToken) connect()
    else if (portrait) setSettingsOpen(true)
    else alert('Поверните телефон вертикально, чтобы открыть настройки и отсканировать QR‑код.')
  }, [connect, endpoint, pairingToken, portrait, requestMotionPermission])

  useEffect(() => {
    if (autoReconnect.current && endpoint && pairingToken) connect()
  }, [connect, endpoint, pairingToken])

  useEffect(() => {
    const query = window.matchMedia('(orientation: portrait)')
    const update = () => setPortrait(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const applyPairingCode = useCallback((raw: string) => {
    try {
      const pair = new URL(raw)
      const pairedEndpoint = pair.searchParams.get('endpoint')
      const token = pair.searchParams.get('token')
      const session = pair.searchParams.get('session')
      const setup = pair.searchParams.get('setup')
      if (pair.protocol !== 'pitlink:' || !pairedEndpoint || !token) throw new Error()
      setEndpoint(pairedEndpoint)
      setPairingToken(token)
      setRelaySession(session ?? '')
      localStorage.setItem('pitlink-endpoint', pairedEndpoint)
      localStorage.setItem('pitlink-pairing-token', token)
      if (session) localStorage.setItem('pitlink-relay-session', session)
      else localStorage.removeItem('pitlink-relay-session')
      localStorage.removeItem('pitlink-autoconnect')
      autoReconnect.current = false
      setScannerOpen(false)
      setScannerError('')
      setSetupUrl(setup ?? '')
      if (pairedEndpoint.startsWith('wss://') && setup && !session) {
        setSettingsOpen(true)
        setScannerError('Сначала установите локальный сертификат с ПК, затем вернитесь и подключитесь.')
        return
      }
      setSettingsOpen(false)
      window.setTimeout(() => connect(pairedEndpoint, token, session ?? ''), 0)
    } catch { setScannerError('Это не код PitLink Controller.') }
  }, [connect])

  useEffect(() => {
    if (!scannerOpen) return
    const reader = new Html5Qrcode('qr-reader')
    scanner.current = reader
    reader.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, applyPairingCode, () => undefined)
      .catch(() => setScannerError('Не удалось открыть камеру. Разрешите доступ или введите адрес вручную.'))
    return () => { scanner.current?.stop().catch(() => undefined); scanner.current = null }
  }, [applyPairingCode, scannerOpen])

  const center = useCallback(async () => {
    if (!await requestMotionPermission()) return
    baseline.current = latestOrientation.current.known
      ? { beta: latestOrientation.current.beta, gamma: latestOrientation.current.gamma, isSet: true }
      : { beta: 0, gamma: 0, isSet: false }
    setSteering(0); setThrottle(0); setBrake(0)
    setSensor({ roll: 0, pitch: 0 })
    controls.current.steering = 0; controls.current.throttle = 0; controls.current.brake = 0
    send({ type: 'event', action: 'center' })
  }, [requestMotionPermission, send])

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
      <button className={`connection ${connection}`} onClick={() => connection === 'offline' ? startController() : connect()}><i />{connection === 'online' ? 'ПК ПОДКЛЮЧЁН' : connection === 'connecting' ? 'ПОДКЛЮЧЕНИЕ…' : 'НАЧАТЬ / ПОДКЛЮЧИТЬ ПК'}</button>
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
    <button className="portrait-settings" onClick={() => setSettingsOpen(true)}>НАСТРОЙКИ</button>
    {settingsOpen && <div className="sheet" role="dialog" aria-modal="true">
      <form onSubmit={event => { event.preventDefault(); setSettingsOpen(false); connect() }}>
        <h1>Подключение к ПК</h1>
        <p>Подключитесь к одной Wi‑Fi сети или включите USB‑модем на телефоне.</p>
        <label>Адрес ресивера <input value={endpoint} onChange={event => setEndpoint(event.target.value)} autoCapitalize="none" inputMode="url" /></label>
        <small>Порт: 32100 · Только локальная сеть</small>
        {scannerError && <p className="scan-error">{scannerError}</p>}
        {setupUrl && <a className="setup-link" href={setupUrl} target="_blank" rel="noreferrer">Открыть настройку сертификата на ПК</a>}
        <div><button type="button" onClick={() => setScannerOpen(true)}>Сканировать QR</button><button type="button" onClick={() => setSettingsOpen(false)}>Отмена</button><button type="submit">Сохранить и подключить</button></div>
      </form>
    </div>}
    {scannerOpen && <div className="sheet scanner-sheet" role="dialog" aria-modal="true"><div><h1>Сканируйте QR с ПК</h1><div id="qr-reader" /><button onClick={() => setScannerOpen(false)}>Отмена</button></div></div>}
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
