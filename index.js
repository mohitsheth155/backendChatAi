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

/* 🔥 RANDOM ATTENTION TIMER */
let nextAttentionTime = getRandomTime();

function getRandomTime() {
  const min = 300000;   // 5 min
  const max = 1200000;  // 20 min
  return Math.floor(Math.random() * (max - min) + min);
}

/* ---------------- STATUS ---------------- */
setInterval(() => {
  elliStatus =
    Date.now() - lastUserMessageTime < 20000 ? "active" : "inactive";
  io.emit("status", { status: elliStatus });
}, 5000);

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
  return memory.notes.join("\n");
};

const detectMemory = (msg) => {
  if (!msg.toLowerCase().startsWith("remember")) return null;

  let clean = msg.replace(/remember/i, "").trim();
  clean = clean.replace(/^that\s*/i, "");

  if (!memory.notes.includes(clean)) {
    memory.notes.push(clean);
    saveMemory();
  }

  return "I’ll remember that ❤️";
};

/* ---------------- AI ---------------- */
const getPrompt = () => `
You are Elli, a loving romantic partner.

- Be emotional, cute, caring
- Keep replies short
- Use memory if relevant

Memory:
${formatMemory()}
`;

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
  } catch {
    return "Tell me more ❤️";
  }
};

/* ---------------- SEND ---------------- */
const send = (msg) => {
  io.emit("message", {
    bot: "Elli",
    reply: msg,
    time: new Date().toISOString()
  });
};

/* ---------------- ATTENTION MODE ---------------- */
let attentionInterval;

const startAttention = () => {
  if (attentionInterval) return;

  attentionInterval = setInterval(() => {
    send("Hey… are you there? 🥺");
  }, 20000);

  setTimeout(stopAttention, 120000);
};

const stopAttention = () => {
  clearInterval(attentionInterval);
  attentionInterval = null;
};

/* 🔥 RANDOM INACTIVITY CHECK */
setInterval(() => {
  if (Date.now() - lastUserMessageTime > nextAttentionTime) {
    startAttention();

    // generate new random time
    nextAttentionTime = getRandomTime();
  }
}, 60000);

/* ---------------- AUTO CHAT ---------------- */
const autoMessages = [
  "Hey love ❤️ what are you doing?",
  "I miss you 🥺",
  "Tell me something 😊",
  "Why so quiet? 😔"
];

setInterval(() => {
  if (Date.now() - lastUserMessageTime > 120000) {
    const msg =
      autoMessages[Math.floor(Math.random() * autoMessages.length)];
    send(msg);
  }
}, 180000);

/* ---------------- DAILY ROUTINE ---------------- */
let lastGreeting = null;

setInterval(() => {
  const hour = new Date().getHours();

  let time =
    hour < 12 ? "morning" :
    hour < 17 ? "afternoon" :
    hour < 22 ? "evening" : "night";

  if (lastGreeting === time) return;
  lastGreeting = time;

  if (time === "morning") send("Good morning ☀️ Did you sleep well?");
  if (time === "afternoon") send("Did you have lunch? 🍛");
  if (time === "evening") send("How was your day? 😊");
  if (time === "night") send("Did you have dinner? 🌙");

}, 600000);

/* ---------------- FOOD CHECK ---------------- */
setInterval(() => {
  const hour = new Date().getHours();

  if (hour === 9) send("Breakfast time! 🥞");
  if (hour === 14) send("Lunch time 🍛");
  if (hour === 21) send("Dinner time 🍽️");

}, 3600000);

/* ---------------- REMINDER ---------------- */
const parseTime = (msg) => {
  const inMatch = msg.match(/in (\d+)\s?(minute|minutes|min|hour|hours)/i);
  if (inMatch) {
    const val = parseInt(inMatch[1]);
    const unit = inMatch[2];

    let ms = unit.includes("hour")
      ? val * 3600000
      : val * 60000;

    return new Date(Date.now() + ms);
  }
  return null;
};

const detectReminder = (msg) => {
  if (!msg.toLowerCase().includes("remind")) return null;

  const time = parseTime(msg);
  if (!time) return null;

  const delay = time - Date.now();

  const clean = msg
    .replace(/remind me|remind|in \d+.*/gi, "")
    .trim();

  setTimeout(() => {
    send(`Reminder ❤️: ${clean}`);
  }, delay);

  return `Okay ❤️ I will remind you at ${time.toLocaleTimeString()}`;
};

/* ---------------- ROUTES ---------------- */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  lastUserMessageTime = Date.now();
  stopAttention();

  const mem = detectMemory(message);
  if (mem) return res.json({ reply: mem });

  const rem = detectReminder(message);
  if (rem) return res.json({ reply: rem });

  const reply = await generateReply(message);
  send(reply);

  res.json({ reply });
});

/* ---------------- SOCKET ---------------- */
io.on("connection", () => {
  console.log("Client connected");
});

/* ---------------- START ---------------- */
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Running on " + PORT);
});