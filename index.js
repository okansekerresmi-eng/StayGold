const puppeteer = require("puppeteer-core");
const { google } = require("googleapis");
const speakeasy = require("speakeasy");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

/* ================= CONFIG ================= */
const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const INSTAGRAM_LOGIN_URL = "https://www.instagram.com/accounts/login/";
const DEBUG_PORT = 9222;
let linkAdderStarted = false;

const SHEET_ID = "103PO8X7OcXdh76ZqdmdpDhNbuI6yhRo6IxRhnNFgBCw";
const SHEET_NAME = "Insta";
const CREDENTIALS_DIR = path.join(__dirname, "credentials");
/* ========================================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { exec } = require("child_process");
const { execSync } = require("child_process");

function isNetworkError(err) {
  const msg = String(err?.message || err || "").toLowerCase();

  return (
    msg.includes("err_network_changed") ||
    msg.includes("err_connection_reset") ||
    msg.includes("network changed") ||
    msg.includes("execution context was destroyed") ||
    msg.includes("target closed") ||
    msg.includes("navigation failed") ||
    msg.includes("browser has disconnected")
  );
}


function runLinkAdder() {
  if (linkAdderStarted) return;
  linkAdderStarted = true;

  const scriptPath =
    "C:\\Users\\小橙子\\Desktop\\Link-Ekleyici-Insta\\index.js";

  console.log("🔗 Link-Ekleyici başlatılıyor (aynı CMD)...");

  const child = spawn("node", [scriptPath], {
    stdio: "inherit",   // 🔥 LOG'ları aynı terminalde gösterir
    windowsHide: false
  });

  child.on("close", (code) => {
    console.log(`🔗 Link-Ekleyici kapandı (kod: ${code})`);
    linkAdderStarted = false;
  });

  child.on("error", (err) => {
    console.error("❌ Link-Ekleyici başlatılamadı:", err.message);
    linkAdderStarted = false;
  });
}

function waitForDebugPort(timeout = 20000) {
  const start = Date.now();
  const url = `http://127.0.0.1:${DEBUG_PORT}/json/version`;

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeout)
        return reject(new Error("Chrome debug port açılmadı"));

      http.get(url, (res) => {
        if (res.statusCode !== 200) return setTimeout(check, 500);
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.webSocketDebuggerUrl) return resolve();
          } catch {}
          setTimeout(check, 500);
        });
      }).on("error", () => setTimeout(check, 500));
    };
    check();
  });
}

function getRandomCredentialFile() {
  const files = fs.readdirSync(CREDENTIALS_DIR).filter(f => f.endsWith(".json"));
  if (!files.length) throw new Error("credentials klasörü boş");
  return path.join(CREDENTIALS_DIR, files[Math.floor(Math.random() * files.length)]);
}
async function clickConfirmButton(page, timeout = 45000) {
  const rx = "^(confirm|onayla|continue|devam)$";

  // 1) Direct <button> text match
  const btnHandle = await page.waitForFunction(
    (pattern) => {
      const r = new RegExp(pattern, "i");
      const btn = [...document.querySelectorAll("button")]
        .find(b => b.offsetParent !== null && r.test((b.innerText || "").trim()));
      return btn || false;
    },
    { timeout },
    rx
  ).catch(() => null);

  if (btnHandle) {
    await page.evaluate((pattern) => {
      const r = new RegExp(pattern, "i");
      const btn = [...document.querySelectorAll("button")]
        .find(b => b.offsetParent !== null && r.test((b.innerText || "").trim()));
      if (btn) {
        btn.scrollIntoView({ block: "center" });
        btn.click();
      }
    }, rx);

    await page.keyboard.press("Enter");
    return;
  }

  // 2) Fallback: find span and click its clickable parent
  await page.waitForFunction(
    (pattern) => {
      const r = new RegExp(pattern, "i");
      return [...document.querySelectorAll("span, div, button, [role='button']")]
        .some(n =>
          n.offsetParent !== null &&
          r.test(((n.innerText || "")).trim())
        );
    },
    { timeout },
    rx
  );

  await page.evaluate((pattern) => {
    const r = new RegExp(pattern, "i");

    // Prefer button/role=button matches first
    let el =
      [...document.querySelectorAll("button,[role='button']")]
        .find(n => n.offsetParent !== null && r.test((n.innerText || "").trim())) ||
      null;

    // If still not found, try span then climb up
    if (!el) {
      const span = [...document.querySelectorAll("span")]
        .find(s => s.offsetParent !== null && r.test((s.innerText || "").trim()));
      if (!span) throw new Error("Confirm yazısı bulunamadı");

      el = span;
      while (el && el !== document.body) {
        if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") break;
        el = el.parentElement;
      }
    }

    if (!el) throw new Error("Confirm için tıklanabilir eleman bulunamadı");

    el.scrollIntoView({ block: "center" });
    el.click();
  }, rx);

  // 3) Extra guarantee
  await page.keyboard.press("Enter");
}
async function safeGoto(page, url, maxRetry = 5) {
  for (let i = 1; i <= maxRetry; i++) {
    try {
      console.log(`🌐 Gidiliyor: ${url} (deneme ${i})`);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });

      return;
    } catch (err) {
      if (!isNetworkError(err)) {
        throw err;
      }

      const delay = 1500 * i;
      console.log(`⚠️ Network hatası → retry ${i}/${maxRetry} (${delay}ms)`);

      await sleep(delay);

      try {
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
      } catch {}

      if (i === maxRetry) {
        console.log("❌ Maksimum retry aşıldı → hata fırlatılıyor");
        throw err;
      }
    }
  }
}
async function clickSuspendedIcon(page) {
  await page.waitForSelector(
    'div[data-bloks-name="ig.components.Icon"]',
    { timeout: 15000 }
  );

  await page.evaluate(() => {
    const icon = document.querySelector(
      'div[data-bloks-name="ig.components.Icon"]'
    );
    if (!icon) throw new Error("Suspended icon bulunamadı");

    icon.scrollIntoView({ block: "center" });
    icon.click();
  });

  await sleep(1000);
}
async function getUsernameFromLogoutText(page) {
  return await page.evaluate(() => {
    const span = [...document.querySelectorAll(
      'span[data-bloks-name="bk.components.Text"]'
    )].find(s =>
      s.innerText &&
      s.innerText.toLowerCase().startsWith("log out")
    );

    if (!span) return null;

    // "Log out nurayseyfettin777"
    return span.innerText.replace(/log out/i, "").trim();
  });
}
async function markSuspendedByUsername(sheets, username) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  });

  const rows = res.data.values || [];

  const index = rows.findIndex(r =>
    r[0] && r[0].split("-")[0].trim() === username
  );

  if (index === -1) {
    console.log("⚠️ Sheet’te kullanıcı bulunamadı:", username);
    return;
  }

  const rowNumber = index + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!C${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["SUSPENDED"]],
    },
  });

  console.log(`⛔ ${username} → C${rowNumber} = SUSPENDED`);
}

async function getRandomInstagramAccount() {
  const auth = new google.auth.GoogleAuth({
    keyFile: getRandomCredentialFile(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  // A'dan I'ye kadar hepsini çekiyoruz
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`,
  });

  const rows = res.data.values || [];

  const eligible = rows
    .map((r, i) => {
      return {
        row: i + 1,
        A: r[0] || "",
        B: r[1] || "",
        C: r[2] || "",
        D: r[3] || "",
        E: r[4] || "",
        H: r[7] || "",
        I: r[8] || "",
      };
    })
    .filter(r => {
      // A sütunu dolu ve geçerli formatta mı
      if (!r.A || r.A.split("-").length < 3) return false;

      // 🔥 B C D E H I sütunları DOLUYSA seçme
      const anyFilled =
        r.B.trim() !== "" ||
        r.C.trim() !== "" ||
        r.D.trim() !== "" ||
        r.E.trim() !== "" ||
        r.H.trim() !== "" ||
        r.I.trim() !== "";

      return !anyFilled; // sadece hepsi boş olanları seç
    });

  if (!eligible.length)
    throw new Error("Uygun (boş sütunlu) hesap bulunamadı");

  const pick = eligible[Math.floor(Math.random() * eligible.length)];

  const [username, password, rawSecret] = pick.A.split("-");

  console.log("🎯 Seçilen satır:", pick.row);

  return {
    username,
    password,
    rawSecret,
    row: pick.row,
    sheets,
  };
}

function generate2FA(secretRaw) {
  const secret = secretRaw.replace(/\s+/g, "").toUpperCase();
  return speakeasy.totp({
    secret,
    encoding: "base32",
  });
}
async function getLoggedInUsernameIfExists(page) {
  return await page.evaluate(() => {
    const img = [...document.querySelectorAll("img")]
      .find(i =>
        i.alt &&
        i.alt.endsWith("'s profile picture")
      );

    if (!img) return null;

    // "kgizem.bozdagkalaycioglu290's profile picture"
    return img.alt.replace("'s profile picture", "").trim();
  });
}
async function markUserOnline(sheets, username) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  });

  const rows = res.data.values || [];

  const index = rows.findIndex(r => {
    if (!r[0]) return false;
    const sheetUsername = r[0].split("-")[0].trim();
    return sheetUsername === username;
  });

  if (index === -1) {
    console.log("⚠️ Sheet’te kullanıcı bulunamadı:", username);
    return;
  }

  const rowNumber = index + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!C${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["online"]],
    },
  });

  console.log(`🟢 ${username} → C${rowNumber} = online`);
}

function startHumanConfirmWatcher(page, sheets, username, row) {
  let stopped = false;

  const interval = setInterval(async () => {
    if (stopped) return;

    try {
      const flagged = await page.evaluate((u) => {
        const spans = [...document.querySelectorAll("span[role='heading']")];
        return spans.some(s =>
          s.innerText &&
          s.innerText.toLowerCase().includes("confirm you're human") &&
          s.innerText.includes(u)
        );
      }, username);

      if (flagged) {
        stopped = true;
        clearInterval(interval);

        console.log("🚩 HUMAN CONFIRM TESPİT EDİLDİ → FLAGGED");

        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!C${row}`,
          valueInputOption: "RAW",
          requestBody: {
            values: [["Flagged"]],
          },
        });

        console.log(`🚩 C${row} → Flagged`);
      }
    } catch (e) {
      // sessiz geç — navigation sırasında hata olabilir
    }
  }, 1500); // ⏱️ 1.5 saniyede bir kontrol
}

async function checkIfSuspended(page) {
  try {
    return await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();

      return (
        text.includes("account has been suspended") ||
        text.includes("hesabın askıya alındı") ||
        text.includes("your account has been disabled") ||
        text.includes("we suspended your account")
      );
    });
  } catch {
    return false;
  }
}



async function clickLoginButton(page, timeout = 45000) {

  await page.waitForFunction(
    () => {
      return [...document.querySelectorAll("span")]
        .some(s =>
          s.innerText &&
          /^(log in|giriş yap)$/i.test(s.innerText.trim()) &&
          s.offsetParent !== null
        );
    },
    { timeout }
  );

  await Promise.all([
    page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 20000
    }).catch(e => {
      if (!isNetworkError(e)) throw e;
    }),

    page.evaluate(() => {
      const span = [...document.querySelectorAll("span")]
        .find(s =>
          s.innerText &&
          /^(log in|giriş yap)$/i.test(s.innerText.trim()) &&
          s.offsetParent !== null
        );

      if (!span) throw new Error("Login span bulunamadı");

      let el = span;
      while (el && el !== document.body) {
        if (
          el.tagName === "BUTTON" ||
          el.getAttribute("role") === "button"
        ) break;
        el = el.parentElement;
      }

      if (!el) throw new Error("Login için tıklanabilir parent yok");

      el.scrollIntoView({ block: "center" });
      el.click();
    })
  ]);

  await new Promise(r => setTimeout(r, 1500));
}

async function typeFirstAvailable(page, selectors, text) {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { visible: true, timeout: 4000 });

      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.focus();
        el.value = "";
        el.setAttribute("autocomplete", "off");
        el.setAttribute("autocorrect", "off");
        el.setAttribute("autocapitalize", "off");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, selector);

      const delay = Math.floor(Math.random() * 120) + 40;
      await page.type(selector, text, { delay });
      return;
    } catch {}
  }
  throw new Error("Hiçbir input bulunamadı");
}

/* ================= MAIN ================= */
(async () => {
  try {
    await waitForDebugPort();

    // Google Sheets auth
    const auth = new google.auth.GoogleAuth({
      keyFile: getRandomCredentialFile(),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // Açık Chrome’a bağlan
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
      defaultViewport: null,
    });

    const page = (await browser.pages())[0] || (await browser.newPage());

    // Instagram ana sayfasına git
    await safeGoto(page, "https://www.instagram.com/");

    if (await checkIfSuspended(page)) {
      console.log("⛔ Hesap SUSPENDED");

      await clickSuspendedIcon(page);
      const suspendedUsername = await getUsernameFromLogoutText(page);

      if (suspendedUsername) {
        await markSuspendedByUsername(sheets, suspendedUsername);
      }
      return;
    }

    /* ================= ZATEN LOGIN VAR MI ================= */
    let loggedUser = await getLoggedInUsernameIfExists(page);
    if (loggedUser) {
      console.log("✅ Zaten login:", loggedUser);
      runLinkAdder();
      return;
    }

    /* ================= LOGIN FLOW ================= */
    const { username, password, rawSecret, row } =
      await getRandomInstagramAccount();

    startHumanConfirmWatcher(page, sheets, username, row);
    console.log("📸 Login yapılacak IG:", username);

    await safeGoto(page, INSTAGRAM_LOGIN_URL);

    if (await checkIfSuspended(page)) {
      console.log("⛔ Hesap SUSPENDED (login sayfası)");

      await clickSuspendedIcon(page);
      const suspendedUsername = await getUsernameFromLogoutText(page);
      if (suspendedUsername)
        await markSuspendedByUsername(sheets, suspendedUsername);
      return;
    }

    // USERNAME
    await typeFirstAvailable(
      page,
      [
        'input[name="username"]',
        'input[name="email"]',
        'input[autocomplete="username"]',
      ],
      username
    );

    // PASSWORD
    await typeFirstAvailable(
      page,
      [
        'input[name="password"]',
        'input[name="pass"]',
        'input[autocomplete="current-password"]',
      ],
      password
    );

    await clickLoginButton(page);
    console.log("🔐 Login gönderildi");

    /* ================= 2FA ================= */
    try {
      await page.waitForSelector('input[name="verificationCode"]', {
        timeout: 60000,
      });

      const code = generate2FA(rawSecret);

      await typeFirstAvailable(
        page,
        ['input[name="verificationCode"]', 'input[type="tel"]'],
        code
      );

      await Promise.all([
        page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 20000,
          })
          .catch((e) => {
            if (!isNetworkError(e)) throw e;
          }),
        clickConfirmButton(page),
      ]);

      await sleep(1500);
    } catch (e) {
      console.log("⚠️ 2FA ekranı gelmedi → Login kontrol ediliyor...");

      const loggedAfterFail =
        await getLoggedInUsernameIfExists(page);

      if (!loggedAfterFail)
        throw new Error("2FA başarısız ve login yapılmamış");

      console.log("✅ Login başarılı:", loggedAfterFail);
    }

    if (await checkIfSuspended(page)) {
      console.log("⛔ Hesap SUSPENDED (login sonrası)");

      await clickSuspendedIcon(page);
      const suspendedUsername =
        await getUsernameFromLogoutText(page);

      if (suspendedUsername)
        await markSuspendedByUsername(sheets, suspendedUsername);
      return;
    }

    const finalUser =
      (await getLoggedInUsernameIfExists(page)) || username;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!B${row}`,
      valueInputOption: "RAW",
      requestBody: { values: [["+"]] },
    });

    console.log(`➕ Sheet işaretlendi → B${row}`);

    if (finalUser) {
      await markUserOnline(sheets, finalUser);
    }

    /* ================= LINK EKLEYİCİ ================= */
    runLinkAdder();

  } catch (err) {
    console.error("❌ HATA:", err.message || err);
  }
})();



// 🔥 Supervisor nazik kapatma desteği
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM alındı → Chrome kapatılıyor...");
  try {
    require("child_process").execSync("taskkill /F /IM chrome.exe", { stdio: "ignore" });
  } catch {}
  process.exit(0);
});
