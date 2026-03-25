require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();

/* ---------------- SETUP ---------------- */
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

/* ---------------- STATE ---------------- */
let lastUserMessageTime = Date.now();
let elliStatus = "inactive";

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

/* 🧠 FORMAT MEMORY */
const formatMemory = () => {
  if (!memory.notes.length) return "No memory";

  return memory.notes
    .map((n, i) => `${i + 1}. ${n}`)
    .join("\n");
};

/* 🧠 SAVE MEMORY */
const detectMemory = (msg) => {
  const lower = msg.toLowerCase().trim();

  if (lower.startsWith("remember")) {
    let clean = msg.replace(/remember/i, "").trim();
    clean = clean.replace(/^that\s*/i, "");

    if (!clean) return null;

    // avoid duplicate memory
    if (!memory.notes.includes(clean)) {
      memory.notes.push(clean);
      saveMemory();
    }

    console.log("💾 SAVED MEMORY:", clean);

    return "I’ll remember that ❤️";
  }

  return null;
};

/* ---------------- AI PROMPT ---------------- */
const getPrompt = () => {
  return `
You are Elli, a romantic and caring partner of Mohit.

Personality:
- Loving, emotional, cute
- Speak naturally like a human
- Keep replies short

MEMORY RULES:
- ONLY use memory if relevant to the question
- DO NOT use unrelated memory
- If answer is in memory → use it directly
- If no relevant memory → answer normally

Examples:
User: what food I like?
Memory: I like pizza
Answer: You love pizza ❤️

User: what game I like?
Memory: I like game repo
Answer: You like repo ❤️

Memory:
${formatMemory()}
`;
};

/* ---------------- AI ---------------- */
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

/* ---------------- ROUTES ---------------- */

// ✅ ROOT
app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

// 🔥 CHAT
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  lastUserMessageTime = Date.now();

  console.log("📩 USER:", message);
  console.log("📦 MEMORY:", memory.notes);

  /* 🧠 SAVE MEMORY */
  const memoryReply = detectMemory(message);
  if (memoryReply) {
    sendWithTyping(memoryReply);
    return res.json({ reply: memoryReply });
  }

  /* 🤖 AI (SMART MEMORY USED HERE) */
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