/**
 * SmartDine Assist — Simple & Clean Hospitality Service
 * Real-Time Alerts, Audio Sound Notification, and WiFi Security Gate
 */

// --- 1. REAL-TIME CROSS-TAB SYNC ---
const channel = new BroadcastChannel("smart_dine_simple_channel");

// --- 2. SIMPLE APPLICATION STATE ---
let appState = {
  activeRole: "guest",     // "guest" | "captain"
  isWifiConnected: true,   // true = on Restaurant WiFi, false = External IP
  alerts: []               // Array of active alerts
};

// Load alerts from LocalStorage
function loadState() {
  const saved = localStorage.getItem("smart_dine_simple_alerts");
  if (saved) {
    try {
      appState.alerts = JSON.parse(saved);
    } catch (e) {
      appState.alerts = [];
    }
  }
}

function saveState() {
  localStorage.setItem("smart_dine_simple_alerts", JSON.stringify(appState.alerts));
  // Broadcast to other open browser tabs
  channel.postMessage({ type: "SYNC_ALERTS", alerts: appState.alerts });
}

// --- 3. AUDIO SOUND NOTIFICATION FOR CAPTAIN ---
function playSoundAlert() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    // Simple, pleasant two-tone beep (E5 -> A5)
    osc.type = "sine";
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(659.25, now);       // E5
    osc.frequency.setValueAtTime(880.00, now + 0.18); // A5
    
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.start(now);
    osc.stop(now + 0.5);
  } catch (e) {
    console.log("Sound alert triggered (browser auto-play may require click):", e);
  }
}

// --- 4. GUEST ACTIONS ---
function sendServiceAlert(serviceName, icon) {
  // Security Check: If guest is not on Restaurant WiFi, block request
  if (!appState.isWifiConnected) {
    document.getElementById("security-modal").classList.add("active");
    return;
  }

  const alertId = "alert_" + Date.now();
  const newAlert = {
    id: alertId,
    table: "Table 04",
    service: serviceName,
    icon: icon,
    status: "pending",
    time: "Just now"
  };

  appState.alerts.push(newAlert);
  saveState();

  // Play audio alert instantly
  playSoundAlert();

  // Show status message to Guest
  const statusBox = document.getElementById("guest-status-box");
  const statusText = document.getElementById("guest-status-text");
  statusBox.style.display = "flex";
  statusText.textContent = `✅ "${serviceName}" request sent to Capt. Rahul!`;

  render();
}

// --- 5. CAPTAIN ACTIONS ---
function acknowledgeAlert(alertId) {
  const alert = appState.alerts.find(a => a.id === alertId);
  if (alert) {
    alert.status = "acknowledged";
    saveState();
    render();

    // Update guest status text if they are watching
    const statusBox = document.getElementById("guest-status-box");
    const statusText = document.getElementById("guest-status-text");
    statusBox.style.display = "flex";
    statusText.textContent = `🏃‍♂️ Capt. Rahul has acknowledged and is on the way!`;
  }
}

function completeAlert(alertId) {
  appState.alerts = appState.alerts.filter(a => a.id !== alertId);
  saveState();
  render();

  // Hide guest status box when completed
  if (appState.alerts.length === 0) {
    document.getElementById("guest-status-box").style.display = "none";
  }
}

// --- 6. RENDER ENGINE ---
function render() {
  // 1. Update Badge Counter
  document.getElementById("alert-badge").textContent = appState.alerts.length;

  // 2. Render Captain Alerts List
  const container = document.getElementById("alerts-container");
  container.innerHTML = "";

  if (appState.alerts.length === 0) {
    container.innerHTML = `<div class="empty-state">No active service requests right now.</div>`;
    return;
  }

  appState.alerts.forEach(alert => {
    const card = document.createElement("div");
    card.className = `alert-card ${alert.status === "acknowledged" ? "acknowledged" : ""}`;

    card.innerHTML = `
      <div class="alert-info">
        <h3><span>${alert.icon}</span> <span>${alert.table} — ${alert.service}</span></h3>
        <p>${alert.status === "acknowledged" ? "✓ Acknowledged • Capt. Rahul on the way" : "⚡ New alert • Waiting for Captain"}</p>
      </div>

      <div class="alert-actions">
        ${alert.status !== "acknowledged" ? `
          <button class="btn-ack" onclick="acknowledgeAlert('${alert.id}')">Acknowledge</button>
        ` : `
          <span style="font-size: 0.85rem; color: #2563eb; font-weight: 600;">✓ Acknowledged</span>
        `}
        <button class="btn-complete" onclick="completeAlert('${alert.id}')">Complete</button>
      </div>
    `;

    container.appendChild(card);
  });
}

// --- 7. WIFI SECURITY TOGGLE & MODAL ---
function toggleWifi() {
  appState.isWifiConnected = !appState.isWifiConnected;
  const btn = document.getElementById("btn-wifi-toggle");
  const badge = document.getElementById("wifi-status-badge");

  if (appState.isWifiConnected) {
    btn.className = "wifi-toggle-btn";
    btn.textContent = "📶 Connected to Restaurant WiFi 🔒";
    badge.className = "wifi-badge";
    badge.innerHTML = "<span>🔒 WiFi Security Verified</span>";
  } else {
    btn.className = "wifi-toggle-btn disconnected";
    btn.textContent = "🌐 External Network / 5G (Blocked) ⚠️";
    badge.className = "wifi-badge blocked";
    badge.innerHTML = "<span>⚠️ External IP Blocked</span>";
  }
}

function closeSecurityModal() {
  document.getElementById("security-modal").classList.remove("active");
  switchRole("captain");
}

// --- 8. ROLE SWITCHER ---
function switchRole(role) {
  appState.activeRole = role;
  const guestBtn = document.getElementById("btn-guest-view");
  const captainBtn = document.getElementById("btn-captain-view");
  const guestSection = document.getElementById("guest-view");
  const captainSection = document.getElementById("captain-view");

  if (role === "guest") {
    guestBtn.classList.add("active");
    captainBtn.classList.remove("active");
    guestSection.classList.add("active");
    captainSection.classList.remove("active");
  } else {
    guestBtn.classList.remove("active");
    captainBtn.classList.add("active");
    guestSection.classList.remove("active");
    captainSection.classList.add("active");
  }
}

// --- 9. CROSS-TAB LISTENERS ---
channel.onmessage = (event) => {
  if (event.data && event.data.type === "SYNC_ALERTS") {
    const oldLen = appState.alerts.length;
    appState.alerts = event.data.alerts;
    render();
    // Play sound if a new alert was added from another tab
    if (appState.alerts.length > oldLen) {
      playSoundAlert();
    }
  }
};

window.addEventListener("storage", (e) => {
  if (e.key === "smart_dine_simple_alerts" && e.newValue) {
    appState.alerts = JSON.parse(e.newValue);
    render();
  }
});

// --- 10. INIT ---
document.addEventListener("DOMContentLoaded", () => {
  loadState();
  render();

  document.getElementById("btn-guest-view").onclick = () => switchRole("guest");
  document.getElementById("btn-captain-view").onclick = () => switchRole("captain");
  document.getElementById("btn-wifi-toggle").onclick = () => toggleWifi();
});
