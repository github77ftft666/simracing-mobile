#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const QRCode = require('qrcode')
const selfsigned = require('selfsigned')
const { WebSocketServer } = require('ws')

const CONTROL_PORT = 32100
const QR_PORT = 32102
const SETUP_PORT = 32103
const token = process.env.PITLINK_PAIR_TOKEN ?? crypto.randomBytes(24).toString('base64url')
const profile = require('./profiles/automobilista2.json')
const keyboardPath = process.pkg ? path.join(path.dirname(process.execPath), 'keyboard.ps1') : path.join(__dirname, 'keyboard.ps1')
const keyboard = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', keyboardPath], { stdio: ['pipe', 'ignore', 'inherit'], windowsHide: true })
let previousKeys = ''
let controlServer
let qrServer
let setupServer

function lanAddress() {
  const candidates = Object.entries(os.networkInterfaces()).flatMap(([name, devices]) =>
    (devices ?? []).filter(device => device.family === 'IPv4' && !device.internal && !device.address.startsWith('169.254.')).map(device => ({ name, address: device.address })),
  ).filter(device => !/(tun|vpn|virtual|loopback|happ|docker|wsl)/i.test(device.name))
  candidates.sort((a, b) => Number(b.address.startsWith('192.168.')) - Number(a.address.startsWith('192.168.')))
  return candidates[0]?.address ?? '127.0.0.1'
}

function certificatePaths() {
  const directory = path.join(process.env.LOCALAPPDATA ?? path.dirname(process.execPath), 'PitLinkController')
  fs.mkdirSync(directory, { recursive: true })
  return {
    rootKey: path.join(directory, 'pitlink-root-ca-key.pem'),
    rootCert: path.join(directory, 'pitlink-root-ca.pem'),
    rootCer: path.join(directory, 'pitlink-root-ca.cer'),
    serverKey: path.join(directory, 'pitlink-server-key.pem'),
    serverCert: path.join(directory, 'pitlink-server.pem'),
    serverMeta: path.join(directory, 'pitlink-server.json'),
  }
}

async function loadCertificate(address) {
  const files = certificatePaths()
  let root
  if (fs.existsSync(files.rootKey) && fs.existsSync(files.rootCert)) {
    root = { private: fs.readFileSync(files.rootKey, 'utf8'), cert: fs.readFileSync(files.rootCert, 'utf8') }
  } else {
    root = await selfsigned.generate([{ name: 'commonName', value: 'PitLink Local Root CA' }], {
      algorithm: 'sha256',
      keySize: 2048,
      notAfterDate: new Date('2036-01-01'),
      extensions: [
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      ],
    })
    fs.writeFileSync(files.rootKey, root.private, { mode: 0o600 })
    fs.writeFileSync(files.rootCert, root.cert)
    fs.writeFileSync(files.rootCer, new crypto.X509Certificate(root.cert).raw)
  }

  const existing = fs.existsSync(files.serverKey) && fs.existsSync(files.serverCert) && fs.existsSync(files.serverMeta)
    ? JSON.parse(fs.readFileSync(files.serverMeta, 'utf8'))
    : null
  if (existing?.address === address) {
    return { key: fs.readFileSync(files.serverKey, 'utf8'), cert: fs.readFileSync(files.serverCert, 'utf8'), rootCer: files.rootCer }
  }

  const server = await selfsigned.generate([{ name: 'commonName', value: address }], {
    algorithm: 'sha256',
    keySize: 2048,
    notAfterDate: new Date('2031-01-01'),
    ca: { key: root.private, cert: root.cert },
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip: address }] },
    ],
  })
  fs.writeFileSync(files.serverKey, server.private, { mode: 0o600 })
  fs.writeFileSync(files.serverCert, server.cert)
  fs.writeFileSync(files.serverMeta, JSON.stringify({ address }))
  return { key: server.private, cert: server.cert, rootCer: files.rootCer }
}

function mobileConfig(rootCertPath) {
  const certificate = fs.readFileSync(rootCertPath).toString('base64')
  const uuid = crypto.randomUUID().toUpperCase()
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadContent</key><array><dict><key>PayloadCertificateFileName</key><string>PitLink Local Root CA.cer</string><key>PayloadContent</key><data>${certificate}</data><key>PayloadDescription</key><string>Разрешает локальное WSS-соединение PitLink с этим ПК.</string><key>PayloadDisplayName</key><string>PitLink Local Root CA</string><key>PayloadIdentifier</key><string>io.pitlink.local-root</string><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadUUID</key><string>${uuid}</string><key>PayloadVersion</key><integer>1</integer></dict></array><key>PayloadDisplayName</key><string>PitLink локальная сеть</string><key>PayloadIdentifier</key><string>io.pitlink.local-root.profile</string><key>PayloadOrganization</key><string>PitLink</string><key>PayloadType</key><string>Configuration</string><key>PayloadUUID</key><string>${crypto.randomUUID().toUpperCase()}</string><key>PayloadVersion</key><integer>1</integer></dict></plist>`
}

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
  if (!keyboard.stdin.destroyed) keyboard.stdin.write(`${JSON.stringify({ type: 'state', left: false, right: false, throttle: false, brake: false })}\n`)
}

function startControlServer(tls) {
  const server = https.createServer({ key: tls.key, cert: tls.cert })
  controlServer = new WebSocketServer({ server })
  controlServer.on('connection', socket => {
    let paired = false
    socket.on('message', raw => {
      let message
      try { message = JSON.parse(raw.toString()) } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); return }
      if (!paired) {
        if (message.type !== 'pair' || message.token !== token) { socket.send(JSON.stringify({ type: 'error', message: 'Pairing rejected' })); socket.close(); return }
        paired = true
        socket.send(JSON.stringify({ type: 'paired', profile: profile.name }))
        console.log('Телефон сопряжён по WSS.')
        return
      }
      if (message.type === 'state') sendKeys(message)
      if (message.type === 'event' && (message.action === 'gearUp' || message.action === 'gearDown')) keyboard.stdin.write(`${JSON.stringify(message)}\n`)
    })
    socket.on('close', releaseAll)
  })
  return new Promise(resolve => server.listen(CONTROL_PORT, '0.0.0.0', resolve))
}

function startSetupServer(address, rootCer) {
  const config = mobileConfig(rootCer)
  setupServer = http.createServer((request, response) => {
    if (request.url === '/pitlink-root-ca.mobileconfig') {
      response.writeHead(200, { 'Content-Type': 'application/x-apple-aspen-config', 'Content-Disposition': 'attachment; filename="PitLink-Local-Root.mobileconfig"' })
      return response.end(config)
    }
    if (request.url === '/pitlink-root-ca.cer') {
      response.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="PitLink-Local-Root.cer"' })
      return response.end(fs.readFileSync(rootCer))
    }
    if (request.url !== '/' && request.url !== '/setup') { response.writeHead(404); return response.end() }
    response.end(`<!doctype html><meta charset="utf-8"><title>PitLink WSS setup</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0a;color:#fff;font:18px Arial;text-align:center}main{max-width:620px;padding:24px}a{display:block;margin:16px;padding:14px;border-radius:10px;background:#14d6c8;color:#041212;text-decoration:none;font-weight:bold}small{color:#aab;line-height:1.5}</style><main><h1>PitLink: настройка защищённого соединения</h1><p>Установите сертификат один раз для этого ПК и Wi‑Fi.</p><a href="/pitlink-root-ca.mobileconfig">iPhone / iPad: установить профиль</a><small>После загрузки: Настройки → «Профиль загружен» → Установить, затем Настройки → Основные → Об этом устройстве → Доверие сертификатам и включите PitLink Local Root CA.</small><a href="/pitlink-root-ca.cer">Android: скачать сертификат</a><small>Установите его как CA‑сертификат в настройках безопасности Android. Затем вернитесь в PitLink и подключитесь.</small></main>`)
  })
  return new Promise(resolve => setupServer.listen(SETUP_PORT, '0.0.0.0', resolve))
}

function startQrServer(address, pairCode) {
  return QRCode.toDataURL(pairCode, { width: 360, margin: 1 }).then(image => {
    qrServer = http.createServer((request, response) => {
      if (request.url !== '/' && request.url !== '/qr') { response.writeHead(404); return response.end() }
      response.end(`<!doctype html><meta charset="utf-8"><title>PitLink Controller</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0a;color:#fff;font:20px Arial;text-align:center}main{max-width:520px}img{width:min(72vw,360px);margin:24px;background:white;padding:12px;border-radius:12px}small{color:#aab}</style><main><h1>PitLink Controller</h1><p>Automobilista 2 · профиль клавиатуры</p><img src="${image}" alt="QR код сопряжения"><p>Откройте PitLink → ⚙ → Сканировать QR</p><small>После сканирования установите локальный сертификат и нажмите «Подключиться».</small></main>`)
    })
    return new Promise(resolve => qrServer.listen(QR_PORT, '0.0.0.0', resolve))
  })
}

async function main() {
  const address = lanAddress()
  const tls = await loadCertificate(address)
  const setupUrl = `http://${address}:${SETUP_PORT}/setup`
  const pairCode = `pitlink://pair?endpoint=${encodeURIComponent(`wss://${address}:${CONTROL_PORT}`)}&token=${token}&setup=${encodeURIComponent(setupUrl)}`
  await startControlServer(tls)
  await startSetupServer(address, tls.rootCer)
  await startQrServer(address, pairCode)
  const qrPage = `http://${address}:${QR_PORT}/qr`
  console.log(`PitLink Controller готов. QR: ${qrPage}`)
  console.log(`Настройка сертификата: ${setupUrl}`)
  console.log(profile.instructions)
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', qrPage], { detached: true, stdio: 'ignore' }).unref()
}

process.on('SIGINT', () => {
  releaseAll()
  keyboard.kill()
  controlServer?.close()
  qrServer?.close()
  setupServer?.close()
  process.exit(0)
})

main().catch(error => { console.error('Не удалось запустить PitLink Controller:', error); releaseAll(); keyboard.kill(); process.exit(1) })
