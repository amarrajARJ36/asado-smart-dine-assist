/**
 * ARJ SmartDine Assist — Captain Dashboard Logic (Supabase Realtime + Polling Fallback)
 */

let alerts = [];
let isSoundEnabled = true;
let previousAlertIds = new Set();
let audioUnlocked = false;

// --- Fetch Alerts from Supabase ---
async function fetchAlerts(triggerSound = true) {
  const client = window.sbClient || (window.supabase && window.supabase.createClient ? window.sbClient : null);
  if (!client) return;

  try {
    const { data, error } = await client
      .from('service_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error("Error fetching alerts:", error);
      return;
    }

    const currentAlerts = (data || []).map(row => ({
      id: row.id,
      table: row.table_name,
      service: row.service,
      serviceKey: row.service_key,
      icon: row.icon,
      status: row.status,
      timestamp: row.created_at
    }));

    // Check if there are new alerts that weren't in previousAlertIds
    const newAlertFound = currentAlerts.some(a => !previousAlertIds.has(a.id));
    if (newAlertFound && triggerSound && isSoundEnabled && previousAlertIds.size > 0) {
      playSoundAlert();
    }

    previousAlertIds = new Set(currentAlerts.map(a => a.id));
    alerts = currentAlerts;
    render();
  } catch (err) {
    console.error("Network error fetching alerts:", err);
  }
}

// --- Supabase Realtime & Polling Setup ---
function initSupabase() {
  const client = window.sbClient;
  if (!client) {
    console.warn("Supabase client not ready.");
    return;
  }

  // 1. Initial Fetch
  fetchAlerts(false);

  // 2. Realtime Subscription
  try {
    client
      .channel('captain_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_requests' },
        (payload) => {
          console.log("Realtime event received:", payload.eventType);
          fetchAlerts(true);
        }
      )
      .subscribe((status) => {
        console.log("Supabase Realtime Status:", status);
      });
  } catch (e) {
    console.warn("Realtime subscription fallback to polling:", e);
  }

  // 3. Fast 2-second background sync fallback (guarantees 100% reliability)
  setInterval(() => {
    fetchAlerts(true);
  }, 2000);
}

// --- 4-Tone Hospitality Chime ---
function playSoundAlert() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const playTone = (freq, startTime, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = audioCtx.currentTime;
    playTone(523.25, now, 0.18);        // C5
    playTone(659.25, now + 0.12, 0.18);  // E5
    playTone(783.99, now + 0.24, 0.22);  // G5
    playTone(1046.50, now + 0.36, 0.35); // C6
  } catch (e) {
    console.warn("Audio blocked by browser. Click page to enable audio.", e);
  }
}

// --- Render Alerts Grid ---
function render() {
  const badge = document.getElementById("alert-badge");
  if (badge) badge.textContent = alerts.length;

  const container = document.getElementById("alerts-container");
  if (!container) return;
  container.innerHTML = "";

  if (alerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No Active Requests</h3>
        <p>Tables will appear here when guests request service.</p>
      </div>
    `;
    return;
  }

  alerts.forEach(alert => {
    // Format elapsed time
    const elapsedSec = Math.floor((Date.now() - alert.timestamp) / 1000);
    let timeText = "Just now";
    if (elapsedSec >= 60) {
      timeText = `${Math.floor(elapsedSec / 60)}m ago`;
    } else if (elapsedSec > 5) {
      timeText = `${elapsedSec}s ago`;
    }

    const card = document.createElement("div");
    card.className = "alert-card pending";

    card.innerHTML = `
      <div class="alert-info">
        <div class="alert-meta">
          <span class="alert-table">${alert.table}</span>
          <span class="alert-time">${timeText}</span>
        </div>
        <h3 class="alert-service">${alert.service}</h3>
        <p class="alert-status">Waiting for service</p>
      </div>
      <div class="alert-actions">
        <button class="btn-complete" onclick="completeAlert('${alert.id}')">Complete</button>
      </div>
    `;

    container.appendChild(card);
  });
}

// --- Complete Action ---
async function completeAlert(alertId) {
  // Optimistic UI update
  alerts = alerts.filter(a => a.id !== alertId);
  previousAlertIds.delete(alertId);
  render();

  const client = window.sbClient;
  if (client) {
    try {
      const { error } = await client
        .from('service_requests')
        .update({ status: 'completed' })
        .eq('id', alertId);

      if (error) {
        console.error("Error completing alert:", error);
      }
    } catch (err) {
      console.error("Network error on complete:", err);
    }
  }
}

function toggleSound() {
  isSoundEnabled = !isSoundEnabled;
  const btn = document.getElementById("btn-toggle-sound");
  if (isSoundEnabled) {
    btn.className = "btn-sound-toggle enabled";
    btn.textContent = "Sound is Enabled";
    playSoundAlert();
  } else {
    btn.className = "btn-sound-toggle disabled";
    btn.textContent = "Sound is Muted";
  }
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  initSupabase();
  render();

  const toggleSoundBtn = document.getElementById("btn-toggle-sound");
  if (toggleSoundBtn) toggleSoundBtn.onclick = toggleSound;

  const testSoundBtn = document.getElementById("btn-test-sound");
  if (testSoundBtn) testSoundBtn.onclick = playSoundAlert;

  // Unlock browser audio on first user click anywhere
  document.body.addEventListener('click', () => {
    if (!audioUnlocked) {
      audioUnlocked = true;
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
      } catch (e) {}
    }
  }, { once: true });

  // Refresh elapsed timestamps every 10s
  setInterval(render, 10000);
});
