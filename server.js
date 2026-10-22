require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1_200_000 });

const PORT = Number(process.env.PORT || 3000);
const INVITE_CODE = process.env.INVITE_CODE || "";
const OWNER_TOKEN = process.env.OWNER_TOKEN || "";
const isProd = process.env.NODE_ENV === "production";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "harshtaily153@gmail.com";
const EMAIL_FROM = process.env.EMAIL_FROM || "AfterHours <onboarding@resend.dev>";
const DATABASE_URL = process.env.DATABASE_URL || "";
const db = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;
let dbReady = Promise.resolve(false);
if (db) {
  dbReady = db.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      session_id TEXT,
      sender_role TEXT NOT NULL,
      sender TEXT NOT NULL,
      message_text TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_messages_profile_created_idx
      ON chat_messages (profile_id, created_at);
  `).then(() => {
    console.log("PostgreSQL chat history storage is ready.");
    return true;
  }).catch(err => {
    console.error("PostgreSQL initialization failed:", err.message);
    return false;
  });
} else {
  console.warn("DATABASE_URL is not set. Chat history will be temporary and lost on restart.");
}

async function saveMessage(message) {
  if (!db) return false;
  const ready = await dbReady;
  if (!ready) throw new Error("Database is configured but not ready.");
  await db.query(
    `INSERT INTO chat_messages (id, profile_id, session_id, sender_role, sender, message_text, image_data, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING`,
    [message.id, message.profileId, message.sessionId || null, message.from, message.sender, message.text || "", message.image || null, message.timestamp]
  );
  return true;
}

async function loadMessages(profileId, limit = 100) {
  if (!db) return null;
  const ready = await dbReady;
  if (!ready) throw new Error("Database is configured but not ready.");
  const result = await db.query(
    `SELECT id, profile_id, session_id, sender_role, sender, message_text, image_data, created_at
     FROM chat_messages WHERE profile_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [profileId, limit]
  );
  return result.rows.reverse().map(row => ({
    id: row.id, profileId: row.profile_id, sessionId: row.session_id,
    from: row.sender_role, sender: row.sender, text: row.message_text,
    ...(row.image_data ? { image: row.image_data } : {}),
    timestamp: Number(row.created_at)
  }));
}

async function emailVisitorMessage(message, profile) {
  if (!RESEND_API_KEY) return;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [NOTIFY_EMAIL],
        subject: "AfterHours: new message for " + profile.name,
        text: [
          "A visitor sent a message on AfterHours.",
          "",
          "Visitor display name: " + message.sender,
          "Persona: " + profile.name + " (" + profile.id + ")",
          "Message: " + message.text,
          "Time: " + new Date(message.timestamp).toISOString(),
          "",
          "Note: this notification contains chat content. Keep it private."
        ].join("\n")
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Email notification failed:", response.status, detail.slice(0, 300));
    }
  } catch (err) {
    console.error("Email notification error:", err.message);
  }
}

if (!INVITE_CODE || !OWNER_TOKEN) {
  console.warn("WARNING: Set INVITE_CODE and OWNER_TOKEN in your environment before using this app.");
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

const profiles = [
  {
    "id": "aarav-sharma-001",
    "name": "Aarav Sharma",
    "age": 21,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "vihaan-kapoor-002",
    "name": "Vihaan Kapoor",
    "age": 28,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "aditya-chauhan-003",
    "name": "Aditya Chauhan",
    "age": 35,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "arjun-patel-004",
    "name": "Arjun Patel",
    "age": 24,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "reyansh-joshi-005",
    "name": "Reyansh Joshi",
    "age": 31,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "krishna-rao-006",
    "name": "Krishna Rao",
    "age": 38,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "ishaan-verma-007",
    "name": "Ishaan Verma",
    "age": 27,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "kabir-reddy-008",
    "name": "Kabir Reddy",
    "age": 34,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "rohan-mishra-009",
    "name": "Rohan Mishra",
    "age": 23,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "rahul-mehta-010",
    "name": "Rahul Mehta",
    "age": 30,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "dev-malhotra-011",
    "name": "Dev Malhotra",
    "age": 37,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "kunal-saxena-012",
    "name": "Kunal Saxena",
    "age": 26,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "yash-shah-013",
    "name": "Yash Shah",
    "age": 33,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "dhruv-gupta-014",
    "name": "Dhruv Gupta",
    "age": 22,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "siddharth-trivedi-015",
    "name": "Siddharth Trivedi",
    "age": 29,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "manav-desai-016",
    "name": "Manav Desai",
    "age": 36,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "nikhil-iyer-017",
    "name": "Nikhil Iyer",
    "age": 25,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "aniket-pillai-018",
    "name": "Aniket Pillai",
    "age": 32,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "harsh-singh-019",
    "name": "Harsh Singh",
    "age": 21,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "jay-nair-020",
    "name": "Jay Nair",
    "age": 28,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "pranav-sharma-021",
    "name": "Pranav Sharma",
    "age": 35,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "ayaan-kapoor-022",
    "name": "Ayaan Kapoor",
    "age": 24,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "vivaan-chauhan-023",
    "name": "Vivaan Chauhan",
    "age": 31,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "ritvik-patel-024",
    "name": "Ritvik Patel",
    "age": 38,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "atharv-joshi-025",
    "name": "Atharv Joshi",
    "age": 27,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "varun-rao-026",
    "name": "Varun Rao",
    "age": 34,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "akash-verma-027",
    "name": "Akash Verma",
    "age": 23,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "rajat-reddy-028",
    "name": "Rajat Reddy",
    "age": 30,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "abhishek-mishra-029",
    "name": "Abhishek Mishra",
    "age": 37,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "sahil-mehta-030",
    "name": "Sahil Mehta",
    "age": 26,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "om-malhotra-031",
    "name": "Om Malhotra",
    "age": 33,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "parth-saxena-032",
    "name": "Parth Saxena",
    "age": 22,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "tanish-shah-033",
    "name": "Tanish Shah",
    "age": 29,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "mihir-gupta-034",
    "name": "Mihir Gupta",
    "age": 36,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "darsh-trivedi-035",
    "name": "Darsh Trivedi",
    "age": 25,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "neel-desai-036",
    "name": "Neel Desai",
    "age": 32,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "rishi-iyer-037",
    "name": "Rishi Iyer",
    "age": 21,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "shrey-pillai-038",
    "name": "Shrey Pillai",
    "age": 28,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "tanmay-singh-039",
    "name": "Tanmay Singh",
    "age": 35,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "amit-nair-040",
    "name": "Amit Nair",
    "age": 24,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "vivek-sharma-041",
    "name": "Vivek Sharma",
    "age": 31,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "samar-kapoor-042",
    "name": "Samar Kapoor",
    "age": 38,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "kartik-chauhan-043",
    "name": "Kartik Chauhan",
    "age": 27,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "aarush-patel-044",
    "name": "Aarush Patel",
    "age": 34,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "laksh-joshi-045",
    "name": "Laksh Joshi",
    "age": 23,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "shivam-rao-046",
    "name": "Shivam Rao",
    "age": 30,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "mayank-verma-047",
    "name": "Mayank Verma",
    "age": 37,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "ansh-reddy-048",
    "name": "Ansh Reddy",
    "age": 26,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "gaurav-mishra-049",
    "name": "Gaurav Mishra",
    "age": 33,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "chirag-mehta-050",
    "name": "Chirag Mehta",
    "age": 22,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "rudra-malhotra-051",
    "name": "Rudra Malhotra",
    "age": 29,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "nirav-saxena-052",
    "name": "Nirav Saxena",
    "age": 36,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "bhavesh-shah-053",
    "name": "Bhavesh Shah",
    "age": 25,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "meet-gupta-054",
    "name": "Meet Gupta",
    "age": 32,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "devansh-trivedi-055",
    "name": "Devansh Trivedi",
    "age": 21,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "akhil-desai-056",
    "name": "Akhil Desai",
    "age": 28,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "sanjay-iyer-057",
    "name": "Sanjay Iyer",
    "age": 35,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "manish-pillai-058",
    "name": "Manish Pillai",
    "age": 24,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "pratik-singh-059",
    "name": "Pratik Singh",
    "age": 31,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "jatin-nair-060",
    "name": "Jatin Nair",
    "age": 38,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "aarav-patel-061",
    "name": "Aarav Patel",
    "age": 27,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "vihaan-joshi-062",
    "name": "Vihaan Joshi",
    "age": 34,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "aditya-rao-063",
    "name": "Aditya Rao",
    "age": 23,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "arjun-verma-064",
    "name": "Arjun Verma",
    "age": 30,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "reyansh-reddy-065",
    "name": "Reyansh Reddy",
    "age": 37,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "krishna-mishra-066",
    "name": "Krishna Mishra",
    "age": 26,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "ishaan-mehta-067",
    "name": "Ishaan Mehta",
    "age": 33,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "kabir-malhotra-068",
    "name": "Kabir Malhotra",
    "age": 22,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "rohan-saxena-069",
    "name": "Rohan Saxena",
    "age": 29,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "rahul-shah-070",
    "name": "Rahul Shah",
    "age": 36,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "dev-gupta-071",
    "name": "Dev Gupta",
    "age": 25,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "kunal-trivedi-072",
    "name": "Kunal Trivedi",
    "age": 32,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "yash-desai-073",
    "name": "Yash Desai",
    "age": 21,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "dhruv-iyer-074",
    "name": "Dhruv Iyer",
    "age": 28,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "siddharth-pillai-075",
    "name": "Siddharth Pillai",
    "age": 35,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "manav-singh-076",
    "name": "Manav Singh",
    "age": 24,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "nikhil-nair-077",
    "name": "Nikhil Nair",
    "age": 31,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "aniket-sharma-078",
    "name": "Aniket Sharma",
    "age": 38,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "harsh-kapoor-079",
    "name": "Harsh Kapoor",
    "age": 27,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "jay-chauhan-080",
    "name": "Jay Chauhan",
    "age": 34,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "pranav-patel-081",
    "name": "Pranav Patel",
    "age": 23,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "ayaan-joshi-082",
    "name": "Ayaan Joshi",
    "age": 30,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "vivaan-rao-083",
    "name": "Vivaan Rao",
    "age": 37,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "ritvik-verma-084",
    "name": "Ritvik Verma",
    "age": 26,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "atharv-reddy-085",
    "name": "Atharv Reddy",
    "age": 33,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "varun-mishra-086",
    "name": "Varun Mishra",
    "age": 22,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "akash-mehta-087",
    "name": "Akash Mehta",
    "age": 29,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "rajat-malhotra-088",
    "name": "Rajat Malhotra",
    "age": 36,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "abhishek-saxena-089",
    "name": "Abhishek Saxena",
    "age": 25,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "sahil-shah-090",
    "name": "Sahil Shah",
    "age": 32,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "om-gupta-091",
    "name": "Om Gupta",
    "age": 21,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "parth-trivedi-092",
    "name": "Parth Trivedi",
    "age": 28,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "tanish-desai-093",
    "name": "Tanish Desai",
    "age": 35,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "mihir-iyer-094",
    "name": "Mihir Iyer",
    "age": 24,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "darsh-pillai-095",
    "name": "Darsh Pillai",
    "age": 31,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "neel-singh-096",
    "name": "Neel Singh",
    "age": 38,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "rishi-nair-097",
    "name": "Rishi Nair",
    "age": 27,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "shrey-sharma-098",
    "name": "Shrey Sharma",
    "age": 34,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "tanmay-kapoor-099",
    "name": "Tanmay Kapoor",
    "age": 23,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "amit-chauhan-100",
    "name": "Amit Chauhan",
    "age": 30,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "vivek-patel-101",
    "name": "Vivek Patel",
    "age": 37,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "samar-joshi-102",
    "name": "Samar Joshi",
    "age": 26,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "kartik-rao-103",
    "name": "Kartik Rao",
    "age": 33,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "aarush-verma-104",
    "name": "Aarush Verma",
    "age": 22,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "laksh-reddy-105",
    "name": "Laksh Reddy",
    "age": 29,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "shivam-mishra-106",
    "name": "Shivam Mishra",
    "age": 36,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "mayank-mehta-107",
    "name": "Mayank Mehta",
    "age": 25,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "ansh-malhotra-108",
    "name": "Ansh Malhotra",
    "age": 32,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "gaurav-saxena-109",
    "name": "Gaurav Saxena",
    "age": 21,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "chirag-shah-110",
    "name": "Chirag Shah",
    "age": 28,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "rudra-gupta-111",
    "name": "Rudra Gupta",
    "age": 35,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "nirav-trivedi-112",
    "name": "Nirav Trivedi",
    "age": 24,
    "bio": "Into cricket, travel stories, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "bhavesh-desai-113",
    "name": "Bhavesh Desai",
    "age": 31,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "meet-iyer-114",
    "name": "Meet Iyer",
    "age": 38,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "devansh-pillai-115",
    "name": "Devansh Pillai",
    "age": 27,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Man"
  },
  {
    "id": "akhil-singh-116",
    "name": "Akhil Singh",
    "age": 34,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#ffc4b8",
    "gender": "Man"
  },
  {
    "id": "sanjay-nair-117",
    "name": "Sanjay Nair",
    "age": 23,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b9e8d2",
    "gender": "Man"
  },
  {
    "id": "manish-sharma-118",
    "name": "Manish Sharma",
    "age": 30,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Man"
  },
  {
    "id": "pratik-kapoor-119",
    "name": "Pratik Kapoor",
    "age": 37,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b7d8ff",
    "gender": "Man"
  },
  {
    "id": "jatin-chauhan-120",
    "name": "Jatin Chauhan",
    "age": 26,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#f2b6d7",
    "gender": "Man"
  },
  {
    "id": "ananya-sharma-f001",
    "name": "Ananya Sharma",
    "age": 21,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "aadhya-reddy-f002",
    "name": "Aadhya Reddy",
    "age": 26,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "aarohi-trivedi-f003",
    "name": "Aarohi Trivedi",
    "age": 31,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "saanvi-kapoor-f004",
    "name": "Saanvi Kapoor",
    "age": 36,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "diya-mishra-f005",
    "name": "Diya Mishra",
    "age": 23,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "myra-desai-f006",
    "name": "Myra Desai",
    "age": 28,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "ira-chauhan-f007",
    "name": "Ira Chauhan",
    "age": 33,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "kiara-mehta-f008",
    "name": "Kiara Mehta",
    "age": 38,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "avni-iyer-f009",
    "name": "Avni Iyer",
    "age": 25,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "riya-patel-f010",
    "name": "Riya Patel",
    "age": 30,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "anika-malhotra-f011",
    "name": "Anika Malhotra",
    "age": 35,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "meera-pillai-f012",
    "name": "Meera Pillai",
    "age": 22,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "ishita-joshi-f013",
    "name": "Ishita Joshi",
    "age": 27,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "kavya-saxena-f014",
    "name": "Kavya Saxena",
    "age": 32,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "nisha-singh-f015",
    "name": "Nisha Singh",
    "age": 37,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "pooja-rao-f016",
    "name": "Pooja Rao",
    "age": 24,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "priya-shah-f017",
    "name": "Priya Shah",
    "age": 29,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "neha-nair-f018",
    "name": "Neha Nair",
    "age": 34,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "aditi-verma-f019",
    "name": "Aditi Verma",
    "age": 21,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "simran-gupta-f020",
    "name": "Simran Gupta",
    "age": 26,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "shreya-sharma-f021",
    "name": "Shreya Sharma",
    "age": 31,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "tanya-reddy-f022",
    "name": "Tanya Reddy",
    "age": 36,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "mira-trivedi-f023",
    "name": "Mira Trivedi",
    "age": 23,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "suhani-kapoor-f024",
    "name": "Suhani Kapoor",
    "age": 28,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "jhanvi-mishra-f025",
    "name": "Jhanvi Mishra",
    "age": 33,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "khushi-desai-f026",
    "name": "Khushi Desai",
    "age": 38,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "riddhi-chauhan-f027",
    "name": "Riddhi Chauhan",
    "age": 25,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "mahi-mehta-f028",
    "name": "Mahi Mehta",
    "age": 30,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "navya-iyer-f029",
    "name": "Navya Iyer",
    "age": 35,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "pari-patel-f030",
    "name": "Pari Patel",
    "age": 22,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "tanvi-malhotra-f031",
    "name": "Tanvi Malhotra",
    "age": 27,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "sakshi-pillai-f032",
    "name": "Sakshi Pillai",
    "age": 32,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "sneha-joshi-f033",
    "name": "Sneha Joshi",
    "age": 37,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "isha-saxena-f034",
    "name": "Isha Saxena",
    "age": 24,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "nandini-singh-f035",
    "name": "Nandini Singh",
    "age": 29,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "ayesha-rao-f036",
    "name": "Ayesha Rao",
    "age": 34,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "zara-shah-f037",
    "name": "Zara Shah",
    "age": 21,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "fatima-nair-f038",
    "name": "Fatima Nair",
    "age": 26,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "sana-verma-f039",
    "name": "Sana Verma",
    "age": 31,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "inaya-gupta-f040",
    "name": "Inaya Gupta",
    "age": 36,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "trisha-sharma-f041",
    "name": "Trisha Sharma",
    "age": 23,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "palak-reddy-f042",
    "name": "Palak Reddy",
    "age": 28,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "hetal-trivedi-f043",
    "name": "Hetal Trivedi",
    "age": 33,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "krisha-kapoor-f044",
    "name": "Krisha Kapoor",
    "age": 38,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "dhvani-mishra-f045",
    "name": "Dhvani Mishra",
    "age": 25,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "mitali-desai-f046",
    "name": "Mitali Desai",
    "age": 30,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "rupal-chauhan-f047",
    "name": "Rupal Chauhan",
    "age": 35,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "jinal-mehta-f048",
    "name": "Jinal Mehta",
    "age": 22,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "khushi-iyer-f049",
    "name": "Khushi Iyer",
    "age": 27,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "vaidehi-patel-f050",
    "name": "Vaidehi Patel",
    "age": 32,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "ananya-gupta-f051",
    "name": "Ananya Gupta",
    "age": 37,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "aadhya-sharma-f052",
    "name": "Aadhya Sharma",
    "age": 24,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "aarohi-reddy-f053",
    "name": "Aarohi Reddy",
    "age": 29,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "saanvi-trivedi-f054",
    "name": "Saanvi Trivedi",
    "age": 34,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "diya-kapoor-f055",
    "name": "Diya Kapoor",
    "age": 21,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "myra-mishra-f056",
    "name": "Myra Mishra",
    "age": 26,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "ira-desai-f057",
    "name": "Ira Desai",
    "age": 31,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "kiara-chauhan-f058",
    "name": "Kiara Chauhan",
    "age": 36,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "avni-mehta-f059",
    "name": "Avni Mehta",
    "age": 23,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "riya-iyer-f060",
    "name": "Riya Iyer",
    "age": 28,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "anika-patel-f061",
    "name": "Anika Patel",
    "age": 33,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "meera-malhotra-f062",
    "name": "Meera Malhotra",
    "age": 38,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "ishita-pillai-f063",
    "name": "Ishita Pillai",
    "age": 25,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "kavya-joshi-f064",
    "name": "Kavya Joshi",
    "age": 30,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "nisha-saxena-f065",
    "name": "Nisha Saxena",
    "age": 35,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "pooja-singh-f066",
    "name": "Pooja Singh",
    "age": 22,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "priya-rao-f067",
    "name": "Priya Rao",
    "age": 27,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "neha-shah-f068",
    "name": "Neha Shah",
    "age": 32,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "aditi-nair-f069",
    "name": "Aditi Nair",
    "age": 37,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "simran-verma-f070",
    "name": "Simran Verma",
    "age": 24,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "shreya-gupta-f071",
    "name": "Shreya Gupta",
    "age": 29,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "tanya-sharma-f072",
    "name": "Tanya Sharma",
    "age": 34,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "mira-reddy-f073",
    "name": "Mira Reddy",
    "age": 21,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "suhani-trivedi-f074",
    "name": "Suhani Trivedi",
    "age": 26,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "jhanvi-kapoor-f075",
    "name": "Jhanvi Kapoor",
    "age": 31,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "khushi-mishra-f076",
    "name": "Khushi Mishra",
    "age": 36,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "riddhi-desai-f077",
    "name": "Riddhi Desai",
    "age": 23,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "mahi-chauhan-f078",
    "name": "Mahi Chauhan",
    "age": 28,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "navya-mehta-f079",
    "name": "Navya Mehta",
    "age": 33,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "pari-iyer-f080",
    "name": "Pari Iyer",
    "age": 38,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "tanvi-patel-f081",
    "name": "Tanvi Patel",
    "age": 25,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "sakshi-malhotra-f082",
    "name": "Sakshi Malhotra",
    "age": 30,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "sneha-pillai-f083",
    "name": "Sneha Pillai",
    "age": 35,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "isha-joshi-f084",
    "name": "Isha Joshi",
    "age": 22,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "nandini-saxena-f085",
    "name": "Nandini Saxena",
    "age": 27,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "ayesha-singh-f086",
    "name": "Ayesha Singh",
    "age": 32,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "zara-rao-f087",
    "name": "Zara Rao",
    "age": 37,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "fatima-shah-f088",
    "name": "Fatima Shah",
    "age": 24,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "sana-nair-f089",
    "name": "Sana Nair",
    "age": 29,
    "bio": "Foodie who thinks every great conversation needs a cup of chai.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "inaya-verma-f090",
    "name": "Inaya Verma",
    "age": 34,
    "bio": "Warm, witty, and a little playful. Loves films and meaningful chats.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "trisha-gupta-f091",
    "name": "Trisha Gupta",
    "age": 21,
    "bio": "Book lover with a soft spot for old Bollywood songs.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "palak-sharma-f092",
    "name": "Palak Sharma",
    "age": 26,
    "bio": "Low-key, funny, and a fan of spontaneous conversations.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "hetal-reddy-f093",
    "name": "Hetal Reddy",
    "age": 31,
    "bio": "Thoughtful listener who enjoys humour and honest conversations.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "krisha-trivedi-f094",
    "name": "Krisha Trivedi",
    "age": 36,
    "bio": "Playful energy, respectful vibes, and a curious mind.",
    "color": "#f4d28b",
    "gender": "Woman"
  },
  {
    "id": "dhvani-kapoor-f095",
    "name": "Dhvani Kapoor",
    "age": 23,
    "bio": "Quiet at first, talkative once the conversation gets interesting.",
    "color": "#b7d8ff",
    "gender": "Woman"
  },
  {
    "id": "mitali-mishra-f096",
    "name": "Mitali Mishra",
    "age": 28,
    "bio": "Ambitious, relaxed after work, and always up for a good conversation.",
    "color": "#f2b6d7",
    "gender": "Woman"
  },
  {
    "id": "rupal-desai-f097",
    "name": "Rupal Desai",
    "age": 33,
    "bio": "Easygoing and curious; enjoys music, chai, and late-night conversations.",
    "color": "#d9b8ff",
    "gender": "Woman"
  },
  {
    "id": "jinal-chauhan-f098",
    "name": "Jinal Chauhan",
    "age": 38,
    "bio": "Confident, friendly, and always happy to swap playlists.",
    "color": "#ffc4b8",
    "gender": "Woman"
  },
  {
    "id": "khushi-mehta-f099",
    "name": "Khushi Mehta",
    "age": 25,
    "bio": "Enjoys fitness, weekend drives, and talking about life.",
    "color": "#b9e8d2",
    "gender": "Woman"
  },
  {
    "id": "vaidehi-iyer-f100",
    "name": "Vaidehi Iyer",
    "age": 30,
    "bio": "Into travel stories, books, and discovering new food spots.",
    "color": "#f4d28b",
    "gender": "Woman"
  }
]; // Fictional roleplay personas; not real users.

const rooms = new Map();
const sessions = new Map();

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const crypto = require("crypto");
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}
function randomId() { return require("crypto").randomBytes(24).toString("hex"); }
function ownerOk(req) {
  const token = req.get("x-owner-token") || req.body?.ownerToken || "";
  return safeEqual(token, OWNER_TOKEN);
}
function sessionFromCookie(req) {
  const sid = req.cookies.ah_session;
  return sid ? sessions.get(sid) : null;
}
function requireSession(req, res, next) {
  const session = sessionFromCookie(req);
  if (!session) return res.status(401).json({ error: "Enter through the private invite page first." });
  req.ahSession = session;
  next();
}
function publicProfile(p) {
  return { id: p.id, name: p.name, age: p.age, bio: p.bio, color: p.color, gender: p.gender || "Man" };
}
function visibleProfilesFor(session) {
  return profiles.filter(p => {
    const gender = p.gender || "Man";
    if (session.preference === "Men") return gender === "Man";
    if (session.preference === "Women") return gender === "Woman";
    return gender === "Man" || gender === "Woman";
  }).map(publicProfile);
}

app.get("/api/session", (req, res) => {
  const session = sessionFromCookie(req);
  if (!session) return res.status(401).json({ ok: false });
  res.json({ ok: true, name: session.name, profiles: visibleProfilesFor(session) });
});

app.post("/api/enter", (req, res) => {
  const { inviteCode, name, age, gender, preference, consent } = req.body || {};
  if (!safeEqual(inviteCode, INVITE_CODE)) return res.status(403).json({ error: "That invite code is not valid." });
  const parsedAge = Number(age);
  if (!Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 120) {
    return res.status(400).json({ error: "This experience is for adults 18+. Enter a valid age." });
  }
  if (!name || String(name).trim().length < 1 || String(name).trim().length > 32) {
    return res.status(400).json({ error: "Choose a display name (1–32 characters)." });
  }
  if (!["Woman", "Man", "Non-binary", "Prefer not to say"].includes(gender)) {
    return res.status(400).json({ error: "Choose a gender option." });
  }
  if (!["Men", "Women", "Everyone"].includes(preference)) {
    return res.status(400).json({ error: "Choose a chat preference." });
  }
  if (consent !== true) return res.status(400).json({ error: "Please confirm the roleplay disclosure and adult-only rule." });

  const sid = randomId();
  const session = {
    sid, name: String(name).trim(), age: parsedAge, gender, preference,
    createdAt: Date.now(), activeProfile: null
  };
  sessions.set(sid, session);
  res.cookie("ah_session", sid, {
    httpOnly: true, sameSite: "strict", secure: isProd, maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/"
  });
  res.json({ ok: true, name: session.name, profiles: visibleProfilesFor(session) });
});

app.post("/api/leave", requireSession, (req, res) => {
  sessions.delete(req.ahSession.sid);
  res.clearCookie("ah_session", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/profiles", requireSession, (req, res) => {
  res.json({ profiles: visibleProfilesFor(req.ahSession) });
});

app.post("/api/owner/profiles/bulk", (req, res) => {
  if (!ownerOk(req)) return res.status(401).json({ error: "Owner authorization required." });
  const incoming = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
  if (!incoming.length || incoming.length > 500) return res.status(400).json({ error: "Provide between 1 and 500 personas." });
  const cleaned = [];
  for (const item of incoming) {
    if (!item.id || !/^[a-z0-9_-]{2,32}$/i.test(item.id)) continue;
    if (!item.name || String(item.name).trim().length > 48) continue;
    if (!Number.isInteger(Number(item.age)) || Number(item.age) < 18) continue;
    cleaned.push({
      id: String(item.id),
      name: String(item.name).trim(),
      age: Number(item.age),
      bio: String(item.bio || "").slice(0, 160),
      color: /^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : "#d9b8ff",
      gender: ["Man", "Woman", "Non-binary"].includes(item.gender) ? item.gender : "Man"
    });
  }
  if (!cleaned.length) return res.status(400).json({ error: "No valid adult personas found." });
  for (const p of cleaned) {
    const idx = profiles.findIndex(x => x.id === p.id);
    if (idx >= 0) profiles[idx] = p; else profiles.push(p);
  }
  for (const s of sessions.values()) {
    const visible = profiles.filter(p => {
      if (s.preference === "Men") return (p.gender || "Man") === "Man";
      if (s.preference === "Women") return (p.gender || "Man") === "Woman";
      return ["Man", "Woman"].includes(p.gender || "Man");
    });
    io.emit("profiles-updated", visible.map(publicProfile));
  }
  res.json({ ok: true, addedOrUpdated: cleaned.length, total: profiles.length, profiles: profiles.map(publicProfile) });
});

app.get("/api/owner/profiles", (req, res) => {
  if (!ownerOk(req)) return res.status(401).json({ error: "Owner authorization required." });
  res.json({ profiles: profiles.map(p => ({ ...p })) });
});
app.post("/api/owner/profiles", (req, res) => {
  if (!ownerOk(req)) return res.status(401).json({ error: "Owner authorization required." });
  const { id, name, age, bio, color, gender } = req.body || {};
  if (!id || !/^[a-z0-9_-]{2,24}$/i.test(id)) return res.status(400).json({ error: "Use a profile ID with 2–24 letters, numbers, _ or -." });
  if (!name || String(name).trim().length > 32) return res.status(400).json({ error: "Profile name is required (max 32 characters)." });
  if (!Number.isInteger(Number(age)) || Number(age) < 18) return res.status(400).json({ error: "Personas must be adults (18+)." });
  const p = { id, name: String(name).trim(), age: Number(age), bio: String(bio || "").slice(0, 160), color: /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#d9b8ff", gender: ["Man", "Woman", "Non-binary"].includes(gender) ? gender : "Man" };
  const idx = profiles.findIndex(x => x.id === id);
  if (idx >= 0) profiles[idx] = p; else profiles.push(p);
  for (const s of sessions.values()) {
    const visible = profiles.filter(p => {
      if (s.preference === "Men") return (p.gender || "Man") === "Man";
      if (s.preference === "Women") return (p.gender || "Man") === "Woman";
      return ["Man", "Woman"].includes(p.gender || "Man");
    });
    io.emit("profiles-updated", visible.map(publicProfile));
  }
  res.json({ ok: true, profiles: profiles.map(publicProfile) });
});
app.delete("/api/owner/profiles/:id", (req, res) => {
  if (!ownerOk(req)) return res.status(401).json({ error: "Owner authorization required." });
  if (profiles.length <= 1) return res.status(400).json({ error: "Keep at least one persona." });
  const idx = profiles.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Profile not found." });
  profiles.splice(idx, 1);
  for (const s of sessions.values()) {
    const visible = profiles.filter(p => {
      if (s.preference === "Men") return (p.gender || "Man") === "Man";
      if (s.preference === "Women") return (p.gender || "Man") === "Woman";
      return ["Man", "Woman"].includes(p.gender || "Man");
    });
    io.emit("profiles-updated", visible.map(publicProfile));
  }
  res.json({ ok: true });
});

io.use((socket, next) => {
  const sid = socket.handshake.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("ah_session="))?.split("=").slice(1).join("=");
  const session = sid ? sessions.get(decodeURIComponent(sid)) : null;
  if (!session) return next(new Error("Please enter through the private invite page."));
  socket.data.session = session;
  next();
});
io.on("connection", socket => {
  const session = socket.data.session;
  socket.join("session:" + session.sid);
  socket.emit("profiles", visibleProfilesFor(session));

  socket.on("join-profile", async ({ profileId } = {}) => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return socket.emit("chat-error", "That profile is not available.");
    if (session.activeProfile) socket.leave(session.activeProfile);
    session.activeProfile = profileId;
    socket.join(profileId);
    if (db) {
      try {
        const history = await loadMessages(profileId, 100);
        rooms.set(profileId, history || []);
      } catch (err) {
        console.error("Could not load chat history:", err.message);
        return socket.emit("chat-error", "Chat history could not be loaded. Please try again shortly.");
      }
    }
    if (!rooms.has(profileId)) rooms.set(profileId, []);
    socket.emit("history", rooms.get(profileId).slice(-100));
    socket.emit("joined-profile", publicProfile(profile));
  });

  socket.on("send-message", async ({ profileId, text, image } = {}) => {
    const body = typeof text === "string" ? text.trim() : "";
    const safeImage = typeof image === "string" && image.length <= 900_000 &&
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image) ? image : "";
    if ((!body && !safeImage) || body.length > 2000) return;
    if (!session.activeProfile || profileId !== session.activeProfile) return;
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const message = {
      id: randomId(), from: "visitor", sender: session.name, sessionId: session.sid,
      profileId, text: body, ...(safeImage ? { image: safeImage } : {}), timestamp: Date.now()
    };
    try {
      await saveMessage(message);
    } catch (err) {
      console.error("Could not save visitor message:", err.message);
      return socket.emit("chat-error", "Message was not saved. Please try sending it again.");
    }
    try {
      await saveMessage(message);
    } catch (err) {
      console.error("Could not save owner reply:", err.message);
      return socket.emit("chat-error", "Reply was not saved. Please try sending it again.");
    }
    if (!rooms.has(profileId)) rooms.set(profileId, []);
    rooms.get(profileId).push(message);
    if (rooms.get(profileId).length > 300) rooms.get(profileId).shift();
    io.to(profileId).emit("message", message);
    // Owner console receives the visitor message so the owner can reply as a selected persona.
    io.to("owner-console").emit("owner-inbox", message);
    void emailVisitorMessage(message, profile);
  });

  socket.on("owner-auth", ({ token } = {}) => {
    if (!safeEqual(token, OWNER_TOKEN)) return socket.emit("owner-auth-result", { ok: false });
    socket.join("owner-console");
    socket.emit("owner-auth-result", { ok: true, profiles: profiles.map(publicProfile) });
  });

  socket.on("owner-join-profile", async ({ profileId, token } = {}) => {
    if (!safeEqual(token, OWNER_TOKEN)) return;
    if (!profiles.some(p => p.id === profileId)) return;
    socket.join("owner:" + profileId);
    if (db) {
      try {
        const history = await loadMessages(profileId, 100);
        rooms.set(profileId, history || []);
      } catch (err) {
        console.error("Could not load owner chat history:", err.message);
        return socket.emit("chat-error", "Chat history could not be loaded. Please try again shortly.");
      }
    }
    socket.emit("owner-history", { profileId, messages: (rooms.get(profileId) || []).slice(-100) });
  });

  socket.on("owner-reply", async ({ profileId, text, image, personaName, token } = {}) => {
    if (!safeEqual(token, OWNER_TOKEN)) return;
    const body = typeof text === "string" ? text.trim() : "";
    const safeImage = typeof image === "string" && image.length <= 900_000 &&
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image) ? image : "";
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || (!body && !safeImage) || body.length > 2000) return;
    const message = {
      id: randomId(), from: "persona", sender: profile.name,
      profileId, text: body, ...(safeImage ? { image: safeImage } : {}), timestamp: Date.now()
    };
    if (!rooms.has(profileId)) rooms.set(profileId, []);
    rooms.get(profileId).push(message);
    if (rooms.get(profileId).length > 300) rooms.get(profileId).shift();
    io.to(profileId).emit("message", message);
    io.to("owner-console").emit("owner-inbox", message);
  });

  socket.on("disconnect", () => {});
});

server.listen(PORT, () => console.log(`AfterHours running on http://localhost:${PORT}`));
