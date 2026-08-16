# SmartDine Assist — Clean & Simple Restaurant Hospitality OS

A minimalist, white-background (light mode) restaurant service calling system separated into two dedicated applications:
1. **`guest.html`**: For restaurant guests (accessed via QR code at their table).
2. **`captain.html`**: For waitstaff/captains (displays incoming alerts with a loud audio chime).

---

## 🔊 Why Was the Sound Not Playing & How to Fix It?

Modern web browsers (Chrome, Safari, Edge) enforce an **Autoplay Policy**: they block `AudioContext.play()` until the user interacts with the page at least once.

### ✅ Solution:
1. Open [`captain.html`](file:///Users/amarraj/Desktop/Smart Dine Assist/captain.html) in your browser.
2. Click the blue button at the top right: **`🔊 Test Sound & Enable Audio`**.
3. You will immediately hear a crisp **4-tone hospitality chime** (`C5 -> E5 -> G5 -> C6`), and the button will turn green (**`🔊 Audio Alerts Active ✓`**).
4. From that point on, every incoming alert will play the sound automatically!

---

## 🚀 How to Test Locally with Two Separate Pages

1. Start your local dev server in [`/Users/amarraj/Desktop/Smart Dine Assist`](file:///Users/amarraj/Desktop/Smart Dine Assist):
   ```bash
   npm run dev
   ```
2. Open **Window 1 (The Captain Tab)**:
   - Go to **`http://localhost:3000/captain.html`**
   - Click **`🔊 Test Sound & Enable Audio`** to unlock browser sound.
3. Open **Window 2 (The Guest Tab)**:
   - Go to **`http://localhost:3000/guest.html?table=4`** (or `?table=12` for Table 12!)
4. Click any service button in Window 2 (e.g. **`💧 Water Refill`**) $\rightarrow$ watch Window 1 play the chime and display the alert card instantly!

---

## 🍽️ How to Practically Deploy This in a Real Restaurant

To install this system in a real-world restaurant, follow this simple 4-step implementation:

### 1. Hardware Required
* **1 WiFi Router**: The restaurant's Guest WiFi router.
* **1 Staff Tablet or POS Computer**: Kept at the captain's station or waiter stand.
* **Table QR Stickers**: Small laminated QR codes placed on each dining table.

### 2. QR Code URL Setup
Each physical table sticker encodes a unique URL with the table number:
* Table 01 $\rightarrow$ `https://smartdine.yourrestaurant.com/guest.html?table=1`
* Table 04 $\rightarrow$ `https://smartdine.yourrestaurant.com/guest.html?table=4`

### 3. Practical WiFi Security Check (2 Easy Ways)

#### Method A: The "Local Network Only" Method (Zero Cloud Needed — Safest & Simplest)
* Instead of hosting the app on the public internet, run a small local Node.js server inside the restaurant (on the POS PC or a Raspberry Pi connected to the router at `http://192.168.1.50`).
* Point the QR codes to `http://192.168.1.50/guest.html?table=4`.
* **Why this is foolproof:** Because `192.168.1.50` is a local IP address, **it is physically impossible for anyone outside the restaurant to open the link or scan the QR code!**

#### Method B: Public Cloud Server + Router IP Whitelisting
* If hosting on Vercel or AWS, the server checks the guest's incoming HTTP request IP address (`req.headers['x-forwarded-for']`).
* If `Guest_IP == Restaurant_WiFi_Public_IP`, the page loads normally.
* If the IP does not match, the app displays: *"Please connect to the Restaurant Free WiFi to call for service."*

### 4. Production Real-Time Sync
* While this prototype uses `BroadcastChannel` (for same-browser testing), a production deployment replaces `BroadcastChannel` with **WebSockets (`socket.io`, Supabase, or Firebase Realtime)**.
* When a guest taps a button on their iPhone, a WebSocket event is pushed to the captain's tablet in `< 50 milliseconds`!
