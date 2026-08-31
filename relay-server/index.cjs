const http = require('node:http')
const { WebSocketServer, WebSocket } = require('ws')

const sessions = new Map()
const server = http.createServer((request, response) => {
  if (request.url === '/health') return response.end('ok')
  response.writeHead(404).end()
})
const wss = new WebSocketServer({ noServer: true })

function tell(socket, message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)) }
function notify(session) {
  tell(session.desktop, { type: 'peers', phone: Boolean(session.phone) })
  tell(session.phone, { type: 'peers', desktop: Boolean(session.desktop) })
}

wss.on('connection', socket => {
  let session
  let role
  socket.once('message', raw => {
    let hello
    try { hello = JSON.parse(raw.toString()) } catch { socket.close(1008, 'invalid json'); return }
    if (hello.type !== 'register' || !['desktop', 'phone'].includes(hello.role) || !/^[A-Za-z0-9_-]{12,80}$/.test(hello.session) || !/^[A-Za-z0-9_-]{24,120}$/.test(hello.secret)) { socket.close(1008, 'invalid registration'); return }
    session = sessions.get(hello.session)
    if (!session) { session = { secret: hello.secret, expires: Date.now() + 12 * 60 * 60 * 1000 }; sessions.set(hello.session, session) }
    if (session.secret !== hello.secret) { socket.close(1008, 'pairing rejected'); return }
    role = hello.role
    if (session[role]) session[role].close(4000, 'replaced')
    session[role] = socket
    tell(socket, { type: 'registered' })
    notify(session)
    socket.on('message', message => {
      if (message.length > 4096) return socket.close(1009, 'message too large')
      const peer = role === 'phone' ? session.desktop : session.phone
      if (peer?.readyState === WebSocket.OPEN) peer.send(message)
    })
    socket.on('close', () => { if (session?.[role] === socket) { delete session[role]; notify(session) } })
  })
})

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') return socket.destroy()
  wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request))
})
setInterval(() => { for (const [id, session] of sessions) if (session.expires < Date.now() && !session.desktop && !session.phone) sessions.delete(id) }, 60000).unref()
server.listen(8787, '0.0.0.0')
