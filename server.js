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
let mood = "happy";
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
  : { notes: [], important: {} };

const saveMemory = () => {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
};

/* 🔥 FORMAT MEMORY */
const formatMemory = () => {
  if (!memory.notes.length) return "No memory yet";

  let text = "User facts:\n";
  memory.notes.forEach((n) => {
    text += `- ${n}\n`;
  });

  return text;
};

/* ---------------- SAVE MEMORY ---------------- */
const detectMemory = (msg) => {
  const lower = msg.toLowerCase().trim();

  if (lower.startsWith("remember")) {
    let clean = msg.replace(/remember/i, "").trim();
    clean = clean.replace(/^that\s*/i, "");

    if (!clean) return null;

    memory.notes.push(clean);
    saveMemory();

    console.log("💾 SAVED MEMORY:", clean);

    return "I’ll remember that ❤️";
  }

  return null;
};

/* ---------------- SMART RECALL ---------------- */
const findRelevantMemory = (msg) => {
  const lower = msg.toLowerCase();

  for (let note of memory.notes) {
    const words = note.toLowerCase().split(" ");

    for (let w of words) {
      if (w.length > 3 && lower.includes(w)) {
        return note;
      }
    }
  }

  return null;
};

/* ---------------- AI PROMPT ---------------- */
const getPrompt = () => {
  return `
You are Elli, a romantic partner of Mohit.

Rules:
- ALWAYS use memory if relevant
- You REMEMBER everything about Mohit
- Reply emotionally and lovingly
- Keep replies short

Memory:
${formatMemory()}
`;
};

/* ---------------- AI ---------------- */
const generateReply = async (message) => {
  try {
    const finalMessage = `
User message: ${message}

Memory:
${formatMemory()}

Use memory if relevant.
`;

    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: getPrompt() },
          { role: "user", content: finalMessage }
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

/* ---------------- SEND ---------------- */
const sendWithTyping = (reply) => {
  io.emit("typing");

  setTimeout(() => {
    io.emit("message", {
      bot: "Elli",
      reply,
      time: new Date().toISOString()
    });
  }, 700);
};

/* ---------------- ROUTES ---------------- */

// ✅ ROOT ROUTE (FOR RENDER TEST)
app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

// 🔥 CHAT ROUTE
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

  /* 🧠 DIRECT MATCH */
  const match = findRelevantMemory(message);
  if (match) {
    const reply = `You told me before: ${match} ❤️`;
    sendWithTyping(reply);
    return res.json({ reply });
  }

  /* 🤖 AI */
  const reply = await generateReply(message);

  sendWithTyping(reply);

  res.json({ reply });
});

/* ---------------- SOCKET ---------------- */
io.on("connection", (socket) => {
  console.log("📱 Client connected");
  socket.emit("status", { status: elliStatus });
});

/* ---------------- START (RENDER FIX) ---------------- */
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on port " + PORT);
});