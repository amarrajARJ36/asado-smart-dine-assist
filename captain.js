/**
 * ARJ SmartDine Assist — Captain Dashboard Logic
 * PIN-protected, Supabase Realtime + Polling sync
 */

let alerts = [];
let isSoundEnabled = true;
let previousAlertIds = new Set();
let audioUnlocked = false;
let isPinVerified = false;
let isInitialLoadDone = false;

// ==========================================================
// PIN AUTHENTICATION
// ==========================================================
let pinCode = '';

function pinPress(digit) {
  if (pinCode.length >= 4) return;
  pinCode += digit;
  updatePinDots();

  if (pinCode.length === 4) {
    validatePin();
  }
}

function pinDelete() {
  if (pinCode.length === 0) return;
  pinCode = pinCode.slice(0, -1);
  updatePinDots();
  // Clear error on delete
  document.getElementById('pin-error').textContent = '';
  clearPinError();
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) {
      dot.classList.toggle('filled', i < pinCode.length);
      dot.classList.remove('error');
    }
  }
}

function showPinError(message) {
  const errorEl = document.getElementById('pin-error');
  if (errorEl) errorEl.textContent = message;

  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) {
      dot.classList.add('error');
      dot.classList.remove('filled');
    }
  }

  // Reset after shake animation
  setTimeout(() => {
    pinCode = '';
    clearPinError();
    updatePinDots();
  }, 800);
}

function clearPinError() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) dot.classList.remove('error');
  }
}

async function validatePin() {
  const client = window.sbClient;
  if (!client) {
    showPinError('System not ready. Please refresh.');
    return;
  }

  try {
    const { data, error } = await client.rpc('validate_captain_pin', {
      p_pin: pinCode
    });

    if (error) {
      console.error("PIN validation RPC error:", error);
      showPinError('Connection error. Try again.');
      return;
    }

    if (data && data.success) {
      // PIN correct — unlock dashboard
      isPinVerified = true;
      sessionStorage.setItem('captain_pin_verified', 'true');

      const pinScreen = document.getElementById('pin-screen');
      const dashboard = document.getElementById('captain-console');

      if (pinScreen) pinScreen.classList.add('hidden');
      if (dashboard) dashboard.style.display = '';

      // Start the dashboard
      initSupabase();
    } else {
      showPinError(data?.error || 'Incorrect PIN.');
    }
  } catch (err) {
    console.error("PIN validation error:", err);
    showPinError('Network error. Try again.');
  }
}

function checkExistingSession() {
  // If already verified in this browser tab session, skip PIN
  if (sessionStorage.getItem('captain_pin_verified') === 'true') {
    isPinVerified = true;
    const pinScreen = document.getElementById('pin-screen');
    const dashboard = document.getElementById('captain-console');
    if (pinScreen) pinScreen.classList.add('hidden');
    if (dashboard) dashboard.style.display = '';
    initSupabase();
    return true;
  }
  return false;
}

// ==========================================================
// SUPABASE DATA & REALTIME
// ==========================================================

async function fetchAlerts(triggerSound = true) {
  const client = window.sbClient;
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

    const newAlertFound = currentAlerts.some(a => !previousAlertIds.has(a.id));
    if (newAlertFound && triggerSound && isSoundEnabled && isInitialLoadDone) {
      playSoundAlert();
    }

    previousAlertIds = new Set(currentAlerts.map(a => a.id));
    alerts = currentAlerts;
    isInitialLoadDone = true;
    render();
  } catch (err) {
    console.error("Network error fetching alerts:", err);
  }
}

async function fetchDailyStats() {
  const client = window.sbClient;
  if (!client) return;

  const startOfDayMs = new Date().setHours(0,0,0,0);

  try {
    const { data, error } = await client.rpc('get_daily_stats', {
      p_start_of_day_ms: startOfDayMs
    });

    if (error) {
      console.error("Error fetching daily stats:", error);
      return;
    }

    if (data && data.success) {
      const elTotal = document.getElementById('stat-total');
      const elTop = document.getElementById('stat-top');
      const elBreakdown = document.getElementById('stat-breakdown');

      if (elTotal) elTotal.textContent = data.total_requests;
      if (elTop) elTop.textContent = data.most_requested;
      
      if (elBreakdown) {
        elBreakdown.innerHTML = '';
        if (data.breakdown && data.breakdown.length > 0) {
          data.breakdown.forEach(item => {
            const row = document.createElement('div');
            row.className = 'breakdown-row';
            row.innerHTML = `<span>${item.service}</span><span class="bd-count">${item.count}</span>`;
            elBreakdown.appendChild(row);
          });
        } else {
          elBreakdown.innerHTML = `<div class="breakdown-row" style="justify-content: center;"><span>No requests yet</span></div>`;
        }
      }
    }
  } catch (err) {
    console.error("Network error fetching daily stats:", err);
  }
}

function initSupabase() {
  const client = window.sbClient;
  if (!client) return;

  fetchAlerts(false);
  fetchDailyStats();

  try {
    client
      .channel('captain_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_requests' },
        () => { fetchAlerts(true); }
      )
      .subscribe();
  } catch (e) {
    console.warn("Realtime subscription error:", e);
  }

  // Polling fallback
  setInterval(() => { fetchAlerts(true); }, 2000);
  setInterval(() => { fetchDailyStats(); }, 60000); // refresh stats every minute
}

// ==========================================================
// AUDIO
// ==========================================================

function playSoundAlert() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

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
    playTone(523.25, now, 0.18);
    playTone(659.25, now + 0.12, 0.18);
    playTone(783.99, now + 0.24, 0.22);
    playTone(1046.50, now + 0.36, 0.35);
  } catch (e) {
    console.warn("Audio blocked. Click page to enable.", e);
  }
}

// ==========================================================
// RENDER
// ==========================================================

function getTimeText(timestamp) {
  const elapsedSec = Math.floor((Date.now() - timestamp) / 1000);
  if (elapsedSec >= 60) return `${Math.floor(elapsedSec / 60)}m ago`;
  if (elapsedSec > 5) return `${elapsedSec}s ago`;
  return "Just now";
}

function render() {
  const badge = document.getElementById("alert-badge");
  if (badge) badge.textContent = alerts.length;

  const container = document.getElementById("alerts-container");
  if (!container) return;

  if (alerts.length === 0) {
    // Only update if not already showing empty state
    if (!container.querySelector('.empty-state')) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No Active Requests</h3>
          <p>Tables will appear here when guests request service.</p>
        </div>
      `;
    }
    return;
  }

  const alertIds = alerts.map(a => a.id);

  // Remove cards that are no longer in the alerts list
  container.querySelectorAll('.alert-card').forEach(card => {
    if (!alertIds.includes(card.dataset.alertId)) {
      card.remove();
    }
  });

  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  alerts.forEach((alert, index) => {
    let card = container.querySelector(`[data-alert-id='${alert.id}']`);

    if (!card) {
      // New alert — create and insert at correct position
      card = document.createElement("div");
      card.className = "alert-card pending";
      card.dataset.alertId = alert.id;
      card.innerHTML = `
        <div class="alert-info">
          <div class="alert-meta">
            <span class="alert-table">${alert.table}</span>
            <span class="alert-time" data-ts="${alert.timestamp}">${getTimeText(alert.timestamp)}</span>
          </div>
          <h3 class="alert-service">${alert.service}</h3>
          <p class="alert-status">Waiting for service</p>
        </div>
        <div class="alert-actions">
          <button class="btn-complete" onclick="completeAlert('${alert.id}')">Complete</button>
        </div>
      `;
      container.appendChild(card);
    } else {
      // Existing card — only update the timestamp text quietly
      const timeEl = card.querySelector('.alert-time');
      if (timeEl) timeEl.textContent = getTimeText(alert.timestamp);
    }
  });
}

// ==========================================================
// ACTIONS
// ==========================================================

async function completeAlert(alertId) {
  alerts = alerts.filter(a => a.id !== alertId);
  previousAlertIds.delete(alertId);
  render();

  const client = window.sbClient;
  if (client) {
    try {
      await client
        .from('service_requests')
        .update({ status: 'completed' })
        .eq('id', alertId);
      
      // Update analytics now that a request was completed
      fetchDailyStats();
    } catch (err) {
      console.error("Error completing alert:", err);
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

// ==========================================================
// INIT
// ==========================================================

document.addEventListener("DOMContentLoaded", () => {
  render();

  const toggleSoundBtn = document.getElementById("btn-toggle-sound");
  if (toggleSoundBtn) toggleSoundBtn.onclick = toggleSound;

  const testSoundBtn = document.getElementById("btn-test-sound");
  if (testSoundBtn) testSoundBtn.onclick = playSoundAlert;

  // Unlock browser audio on first click
  document.body.addEventListener('click', () => {
    if (!audioUnlocked) {
      audioUnlocked = true;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {}
    }
  }, { once: true });

  // Keyboard support for PIN entry
  document.addEventListener('keydown', (e) => {
    if (isPinVerified) return;
    if (e.key >= '0' && e.key <= '9') {
      pinPress(e.key);
    } else if (e.key === 'Backspace') {
      pinDelete();
    }
  });

  // Check if already authenticated in this tab
  if (!checkExistingSession()) {
    // Show PIN screen (already visible by default)
  }

  // Refresh timestamps every 30 seconds quietly
  setInterval(() => {
    container && container.querySelectorAll('.alert-time[data-ts]').forEach(el => {
      el.textContent = getTimeText(parseInt(el.dataset.ts, 10));
    });
  }, 30000);
});
