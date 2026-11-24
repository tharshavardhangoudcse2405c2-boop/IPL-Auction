# Authentication & Render Deployment Guide — Real Auction 26

Real Auction 26 requires verified sign-in via **Email OTP** (Resend) or **Phone SMS OTP** (Twilio) before users can enter the app or join live WebSocket auction rooms. User accounts, hashed single-use OTP challenges, and persistent `HttpOnly` sessions are stored in **PostgreSQL**.

Email OTP and SMS OTP are **independent**:
- Configuring **Resend** enables Email OTP right away even if Twilio is not configured.
- Configuring **Twilio** enables Phone SMS OTP right away even if Resend is not configured.
- Both methods require **PostgreSQL (`DATABASE_URL`)** and **`AUTH_SECRET`** to store accounts and sessions.

---

## Required Render Environment Variables Summary

| Category | Variable | Required? | Purpose |
| :--- | :--- | :--- | :--- |
| **Core & Sessions** | `DATABASE_URL` | Yes | Render PostgreSQL internal connection string |
| **Core & Sessions** | `AUTH_SECRET` | Yes | Secret key used to hash OTP codes and session tokens |
| **Core & Sessions** | `APP_URL` | Yes | Your live Render HTTPS URL (e.g. `https://real-auction-26.onrender.com`) |
| **Email OTP (Resend)** | `RESEND_API_KEY` | For Email OTP | API key from your Resend dashboard |
| **Email OTP (Resend)** | `EMAIL_FROM` | For Email OTP | Verified sender identity (e.g. `Real Auction 26 <auth@yourdomain.com>`) |
| **SMS OTP (Twilio)** | `TWILIO_ACCOUNT_SID` | For SMS OTP | Your Twilio Account SID (`AC...`) |
| **SMS OTP (Twilio)** | `TWILIO_AUTH_TOKEN` | For SMS OTP | Your Twilio Auth Token |
| **SMS OTP (Twilio)** | `TWILIO_FROM_NUMBER` **or** `TWILIO_MESSAGING_SERVICE_SID` | For SMS OTP | Your Twilio E.164 sender number (`+...`) or Messaging Service SID (`MG...`) |
| **AI Winner Analysis** | `GEMINI_API_KEY` | Optional | Server-side Gemini API key for post-auction squad winner evaluation |

> Never commit real API keys, tokens, or database passwords into GitHub or share them in chat. Always add them directly in Render's **Environment** settings.

---

## 1. Create the Render Web Service and Persistent PostgreSQL Database

You can deploy both the Node.js web service and the PostgreSQL database automatically using the repository's `render.yaml` Blueprint.

### Option A: Deploy with the Render Blueprint (`render.yaml`) — Recommended
1. Push your project repository to GitHub (making sure `.env` is ignored and no secrets are committed).
2. Log in to your [Render Dashboard](https://dashboard.render.com).
3. Click **New +** and select **Blueprint**.
4. Connect and select your GitHub repository.
5. Render reads `render.yaml` and prepares:
   - PostgreSQL database: **`real-auction-26-db`**
   - Node web service: **`real-auction-26`** (with `DATABASE_URL` linked automatically and `AUTH_SECRET` auto-generated)
6. When prompted for `sync: false` variables (or right after creation in the service's **Environment** tab), enter `APP_URL`, your Resend and/or Twilio values, and `GEMINI_API_KEY` (optional).
7. Click **Apply** / **Deploy**.

### Option B: Manual Render Setup
If you prefer creating the services manually instead of using the Blueprint:
1. In Render, click **New +** -> **PostgreSQL** and create a database (for example `real-auction-26-db`).
2. Click **New +** -> **Web Service**, connect your repository, choose **Node**, and set:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
3. Add a strong random **`AUTH_SECRET`** (at least 32 random characters) and set **`NODE_ENV`** to `production`.

---

## 2. Set `DATABASE_URL` from Render's Internal Database URL

If you deployed using the `render.yaml` Blueprint, `DATABASE_URL` is already wired automatically via `fromDatabase`.

If you set up the service manually:
1. Open your PostgreSQL database service in the Render Dashboard.
2. Under **Connections** (or **Info**), copy the **Internal Database URL** (not the External URL — the Internal URL keeps traffic on Render's private network).
3. Open your Web Service -> **Environment** -> add **`DATABASE_URL`** and paste the Internal Database URL.
4. Set **`APP_URL`** to your Render web service's HTTPS URL (for example `https://your-service-name.onrender.com`).

On boot, the server automatically creates the `users`, `otp_challenges`, and `sessions` tables in PostgreSQL.

---

## 3. Set Up Email OTP with Resend (`RESEND_API_KEY` and `EMAIL_FROM`)

To send real login codes to any email address (including Gmail):

1. Create an account at [resend.com](https://resend.com).
2. In the Resend dashboard, open **Domains** and click **Add Domain**.
3. Enter a domain or subdomain you own (for example `mail.yourdomain.com` or `yourdomain.com`).
4. Resend will show DNS records (such as **SPF** `TXT` and **DKIM** `TXT`/`CNAME` records).
5. Open your domain registrar or DNS provider (such as Cloudflare, Namecheap, Route 53, or GoDaddy) and add those exact DNS records.
6. Return to Resend and click **Verify DNS Records**. Wait until the domain status shows **Verified**.
7. Open **API Keys** in Resend, click **Create API Key**, give it **Sending access** for your verified domain, and copy the key immediately.
8. Save these two variables for Render:
   - `RESEND_API_KEY`: your Resend API key (`re_...`)
   - `EMAIL_FROM`: a sender address on your verified domain, e.g. `Real Auction 26 <auth@yourdomain.com>`

> Using an unverified domain or a free personal `@gmail.com` address in `EMAIL_FROM` will be rejected by Resend.

---

## 4. Set Up Phone SMS OTP with Twilio (`TWILIO_*`)

To send real SMS verification codes with international country codes:

1. Create an account at [twilio.com](https://www.twilio.com) and complete account verification.
2. From the **Twilio Console** home dashboard, locate:
   - **Account SID** (starts with `AC...`) -> use for `TWILIO_ACCOUNT_SID`
   - **Auth Token** -> use for `TWILIO_AUTH_TOKEN`
3. Configure an SMS sender using **one** of these options:
   - **Option 1 (`TWILIO_FROM_NUMBER`)**: Obtain an SMS-capable phone number in Twilio **Phone Numbers -> Manage -> Active numbers**, and copy it in E.164 format (including `+` and country code, e.g. `+15551234567`).
   - **Option 2 (`TWILIO_MESSAGING_SERVICE_SID`)**: Create a Messaging Service under **Messaging -> Services**, attach your SMS sender to it, and copy its SID (starts with `MG...`).
4. In the Twilio Console under **Messaging -> Settings -> Geo Permissions**, verify that SMS sending is enabled for the countries your users will log in from (such as India `+91`, United States `+1`, UK `+44`, etc.).

> **Important Note for Indian Phone Numbers (`+91`)**:
> Delivering application SMS to Indian (`+91`) mobile numbers generally requires telecom **DLT (Distributed Ledger Technology)** registration, approved sender IDs/headers, and pre-registered OTP message templates in addition to standard Twilio credentials. Twilio trial accounts are also restricted to sending SMS only to phone numbers explicitly added under **Verified Caller IDs** in your Twilio Console.

---

## 5. Add Variables in Render Environment Settings and Redeploy

1. Open your **real-auction-26** Web Service in the Render Dashboard.
2. Go to **Environment** in the left sidebar.
3. Add or update the environment variables you want to enable:
   - Core: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `NODE_ENV=production`
   - Email OTP: `RESEND_API_KEY`, `EMAIL_FROM`
   - SMS OTP: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
   - Optional AI Winner Analysis: `GEMINI_API_KEY`
4. Click **Save, rebuild, and deploy** (or trigger **Manual Deploy -> Deploy latest commit**) so the running server loads the updated environment.
5. Check `https://<your-render-domain>/api/health` in your browser. Confirm `"ok": true` and verify which `auth` capabilities show `true` (`database`, `authSecret`, `email`, `sms`).

---

## 6. Test Email OTP and SMS OTP Separately

### Test Email OTP
1. Open your deployed Render URL (`https://<your-render-domain>`).
2. Confirm you see the **Sign in to Real Auction 26** gate and no warning banner appears under **Email OTP**.
3. Enter a real email address you control (such as a Gmail address) and click **Send Code to Email**.
4. Check your inbox (and spam folder if testing a newly verified domain) for the 6-digit code.
5. Enter the 6-digit code and click **Verify & Sign In**.
6. Refresh the page and close/reopen the browser tab — confirm you stay signed in without being prompted for an OTP again.
7. Create an auction room, refresh the browser, and confirm you reconnect with your same account and franchise ownership.
8. Click **Log out** in the top header and confirm you are returned to the login screen.

### Test Phone SMS OTP
1. On the login screen, switch to **Phone SMS OTP**.
2. Select the matching country code (for example `+91` or `+1`) and enter your phone number.
3. Click **Send Code via SMS**.
4. Enter the 6-digit code received on your phone and click **Verify & Sign In**.
5. Confirm session persistence across browser refresh, WebSocket auction room creation/reconnection, and **Log out**.
