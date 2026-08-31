import { WebSocketServer } from 'ws'
import fs from 'node:fs'
import https from 'node:https'

const PORT = 32100
const host = process.env.PITLINK_HOST ?? '0.0.0.0'
const latest = new Map()

const tlsKey = process.env.PITLINK_TLS_KEY
const tlsCert = process.env.PITLINK_TLS_CERT
const httpsServer = tlsKey && tlsCert
  ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) })
  : null
const server = httpsServer
  ? new WebSocketServer({ server: httpsServer })
  : new WebSocketServer({ host, port: PORT })

const logListening = () => {
  console.log(`PitLink Receiver: ${httpsServer ? 'wss' : 'ws'}://<PC-LAN-IP>:${PORT}`)
  console.log('Локальный режим: Wi-Fi/LAN или USB-модем. Интернет не используется.')
}
if (httpsServer) httpsServer.listen(PORT, host, logListening)
else server.on('listening', logListening)
server.on('connection', (socket, request) => {
  const client = request.socket.remoteAddress ?? 'unknown'
  console.log(`Подключён контроллер ${client}`)
  socket.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString())
      if (message.type === 'state') {
        latest.set(client, message)
        // Adapter boundary: feed this normalized state to ViGEm/XInput or a keyboard mapper.
      }
      if (message.type === 'event') console.log(`Событие ${client}: ${message.action}`)
    } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid protocol message' })) }
  })
  socket.on('close', () => { latest.delete(client); console.log(`Отключён контроллер ${client}`) })
})
