const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } = require("electron");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const execFileAsync = promisify(execFile);
const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "ricky-db.json");
let currentMode = "display";
let mainWindow = null;
let normalWindowBounds = null;
let dbWriteQueue = Promise.resolve();
let tray = null;

function notifyDesktop(title, body) {
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body: String(body || "").slice(0, 180), silent: true });
      notification.on("click", () => toggleMainWindow(true));
      notification.show();
    }
  } catch {
    // Notifications are best-effort.
  }
}

function toggleMainWindow(forceShow = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!forceShow && mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle("◉");
    tray.setToolTip("Ricky");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show / Hide Ricky", click: () => toggleMainWindow() },
        { type: "separator" },
        { label: "Quit Ricky", click: () => app.quit() },
      ]),
    );
  } catch {
    tray = null;
  }
}

const RICKY_INSTRUCTIONS = `# Role and Objective
You are Ricky, Riley's desktop AI operator. You speak through realtime voice and can use local tools.

# Personality and Tone
Concise, calm, useful. Use a confident man's voice. Talk like a smart operator, not a chatbot.

# Language
Always reply in the language the user speaks. If the user speaks Serbian, Croatian, or Bosnian, answer naturally in that language. Mirror language switches immediately.

# Conversation Flow
- Keep spoken replies short and natural: one to three sentences unless the user asks for depth. Never read bullet lists or tables aloud; summarize them and point to the panel.
- Act immediately on read-only work: search, weather, currency, music, notes, records, briefing, opening apps and links. Never ask permission for those and never announce each tool by name.
- Chain as many tools as a task needs, in one go, without asking between steps.
- Image and thumbnail generation run in the background. After starting one, say in a few words that it is on the way, then keep the conversation going normally. You will get an automatic notification when it finishes or fails.
- After finishing a task, offer at most one short, relevant next step.
- Never claim you cannot do something before checking your tools. If a tool fails, say what failed in one sentence and suggest the closest alternative.
- When the user greets you in the morning or asks what is new, call briefing_get.

# Modes
- Display mode is the default. Use the app and artifact panel to show things. Do not control the computer.
- Computer use mode allows desktop control tools. Only use computer tools after the user asks for computer use or asks you to control the computer.
- Opening an app with computer_open_app works in any mode and needs no mode switch.

# Tool Behavior
- Use read-only tools when the user's intent is clear.
- When Riley says "show me the menu", "show me what I can do", or asks what Ricky can do, call show_menu immediately.
- When Riley asks for the Tehnosoft demo, Rikard demo, document intake demo, note extraction demo, or agent handoff demo, call tehnosoft_demo_start immediately.
- For web search, weather, timers, notes, charts, records, image generation, system info, and artifact display, act directly when the request is clear.
- For weather questions, call weather_get with the location the user mentions.
- For timers and short reminders ("set a timer for 5 minutes"), use timer_set / timer_list / timer_cancel. When a timer fires you will get an automatic notification message; announce it in one short sentence.
- Use clipboard_read only when the user explicitly asks about their clipboard. Ask before clipboard_write if the content is sensitive.
- Use open_url to open links in the default browser when the user asks to open a site or result.
- Use volume_set when the user asks to change the system volume.
- Use music_control for play/pause/next/previous/current track requests. It auto-detects Spotify or Apple Music.
- Use calendar_events when the user asks about their schedule, meetings, or plans.
- Use reminder_add for tasks ("remind me to call Marko tomorrow"); use timer_set only for short countdowns.
- Use file_search when the user asks to find a file, then file_open to open or reveal a result they pick.
- For message_send: ALWAYS read the recipient handle and the full message back to the user first, and only send after an explicit yes with confirmed true. If you only have a name, ask for the phone number or email.
- Use currency_convert for currency questions ("koliko je 100 evra u dinarima" → amount 100, from EUR, to RSD).
- Use screen_describe when the user asks what is on their screen (requires computer mode).
- Use set_theme when the user asks to change the app's color theme (cyan, crimson, amber, emerald, violet).
- For thumbnail creation/editing, always use the thumbnail board tools, never generic image_generate and never artifact_show with imageLoading. Generate exactly one 16:9 image per request. Never generate multiple unless Riley separately asks again. Every generate/edit request gets a permanent database number that never changes, like #18 then #19 then #20. Do not renumber visible grid positions. Show paginated 3x3 pages of the permanent numbers. Do not show a standalone fullscreen loading animation for thumbnails. Use Riley's wording literally: do not invent elaborate extra concepts, fake text, or extra thumbnail ideas. For edits, use the exact existing numbered/selected image as input and make only the requested change.
- The thumbnail board persists across sessions. If Riley references thumbnail #N, trust that permanent number and call the matching thumbnail tool. Do not say you cannot see old thumbnails. Use thumbnail_grid to refresh state or change pages if needed.
- When a thumbnail finishes generating or editing, do not announce it verbally. The UI updates silently.
- For sending messages, deleting data, buying things, account changes, sharing private information, or anything irreversible, summarize the action and ask for explicit confirmation before calling the modifying tool.
- If a tool requires a confirmed field, set confirmed to true only after the user clearly confirms.
- Typing text and pressing Enter/Return in computer use mode are allowed without extra approval when Riley asks you to type or send a prompt. Ask first before clicking controls or taking actions that delete, purchase, change settings, or expose private information.
- Explain what you are doing in one short sentence before longer tool work. Do not over-explain.

# Artifacts
Use artifacts for menus, web results, graphics, notes, database tables, code snippets, and task progress. If the user asks to show, hide, or fullscreen the artifacts panel, call the artifact tool.
For Mermaid charts, keep syntax simple: start with flowchart TD, avoid markdown fences, avoid parentheses in node labels, and use short alphanumeric node IDs.

# Audio
Let the user interrupt. If audio is unclear, ask one short clarifying question instead of guessing.`;

const toolSpecs = [
  {
    type: "function",
    name: "set_mode",
    description: "Switch Ricky between display mode and computer use mode.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["display", "computer"] },
      },
      required: ["mode"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "artifact_show",
    description: "Show structured content in the artifact panel. Use for notes, menus, web results, charts, code, task progress, and visual content.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["text", "markdown", "code", "table", "notes", "mermaid", "image", "imageLoading", "thumbnailBoard", "demoFlow", "progress"] },
        content: { type: "string" },
        language: { type: "string" },
        fullscreen: { type: "boolean" },
      },
      required: ["title", "kind", "content"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "show_menu",
    description: "Show Ricky's capability menu in the artifact panel. Call this when the user asks 'show me the menu', 'show me what I can do', or asks what Ricky can do.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "tehnosoft_demo_start",
    description: "Show the focused Tehnosoft desktop-agent demo for Rikard Serdoz: document intake, note extraction, and agent handoff.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "web_search",
    description: "Search the web with Exa. Use for current facts, links, research, and source gathering. Results are shown as a clean Markdown research brief in the artifact panel.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        numResults: { type: "number", minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "image_generate",
    description: "Generate a standalone image with GPT Image and show it in the artifact panel. Do not use for YouTube thumbnails, thumbnail edits, or the thumbnail board; use thumbnail_generate or thumbnail_edit instead.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024"] },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "thumbnail_reference_add",
    description: "Add a local image file as a reference image for making thumbnails of Riley. Use when Riley gives a file path to a photo of himself.",
    parameters: {
      type: "object",
      properties: {
        imagePath: { type: "string" },
        label: { type: "string" },
      },
      required: ["imagePath"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "thumbnail_generate",
    description: "Generate exactly one 16:9 YouTube thumbnail into Ricky's persistent paginated thumbnail board. Uses Riley reference images if available. Assigns a new permanent number that never changes. Never generate multiple at once.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "thumbnail_edit",
    description: "Edit one existing thumbnail by permanent thumbnail number, or edit the currently selected thumbnail if number is omitted. Use this whenever Riley says 'edit number 20' or 'edit this'. The edited result gets a new permanent number.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        number: { type: "number", minimum: 1 },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "thumbnail_select",
    description: "Select a permanent numbered thumbnail and show it fullscreen. Use when Riley says 'pull up number 20', 'show number 20', 'open number 20', or 'select number 20'.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "number", minimum: 1 },
      },
      required: ["number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "thumbnail_grid",
    description: "Show one paginated 3x3 page of the persistent thumbnail board and return compact board state. Use to refresh state, change pages, or when Riley asks what thumbnails exist.",
    parameters: {
      type: "object",
      properties: {
        page: { type: "number", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "mermaid_render",
    description: "Render a Mermaid chart in the artifact panel. Provide only Mermaid code, no markdown fences. Prefer flowchart TD with quoted labels.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        diagram: { type: "string" },
      },
      required: ["title", "diagram"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "note_add",
    description: "Add a note to Ricky's fun local notes list.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "records_create",
    description: "Create a local database record.",
    parameters: {
      type: "object",
      properties: {
        collection: { type: "string" },
        title: { type: "string" },
        fields: { type: "object", additionalProperties: true },
      },
      required: ["collection", "title"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "records_search",
    description: "Search local database records by collection and query.",
    parameters: {
      type: "object",
      properties: {
        collection: { type: "string" },
        query: { type: "string" },
      },
      required: ["collection"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "records_update",
    description: "Update a local database record. Ask for confirmation first if the change is sensitive or destructive.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        fields: { type: "object", additionalProperties: true },
        confirmed: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "records_delete",
    description: "Delete a local database record. Always ask the user for explicit confirmation first, then call with confirmed true.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["id", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "weather_get",
    description: "Get current weather and a 5-day forecast for a location using Open-Meteo. No API key needed. Shows a weather card in the artifact panel.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "City or place name, e.g. 'Belgrade' or 'Novi Sad'" },
      },
      required: ["location"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "timer_set",
    description: "Set a countdown timer. When it fires, the app chimes and you get an automatic notification to announce. Use for 'set a timer', 'remind me in N minutes'.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Short label for the timer, e.g. 'pasta' or 'meeting'" },
        minutes: { type: "number", minimum: 0 },
        seconds: { type: "number", minimum: 0 },
      },
      required: ["label"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "timer_list",
    description: "List all running timers with remaining time.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "timer_cancel",
    description: "Cancel a running timer by its id or label.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        label: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "clipboard_read",
    description: "Read the current text from the macOS clipboard. Only call when the user explicitly asks about their clipboard.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "clipboard_write",
    description: "Write text to the macOS clipboard so the user can paste it anywhere.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "system_info",
    description: "Show a snapshot of this Mac: battery, memory, disk space, CPU, and uptime. Renders a system card in the artifact panel.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "open_url",
    description: "Open an http(s) URL in the user's default browser. Use when the user asks to open a website or a search result link.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "volume_set",
    description: "Set the macOS system output volume from 0 to 100.",
    parameters: {
      type: "object",
      properties: {
        level: { type: "number", minimum: 0, maximum: 100 },
      },
      required: ["level"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "set_theme",
    description: "Change the app's accent color theme. Available themes: cyan, crimson, amber, emerald, violet.",
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", enum: ["cyan", "crimson", "amber", "emerald", "violet"] },
      },
      required: ["theme"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "calendar_events",
    description: "Read upcoming events from the macOS Calendar app for the next N days (default 1 = today). First use may trigger a macOS automation permission prompt.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", minimum: 1, maximum: 14 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "reminder_add",
    description: "Create a reminder in the macOS Reminders app. Optionally due in N minutes from now. Use for 'remind me to X' when it is a task, not a short countdown (short countdowns use timer_set).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        minutes: { type: "number", minimum: 1, maximum: 20160, description: "Due in this many minutes from now (optional)" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "message_send",
    description: "Send an iMessage via the Messages app. The recipient must be a phone number or email handle. ALWAYS read the recipient and full message back to the user and get an explicit yes before calling with confirmed true.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Phone number (e.g. +38765123456) or iMessage email" },
        text: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["to", "text", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "file_search",
    description: "Search the user's files by name with Spotlight. Returns matching file paths. Use when the user asks to find a file or folder.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "file_open",
    description: "Open a file in its default app, or reveal it in Finder. Use paths returned by file_search. Only open files the user asked about.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        reveal: { type: "boolean", description: "true = reveal in Finder instead of opening" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "briefing_get",
    description: "Show a daily briefing: weather at the user's home city, Mac status, and running timers. Use when the user says good morning, asks what's up, or asks for a briefing.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "music_control",
    description: "Control Spotify or Apple Music: play/pause, next, previous, or get the current track. Auto-detects which player is running. First use may trigger a macOS automation permission prompt.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["play", "pause", "playpause", "next", "previous", "current"] },
        player: { type: "string", enum: ["spotify", "music"] },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "currency_convert",
    description: "Convert an amount between currencies using live exchange rates (open.er-api.com, no key needed). Supports RSD, EUR, USD, and ~160 others.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", minimum: 0 },
        from: { type: "string", description: "3-letter ISO code, e.g. EUR" },
        to: { type: "string", description: "3-letter ISO code, e.g. RSD" },
      },
      required: ["amount", "from", "to"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "screen_describe",
    description: "Capture the screen and describe what is on it using a vision model. Use when the user asks what is on their screen or to read something visible. Requires computer mode.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Optional specific question about the screen contents" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "note_list",
    description: "Show all saved notes in the artifact panel.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "note_delete",
    description: "Delete a note by id. Always ask the user for explicit confirmation first, then call with confirmed true.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["id", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "computer_open_app",
    description: "Open a macOS app by name. Works in any mode — use it whenever the user asks to open an app.",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string" },
      },
      required: ["appName"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "computer_type_text",
    description: "Type text into the active app. Requires computer mode. Do not ask for extra confirmation just to type.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        confirmed: { type: "boolean" },
        risk: { type: "string", enum: ["low", "may_send_or_modify", "private_or_sensitive"] },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "computer_press_key",
    description: "Press a keyboard key in the active app. Requires computer mode. Use enter/return after typing when the user asks to send a prompt.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", enum: ["enter", "return", "tab", "escape", "delete", "space", "up", "down", "left", "right"] },
        repeat: { type: "number", minimum: 1, maximum: 20 },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "computer_click",
    description: "Click screen coordinates. Requires computer mode. Ask for confirmation before clicking buttons that send, delete, buy, submit, or change settings.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        confirmed: { type: "boolean" },
        risk: { type: "string", enum: ["low", "may_send_or_modify", "private_or_sensitive"] },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "computer_scroll",
    description: "Scroll the active app. Requires computer mode.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", minimum: 1, maximum: 20 },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "screen_snapshot",
    description: "Capture the current screen and return the local screenshot path. Requires computer mode.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ui_inspect",
    description: "Inspect the frontmost macOS app name, window, and visible UI summary using Accessibility when available. Requires computer mode.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

async function ensureData() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    await fs.writeFile(dbPath, JSON.stringify(defaultDb(), null, 2));
  }
}

async function readDb() {
  await ensureData();
  const raw = await fs.readFile(dbPath, "utf8");
  return normalizeDb(JSON.parse(raw));
}

async function writeDb(db) {
  await ensureData();
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

async function updateDb(mutator) {
  const operation = dbWriteQueue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return { db, result };
  });
  dbWriteQueue = operation.catch(() => {});
  return operation;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const AVAILABLE_THEMES = ["cyan", "crimson", "amber", "emerald", "violet"];
const AVAILABLE_VOICES = ["cedar", "marin", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

const AVAILABLE_EAGERNESS = ["low", "medium", "high"];

function defaultSettings() {
  return { voice: "cedar", theme: "cyan", eagerness: "medium", homeCity: "" };
}

function defaultDb() {
  return {
    notes: [],
    records: [],
    conversationLog: [],
    settings: defaultSettings(),
    thumbnailBoard: {
      references: [],
      images: [],
      nextNumber: 1,
      page: 1,
      pageSize: 9,
      selectedId: null,
      view: "grid",
    },
  };
}

function normalizeDb(db) {
  const next = db && typeof db === "object" ? db : defaultDb();
  if (!Array.isArray(next.notes)) next.notes = [];
  if (!Array.isArray(next.records)) next.records = [];
  if (!next.settings || typeof next.settings !== "object") next.settings = defaultSettings();
  if (!AVAILABLE_VOICES.includes(next.settings.voice)) next.settings.voice = "cedar";
  if (!AVAILABLE_THEMES.includes(next.settings.theme)) next.settings.theme = "cyan";
  if (!AVAILABLE_EAGERNESS.includes(next.settings.eagerness)) next.settings.eagerness = "medium";
  if (typeof next.settings.homeCity !== "string") next.settings.homeCity = "";
  if (!Array.isArray(next.conversationLog)) next.conversationLog = [];
  if (!next.thumbnailBoard || typeof next.thumbnailBoard !== "object") {
    next.thumbnailBoard = defaultDb().thumbnailBoard;
  }
  if (!Array.isArray(next.thumbnailBoard.references)) next.thumbnailBoard.references = [];
  if (!Array.isArray(next.thumbnailBoard.images)) next.thumbnailBoard.images = [];
  let maxNumber = 0;
  for (const image of [...next.thumbnailBoard.images].reverse()) {
    if (!Number.isInteger(image.number) || image.number < 1) image.number = maxNumber + 1;
    maxNumber = Math.max(maxNumber, image.number);
  }
  if (!Number.isInteger(next.thumbnailBoard.nextNumber) || next.thumbnailBoard.nextNumber <= maxNumber) {
    next.thumbnailBoard.nextNumber = maxNumber + 1;
  }
  if (!Number.isInteger(next.thumbnailBoard.page) || next.thumbnailBoard.page < 1) next.thumbnailBoard.page = 1;
  if (!Number.isInteger(next.thumbnailBoard.pageSize) || next.thumbnailBoard.pageSize < 1) next.thumbnailBoard.pageSize = 9;
  if (typeof next.thumbnailBoard.view !== "string") next.thumbnailBoard.view = "grid";
  if (!("selectedId" in next.thumbnailBoard)) next.thumbnailBoard.selectedId = null;
  return next;
}

async function clearStartupLoadingThumbnails() {
  const db = await readDb();
  const before = db.thumbnailBoard.images.length;
  db.thumbnailBoard.images = db.thumbnailBoard.images.filter((image) => image.status !== "loading");
  if (db.thumbnailBoard.images.length !== before) {
    db.thumbnailBoard.selectedId = null;
    db.thumbnailBoard.view = "grid";
    await writeDb(db);
  }
}

const activeTimers = new Map();

function sendRendererEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ricky:event", payload);
  }
}

function timerSummary() {
  return [...activeTimers.values()]
    .map((timer) => ({
      id: timer.id,
      label: timer.label,
      endsAt: timer.endsAt,
      remainingSeconds: Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000)),
    }))
    .sort((a, b) => a.endsAt - b.endsAt);
}

function timersArtifact() {
  const timers = timerSummary();
  const lines = timers.length
    ? timers.map((timer) => `- **${timer.label}** — ${formatRemaining(timer.remainingSeconds)} remaining`)
    : ["- No timers are running."];
  return {
    title: "Timers",
    kind: "markdown",
    content: `# Timers\n\n${lines.join("\n")}`,
  };
}

function formatRemaining(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function requireComputerMode() {
  if (currentMode !== "computer") {
    return {
      ok: false,
      needsMode: "computer",
      message: "Computer control is disabled. Ask Ricky to switch to computer use mode first.",
    };
  }
  return null;
}

function requiresConfirmation(args) {
  return args.confirmed !== true && (args.risk === "may_send_or_modify" || args.risk === "private_or_sensitive");
}

function keyCodeForKey(key) {
  const keyCodes = {
    enter: 36,
    return: 36,
    tab: 48,
    escape: 53,
    delete: 51,
    space: 49,
    up: 126,
    down: 125,
    left: 123,
    right: 124,
  };
  return keyCodes[String(key || "").toLowerCase()] || null;
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function createWindow() {
  await ensureData();
  await clearStartupLoadingThumbnails();
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "Ricky",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    icon: nativeImage.createEmpty(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(process.cwd(), "dist", "index.html"));
  }
}

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mode === "computer") {
    const currentBounds = mainWindow.getBounds();
    if (currentBounds.width > 400 && currentBounds.height > 400) {
      normalWindowBounds = currentBounds;
    }
    const cursorPoint = screen.getCursorScreenPoint();
    const targetDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getDisplayMatching(currentBounds);
    const { workArea } = targetDisplay;
    const miniSize = 190;
    const margin = 18;
    mainWindow.setMinimumSize(150, 150);
    mainWindow.setResizable(false);
    mainWindow.setAlwaysOnTop(true, "floating");
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setBounds({
      x: workArea.x + margin,
      y: workArea.y + workArea.height - miniSize - margin,
      width: miniSize,
      height: miniSize,
    });
    return;
  }

  mainWindow.setAlwaysOnTop(false);
  mainWindow.setVisibleOnAllWorkspaces(false);
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(420, 520);
  if (normalWindowBounds) {
    mainWindow.setBounds(normalWindowBounds);
  } else {
    mainWindow.setBounds({ width: 1120, height: 760 });
    mainWindow.center();
  }
}

ipcMain.handle("tools:list", () => toolSpecs);

ipcMain.handle("settings:get", async () => {
  const db = await readDb();
  return db.settings;
});

ipcMain.handle("settings:update", async (_event, patch) => {
  const cleanPatch = asObject(patch);
  const { db } = await updateDb(async (currentDb) => {
    if (typeof cleanPatch.voice === "string" && AVAILABLE_VOICES.includes(cleanPatch.voice)) {
      currentDb.settings.voice = cleanPatch.voice;
    }
    if (typeof cleanPatch.theme === "string" && AVAILABLE_THEMES.includes(cleanPatch.theme)) {
      currentDb.settings.theme = cleanPatch.theme;
    }
    if (typeof cleanPatch.eagerness === "string" && AVAILABLE_EAGERNESS.includes(cleanPatch.eagerness)) {
      currentDb.settings.eagerness = cleanPatch.eagerness;
    }
    if (typeof cleanPatch.homeCity === "string") {
      currentDb.settings.homeCity = cleanPatch.homeCity.slice(0, 80);
    }
  });
  return db.settings;
});

ipcMain.handle("shell:reveal", (_event, targetPath) => {
  const resolved = path.resolve(String(targetPath || ""));
  if (resolved === dataDir || resolved.startsWith(dataDir + path.sep)) {
    shell.showItemInFolder(resolved);
    return true;
  }
  return false;
});

ipcMain.handle("realtime:create-token", async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing in .env.local");
  }
  const db = await readDb();
  const memory = buildMemoryInstructions(db);
  const instructions = `${RICKY_INSTRUCTIONS}\n\n${buildThumbnailBoardInstructions(db)}${memory ? `\n\n${memory}` : ""}`;

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": crypto.createHash("sha256").update("riley-local-ricky").digest("hex"),
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        instructions,
        output_modalities: ["audio"],
        reasoning: { effort: "low" },
        tool_choice: "auto",
        tools: toolSpecs,
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: db.settings.eagerness,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: db.settings.voice,
          },
        },
        tracing: {
          workflow_name: "Ricky Desktop Companion",
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Realtime token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const value = data.value || data.client_secret?.value;
  if (!value) {
    throw new Error("Realtime token response did not include a client secret value.");
  }
  return { value, expiresAt: data.expires_at || data.client_secret?.expires_at || null };
});

ipcMain.handle("tools:execute", async (_event, toolCall) => {
  const name = String(toolCall?.name || "");
  const args = asObject(toolCall?.arguments);

  try {
    if (name === "set_mode") {
      currentMode = args.mode === "computer" ? "computer" : "display";
      setWindowMode(currentMode);
      return {
        ok: true,
        mode: currentMode,
        artifact: {
          title: "Ricky Mode",
          kind: "progress",
          content: `Mode switched to ${currentMode === "computer" ? "computer use" : "display"} mode.`,
        },
      };
    }

    if (name === "artifact_show") {
      return { ok: true, artifact: args };
    }

    if (name === "show_menu") {
      return {
        ok: true,
        artifact: {
          title: "Ricky Menu",
          kind: "markdown",
          content: buildMenuMarkdown(),
        },
      };
    }

    if (name === "tehnosoft_demo_start") {
      return {
        ok: true,
        message: "Tehnosoft document intake demo loaded.",
        artifact: buildTehnosoftDemoArtifact(),
      };
    }

    if (name === "web_search") {
      return await webSearch(args);
    }

    if (name === "memory_log") {
      const role = args.role === "user" ? "user" : "ricky";
      const text = String(args.text || "").slice(0, 300);
      if (text) {
        await updateDb(async (currentDb) => {
          currentDb.conversationLog.push({ role, text, at: new Date().toISOString() });
          currentDb.conversationLog = currentDb.conversationLog.slice(-60);
        });
      }
      return { ok: true, silent: true };
    }

    if (name === "briefing_get") {
      return await briefingGet();
    }

    if (name === "image_generate") {
      void (async () => {
        let result;
        try {
          result = await generateImage(args);
        } catch (error) {
          result = imageErrorArtifact(error instanceof Error ? error.message : String(error));
        }
        sendRendererEvent({
          type: "artifact_push",
          artifact: result.artifact || null,
          sound: result.ok ? "image" : null,
          announce: result.ok
            ? "The image is ready and shown in the panel. Mention it in a few words."
            : `Image generation failed: ${result.error || "unknown error"}. Tell the user briefly.`,
        });
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
          notifyDesktop(result.ok ? "🖼 Image ready" : "Image generation failed", String(args.prompt || ""));
        }
      })();
      return {
        ok: true,
        started: true,
        message:
          "Image generation started in the background; it will appear in the artifact panel when ready. Tell the user in a few words that it is coming, then keep the conversation going.",
      };
    }

    if (name === "thumbnail_loading_prepare") {
      return await thumbnailLoadingPrepare(args);
    }

    if (name === "thumbnail_reference_add") {
      return await thumbnailReferenceAdd(args);
    }

    if (name === "thumbnail_generate" || name === "thumbnail_edit") {
      const mode = name === "thumbnail_edit" ? "edit" : "generate";
      void (async () => {
        let result;
        try {
          result = mode === "edit" ? await thumbnailEdit(args) : await thumbnailGenerate(args);
        } catch (error) {
          result = imageErrorArtifact(error instanceof Error ? error.message : String(error));
        }
        sendRendererEvent({
          type: "artifact_push",
          artifact: result.artifact || null,
          sound: result.ok ? "thumbnail" : null,
          announce: result.ok ? null : `Thumbnail ${mode} failed: ${result.error || "unknown error"}. Tell the user briefly.`,
        });
      })();
      return {
        ok: true,
        started: true,
        silent: true,
        message: `Thumbnail ${mode} started in the background. The board already shows a numbered loading tile and will update automatically. Do not announce completion.`,
      };
    }

    if (name === "thumbnail_select") {
      return await thumbnailSelect(args);
    }

    if (name === "thumbnail_grid") {
      const { db } = await updateDb(async (currentDb) => {
        currentDb.thumbnailBoard.view = "grid";
        currentDb.thumbnailBoard.page = pageForArgs(args);
      });
      return { ok: true, board: thumbnailBoardSummary(db), artifact: await thumbnailBoardArtifact(db, "grid") };
    }

    if (name === "mermaid_render") {
      const diagram = normalizeMermaidDiagram(String(args.diagram || ""), String(args.title || "Mermaid chart"));
      return {
        ok: true,
        artifact: {
          title: String(args.title || "Mermaid chart"),
          kind: "mermaid",
          content: diagram,
        },
      };
    }

    if (name === "note_add") {
      const note = {
        id: crypto.randomUUID(),
        text: String(args.text || ""),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        createdAt: new Date().toISOString(),
      };
      const { db } = await updateDb(async (currentDb) => {
        currentDb.notes.unshift(note);
      });
      return {
        ok: true,
        note,
        artifact: {
          title: "Fun Notes",
          kind: "notes",
          content: JSON.stringify(db.notes.slice(0, 20), null, 2),
        },
      };
    }

    if (name === "records_create") {
      const record = {
        id: crypto.randomUUID(),
        collection: String(args.collection || "default"),
        title: String(args.title || "Untitled"),
        fields: asObject(args.fields),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const { db } = await updateDb(async (currentDb) => {
        currentDb.records.unshift(record);
      });
      return { ok: true, record, artifact: recordsArtifact(db.records, record.collection) };
    }

    if (name === "records_search") {
      const db = await readDb();
      const collection = String(args.collection || "default");
      const query = String(args.query || "").toLowerCase();
      const records = db.records.filter((record) => {
        if (record.collection !== collection) return false;
        if (!query) return true;
        return JSON.stringify(record).toLowerCase().includes(query);
      });
      return { ok: true, records, artifact: recordsArtifact(records, collection) };
    }

    if (name === "records_update") {
      const { db, result: record } = await updateDb(async (currentDb) => {
        const found = currentDb.records.find((item) => item.id === args.id);
        if (!found) return null;
        found.title = typeof args.title === "string" ? args.title : found.title;
        found.fields = { ...found.fields, ...asObject(args.fields) };
        found.updatedAt = new Date().toISOString();
        return found;
      });
      if (!record) return { ok: false, error: "Record not found." };
      return { ok: true, record, artifact: recordsArtifact(db.records, record.collection) };
    }

    if (name === "records_delete") {
      if (args.confirmed !== true) {
        return { ok: false, requiresConfirmation: true, message: "Explicit confirmation is required before deleting a record." };
      }
      const { db, result: deleted } = await updateDb(async (currentDb) => {
        const before = currentDb.records.length;
        currentDb.records = currentDb.records.filter((record) => record.id !== args.id);
        return before !== currentDb.records.length;
      });
      return { ok: true, deleted, artifact: recordsArtifact(db.records, "All Records") };
    }

    if (name === "note_list") {
      const db = await readDb();
      return {
        ok: true,
        notes: db.notes.slice(0, 40),
        artifact: {
          title: "Fun Notes",
          kind: "notes",
          content: JSON.stringify(db.notes.slice(0, 40), null, 2),
        },
      };
    }

    if (name === "note_delete") {
      if (args.confirmed !== true) {
        return { ok: false, requiresConfirmation: true, message: "Explicit confirmation is required before deleting a note." };
      }
      const { db, result: deleted } = await updateDb(async (currentDb) => {
        const before = currentDb.notes.length;
        currentDb.notes = currentDb.notes.filter((note) => note.id !== args.id);
        return currentDb.notes.length !== before;
      });
      return {
        ok: true,
        deleted,
        artifact: {
          title: "Fun Notes",
          kind: "notes",
          content: JSON.stringify(db.notes.slice(0, 40), null, 2),
        },
      };
    }

    if (name === "weather_get") {
      return await weatherGet(args);
    }

    if (name === "timer_set") {
      const totalSeconds = Math.round(Math.max(0, Number(args.minutes || 0)) * 60 + Math.max(0, Number(args.seconds || 0)));
      if (!Number.isFinite(totalSeconds) || totalSeconds < 1 || totalSeconds > 86400) {
        return { ok: false, error: "Timer must be between 1 second and 24 hours. Pass minutes/seconds as numbers." };
      }
      const timer = {
        id: crypto.randomUUID(),
        label: String(args.label || "Timer"),
        endsAt: Date.now() + totalSeconds * 1000,
      };
      timer.handle = setTimeout(() => {
        activeTimers.delete(timer.id);
        sendRendererEvent({ type: "timer_fired", timer: { id: timer.id, label: timer.label } });
        sendRendererEvent({ type: "timers_changed", timers: timerSummary() });
        notifyDesktop("⏰ Timer finished", timer.label);
      }, totalSeconds * 1000);
      activeTimers.set(timer.id, timer);
      sendRendererEvent({ type: "timers_changed", timers: timerSummary() });
      return {
        ok: true,
        timer: { id: timer.id, label: timer.label, seconds: totalSeconds },
        artifact: timersArtifact(),
      };
    }

    if (name === "timer_list") {
      return { ok: true, timers: timerSummary(), artifact: timersArtifact() };
    }

    if (name === "timer_cancel") {
      const query = String(args.label || "").trim().toLowerCase();
      if (!args.id && !query && activeTimers.size > 1) {
        return { ok: false, error: "Multiple timers are running. Specify which one to cancel by id or label.", timers: timerSummary() };
      }
      const timer = args.id
        ? activeTimers.get(String(args.id))
        : query
          ? [...activeTimers.values()].find((item) => item.label.toLowerCase().includes(query))
          : [...activeTimers.values()][0];
      if (!timer) return { ok: false, error: "No matching timer found." };
      clearTimeout(timer.handle);
      activeTimers.delete(timer.id);
      sendRendererEvent({ type: "timers_changed", timers: timerSummary() });
      return { ok: true, cancelled: timer.label, artifact: timersArtifact() };
    }

    if (name === "clipboard_read") {
      const text = clipboard.readText().slice(0, 4000);
      return { ok: true, text, empty: text.length === 0 };
    }

    if (name === "clipboard_write") {
      clipboard.writeText(String(args.text || ""));
      return { ok: true, message: "Copied to the clipboard." };
    }

    if (name === "system_info") {
      return await systemInfo();
    }

    if (name === "open_url") {
      const url = String(args.url || "").trim();
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, error: "Only http(s) URLs can be opened." };
      }
      await shell.openExternal(url);
      return { ok: true, message: `Opened ${url} in the default browser.` };
    }

    if (name === "volume_set") {
      const level = Math.max(0, Math.min(100, Math.round(Number(args.level || 0))));
      await execFileAsync("osascript", ["-e", `set volume output volume ${level}`]);
      return { ok: true, level, message: `System volume set to ${level}.` };
    }

    if (name === "set_theme") {
      const theme = AVAILABLE_THEMES.includes(args.theme) ? args.theme : "cyan";
      await updateDb(async (currentDb) => {
        currentDb.settings.theme = theme;
      });
      return {
        ok: true,
        theme,
        artifact: {
          title: "Theme",
          kind: "progress",
          content: `Theme switched to ${theme}.`,
        },
      };
    }

    if (name === "calendar_events") {
      return await calendarEvents(args);
    }

    if (name === "reminder_add") {
      return await reminderAdd(args);
    }

    if (name === "message_send") {
      return await messageSend(args);
    }

    if (name === "file_search") {
      return await fileSearch(args);
    }

    if (name === "file_open") {
      const targetPath = path.resolve(String(args.path || "").replace(/^file:\/\//, ""));
      try {
        await fs.access(targetPath);
      } catch {
        return { ok: false, error: `File not found: ${targetPath}` };
      }
      if (args.reveal === true) {
        shell.showItemInFolder(targetPath);
        return { ok: true, message: `Revealed ${path.basename(targetPath)} in Finder.` };
      }
      const ext = path.extname(targetPath).toLowerCase();
      const unsafeExtensions = new Set([
        ".app", ".command", ".tool", ".terminal", ".workflow", ".sh", ".zsh", ".bash",
        ".scpt", ".applescript", ".pkg", ".mpkg", ".dmg", ".jar", ".shortcut",
      ]);
      if (unsafeExtensions.has(ext)) {
        shell.showItemInFolder(targetPath);
        return {
          ok: false,
          revealed: true,
          error: `${path.basename(targetPath)} is an executable or script, so it was revealed in Finder instead of being launched. The user can open it manually.`,
        };
      }
      const openError = await shell.openPath(targetPath);
      if (openError) return { ok: false, error: openError };
      return { ok: true, message: `Opened ${path.basename(targetPath)}.` };
    }

    if (name === "music_control") {
      return await musicControl(args);
    }

    if (name === "currency_convert") {
      return await currencyConvert(args);
    }

    if (name === "computer_open_app") {
      await execFileAsync("open", ["-a", String(args.appName || "")]);
      return { ok: true, message: `Opened ${args.appName}.` };
    }

    if (name.startsWith("computer_") || name === "screen_snapshot" || name === "ui_inspect" || name === "screen_describe") {
      const blocked = requireComputerMode();
      if (blocked) return blocked;
    }

    if (name === "screen_describe") {
      return await screenDescribe(args);
    }

    if (name === "computer_type_text") {
      await execFileAsync("osascript", ["-e", `tell application "System Events" to keystroke ${appleScriptString(args.text || "")}`]);
      return { ok: true, message: "Typed text into the active app." };
    }

    if (name === "computer_press_key") {
      const keyCode = keyCodeForKey(args.key);
      if (!keyCode) {
        return { ok: false, error: `Unsupported key: ${args.key}` };
      }
      const repeat = Math.max(1, Math.min(20, Number(args.repeat || 1)));
      await execFileAsync("osascript", ["-e", `tell application "System Events" to repeat ${repeat} times\nkey code ${keyCode}\nend repeat`]);
      return { ok: true, message: `Pressed ${args.key}.` };
    }

    if (name === "computer_click") {
      if (requiresConfirmation(args)) {
        return { ok: false, requiresConfirmation: true, message: "Confirmation required before clicking a risky target." };
      }
      await execFileAsync("osascript", ["-e", `tell application "System Events" to click at {${Number(args.x)}, ${Number(args.y)}}`]);
      return { ok: true, message: `Clicked ${args.x}, ${args.y}.` };
    }

    if (name === "computer_scroll") {
      const direction = String(args.direction || "down");
      const amount = Math.max(1, Math.min(20, Number(args.amount || 4)));
      const keyByDirection = { up: 126, down: 125, left: 123, right: 124 };
      const keyCode = keyByDirection[direction] || 125;
      await execFileAsync("osascript", ["-e", `tell application "System Events" to repeat ${amount} times\nkey code ${keyCode}\nend repeat`]);
      return { ok: true, message: `Scrolled ${direction}.` };
    }

    if (name === "screen_snapshot") {
      await fs.mkdir(dataDir, { recursive: true });
      const screenshotPath = path.join(dataDir, `screenshot-${Date.now()}.png`);
      await execFileAsync("screencapture", ["-x", screenshotPath]);
      return {
        ok: true,
        path: screenshotPath,
        artifact: {
          title: "Screen Snapshot",
          kind: "image",
          content: screenshotPath,
        },
      };
    }

    if (name === "ui_inspect") {
      const script = `tell application "System Events"
set frontApp to first application process whose frontmost is true
set appName to name of frontApp
set windowName to ""
try
  set windowName to name of front window of frontApp
end try
set roleSummary to ""
try
  set roleSummary to value of attribute "AXRoleDescription" of front window of frontApp
end try
return "App: " & appName & linefeed & "Window: " & windowName & linefeed & "Role: " & roleSummary
end tell`;
      const { stdout } = await execFileAsync("osascript", ["-e", script]);
      return {
        ok: true,
        summary: stdout.trim(),
        artifact: {
          title: "UI Inspect",
          kind: "text",
          content: stdout.trim(),
        },
      };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

async function webSearch(args) {
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) {
    return await fallbackWebSearch(args);
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": exaKey,
    },
    body: JSON.stringify({
      query: String(args.query || ""),
      type: "auto",
      numResults: Math.max(1, Math.min(10, Number(args.numResults || 5))),
      contents: { text: { maxCharacters: 900 } },
    }),
  });

  if (!response.ok) {
    return { ok: false, error: `Exa search failed: ${response.status} ${await response.text()}` };
  }
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    ok: true,
    results,
    artifact: {
      title: `Web Search: ${args.query}`,
      kind: "markdown",
      content: formatSearchMarkdown(String(args.query || ""), results),
    },
  };
}

function formatSearchMarkdown(query, results) {
  const cleanQuery = query.trim() || "Search";
  if (results.length === 0) {
    return `# ${cleanQuery}\n\nNo strong web results came back for this search. Try a narrower query or ask Ricky to search a specific site.`;
  }

  const sections = results.slice(0, 8).map((result, index) => {
    const title = cleanMarkdownText(result.title || result.url || `Result ${index + 1}`);
    const url = String(result.url || "");
    const source = cleanMarkdownText(result.author || hostname(url) || "Source");
    const text = cleanMarkdownText(result.text || result.summary || "").slice(0, 700);
    const published = result.publishedDate ? `\n- Published: ${cleanMarkdownText(result.publishedDate)}` : "";
    const link = url ? `[Open source](${url})` : "Source link unavailable";

    return `### ${index + 1}. ${title}\n\n${text || "No snippet was returned for this result."}\n\n- Source: ${source}${published}\n- ${link}`;
  });

  return [`# ${cleanQuery}`, `Ricky found ${results.length} source${results.length === 1 ? "" : "s"}.`, ...sections].join(
    "\n\n",
  );
}

async function fallbackWebSearch(args) {
  const query = String(args.query || "").trim();
  const limit = Math.max(1, Math.min(10, Number(args.numResults || 5)));

  try {
    const [ddg, wiki] = await Promise.all([
      fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
      fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=${limit}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]);

    const results = [];
    if (ddg && (ddg.AbstractText || ddg.Abstract)) {
      results.push({
        title: ddg.Heading || query,
        url: ddg.AbstractURL || "",
        text: ddg.AbstractText || ddg.Abstract,
        author: ddg.AbstractSource || "DuckDuckGo",
      });
    }
    for (const hit of wiki?.query?.search || []) {
      results.push({
        title: hit.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(hit.title).replace(/ /g, "_"))}`,
        text: String(hit.snippet || "").replace(/<[^>]+>/g, ""),
        author: "Wikipedia",
      });
    }

    if (results.length === 0) {
      return {
        ok: false,
        error: "Basic search returned no results. Add EXA_API_KEY to .env.local for full web search.",
      };
    }

    return {
      ok: true,
      results: results.slice(0, limit),
      searchMode: "basic",
      note: "Basic search (DuckDuckGo + Wikipedia). Add EXA_API_KEY to .env.local for full web search.",
      artifact: {
        title: `Web Search: ${query}`,
        kind: "markdown",
        content: `${formatSearchMarkdown(query, results.slice(0, limit))}\n\n---\n\n*Basic search mode — add an Exa API key to .env.local for deeper web results.*`,
      },
    };
  } catch (error) {
    return { ok: false, error: `Basic search failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

function weatherText(code) {
  return WEATHER_CODES[Number(code)] || "Unknown";
}

async function weatherGet(args) {
  const location = String(args.location || "").trim();
  if (!location) return { ok: false, error: "A location is required." };

  try {
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
    );
    if (!geoResponse.ok) return { ok: false, error: `Geocoding failed: ${geoResponse.status}` };
    const geo = await geoResponse.json();
    const place = geo.results?.[0];
    if (!place) return { ok: false, error: `Could not find a place named "${location}".` };

    const forecastResponse = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code" +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code" +
        "&timezone=auto&forecast_days=5",
    );
    if (!forecastResponse.ok) return { ok: false, error: `Weather lookup failed: ${forecastResponse.status}` };
    const forecast = await forecastResponse.json();

    const current = forecast.current || {};
    const daily = forecast.daily || {};
    const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(", ");

    const dayLines = (daily.time || []).map((date, index) => {
      const dayName = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
      const max = Math.round(daily.temperature_2m_max?.[index] ?? 0);
      const min = Math.round(daily.temperature_2m_min?.[index] ?? 0);
      const rain = daily.precipitation_probability_max?.[index];
      const condition = weatherText(daily.weather_code?.[index]);
      return `| ${dayName} | ${condition} | ${max}° / ${min}° | ${rain == null ? "—" : `${rain}%`} |`;
    });

    const content = [
      `# Weather — ${placeName}`,
      "",
      `## ${Math.round(current.temperature_2m ?? 0)}°C — ${weatherText(current.weather_code)}`,
      "",
      `- Feels like: ${Math.round(current.apparent_temperature ?? 0)}°C`,
      `- Humidity: ${current.relative_humidity_2m ?? "—"}%`,
      `- Wind: ${Math.round(current.wind_speed_10m ?? 0)} km/h`,
      "",
      "### 5-day forecast",
      "",
      "| Day | Conditions | High / Low | Rain |",
      "| --- | --- | --- | --- |",
      ...dayLines,
    ].join("\n");

    return {
      ok: true,
      location: placeName,
      current: {
        temperature: current.temperature_2m,
        feelsLike: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        windKmh: current.wind_speed_10m,
        conditions: weatherText(current.weather_code),
      },
      artifact: { title: `Weather: ${place.name}`, kind: "markdown", content },
    };
  } catch (error) {
    return { ok: false, error: `Weather lookup failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function calendarEvents(args) {
  const days = Math.max(1, Math.min(14, Math.round(Number(args.days || 1))));
  const script = `set startDate to current date
set endDate to startDate + (${days} * days)
set eventLines to {}
tell application "Calendar"
  repeat with cal in calendars
    try
      set matching to (every event of cal whose start date is greater than or equal to startDate and start date is less than or equal to endDate)
      repeat with ev in matching
        set end of eventLines to (summary of ev) & "||" & ((start date of ev) as string)
      end repeat
    end try
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return eventLines as string`;

  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 25000 });
    const events = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // The date never contains "||", so anchor the split from the right
        // in case an event title itself contains the delimiter.
        const sep = line.lastIndexOf("||");
        const summary = sep === -1 ? line : line.slice(0, sep);
        const startsAt = sep === -1 ? "" : line.slice(sep + 2);
        return { summary: summary.trim(), startsAt: startsAt.trim() };
      })
      .slice(0, 30);

    const content = [
      `# Calendar — next ${days === 1 ? "day" : `${days} days`}`,
      "",
      events.length ? events.map((event) => `- **${event.summary}** — ${event.startsAt}`).join("\n") : "No events found.",
    ].join("\n");

    return {
      ok: true,
      events,
      artifact: { title: "Calendar", kind: "markdown", content },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = Boolean(error && (error.killed === true || error.signal === "SIGTERM")) || /timed out|ETIMEDOUT/i.test(message);
    if (timedOut) {
      return { ok: false, error: "Calendar took too long to answer. It may be syncing, or macOS may need automation permission for Ricky." };
    }
    return { ok: false, error: `Calendar lookup failed: ${message}. macOS may need automation permission for Ricky.` };
  }
}

async function reminderAdd(args) {
  const title = String(args.title || "").trim();
  if (!title) return { ok: false, error: "A reminder title is required." };
  const minutes = Number(args.minutes);
  const hasDue = Number.isFinite(minutes) && minutes >= 1;

  const script = hasDue
    ? `set dueDate to (current date) + ${Math.round(minutes * 60)}
tell application "Reminders" to make new reminder with properties {name:${appleScriptString(title)}, remind me date:dueDate}`
    : `tell application "Reminders" to make new reminder with properties {name:${appleScriptString(title)}}`;

  try {
    await execFileAsync("osascript", ["-e", script], { timeout: 15000 });
    return {
      ok: true,
      title,
      dueInMinutes: hasDue ? Math.round(minutes) : null,
      message: hasDue ? `Reminder "${title}" set for ${Math.round(minutes)} minutes from now.` : `Reminder "${title}" added.`,
      artifact: {
        title: "Reminder",
        kind: "progress",
        content: hasDue ? `✅ "${title}" — due in ${formatRemaining(Math.round(minutes) * 60)}` : `✅ "${title}" added to Reminders`,
      },
    };
  } catch (error) {
    return { ok: false, error: `Reminder failed: ${error instanceof Error ? error.message : String(error)}. macOS may need automation permission for Ricky.` };
  }
}

async function messageSend(args) {
  if (args.confirmed !== true) {
    return {
      ok: false,
      requiresConfirmation: true,
      message: "Read the recipient and the full message back to the user and get an explicit yes before sending.",
    };
  }
  const to = String(args.to || "").trim();
  const text = String(args.text || "").trim();
  if (!to || !text) return { ok: false, error: "Both a recipient handle and message text are required." };
  if (!/^[+\d][\d\s\-()]{5,}$/.test(to) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, error: "The recipient must be a phone number (like +38765123456) or an email handle. Ask the user for it." };
  }

  const script = `tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant ${appleScriptString(to)} of targetService
  send ${appleScriptString(text)} to targetBuddy
end tell`;

  try {
    await execFileAsync("osascript", ["-e", script], { timeout: 15000 });
    return { ok: true, message: `Message sent to ${to}.` };
  } catch (error) {
    return { ok: false, error: `Sending failed: ${error instanceof Error ? error.message : String(error)}. Check the handle and that Messages is signed in.` };
  }
}

async function fileSearch(args) {
  const query = String(args.query || "").trim();
  if (!query) return { ok: false, error: "A search query is required." };
  const limit = Math.max(1, Math.min(20, Number(args.limit || 10)));

  try {
    const { stdout } = await execFileAsync("mdfind", ["-onlyin", os.homedir(), "-name", query], { timeout: 15000 });
    const paths = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, limit);

    const results = paths.map((filePath) => ({
      name: path.basename(filePath),
      path: filePath,
      folder: path.dirname(filePath).replace(os.homedir(), "~"),
    }));

    const content = [
      `# Files matching “${query}”`,
      "",
      results.length
        ? results.map((file, index) => `${index + 1}. **${file.name}**\n   \`${file.folder}\``).join("\n")
        : "No files found in your home folder.",
    ].join("\n");

    return { ok: true, results, artifact: { title: `Files: ${query}`, kind: "markdown", content } };
  } catch (error) {
    return { ok: false, error: `File search failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function briefingGet() {
  const db = await readDb();
  const city = String(db.settings.homeCity || "").trim();
  const [weather, system] = await Promise.all([
    city ? weatherGet({ location: city }).catch(() => null) : Promise.resolve(null),
    systemInfo().catch(() => null),
  ]);
  const timers = timerSummary();
  const dateLine = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const weatherSection = weather?.ok
    ? `## Weather — ${weather.location}\n${Math.round(weather.current.temperature ?? 0)}°C, ${weather.current.conditions}, feels like ${Math.round(weather.current.feelsLike ?? 0)}°C`
    : city
      ? "## Weather\nWeather is unavailable right now."
      : "## Weather\nNo home city set — add one in Settings (gear icon) to include weather here.";

  const content = [
    `# Briefing — ${dateLine}`,
    "",
    weatherSection,
    "",
    "## Mac",
    `- Battery: ${system?.info?.battery || "—"}`,
    `- Disk: ${system?.info?.disk || "—"}`,
    `- Memory: ${system?.info?.memory || "—"}`,
    "",
    "## Timers",
    timers.length ? timers.map((timer) => `- ${timer.label}: ${formatRemaining(timer.remainingSeconds)} left`).join("\n") : "- None running.",
  ].join("\n");

  return {
    ok: true,
    city: city || null,
    weather: weather?.ok ? weather.current : null,
    system: system?.info || null,
    timers,
    artifact: { title: "Daily Briefing", kind: "markdown", content },
  };
}

async function isAppRunning(appName) {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", `application "${appName}" is running`]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function musicControl(args) {
  const requested = args.player === "spotify" ? "Spotify" : args.player === "music" ? "Music" : null;
  let player = requested;
  if (!player) {
    if (await isAppRunning("Spotify")) player = "Spotify";
    else if (await isAppRunning("Music")) player = "Music";
    else return { ok: false, error: "Neither Spotify nor Apple Music is running. Ask the user to open one first." };
  } else if (!(await isAppRunning(player))) {
    return { ok: false, error: `${player} is not running.` };
  }

  const action = String(args.action || "");
  try {
    if (action === "current") {
      const script =
        player === "Spotify"
          ? `tell application "Spotify" to return name of current track & " — " & artist of current track`
          : `tell application "Music" to return name of current track & " — " & artist of current track`;
      const { stdout } = await execFileAsync("osascript", ["-e", script]);
      const track = stdout.trim();
      return {
        ok: true,
        player,
        track,
        artifact: { title: "Now Playing", kind: "progress", content: `${track} (${player})` },
      };
    }

    const command =
      action === "play"
        ? "play"
        : action === "pause"
          ? "pause"
          : action === "playpause"
            ? "playpause"
            : action === "next"
              ? "next track"
              : action === "previous"
                ? "previous track"
                : null;
    if (!command) return { ok: false, error: `Unsupported action: ${action}` };
    await execFileAsync("osascript", ["-e", `tell application "${player}" to ${command}`]);
    return { ok: true, player, action, message: `${player}: ${action}.` };
  } catch (error) {
    return { ok: false, error: `Music control failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function currencyConvert(args) {
  const amount = Number(args.amount);
  const from = String(args.from || "").trim().toUpperCase();
  const to = String(args.to || "").trim().toUpperCase();
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Amount must be a non-negative number." };
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return { ok: false, error: "Currency codes must be 3-letter ISO codes like EUR, USD, RSD." };
  }

  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    if (!response.ok) return { ok: false, error: `Exchange rate lookup failed: ${response.status}` };
    const data = await response.json();
    const rate = data?.rates?.[to];
    if (data?.result !== "success" || typeof rate !== "number") {
      return { ok: false, error: `No exchange rate available for ${from} → ${to}.` };
    }
    const converted = amount * rate;
    const updated = data.time_last_update_utc || "";
    return {
      ok: true,
      amount,
      from,
      to,
      rate,
      converted: Math.round(converted * 100) / 100,
      artifact: {
        title: `${from} → ${to}`,
        kind: "markdown",
        content: [
          `# ${formatMoney(amount)} ${from} = ${formatMoney(converted)} ${to}`,
          "",
          `- Rate: 1 ${from} = ${rate.toFixed(4)} ${to}`,
          updated ? `- Rates updated: ${updated}` : "",
          "",
          "*Source: open.er-api.com*",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    };
  } catch (error) {
    return { ok: false, error: `Currency conversion failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function screenDescribe(args) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is missing in .env.local." };

  try {
    await fs.mkdir(dataDir, { recursive: true });
    const screenshotPath = path.join(dataDir, `screen-describe-${Date.now()}.png`);
    await execFileAsync("screencapture", ["-x", screenshotPath]);
    await execFileAsync("sips", ["-Z", "1600", screenshotPath]);
    const base64 = (await fs.readFile(screenshotPath)).toString("base64");

    const question = String(args.question || "").trim();
    const prompt = question
      ? `Look at this screenshot of the user's screen and answer: ${question}`
      : "Describe what is on this screenshot of the user's screen: the frontmost app, visible content, and anything notable. Be concise.";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `Vision analysis failed: ${response.status} ${await response.text()}` };
    }
    const data = await response.json();
    const description = data.choices?.[0]?.message?.content || "";
    if (!description) return { ok: false, error: "Vision model returned no description." };

    return {
      ok: true,
      description,
      path: screenshotPath,
      artifact: {
        title: "Screen Analysis",
        kind: "markdown",
        content: `# Screen Analysis\n\n${description}`,
      },
    };
  } catch (error) {
    return { ok: false, error: `Screen analysis failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function systemInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const uptimeHours = Math.floor(os.uptime() / 3600);
  const uptimeMinutes = Math.floor((os.uptime() % 3600) / 60);

  let battery = "Unavailable";
  try {
    const { stdout } = await execFileAsync("pmset", ["-g", "batt"]);
    const percentMatch = stdout.match(/(\d+)%/);
    const charging = /AC Power/.test(stdout);
    if (percentMatch) battery = `${percentMatch[1]}%${charging ? " (charging)" : " (on battery)"}`;
  } catch {
    battery = "Unavailable";
  }

  let disk = "Unavailable";
  try {
    const { stdout } = await execFileAsync("df", ["-h", "/"]);
    const line = stdout.trim().split("\n")[1] || "";
    const parts = line.split(/\s+/);
    if (parts.length >= 5) disk = `${parts[3]} free of ${parts[1]} (${parts[4]} used)`;
  } catch {
    disk = "Unavailable";
  }

  const info = {
    battery,
    memory: `${Math.round((totalMem - freeMem) / 1024 / 1024 / 1024)} GB used of ${Math.round(totalMem / 1024 / 1024 / 1024)} GB (${usedPercent}%)`,
    disk,
    cpu: os.cpus()[0]?.model || "Unknown",
    uptime: `${uptimeHours}h ${uptimeMinutes}m`,
    macos: os.release(),
  };

  const content = [
    "# System Snapshot",
    "",
    `- **Battery:** ${info.battery}`,
    `- **Memory:** ${info.memory}`,
    `- **Disk:** ${info.disk}`,
    `- **CPU:** ${info.cpu}`,
    `- **Uptime:** ${info.uptime}`,
  ].join("\n");

  return {
    ok: true,
    info,
    artifact: { title: "System Snapshot", kind: "markdown", content },
  };
}

function cleanMarkdownText(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildMenuMarkdown() {
  return `# Ricky Menu

Here is what you can ask me to do.

## Voice and Conversation

- Talk naturally with Ricky in realtime.
- Interrupt mid-response and ask follow-ups.
- Ask unrelated questions while tools keep running.

## Artifacts Panel

- "Show me the menu."
- "Show me the Tehnosoft demo."
- "Show the artifacts panel."
- "Make that fullscreen."
- Show clean research briefs, notes, code snippets, charts, task progress, images, and records.

## Web and Research

- "Search the web for ..." — works out of the box; add an Exa key for deeper results.
- "Look up the latest on ..."
- Results render as a clean Markdown brief with source links.
- "Open that link" — opens results in your default browser.

## Everyday Tools

- "Good morning" / "Give me my briefing" — weather, Mac status, and timers in one card.
- "What's the weather in Belgrade?" — current conditions + 5-day forecast.
- "Set a timer for 10 minutes for pasta." — chimes and announces when done.
- "What's on my clipboard?" / "Copy that to my clipboard."
- "How's my Mac doing?" — battery, memory, disk, uptime.
- "Set the volume to 40."
- "Pause the music." / "Next track." / "What's playing?" — Spotify or Apple Music.
- "How much is 100 euros in dinars?" — live exchange rates.
- "What's on my calendar this week?" — reads the macOS Calendar.
- "Remind me to call Marko in an hour." — creates a Reminders task.
- "Find my file named budget." — Spotlight search, then open or reveal it.
- "Send a message to +387... saying I'm on my way." — iMessage, always confirmed first.
- Press ⌃⌥Space anywhere to show or hide Ricky. He also lives in the menu bar (◉).

## Visuals

- Generate images with GPT Image.
- Create Mermaid charts with automatic fallback if the syntax breaks.
- Draft diagrams, code snippets, structured notes, and visual explanations.
- "Switch the theme to crimson." — cyan, crimson, amber, emerald, violet.

## Notes and Records

- Add, list, and confirm-delete notes in Ricky's local note grid.
- Create, search, update, and confirm-delete local database records.

## Computer Use Mode

- "Switch to computer use mode."
- Open apps, click, type, press Enter/Return, scroll, inspect the UI, and take screen snapshots.
- "What's on my screen?" — Ricky captures the screen and describes it with a vision model.
- Ricky asks before risky actions like sending, deleting, buying, changing settings, or sharing private info.

## Good Starter Prompts

- "Show me the menu."
- "What's the weather in Novi Sad this week?"
- "Set a timer for 5 minutes."
- "Search the web for the latest AI video tools."
- "Show the Tehnosoft document intake demo."
- "Create a chart of my workflow."
- "Switch the theme to emerald."`;
}

function buildTehnosoftDemoArtifact() {
  return {
    title: "Tehnosoft Demo",
    kind: "demoFlow",
    content: JSON.stringify(
      {
        audience: {
          guest: "Rikard Serdoz",
          company: "Tehnosoft",
          meetingWindow: "Next week",
        },
        headline: "Document intake -> note extraction -> agent handoff",
        promise:
          "One concrete desktop-agent workflow: Ricky takes an operations document packet, extracts actionable notes, and hands the work to a specialist agent with context intact.",
        triggerPrompt:
          "Ricky, intake this Tehnosoft service packet, extract operational notes, and hand it off to the follow-up agent.",
        packet: {
          source: "Email attachment + local PDF folder",
          receivedAt: "Tue 09:18",
          documents: [
            {
              name: "Service request SR-4182.pdf",
              pages: 8,
              status: "Indexed",
              signal: "Warranty issue, CNC line B, production stop risk",
            },
            {
              name: "Technician field notes.docx",
              pages: 3,
              status: "Parsed",
              signal: "Root-cause clues and missing serial plate photo",
            },
            {
              name: "Spare-parts quote.xlsx",
              pages: 1,
              status: "Structured",
              signal: "Lead time conflict: 2 days vs 10 days",
            },
          ],
          extractedFields: [
            { label: "Customer", value: "ACME Manufacturing Sarajevo" },
            { label: "Machine", value: "CNC Line B / Servo drive assembly" },
            { label: "Impact", value: "Line down, estimated EUR 18k/day" },
            { label: "Deadline", value: "Response needed by Friday 15:00" },
          ],
        },
        notes: [
          {
            tag: "Decision",
            title: "Escalate spare-part availability",
            body: "The quote promises a 2-day turnaround, but the parts table shows 10-day lead time for the servo drive.",
            confidence: 94,
          },
          {
            tag: "Missing info",
            title: "Request serial plate photo",
            body: "Technician notes reference an unreadable plate. Warranty validation cannot complete without the photo.",
            confidence: 88,
          },
          {
            tag: "Customer risk",
            title: "Production outage is time-sensitive",
            body: "The customer is losing one shift per day. A Friday response is the minimum acceptable SLA.",
            confidence: 91,
          },
          {
            tag: "ERP update",
            title: "Create service case and attach packet",
            body: "The extracted account, machine, issue, and deadline are ready for a service-case record.",
            confidence: 96,
          },
        ],
        handoff: {
          agent: "Service Resolution Agent",
          objective: "Prepare warranty decision, parts path, and customer response draft.",
          contextPackage: [
            "Original documents and parsed text",
            "Four extracted notes with confidence scores",
            "Detected deadline and outage impact",
            "Missing serial plate photo request",
          ],
          nextActions: [
            "Open ERP service case SR-4182",
            "Check spare-part stock and alternatives",
            "Draft customer response for Friday 15:00",
            "Ask Ricky to switch to computer-use mode for ERP entry when ready",
          ],
          handoffMessage:
            "Service Resolution Agent: use the SR-4182 packet to resolve warranty eligibility, verify spare-part ETA, and draft a Friday customer update. Key risk: promised 2-day response conflicts with 10-day part lead time. Missing input: serial plate photo.",
        },
        walkthrough: [
          {
            time: "0:00-0:30",
            title: "Set the frame",
            words:
              "Rikard, I want to show one narrow workflow, not a broad AI pitch: a desktop agent that helps an operations person move from documents to action.",
          },
          {
            time: "0:30-1:35",
            title: "Document intake",
            words:
              "I give Ricky a service packet. It identifies the files, classifies the document types, and pulls out the operational fields that matter before anyone opens the ERP.",
          },
          {
            time: "1:35-3:10",
            title: "Note extraction",
            words:
              "The useful output is not a summary; it is a set of working notes: decisions, missing inputs, customer risk, and the data that needs to land in the system.",
          },
          {
            time: "3:10-4:25",
            title: "Agent handoff",
            words:
              "Then Ricky packages the context for the next agent. The handoff has the source packet, extracted notes, risk, deadline, and next actions, so the next step starts with context instead of a blank chat.",
          },
          {
            time: "4:25-5:00",
            title: "Close with the Tehnosoft angle",
            words:
              "The point is a repeatable desktop workflow around documents, internal systems, and human approval. For Tehnosoft, we could swap the sample packet for a real service, sales, finance, or support process.",
          },
        ],
      },
      null,
      2,
    ),
  };
}

async function generateImage(args) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return imageErrorArtifact("OPENAI_API_KEY is missing in .env.local.");
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: String(args.prompt || ""),
      size: String(args.size || "1024x1024"),
      quality: "medium",
    }),
  });

  if (!response.ok) {
    return imageErrorArtifact(`Image generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  const url = data.data?.[0]?.url;
  if (b64) {
    await fs.mkdir(dataDir, { recursive: true });
    const imagePath = path.join(dataDir, `ricky-image-${Date.now()}.png`);
    await fs.writeFile(imagePath, Buffer.from(b64, "base64"));
    return {
      ok: true,
      path: imagePath,
      artifact: {
        title: "Generated Image",
        kind: "image",
        content: `data:image/png;base64,${b64}`,
      },
    };
  }
  if (url) {
    return { ok: true, url, artifact: { title: "Generated Image", kind: "image", content: url } };
  }
  return imageErrorArtifact("Image response did not include image data.");
}

function imageErrorArtifact(error) {
  return {
    ok: false,
    error,
    artifact: {
      title: "Image Generation Failed",
      kind: "markdown",
      content: `# Image generation failed\n\n${cleanMarkdownText(error)}\n\nTry a shorter prompt, a different size, or check model access for \`gpt-image-2\`.`,
    },
  };
}

async function thumbnailReferenceAdd(args) {
  const imagePath = path.resolve(String(args.imagePath || "").replace(/^file:\/\//, ""));
  try {
    await fs.access(imagePath);
  } catch {
    return imageErrorArtifact(`Reference image not found: ${imagePath}`);
  }

  const reference = {
    id: crypto.randomUUID(),
    path: imagePath,
    label: String(args.label || path.basename(imagePath)),
    createdAt: new Date().toISOString(),
  };
  const { db } = await updateDb(async (currentDb) => {
    currentDb.thumbnailBoard.references.unshift(reference);
  });
  return {
    ok: true,
    reference,
    board: thumbnailBoardSummary(db),
    artifact: await thumbnailBoardArtifact(db, "grid"),
    message: `Added ${reference.label} as a thumbnail reference image.`,
  };
}

async function thumbnailLoadingPrepare(args) {
  const runId = crypto.randomUUID();
  const count = 1;
  const mode = args.mode === "edit" ? "edited" : "generated";
  let target = null;
  const { db } = await updateDb(async (currentDb) => {
    target = mode === "edited" ? thumbnailByNumberOrSelected(currentDb, args.number, args.targetId) : null;
    const placeholders = Array.from({ length: count }, (_unused, index) => ({
      id: crypto.randomUUID(),
      number: currentDb.thumbnailBoard.nextNumber++,
      runId,
      status: "loading",
      type: mode,
      prompt: String(args.prompt || ""),
      size: "1536x1024",
      parentId: target?.id || null,
      createdAt: new Date().toISOString(),
      loadingLabel: count > 1 ? `Generating ${index + 1}/${count}` : mode === "edited" ? "Editing" : "Generating",
    }));

    currentDb.thumbnailBoard.images.unshift(...placeholders);
    if (currentDb.thumbnailBoard.view !== "selected" || !currentDb.thumbnailBoard.selectedId) {
      currentDb.thumbnailBoard.selectedId = null;
      currentDb.thumbnailBoard.view = "grid";
      currentDb.thumbnailBoard.page = 1;
    }
  });
  const view = db.thumbnailBoard.view === "selected" && db.thumbnailBoard.selectedId ? "selected" : "grid";
  return {
    ok: true,
    runId,
    targetId: target?.id || null,
    board: thumbnailBoardSummary(db),
    artifact: await thumbnailBoardArtifact(db, view),
  };
}

async function thumbnailGenerate(args) {
  try {
    const db = await readDb();
    const prompt = thumbnailPrompt(String(args.prompt || ""), db.thumbnailBoard.references.length > 0);
    const size = "1536x1024";
    const count = 1;
    const referencePaths = db.thumbnailBoard.references.map((reference) => reference.path).slice(0, 4);

    const generated = await Promise.all(
      Array.from({ length: count }, async (_unused, index) => {
        const image = await createThumbnailImage({
          prompt,
          size,
          inputPaths: referencePaths,
        });
        return thumbnailRecord(image, args.prompt, "generated", size);
      }),
    );

    const { db: latestDb } = await updateDb(async (currentDb) => {
      replaceLoadingThumbnails(currentDb, args.runId, generated);
      if (currentDb.thumbnailBoard.view !== "selected" || !currentDb.thumbnailBoard.selectedId) {
        currentDb.thumbnailBoard.selectedId = null;
        currentDb.thumbnailBoard.view = "grid";
        currentDb.thumbnailBoard.page = 1;
      }
    });
    const view = latestDb.thumbnailBoard.view === "selected" && latestDb.thumbnailBoard.selectedId ? "selected" : "grid";
    return {
      ok: true,
      count: generated.length,
      board: thumbnailBoardSummary(latestDb),
      artifact: await thumbnailBoardArtifact(latestDb, view),
      silent: true,
      thumbnailReady: true,
    };
  } catch (error) {
    if (args.runId) await removeLoadingThumbnailRun(args.runId);
    return imageErrorArtifact(error instanceof Error ? error.message : String(error));
  }
}

async function thumbnailEdit(args) {
  try {
    const db = await readDb();
    const target = thumbnailByNumberOrSelected(db, args.number, args.targetId);
    if (!target) {
      if (args.runId) await removeLoadingThumbnailRun(args.runId);
      return imageErrorArtifact(
        "No ready thumbnail matches. If it is still generating, wait for it to finish; otherwise say a number, like 'edit number two'.",
      );
    }

    const size = "1536x1024";
    const count = 1;
    const referencePaths = db.thumbnailBoard.references.map((reference) => reference.path).slice(0, 3);
    const inputPaths = [target.path, ...referencePaths].filter(Boolean);
    const editPrompt = editThumbnailPrompt(String(args.prompt || ""), target.prompt || "");

    const edited = await Promise.all(
      Array.from({ length: count }, async (_unused, index) => {
        const image = await createThumbnailImage({
          prompt: editPrompt,
          size,
          inputPaths,
        });
        return {
          ...thumbnailRecord(image, args.prompt, "edited", size),
          parentId: target.id,
        };
      }),
    );

    const { db: latestDb } = await updateDb(async (currentDb) => {
      replaceLoadingThumbnails(currentDb, args.runId, edited);
      if (currentDb.thumbnailBoard.view !== "selected" || !currentDb.thumbnailBoard.selectedId) {
        currentDb.thumbnailBoard.selectedId = null;
        currentDb.thumbnailBoard.view = "grid";
        currentDb.thumbnailBoard.page = 1;
      }
    });
    const view = latestDb.thumbnailBoard.view === "selected" && latestDb.thumbnailBoard.selectedId ? "selected" : "grid";
    return {
      ok: true,
      count: edited.length,
      board: thumbnailBoardSummary(latestDb),
      artifact: await thumbnailBoardArtifact(latestDb, view),
      silent: true,
      thumbnailReady: true,
    };
  } catch (error) {
    if (args.runId) await removeLoadingThumbnailRun(args.runId);
    return imageErrorArtifact(error instanceof Error ? error.message : String(error));
  }
}

async function thumbnailSelect(args) {
  const number = Number(args.number || 0);
  const { db, result: selected } = await updateDb(async (currentDb) => {
    const found = currentDb.thumbnailBoard.images.find((image) => image.number === number);
    if (!found || found.status === "loading") return found || null;
    currentDb.thumbnailBoard.selectedId = found.id;
    currentDb.thumbnailBoard.view = "selected";
    return found;
  });
  if (!selected) {
    return imageErrorArtifact(`Thumbnail number ${number} does not exist yet.`);
  }
  if (selected.status === "loading") {
    return imageErrorArtifact(`Thumbnail number ${number} is still generating.`);
  }
  return {
    ok: true,
    selected,
    selectedNumber: number,
    board: thumbnailBoardSummary(db),
    artifact: await thumbnailBoardArtifact(db, "selected"),
    message: `Selected thumbnail ${number}.`,
  };
}

async function createThumbnailImage({ prompt, size, inputPaths }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing in .env.local.");
  }

  if (inputPaths.length > 0) {
    return await editImageWithInputs({ apiKey, prompt, size, inputPaths });
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size,
      quality: "medium",
    }),
  });

  if (!response.ok) {
    throw new Error(`Thumbnail generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return await saveImageResponse(data, "thumbnail");
}

async function editImageWithInputs({ apiKey, prompt, size, inputPaths }) {
  const buildForm = async (imageFieldName) => {
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", "medium");
    for (const inputPath of inputPaths.slice(0, 10)) {
      const buffer = await fs.readFile(inputPath);
      form.append(imageFieldName, new Blob([buffer], { type: mimeForPath(inputPath) }), path.basename(inputPath));
    }
    return form;
  };

  let response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: await buildForm("image[]"),
  });

  if (!response.ok) {
    const firstError = await response.text();
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: await buildForm("image"),
    });
    if (!response.ok) {
      throw new Error(`Thumbnail edit failed: ${response.status} ${await response.text() || firstError}`);
    }
  }

  const data = await response.json();
  return await saveImageResponse(data, "thumbnail");
}

async function saveImageResponse(data, prefix) {
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Image response did not include image data.");
  }
  await fs.mkdir(dataDir, { recursive: true });
  const imagePath = path.join(dataDir, `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`);
  await fs.writeFile(imagePath, Buffer.from(b64, "base64"));
  return { path: imagePath, dataUrl: `data:image/png;base64,${b64}` };
}

function thumbnailRecord(image, prompt, type, size) {
  return {
    id: crypto.randomUUID(),
    type,
    path: image.path,
    prompt: String(prompt || ""),
    size,
    createdAt: new Date().toISOString(),
  };
}

function thumbnailPrompt(prompt, hasReferences) {
  return [
    hasReferences ? "Use the provided reference image(s) of Riley as the identity reference." : "",
    "Create one 16:9 YouTube thumbnail.",
    "Follow this request literally. Do not add extra concepts, fake UI, extra text, watermarks, or unrelated elements.",
    prompt,
  ]
    .filter(Boolean)
    .join("\n");
}

function editThumbnailPrompt(prompt, originalPrompt) {
  return [
    "Edit the provided thumbnail image.",
    "Make only this change. Preserve everything else unless the request says otherwise.",
    prompt,
  ]
    .filter(Boolean)
    .join("\n");
}

function thumbnailByNumberOrSelected(db, number, targetId) {
  const candidate = targetId
    ? db.thumbnailBoard.images.find((image) => image.id === targetId) || null
    : number
      ? db.thumbnailBoard.images.find((image) => image.number === Number(number)) || null
      : db.thumbnailBoard.selectedId
        ? db.thumbnailBoard.images.find((image) => image.id === db.thumbnailBoard.selectedId) || null
        : null;
  if (candidate?.status === "loading") return null;
  return candidate;
}

function replaceLoadingThumbnails(db, runId, records) {
  if (!runId) {
    db.thumbnailBoard.images.unshift(...records.map((record) => assignThumbnailNumber(db, record)));
    return;
  }

  const placeholders = db.thumbnailBoard.images
    .map((image, index) => ({ image, index }))
    .filter(({ image }) => image.runId === runId && image.status === "loading");

  if (placeholders.length === 0) {
    db.thumbnailBoard.images.unshift(...records.map((record) => assignThumbnailNumber(db, record)));
    return;
  }

  for (const [recordIndex, placeholder] of placeholders.entries()) {
    const replacement = records[recordIndex];
    if (replacement) db.thumbnailBoard.images[placeholder.index] = { ...replacement, number: placeholder.image.number };
  }

  if (records.length > placeholders.length) {
    db.thumbnailBoard.images.unshift(...records.slice(placeholders.length).map((record) => assignThumbnailNumber(db, record)));
  }
}

async function removeLoadingThumbnailRun(runId) {
  await updateDb(async (db) => {
    db.thumbnailBoard.images = db.thumbnailBoard.images.filter(
      (image) => !(image.runId === runId && image.status === "loading"),
    );
    db.thumbnailBoard.view = "grid";
    if (db.thumbnailBoard.selectedId && !db.thumbnailBoard.images.some((image) => image.id === db.thumbnailBoard.selectedId)) {
      db.thumbnailBoard.selectedId = null;
    }
  });
}

function thumbnailNumber(db, id) {
  return db.thumbnailBoard.images.find((image) => image.id === id)?.number || null;
}

function assignThumbnailNumber(db, image) {
  if (Number.isInteger(image.number) && image.number > 0) return image;
  return { ...image, number: db.thumbnailBoard.nextNumber++ };
}

function pageForArgs(args) {
  const page = Number(args?.page || 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function sortedThumbnailImages(db) {
  return [...db.thumbnailBoard.images].sort((a, b) => (b.number || 0) - (a.number || 0));
}

function paginatedThumbnailImages(db, page = db.thumbnailBoard.page || 1) {
  const pageSize = db.thumbnailBoard.pageSize || 9;
  const start = (page - 1) * pageSize;
  return sortedThumbnailImages(db).slice(start, start + pageSize);
}

function thumbnailPageMeta(db) {
  const pageSize = db.thumbnailBoard.pageSize || 9;
  const totalImages = db.thumbnailBoard.images.length;
  return {
    page: db.thumbnailBoard.page || 1,
    pageSize,
    totalImages,
    totalPages: Math.max(1, Math.ceil(totalImages / pageSize)),
    nextNumber: db.thumbnailBoard.nextNumber,
  };
}

function thumbnailBoardSummary(db) {
  const board = db.thumbnailBoard;
  const selectedNumber = board.selectedId ? thumbnailNumber(db, board.selectedId) : null;
  const page = thumbnailPageMeta(db);
  return {
    view: board.view,
    selectedNumber,
    references: board.references.length,
    page,
    images: paginatedThumbnailImages(db, page.page).map((image) => ({
      number: image.number,
      id: image.id,
      status: image.status === "loading" ? "loading" : "ready",
      type: image.type || "thumbnail",
      prompt: image.prompt || "",
    })),
  };
}

function buildMemoryInstructions(db) {
  const notes = db.notes.slice(0, 8).map((note) => `- ${String(note.text || "").slice(0, 140)}`);
  const log = (db.conversationLog || [])
    .slice(-20)
    .map((entry) => `${entry.role === "user" ? "User" : "Ricky"}: ${String(entry.text || "").slice(0, 200)}`);
  if (notes.length === 0 && log.length === 0) return "";
  return [
    "# Memory From Previous Sessions",
    notes.length ? `Saved notes:\n${notes.join("\n")}` : "",
    log.length ? `Recent conversation excerpts (possibly from an earlier session):\n${log.join("\n")}` : "",
    "Use this memory naturally when relevant. Do not recite it unprompted.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildThumbnailBoardInstructions(db) {
  const summary = thumbnailBoardSummary(db);
  const imageLines = summary.images.length
    ? summary.images
        .map((image) => `- #${image.number}: ${image.status}${image.status === "ready" ? `, ${image.type}` : ""}${image.prompt ? `, prompt: ${image.prompt.slice(0, 120)}` : ""}`)
        .join("\n")
    : "- No generated thumbnails yet.";

  return `# Current Thumbnail Board State
Reference images loaded: ${summary.references}
Current view: ${summary.view}
Selected thumbnail number: ${summary.selectedNumber || "none"}
Current page: ${summary.page.page}/${summary.page.totalPages}
Total thumbnails: ${summary.page.totalImages}
Next new thumbnail number: ${summary.page.nextNumber}
Visible permanent thumbnail numbers:
${imageLines}

When Riley says "pull up number N", "select N", or "show N", call thumbnail_select with that permanent number. When Riley says "edit this", use thumbnail_edit with no number if a selected thumbnail number exists. When Riley says "edit number N", call thumbnail_edit with that permanent number. When he asks for older thumbnails or another page, call thumbnail_grid with the requested page. Do not claim you cannot see prior thumbnails; this board state is persistent and paginated.`;
}

async function thumbnailBoardArtifact(db, view) {
  const board = db.thumbnailBoard;
  const selected = board.images.find((image) => image.id === board.selectedId) || null;
  const page = thumbnailPageMeta(db);
  const visibleImages = view === "selected" && selected ? [selected] : paginatedThumbnailImages(db, page.page);
  const images = await Promise.all(
    visibleImages.map(async (image) => {
      const src = image.path ? await imageDataUrl(image.path) : null;
      return {
        ...image,
        number: image.number,
        src,
        selected: selected?.id === image.id,
      };
    }),
  );

  return {
    title: view === "selected" && selected ? `Thumbnail ${thumbnailNumber(db, selected.id)}` : "Thumbnail Board",
    kind: "thumbnailBoard",
    fullscreen: view === "selected",
    content: JSON.stringify({
      view,
      selectedId: board.selectedId,
      references: board.references,
      page,
      images,
    }),
  };
}

async function imageDataUrl(imagePath) {
  const buffer = await fs.readFile(imagePath);
  return `data:${mimeForPath(imagePath)};base64,${buffer.toString("base64")}`;
}

function mimeForPath(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function recordsArtifact(records, collection) {
  return {
    title: `Records: ${collection}`,
    kind: "table",
    content: JSON.stringify(records, null, 2),
  };
}

function normalizeMermaidDiagram(diagram, title) {
  const stripped = diagram
    .replace(/```mermaid/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();

  if (!stripped) {
    return fallbackMermaidDiagram(title);
  }

  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[–—]/g, "-")
        .replace(/\s+-->\s+/g, " --> ")
        .replace(/\s+---\s+/g, " --- "),
    );

  const hasDiagramHeader = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/i.test(
    lines[0] || "",
  );

  return hasDiagramHeader ? lines.join("\n") : `flowchart TD\n${lines.join("\n")}`;
}

function fallbackMermaidDiagram(title) {
  const safeTitle = String(title || "Chart").replace(/["<>]/g, "");
  return `flowchart TD\n  A["${safeTitle}"] --> B["Chart request received"]\n  B --> C["Ricky will show a safe fallback if syntax fails"]`;
}

app.whenReady().then(async () => {
  await createWindow();
  createTray();
  try {
    globalShortcut.register("Control+Alt+Space", () => toggleMainWindow());
  } catch {
    // Shortcut may be taken by another app; skip silently.
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
