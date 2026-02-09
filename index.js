const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const OAUTH_CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");
const { GoogleAuth } = require("google-auth-library");
const TOKENS_DIR = path.join(__dirname, "tokens");
const speakeasy = require("speakeasy");
//////////////////// CONFIG ////////////////////
const SITE_URL = "https://www.instagram.com/accounts/emailsignup/"; // KAYIT SAYFASI URL
const PASSWORD_VALUE = "Okanokan10!";
const SHEET_ID = "1UgCB8MemIK0uEUOewbAD7g9CCnxxUdXIOXZR9UV5zdw";
const SHEET_NAME = "imap";
 
const CREDENTIALS_DIR = path.join(__dirname, "credentials");
const SPEED = 1.5;
const NAMES_FILE = path.join(__dirname, "isimler.txt");
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = 9222;
////////////////////////////////////////////////
 
/* ---------------- UTIL ---------------- */
const randInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const choice = (arr) => arr[randInt(0, arr.length - 1)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
const WARP_CLI =
  `"C:\\Program Files\\Cloudflare\\Cloudflare WARP\\warp-cli.exe"`;

function warpConnect() {
  return new Promise((resolve, reject) => {
    console.log("🛡️ Cloudflare WARP bağlanıyor...");

    spawn("cmd.exe", ["/c", `${WARP_CLI} connect`], {
      stdio: "ignore",
      detached: false,
    });

    // bağlantı kontrol döngüsü
    const start = Date.now();
    const timeoutMs = 20000;

    const check = () => {
      spawn("cmd.exe", ["/c", `${WARP_CLI} status`], {
        stdio: ["ignore", "pipe", "ignore"],
      }).stdout.on("data", (data) => {
        const out = data.toString().toLowerCase();

        if (out.includes("connected")) {
          console.log("✅ WARP bağlandı");
          return resolve();
        }

        if (Date.now() - start > timeoutMs) {
          return reject(new Error("⛔ WARP bağlanamadı (timeout)"));
        }

        setTimeout(check, 1500);
      });
    };

    setTimeout(check, 2000);
  });
}
 
function runShutdownBat() {
  const batPath = path.join(__dirname, "shut.bat");
 
  console.log("⚠️ shut.bat çalıştırılıyor...");
  spawn("cmd.exe", ["/c", batPath], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function cleanBase32(secret) {
  return secret
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, ""); // boşluk + görünmez char + her şeyi sil
}

function get2FACode(secret) {
  return speakeasy.totp({
    secret: cleanBase32(secret),
    encoding: "base32",
    step: 30,
  });
}

function normalizeAscii(str) {
  return str
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

 
/* ---------------- DATA ---------------- */
function getAllNameWords() {
  return fs
    .readFileSync(NAMES_FILE, "utf8")
    .split(/\r?\n/)
    .map((l) => normalizeAscii(l.trim().replace(/-/g, " ")))
    .filter(Boolean)
    .flatMap((l) => l.split(/\s+/));
}
 
/* ---------------- USERNAME ---------------- */
function generateUsernameFromFullName(fullName) {
  const base = normalizeAscii(fullName).replace(/\s+/g, "");
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const randLetter = () => letters[Math.floor(Math.random() * letters.length)];
 
  while (true) {
    let username = base;
    let applied = false;
 
    if (Math.random() < 0.33 && fullName.includes(" ")) {
      username = normalizeAscii(fullName).split(/\s+/).join(".");
      applied = true;
    }
 
    if (Math.random() < 0.66) {
      username += randInt(100, 999);
      applied = true;
    }
 
    if (Math.random() < 0.33) {
      const cnt = Math.random() < 0.5 ? 1 : 2;
      let pre = "";
      for (let i = 0; i < cnt; i++) pre += randLetter();
      username = pre + username;
      applied = true;
    }
 
    if (applied) return username.slice(0, 30);
  }
}
function getRandomCredentialFile() {
  const files = fs
    .readdirSync(CREDENTIALS_DIR)
    .filter(f => f.endsWith(".json"));

  if (!files.length) {
    throw new Error("credentials klasöründe json yok");
  }

  const picked = files[Math.floor(Math.random() * files.length)];
  return path.join(CREDENTIALS_DIR, picked);
}
function validateTokenStructure(tokenFile) {
  const data = JSON.parse(fs.readFileSync(tokenFile));
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Token eksik alan içeriyor: " + path.basename(tokenFile));
  }
}
 
/* ---------------- EMAIL (+XXX) ---------------- */
function generatePlusEmail(baseEmail) {
  const [local, domain] = baseEmail.split("@");
  const plus = randInt(100, 999);
  return `${local}+${plus}@${domain}`;
}
 
function getUniqueProfileDir() {
  return path.join(
    __dirname,
    "tmp_chrome_profile_" + Date.now() + "_" + randInt(1000, 9999)
  );
}

function decodeBase64(data) {
  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}
function createOAuthClient(tokenFile) {
  const credentials = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH));
  const { client_id, client_secret, redirect_uris } = credentials.installed;

  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "http://localhost"
  );

  auth.setCredentials(JSON.parse(fs.readFileSync(tokenFile)));
  return auth;
}

 
function launchChromeDebug() {
  const profileDir = getUniqueProfileDir();

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-translate",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--start-maximized",
  ];

  console.log("🚀 Yeni Chrome profili ile başlatılıyor:", profileDir);

  return spawn(CHROME_PATH, args, {
    detached: true,
    stdio: "ignore",
  });
}

/* ---------------- PAGE ---------------- */
async function clearAndType(page, selector, text) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector);
  await page.type(selector, text, { delay: randInt(35, 80) });
}

async function clickBitti(page, timeout = 60000) {
  const labels = ["Bitti", "Done"];

  await page.waitForFunction(
    (labels) => {
      return [...document.querySelectorAll("span, button, div, [role='button'], a")]
        .some(el => {
          const t = (el.innerText || "").trim();
          const visible = el.offsetParent !== null;
          return visible && labels.includes(t);
        });
    },
    { timeout },
    labels
  );

  const clicked = await page.evaluate((labels) => {
    const el = [...document.querySelectorAll("span, button, div, [role='button'], a")]
      .find(el => {
        const t = (el.innerText || "").trim();
        const visible = el.offsetParent !== null;
        return visible && labels.includes(t);
      });

    if (!el) return false;

    let target = el;
    for (let i = 0; i < 8; i++) {
      if (!target) break;
      if (
        target.tagName === "DIV" ||
        target.tagName === "BUTTON" ||
        target.getAttribute("role") === "button" ||
        target.tagName === "A"
      ) {
        target.scrollIntoView({ block: "center" });
        target.click();
        return true;
      }
      target = target.parentElement;
    }
    return false;
  }, labels);

  if (!clicked) {
    throw new Error("⛔ Bitti / Done butonu tıklanamadı");
  }

  await sleep(1500);
}

async function enter2FAHumanLike(page, secret) {
  console.log("🔐 Authenticator kurulumu başlıyor");

  const inputSelector = 'input[maxlength="6"]';

  // en fazla 2 deneme
  for (let attempt = 1; attempt <= 2; attempt++) {
    const token = get2FACode(secret);
    console.log(`🔢 TOTP (${attempt}):`, token);
    await page.keyboard.press("Tab");
    await sleep(150);
    await page.keyboard.press("Tab");
    await sleep(150);
    await page.keyboard.press("Tab");
    await sleep(150);
    await page.keyboard.press("Enter");

    await page.waitForSelector(inputSelector, { visible: true });
    
    // input'u TAM temizle
    await page.click(inputSelector);
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await sleep(200);

    // rakam rakam yaz
    for (const ch of token) {
      await page.keyboard.type(ch, { delay: randInt(80, 140) });
    }

    await sleep(300);

    // İleri
    await page.keyboard.press("Tab");
    await sleep(150);
    await page.keyboard.press("Tab");
    await sleep(150);
    await page.keyboard.press("Enter");

    // sonucu bekle
    await sleep(3000);

    const invalid = await isInvalidCodeVisible(page);

    if (!invalid) {
      console.log("✅ Authenticator kodu kabul edildi");
      return;
    }

    console.log("⚠️ Kod reddedildi, yeni TOTP bekleniyor...");

    // ⏱️ yeni time-step gelsin diye bekle
    await sleep(3500);
  }

  throw new Error("⛔ Authenticator kodu 2 denemede de reddedildi");
}

async function getEmailFromToken(tokenPath) {
  validateTokenStructure(tokenPath);

  const auth = createOAuthClient(tokenPath);
  const gmail = google.gmail({ version: "v1", auth });

  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress.toLowerCase();
}

async function clickIleri(page, timeout = 45000) {
  const labels = ["İleri", "Next", "Continue"];

  await page.waitForFunction(
    (labels) => {
      return [...document.querySelectorAll("span")]
        .some(s => labels.includes((s.innerText || "").trim()));
    },
    { timeout },
    labels
  );

  const clicked = await page.evaluate((labels) => {
    const span = [...document.querySelectorAll("span")]
      .find(s => labels.includes((s.innerText || "").trim()));

    if (!span) return false;

    let el = span;

    // 🔥 en dış tıklanabilir container’a kadar çık
    for (let i = 0; i < 12; i++) {
      if (!el || el === document.body) break;

      const role = el.getAttribute?.("role");
      const clickable =
        el.tagName === "BUTTON" ||
        role === "button" ||
        el.onclick ||
        el.getAttribute?.("tabindex") !== null ||
        el.tagName === "DIV";

      if (clickable) {
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      }

      el = el.parentElement;
    }

    return false;
  }, labels);

  if (!clicked) {
    throw new Error("⛔ Continue / İleri butonu tıklanamadı");
  }

  await new Promise(r => setTimeout(r, 1200));
}
async function waitForNextTotpWindow(step = 30, safetyMs = 1200) {
  const now = Date.now();
  const msInStep = step * 1000;
  const msToNext = msInStep - (now % msInStep);
  await sleep(msToNext + safetyMs);
}

async function get2FASecret(page, timeout = 60000) {
  await page.waitForFunction(() => {
    return [...document.querySelectorAll("span")]
      .some(el => {
        const t = (el.innerText || "").trim().replace(/\s/g, "");
        return /^[A-Z2-7]{32,}$/.test(t);
      });
  }, { timeout });

  const secret = await page.evaluate(() => {
    const spans = [...document.querySelectorAll("span")];

    for (const s of spans) {
      const raw = (s.innerText || "").trim();
      const cleaned = raw.replace(/\s/g, "");

      if (
        /^[A-Z2-7]{32,}$/.test(cleaned) &&           // 🔥 gerçek secret
        !raw.toLowerCase().includes("example") &&
        !raw.toLowerCase().includes("örnek")
      ) {
        return cleaned;
      }
    }
    return null;
  });

  if (!secret) {
    throw new Error("⛔ 2FA secret bulunamadı");
  }

  console.log("🔐 2FA SECRET (RAW):", secret);
  console.log("🔐 2FA SECRET (CLEAN):", cleanBase32(secret));

  return secret;
}


async function waitInstagramCodeAPI({
  tokenFile,
  timeoutMs = 60000,
  pollMs = 3000,
  maxAgeMinutes = 3,
} = {}) {
  const auth = createOAuthClient(tokenFile);

  console.log("🔐 Kullanılan token:", path.basename(tokenFile));

  const gmail = google.gmail({ version: "v1", auth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  console.log("📧 Token Gmail:", profile.data.emailAddress);

  const start = Date.now();
  const maxAgeMs = maxAgeMinutes * 60 * 1000;

  console.log("📡 Gmail API ile Instagram kodu bekleniyor (proxysiz)...");

  while (Date.now() - start < timeoutMs) {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: "from:no-reply@mail.instagram.com OR subject:Instagram",
      maxResults: 10,
    });

    if (list.data.messages) {
      for (const m of list.data.messages) {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: m.id,
          format: "full",
        });

        const mailTime = Number(msg.data.internalDate);
        if (Date.now() - mailTime > maxAgeMs) continue;

        const headers = msg.data.payload.headers || [];
        const subject =
          headers.find(h => h.name === "Subject")?.value || "";

        const subjectMatch = subject.match(/\b\d{6}\b/);
        if (subjectMatch) return subjectMatch[0];

        let body = "";
        const walk = (part) => {
          if (part.body?.data)
            body += decodeBase64(part.body.data);
          if (part.parts) part.parts.forEach(walk);
        };
        walk(msg.data.payload);

        const bodyMatch = body.match(/\b\d{6}\b/);
        if (bodyMatch) return bodyMatch[0];
      }
    }

    await sleep(pollMs);
  }

  throw new Error("⛔ Gmail API ile belirtilen sürede kod alınamadı");
}
async function selectComboByRandomOption(page, labelText, valuesArray) {
  console.log("🎯 Açılıyor:", labelText);

  // combobox'u aç
  await page.waitForFunction(
    (label) => {
      return [...document.querySelectorAll("span")]
        .some(s => (s.innerText || "").trim() === label);
    },
    { timeout: 60000 },
    labelText
  );

  await page.evaluate((label) => {
    const span = [...document.querySelectorAll("span")]
      .find(s => (s.innerText || "").trim() === label);

    let el = span;
    for (let i = 0; i < 10; i++) {
      if (!el) break;
      if (el.getAttribute?.("role") === "combobox") {
        el.click();
        return;
      }
      el = el.parentElement;
    }
  }, labelText);

  await sleep(randInt(300, 600));

  // 🎲 rastgele değer seç
  const value = valuesArray[randInt(0, valuesArray.length - 1)];
  console.log(`👉 ${labelText} seçiliyor:`, value);

  // option’u bul ve tıkla
  await page.waitForFunction(
    (val) => {
      return [...document.querySelectorAll('[role="option"]')]
        .some(o => (o.innerText || "").trim() === String(val));
    },
    { timeout: 30000 },
    value
  );

  await page.evaluate((val) => {
    const opt = [...document.querySelectorAll('[role="option"]')]
      .find(o => (o.innerText || "").trim() === String(val));

    if (opt) {
      opt.scrollIntoView({ block: "center" });
      opt.click();
    }
  }, value);

  await sleep(randInt(400, 800));
}

async function clickInstagramApp(page) {
  await page.waitForFunction(() => {
    const nodes = [
      ...document.querySelectorAll("div, span, button, [role='button'], a"),
    ];
    return nodes.some(n => {
      const t = (n.innerText || "").trim().toLowerCase();
      return t === "instagram" || t.startsWith("instagram");
    });
  }, { timeout: 60000 });

  const clicked = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll("div, span, button, [role='button'], a"),
    ];
    const el = nodes.find(n => {
      const t = (n.innerText || "").trim().toLowerCase();
      return t === "instagram" || t.startsWith("instagram");
    });

    if (!el) return false;

    let target = el;
    for (let i = 0; i < 6; i++) {
      if (!target) break;
      if (target.tagName === "DIV" || target.tagName === "BUTTON" || target.tagName === "A") {
        target.scrollIntoView({ block: "center" });
        target.click();
        return true;
      }
      target = target.parentElement;
    }
    return false;
  });

  if (!clicked) throw new Error("⛔ Instagram App tıklanamadı");

  await sleep(1000);
}
async function fillNameUsernameHuman(page, { fullName, username }) {
  await page.waitForSelector("input", { timeout: 60000 });

  const allInputs = await page.$$("input");

  // yeni UI’de isim ve username en sondaki 2 input
  const nameInput = allInputs[allInputs.length - 2];
  const userInput = allInputs[allInputs.length - 1];

  async function humanType(el, text) {
    await el.click({ clickCount: 3 });
    await sleep(randInt(200, 400));

    for (const ch of text) {
      await el.type(ch, { delay: randInt(40, 90) });
    }

    await sleep(randInt(200, 400));
  }

  console.log("✍️ Full name yazılıyor...");
  await humanType(nameInput, fullName);

  console.log("✍️ Username yazılıyor...");
  await humanType(userInput, username);

  console.log("✅ Name + Username yazıldı");
}

async function fillEmailPasswordHuman(page, { email, password }) {
  await page.waitForSelector("input", { timeout: 60000 });

  const allInputs = await page.$$("input");

  if (allInputs.length < 2) {
    throw new Error("⛔ Email / Password input bulunamadı");
  }

  async function humanType(el, text) {
    await el.click({ clickCount: 3 });
    await sleep(randInt(200, 400));

    for (const ch of text) {
      await el.type(ch, { delay: randInt(40, 90) });
    }

    await sleep(randInt(200, 400));
  }

  console.log("✍️ Email yazılıyor...");
  await humanType(allInputs[0], email);

  console.log("✍️ Password yazılıyor...");
  await humanType(allInputs[1], password);

  console.log("✅ Email + Password yazıldı");
}

async function clickAccountUsername(page, username, timeout = 60000) {
  const uname = username.toLowerCase();

  await page.waitForFunction(
    (uname) => {
      return [...document.querySelectorAll("div, span, a")]
        .some(el => (el.innerText || "").trim().toLowerCase() === uname);
    },
    { timeout },
    uname
  );

  const clicked = await page.evaluate((uname) => {
    const el = [...document.querySelectorAll("div, span, a")]
      .find(e => (e.innerText || "").trim().toLowerCase() === uname);

    if (!el) return false;

    let target = el;
    for (let i = 0; i < 5; i++) {
      if (!target) break;
      if (target.tagName === "DIV" || target.tagName === "A") {
        target.scrollIntoView({ block: "center" });
        target.click();
        return true;
      }
      target = target.parentElement;
    }
    return false;
  }, uname);

  if (!clicked) {
    throw new Error("⛔ Kullanıcı adına tıklanamadı: " + username);
  }

  await sleep(1500);
}


async function clickDevam(page, timeout = 60000) {
  const labels = ["Continue", "Devam", "İleri", "Next"];

  await page.waitForFunction(
    (labels) => {
      return [...document.querySelectorAll("span")]
        .some(s => labels.includes((s.innerText || "").trim()));
    },
    { timeout },
    labels
  );

  const clicked = await page.evaluate((labels) => {
    const span = [...document.querySelectorAll("span")]
      .find(s => labels.includes((s.innerText || "").trim()));

    if (!span) return false;

    let el = span;

    // 🔼 En dış tıklanabilir DIV'e kadar çık
    for (let i = 0; i < 10; i++) {
      if (!el || el === document.body) break;

      const role = el.getAttribute?.("role");
      const clickable =
        el.tagName === "BUTTON" ||
        role === "button" ||
        el.onclick ||
        el.getAttribute?.("tabindex") !== null ||
        el.tagName === "DIV";

      if (clickable) {
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      }

      el = el.parentElement;
    }

    return false;
  }, labels);

  if (!clicked) {
    throw new Error("⛔ Continue / Devam butonu tıklanamadı");
  }

  await sleep(1500);
}


function getRandomTokenFile() {
  const files = fs.readdirSync(TOKENS_DIR).filter(f => f.endsWith(".json"));
  if (!files.length) throw new Error("tokens klasörü boş!");

  // 🔀 Gerçek karıştırma
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }

  const picked = files[0];
  console.log("🎯 Rastgele seçilen token:", picked);

  return path.join(TOKENS_DIR, picked);
}


async function write2FAToSheet({ username, password, secret }) {
  const credentialFile = getRandomCredentialFile();

  const auth = new GoogleAuth({
    keyFile: credentialFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const value = `${username}-${password}-${secret}`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[value]],
    },
  });

  console.log("📄 2FA Sheet kaydı OK:", value);
}
async function isInvalidCodeVisible(page) {
  const needles = [
    "Bu kod doğru değil. Lütfen tekrar dene.",
    "This code isn't right. Please try again.",
    "Invalid code",
    "code isn't right",
    "Please try again",
    "Try again",
    "wrong code",
  ].map(s => s.toLowerCase());

  return await page.evaluate((needles) => {
    const nodes = [...document.querySelectorAll("span, div, p")];
    return nodes.some(n => {
      const t = (n.innerText || "").trim().toLowerCase();
      if (!t) return false;
      // sadece görünür olanlar
      const visible = n.offsetParent !== null;
      return visible && needles.some(x => t.includes(x));
    });
  }, needles);
}


async function goTo2FA(page) {
  await page.goto(
    "https://accountscenter.instagram.com/password_and_security/two_factor/?theme=dark",
    { waitUntil: "domcontentloaded" }
  );
}

async function clickKaydol(page, timeout = 45000) {
  const labels = ["Kaydol", "Sign up", "Sign Up", "Submit"];

  await page.waitForFunction(
    (labels) => {
      return [...document.querySelectorAll("span")]
        .some(s => labels.includes((s.innerText || "").trim()));
    },
    { timeout },
    labels
  );

  const clicked = await page.evaluate((labels) => {
    const span = [...document.querySelectorAll("span")]
      .find(s => labels.includes((s.innerText || "").trim()));

    if (!span) return false;

    let el = span;

    // 🔥 en dış tıklanabilir container’a kadar çık
    for (let i = 0; i < 12; i++) {
      if (!el || el === document.body) break;

      const role = el.getAttribute?.("role");
      const clickable =
        el.tagName === "BUTTON" ||
        role === "button" ||
        el.onclick ||
        el.getAttribute?.("tabindex") !== null ||
        el.tagName === "DIV";

      if (clickable) {
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      }

      el = el.parentElement;
    }

    return false;
  }, labels);

  if (!clicked) {
    throw new Error("⛔ Submit / Kaydol butonu tıklanamadı");
  }

  await new Promise(r => setTimeout(r, 1200));
}

/* ---------------- MAIN ---------------- */
async function main() {
  const tokenFile = getRandomTokenFile();
  const baseEmail = await getEmailFromToken(tokenFile);
  const email = generatePlusEmail(baseEmail);
  console.log("🔐 Seçilen token:", path.basename(tokenFile));
  console.log("📧 Token Gmail:", baseEmail);

  const words = getAllNameWords();
  const fullName = `${choice(words)} ${choice(words)}`;
  const username = generateUsernameFromFullName(fullName);
 
  console.log("📧 Email:", email);
  console.log("👤 Ad Soyad:", fullName);
  console.log("🧩 Username:", username);
 
  launchChromeDebug();
  await sleep(4000);
 
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
    defaultViewport: null,
  });
 
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.goto(SITE_URL, { waitUntil: "domcontentloaded" });
  // 🔄 Sayfa yüklendikten sonra F5 (reload)
  await sleep(2000); // insan gibi kısa bekleme
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(2000);
  
  // 1️⃣ Email + Password
  await fillEmailPasswordHuman(page, {
    email,
    password: PASSWORD_VALUE,
  });

  // 2️⃣ DOĞUM TARİHİ (SIRA: DAY → MONTH → YEAR)
    // 🎂 DOĞUM TARİHİ – OPTION’A TIKLAYARAK (INSANSI)

  // Gün: 1–28
  const days = Array.from({ length: 28 }, (_, i) => String(i + 1));

  // Yıl: 1982–2004
  const years = [];
  for (let y = 1982; y <= 2004; y++) years.push(String(y));

  // Ay
  await selectComboByRandomOption(page, "Month", MONTHS);
  await selectComboByRandomOption(page, "Day", days);
  await selectComboByRandomOption(page, "Year", years);



  // 3️⃣ İsim + Username
  await fillNameUsernameHuman(page, {
    fullName,
    username,
  });

  // 4️⃣ Submit (Kaydol)
  await sleep(4000);
  await clickKaydol(page);
 
  // ✅ Onay kodu inputunu bekle
  const CONFIRM_SELECTOR = 'input[maxlength="6"]';
 
  await page.waitForSelector(CONFIRM_SELECTOR, {
    visible: true,
    timeout: 60000,
  });
 
 
  console.log("⏳ Gmail API kodu bekleniyor...");
  const code = await waitInstagramCodeAPI({
      tokenFile,
      timeoutMs: 60000,
      pollMs: 3000,
      maxAgeMinutes: 3,
    });
    console.log("🔑 Gelen kod:", code);
 
  await sleep(4300);
  // ✅ Kodu yaz (BURASI ÖNEMLİ)
    // 1️⃣ Kod yaz
  await clearAndType(page, CONFIRM_SELECTOR, code);
  console.log("✍️ Onay kodu yazıldı");

  // 2️⃣ WARP bağlan
  await warpConnect();

  // ekstra güvenlik beklemesi
  await sleep(2500);

  // 3️⃣ Confirm / İleri
  await clickIleri(page);
  console.log("➡️ Confirm tıklandı (WARP aktif)");

  // ✅ hesap oluşturma başarılı mı kontrol et
  await page.waitForFunction(
    () => !location.pathname.includes("confirm"),
    { timeout: 60000 }
  );
 
  console.log("🎉 Hesap başarıyla oluşturuldu");
 
  console.log("⏳ 'Profil' yazısı 25 saniye kontrol ediliyor...");
 
  let profileFound = false;
 
  try {
    await page.waitForFunction(
      () => {
        return [...document.querySelectorAll("span")]
          .some(span => {
            const t = span.innerText?.trim();
            return t === "Profil" || t === "Profile";
          });
      },
      { timeout: 60000 }
    );
 
    profileFound = true;
  } catch (e) {
    profileFound = false;
  }
 
    if (profileFound) {
      console.log("🔐 2FA kurulumu başlıyor...");

      await goTo2FA(page);

      if (await page.$('input[maxlength="6"]')) {
        console.log("ℹ️ 2FA zaten aktif, atlanıyor");
        return;
      }

      await clickAccountUsername(page, username);
      await clickInstagramApp(page);
      await clickDevam(page);

      const secret = await get2FASecret(page);
      await enter2FAHumanLike(page, secret);
      
      await sleep(3000);

      await clickBitti(page);

      await write2FAToSheet({
        username,
          password: PASSWORD_VALUE,
          secret
      });


    }
     
  await sleep(2200);
 
  console.log("🛑 shut.bat çalıştırılıyor...");
  runShutdownBat();
}
 
main()
  .catch((err) => {
    console.error("❌ HATA:", err.message || err);
 
    // hata durumunda da kapat
    setTimeout(() => {
      runShutdownBat();
    }, 2000);
  });
