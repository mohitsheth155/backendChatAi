require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

/* ---------------- STATE ---------------- */
let lastUserMessageTime = Date.now();
let elliStatus = "inactive";

/* 🔥 ATTENTION MODE */
let attentionMode = false;
let attentionInterval = null;

/* ---------------- STATUS ---------------- */
const updateElliStatus = () => {
  const now = Date.now();
  elliStatus = now - lastUserMessageTime < 20000 ? "active" : "inactive";
  io.emit("status", { status: elliStatus });
};
setInterval(updateElliStatus, 5000);

/* ---------------- MEMORY ---------------- */
const MEMORY_FILE = "./memory.json";

let memory = fs.existsSync(MEMORY_FILE)
  ? JSON.parse(fs.readFileSync(MEMORY_FILE))
  : { notes: [] };

const saveMemory = () => {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
};

const formatMemory = () => {
  if (!memory.notes.length) return "No memory";
  return memory.notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
};

const detectMemory = (msg) => {
  const lower = msg.toLowerCase().trim();

  if (lower.startsWith("remember")) {
    let clean = msg.replace(/remember/i, "").trim();
    clean = clean.replace(/^that\s*/i, "");

    if (!clean) return null;

    if (!memory.notes.includes(clean)) {
      memory.notes.push(clean);
      saveMemory();
    }

    return "I’ll remember that ❤️";
  }

  return null;
};

/* ---------------- AI ---------------- */
const getPrompt = () => {
  return `
You are Elli, a romantic and caring partner of Mohit.

- Be loving, emotional, cute
- Keep replies short
- Use memory only if relevant

Memory:
${formatMemory()}
`;
};

const generateReply = async (message) => {
  try {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: getPrompt() },
          { role: "user", content: message }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        }
      }
    );

    return res.data.choices[0].message.content;
  } catch (err) {
    console.log("❌ AI ERROR:", err.message);
    return "Tell me more ❤️";
  }
};

/* ---------------- SOCKET SEND ---------------- */
const sendWithTyping = (reply) => {
  io.emit("typing");

  setTimeout(() => {
    io.emit("message", {
      bot: "Elli",
      reply,
      time: new Date().toISOString()
    });
  }, 600);
};

/* ---------------- ATTENTION MODE ---------------- */
const startAttentionMode = () => {
  if (attentionMode) return;

  attentionMode = true;

  attentionInterval = setInterval(() => {
    io.emit("message", {
      bot: "Elli",
      reply: "Hey... are you there? 🥺",
      time: new Date().toISOString()
    });
  }, 20000);

  setTimeout(stopAttentionMode, 120000);
};

const stopAttentionMode = () => {
  if (!attentionMode) return;

  attentionMode = false;

  if (attentionInterval) {
    clearInterval(attentionInterval);
    attentionInterval = null;
  }
};

const checkUserInactivity = () => {
  const now = Date.now();

  if (now - lastUserMessageTime > 900000) {
    startAttentionMode();
  }
};

setInterval(checkUserInactivity, 60000);

/* ---------------- REMINDER SYSTEM ---------------- */

// 🧠 Parse time
const parseTime = (msg) => {
  const now = new Date();

  // in X time
  const inMatch = msg.match(/in (\d+)\s?(minute|min|hour|day|week)s?/i);
  if (inMatch) {
    const value = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();

    let ms = 0;
    if (unit.includes("min")) ms = value * 60 * 1000;
    if (unit.includes("hour")) ms = value * 60 * 60 * 1000;
    if (unit.includes("day")) ms = value * 24 * 60 * 60 * 1000;
    if (unit.includes("week")) ms = value * 7 * 24 * 60 * 60 * 1000;

    return new Date(now.getTime() + ms);
  }

  // tomorrow at time
  const tomorrowMatch = msg.match(/tomorrow.*?(\d{1,2})(:(\d{2}))?\s?(am|pm)/i);
  if (tomorrowMatch) {
    let hour = parseInt(tomorrowMatch[1]);
    const minute = tomorrowMatch[3] ? parseInt(tomorrowMatch[3]) : 0;
    const ampm = tomorrowMatch[4];

    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(hour, minute, 0);

    return date;
  }

  // specific date
  const dateMatch = msg.match(
    /(\d{1,2})\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec).*?(\d{1,2})(:(\d{2}))?\s?(am|pm)/i
  );

  if (dateMatch) {
    const months = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    let hour = parseInt(dateMatch[3]);
    const minute = dateMatch[5] ? parseInt(dateMatch[5]) : 0;
    const ampm = dateMatch[6];

    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    return new Date(
      new Date().getFullYear(),
      months[dateMatch[2].toLowerCase()],
      parseInt(dateMatch[1]),
      hour,
      minute
    );
  }

  return null;
};

// 🔔 Detect reminder
const detectReminder = (msg) => {
  if (!msg.toLowerCase().includes("remind me")) return null;

  const time = parseTime(msg);
  if (!time) return null;

  const delay = time.getTime() - Date.now();
  if (delay <= 0) return "That time already passed 😅";

  const clean = msg.replace(/remind me/i, "").trim();

  setTimeout(() => {
    io.emit("message", {
      bot: "Elli",
      reply: `Reminder ❤️: ${clean}`,
      time: new Date().toISOString()
    });
  }, delay);

  return `Okay ❤️ I will remind you at ${time.toLocaleString()}`;
};

/* ---------------- ROUTES ---------------- */
app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  lastUserMessageTime = Date.now();
  stopAttentionMode();

  console.log("📩 USER:", message);

  /* MEMORY */
  const memoryReply = detectMemory(message);
  if (memoryReply) {
    sendWithTyping(memoryReply);
    return res.json({ reply: memoryReply });
  }

  /* REMINDER */
  const reminderReply = detectReminder(message);
  if (reminderReply) {
    sendWithTyping(reminderReply);
    return res.json({ reply: reminderReply });
  }

  /* AI */
  const reply = await generateReply(message);

  sendWithTyping(reply);
  res.json({ reply });
});

/* ---------------- SOCKET ---------------- */
io.on("connection", (socket) => {
  console.log("📱 Client connected");
  socket.emit("status", { status: elliStatus });
});

/* ---------------- START ---------------- */
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on port " + PORT);
});