#!/usr/bin/env node
const crypto = require('node:crypto')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const QRCode = require('qrcode')
const { WebSocketServer } = require('ws')

const CONTROL_PORT = 32100
const QR_PORT = 32102
const token = process.env.PITLINK_PAIR_TOKEN ?? crypto.randomBytes(24).toString('base64url')
const profile = require('./profiles/automobilista2.json')
const keyboardPath = process.pkg ? path.join(path.dirname(process.execPath), 'keyboard.ps1') : path.join(__dirname, 'keyboard.ps1')
const keyboard = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', keyboardPath], { stdio: ['pipe', 'ignore', 'inherit'], windowsHide: true })
let previousKeys = ''

function lanAddress() {
  const candidates = Object.entries(os.networkInterfaces()).flatMap(([name, devices]) =>
    (devices ?? []).filter(device => device.family === 'IPv4' && !device.internal && !device.address.startsWith('169.254.')).map(device => ({ name, address: device.address })),
  ).filter(device => !/(tun|vpn|virtual|loopback|happ|docker|wsl)/i.test(device.name))
  candidates.sort((a, b) => Number(b.address.startsWith('192.168.')) - Number(a.address.startsWith('192.168.')))
  if (candidates[0]) return candidates[0].address
  return '127.0.0.1'
}
const address = lanAddress()
const pairCode = `pitlink://pair?endpoint=${encodeURIComponent(`ws://${address}:${CONTROL_PORT}`)}&token=${token}`

function sendKeys(state) {
  const threshold = profile.threshold
  const keys = {
    type: 'state',
    left: state.steering < -threshold,
    right: state.steering > threshold,
    throttle: state.throttle > threshold,
    brake: state.brake > threshold,
  }
  const next = JSON.stringify(keys)
  if (next !== previousKeys) { keyboard.stdin.write(`${next}\n`); previousKeys = next }
}
function releaseAll() {
  previousKeys = ''
  keyboard.stdin.write(`${JSON.stringify({ type: 'state', left: false, right: false, throttle: false, brake: false })}\n`)
}

const controlServer = new WebSocketServer({ port: CONTROL_PORT, host: '0.0.0.0' })
controlServer.on('connection', socket => {
  let paired = false
  socket.on('message', raw => {
    let message
    try { message = JSON.parse(raw.toString()) } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); return }
    if (!paired) {
      if (message.type !== 'pair' || message.token !== token) { socket.send(JSON.stringify({ type: 'error', message: 'Pairing rejected' })); socket.close(); return }
      paired = true
      socket.send(JSON.stringify({ type: 'paired', profile: profile.name }))
      console.log('Телефон сопряжён.')
      return
    }
    if (message.type === 'state') sendKeys(message)
    if (message.type === 'event' && (message.action === 'gearUp' || message.action === 'gearDown')) keyboard.stdin.write(`${JSON.stringify(message)}\n`)
  })
  socket.on('close', releaseAll)
})

QRCode.toDataURL(pairCode, { width: 360, margin: 1 }, (error, image) => {
  if (error) throw error
  const server = http.createServer((request, response) => {
    if (request.url !== '/' && request.url !== '/qr') { response.writeHead(404); return response.end() }
    response.end(`<!doctype html><meta charset="utf-8"><title>PitLink Controller</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0a;color:#fff;font:20px Arial;text-align:center}main{max-width:520px}img{width:min(72vw,360px);margin:24px;background:white;padding:12px;border-radius:12px}small{color:#aab}</style><main><h1>PitLink Controller</h1><p>Automobilista 2 · профиль клавиатуры</p><img src="${image}" alt="QR код сопряжения"><p>Откройте PitLink → ⚙ → Сканировать QR</p><small>ПК: ${address}:${CONTROL_PORT}</small></main>`)
  })
  server.listen(QR_PORT, '0.0.0.0', () => {
    const qrPage = `http://${address}:${QR_PORT}/qr`
    console.log(`PitLink Controller готов. Откройте QR: ${qrPage}`)
    console.log(profile.instructions)
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', qrPage], { detached: true, stdio: 'ignore' }).unref()
  })
})

process.on('SIGINT', () => { releaseAll(); keyboard.kill(); controlServer.close(); process.exit(0) })
