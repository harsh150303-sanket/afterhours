# AfterHours — private chat starter

A Node.js + Express + Socket.IO starter for an invite-only, adult roleplay chat with a host-operated persona console.

## What it includes

- Entry screen: invite code, display name, age, gender, chat preference, and an explicit roleplay disclosure checkbox.
- No conventional account creation. A short-lived, HTTP-only session cookie is issued after the invite code is accepted.
- Real-time one-to-one chat with a host-operated persona.
- Owner console to create/update fictional adult personas and reply as a selected persona.
- Basic request rate limiting, security headers, message length limits, and `noindex` metadata.
- Chat history is held **in server memory only** and disappears when the server restarts. It is not a durable database.

## Important honesty and safety choices

The entry page explicitly tells participants that profiles may be fictional personas operated by one host. Keep this disclosure. Do not present host-operated personas as independent real people. Use only with consenting adults, and do not ask participants to send intimate images or sensitive personal information.

The age field is self-reported, not age verification. For any broader deployment, use an appropriate age-assurance process and legal review. An invite code and `noindex` are not substitutes for access controls.

## Run on Windows 11

1. Install Node.js 20 or newer from https://nodejs.org/.
2. Extract this ZIP to a folder.
3. In that folder, copy `.env.example` to `.env`.
4. Edit `.env` and set two long, different random secrets for `INVITE_CODE` and `OWNER_TOKEN`. Never commit `.env` to GitHub.
5. Open Command Prompt in the folder and run:

   ```bat
   npm install
   npm start
   ```

6. Open http://localhost:3000 in your browser.
7. Enter the invite code from `.env`. To operate personas, open **Host console** at the bottom and enter the owner token.

## Private deployment notes

- For remote access, deploy the Node server to a host that supports WebSockets and HTTPS (not a static-only host).
- Set `INVITE_CODE`, `OWNER_TOKEN`, and `NODE_ENV=production` as server environment variables.
- Keep the repository private if you do not want source code visible. Never commit secrets.
- Anyone with the invite code can enter, so share it only with intended participants. Rotate it if it leaks.
- Add persistent storage, moderation/report controls, session expiry, and stronger abuse protection before inviting more people.
- This starter uses in-memory sessions and messages. A server restart clears them, and the app is not designed for high-availability use.
- Do not use this as a public service without security review and appropriate privacy/legal notices.

## Current limitations

- One active host operator is assumed.
- Messages are relayed to the matching profile room. The owner inbox receives visitor messages and owner replies.
- The app has no durable database, image/file uploads, email, password login, or third-party identity verification.
- The invitation code controls entry but does not uniquely identify a participant; a no-login system cannot reliably prevent nickname reuse.
