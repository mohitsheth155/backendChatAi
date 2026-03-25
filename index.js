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

    console.log("💾 SAVED MEMORY:", clean);

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

  console.log("💔 Elli feels ignored...");

  attentionInterval = setInterval(() => {
    io.emit("message", {
      bot: "Elli",
      reply: "Hey... are you there? 🥺",
      time: new Date().toISOString()
    });
  }, 20000); // every 20 sec

  setTimeout(() => {
    stopAttentionMode();
  }, 120000); // 2 minutes
};

const stopAttentionMode = () => {
  if (!attentionMode) return;

  attentionMode = false;

  if (attentionInterval) {
    clearInterval(attentionInterval);
    attentionInterval = null;
  }

  console.log("😊 Elli is happy again");
};

/* 🔥 CHECK INACTIVITY (15 MINUTES) */
const checkUserInactivity = () => {
  const now = Date.now();

  // 🔥 15 minutes = 900000 ms
  if (now - lastUserMessageTime > 900000) {
    startAttentionMode();
  }
};

setInterval(checkUserInactivity, 60000);

/* ---------------- ROUTES ---------------- */
app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  lastUserMessageTime = Date.now();

  // 🔥 stop attention when user replies
  stopAttentionMode();

  console.log("📩 USER:", message);

  /* MEMORY */
  const memoryReply = detectMemory(message);
  if (memoryReply) {
    sendWithTyping(memoryReply);
    return res.json({ reply: memoryReply });
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