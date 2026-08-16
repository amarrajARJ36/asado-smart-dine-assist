/**
 * ARJ SmartDine Assist — Local Restaurant Server
 * Node.js HTTP + WebSocket (Zero Database)
 * Simplified: Pending → Complete (no Acknowledge)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

let PORT = process.env.PORT || 3001;

// In-memory alerts (no database needed)
let activeAlerts = [];

// --- HTTP Static File Server ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/guest.html' : req.url;
  filePath = filePath.split('?')[0];

  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// --- WebSocket Engine ---
const wss = new WebSocketServer({ server });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  // Send current alerts on connect
  ws.send(JSON.stringify({ type: 'INIT_ALERTS', alerts: activeAlerts }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'GUEST_CALL') {
        const newAlert = {
          id: 'alert_' + Date.now(),
          table: data.table || 'Table 04',
          service: data.service,
          serviceKey: data.serviceKey || '',
          icon: data.icon,
          status: 'pending',
          timestamp: Date.now()
        };

        activeAlerts.push(newAlert);
        broadcast({ type: 'NEW_ALERT', alert: newAlert, alerts: activeAlerts });

      } else if (data.type === 'COMPLETE_ALERT') {
        const completed = activeAlerts.find(a => a.id === data.alertId);
        activeAlerts = activeAlerts.filter(a => a.id !== data.alertId);
        broadcast({
          type: 'ALERT_REMOVED',
          alertId: data.alertId,
          completedAlert: completed || null,
          alerts: activeAlerts
        });
      }

    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });
});

// --- Start with Auto Port Fallback ---
function startServer(port) {
  server.listen(port, () => {
    console.log('');
    console.log('==================================================');
    console.log('  ARJ SmartDine Assist - Restaurant Server');
    console.log('==================================================');
    console.log(`  Guest Page:    http://localhost:${port}/guest.html?table=4`);
    console.log(`  Captain Page:  http://localhost:${port}/captain.html`);
    console.log('==================================================');
    console.log('');
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} busy. Trying ${PORT + 1}...`);
    PORT++;
    startServer(PORT);
  } else {
    console.error('Server error:', err);
  }
});

startServer(PORT);
