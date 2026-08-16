/**
 * ARJ SmartDine Assist — Captain Dashboard Logic (Supabase Realtime)
 * Desktop-oriented, simplified, emoji-free, with sound control and instant Supabase cloud sync
 */

let alerts = [];
let isSoundEnabled = true;

// --- Supabase Realtime & Data Fetching ---
async function initSupabase() {
  if (!supabase) {
    console.warn("Supabase client not initialized.");
    return;
  }

  // 1. Initial Load of Pending Alerts
  try {
    const { data, error } = await supabase
      .from('service_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error("Error fetching initial alerts:", error);
    } else {
      alerts = (data || []).map(row => ({
        id: row.id,
        table: row.table_name,
        service: row.service,
        serviceKey: row.service_key,
        icon: row.icon,
        status: row.status,
        timestamp: row.created_at
      }));
      render();
    }
  } catch (err) {
    console.error("Network error on initial fetch:", err);
  }

  // 2. Realtime Subscription
  supabase
    .channel('captain_alerts_channel')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'service_requests'
      },
      (payload) => {
        const newRow = payload.new;
        if (newRow && newRow.status === 'pending') {
          // Avoid duplicate entry if already present
          if (!alerts.some(a => a.id === newRow.id)) {
            alerts.push({
              id: newRow.id,
              table: newRow.table_name,
              service: newRow.service,
              serviceKey: newRow.service_key,
              icon: newRow.icon,
              status: newRow.status,
              timestamp: newRow.created_at
            });
            render();
            if (isSoundEnabled) {
              playSoundAlert();
            }
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'service_requests'
      },
      (payload) => {
        const updatedRow = payload.new;
        if (updatedRow && updatedRow.status === 'completed') {
          alerts = alerts.filter(a => a.id !== updatedRow.id);
          render();
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'service_requests'
      },
      (payload) => {
        const oldRow = payload.old;
        if (oldRow && oldRow.id) {
          alerts = alerts.filter(a => a.id !== oldRow.id);
          render();
        }
      }
    )
    .subscribe();
}

// --- 4-Tone Hospitality Chime ---
function playSoundAlert() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const playTone = (freq, startTime, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.25, startTime);
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
    console.warn("Audio blocked by browser. Click page to enable.", e);
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
  render();

  // Update in Supabase
  if (supabase) {
    const { error } = await supabase
      .from('service_requests')
      .update({ status: 'completed' })
      .eq('id', alertId);

    if (error) {
      console.error("Error completing alert:", error);
    }
  }
}

function toggleSound() {
  isSoundEnabled = !isSoundEnabled;
  const btn = document.getElementById("btn-toggle-sound");
  if (isSoundEnabled) {
    btn.className = "btn-sound-toggle enabled";
    btn.textContent = "Sound is Enabled";
    playSoundAlert(); // Verify audio activation
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

  // Refresh timestamps every 15s
  setInterval(render, 15000);
});
