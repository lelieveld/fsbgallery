const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.GALLERY_PASSWORD || "veranderdit";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "beheerdit";
const SESSION_SECRET = process.env.SESSION_SECRET || "lokale-test-sessie-verander-dit-op-render";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const DOWNLOAD_LOG_FILE = process.env.DOWNLOAD_LOG_FILE || path.join(UPLOAD_DIR, "downloads.jsonl");
const GALLERY_FILE = process.env.GALLERY_FILE || path.join(UPLOAD_DIR, "galleries.json");
const CLOUDINARY_PHOTO_FILE = process.env.CLOUDINARY_PHOTO_FILE || path.join(UPLOAD_DIR, "cloudinary-photos.json");
const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(UPLOAD_DIR, "settings.json");
const cloudinaryUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL || "");
const CLOUDINARY_CLOUD_NAME = ((cloudinaryUrl.cloudName || process.env.CLOUDINARY_CLOUD_NAME) || "").trim();
const CLOUDINARY_API_KEY = ((cloudinaryUrl.apiKey || process.env.CLOUDINARY_API_KEY) || "").trim();
const CLOUDINARY_API_SECRET = ((cloudinaryUrl.apiSecret || process.env.CLOUDINARY_API_SECRET) || "").trim();
const CLOUDINARY_BASE_FOLDER = (process.env.CLOUDINARY_BASE_FOLDER || "fetish-social-brabant").trim();
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const COOKIE_NAME = "gallery_auth";

const defaultGalleries = [
  { slug: "oude-social-fotos", title: "Oude social foto's" },
  { slug: "eindhoven-pride-26", title: "Eindhoven Pride 26" },
  { slug: "roze-maandag-26", title: "Roze Maandag 26" }
];

const imageTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function parseCloudinaryUrl(value) {
  if (!value) return {};

  try {
    const cleaned = value.trim().replace(/^CLOUDINARY_URL=/, "");
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "cloudinary:") return {};

    return {
      apiKey: decodeURIComponent(parsed.username || ""),
      apiSecret: decodeURIComponent(parsed.password || ""),
      cloudName: (parsed.hostname || "").trim()
    };
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function makeSessionCookie(session) {
  const payload = JSON.stringify({ ...session, expires: Date.now() + 1000 * 60 * 60 * 8 });
  const encoded = base64Url(payload);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encoded}.${sign(encoded)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return [part.slice(0, separator), part.slice(separator + 1)];
      })
  );
}

function getSession(req) {
  const cookie = parseCookies(req)[COOKIE_NAME];
  if (!cookie || !cookie.includes(".")) return null;

  const [encoded, signature] = cookie.split(".");
  if (signature !== sign(encoded)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.expires > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function isAuthenticated(req) {
  return Boolean(getSession(req));
}

function isAdmin(req) {
  return getSession(req)?.role === "admin";
}

async function readSettings() {
  try {
    return JSON.parse(await fs.promises.readFile(SETTINGS_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeSettings(settings) {
  await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

async function verifyVisitorPassword(password) {
  const settings = await readSettings();
  const visitor = settings.visitorPassword;

  if (visitor?.salt && visitor?.hash) {
    return hashPassword(password, visitor.salt) === visitor.hash;
  }

  return password === PASSWORD;
}

async function updateVisitorPassword(password) {
  const cleanPassword = String(password || "").trim();
  if (cleanPassword.length < 6) throw new Error("Gebruik minimaal 6 tekens voor het bezoekerswachtwoord.");

  const settings = await readSettings();
  const salt = crypto.randomBytes(16).toString("hex");
  settings.visitorPassword = {
    salt,
    hash: hashPassword(cleanPassword, salt),
    updatedAt: new Date().toISOString()
  };
  await writeSettings(settings);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);
}

function safeGalleryDir(slug) {
  const normalized = slugify(slug);
  if (!normalized) return null;

  const resolved = path.resolve(UPLOAD_DIR, normalized);
  const root = path.resolve(UPLOAD_DIR);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

function safeImagePath(gallerySlug, filename) {
  const galleryDir = safeGalleryDir(gallerySlug);
  if (!galleryDir) return null;

  const name = path.basename(filename);
  const extension = path.extname(name).toLowerCase();
  if (!imageTypes.has(extension)) return null;

  const resolved = path.resolve(galleryDir, name);
  return resolved.startsWith(galleryDir + path.sep) ? resolved : null;
}

async function ensureGalleryDirs(galleries) {
  await Promise.all(galleries.map((gallery) => fs.promises.mkdir(safeGalleryDir(gallery.slug), { recursive: true })));
}

async function migrateLegacyPhotos(targetSlug) {
  const targetDir = safeGalleryDir(targetSlug);
  if (!targetDir) return;

  const entries = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && imageTypes.has(path.extname(entry.name).toLowerCase()))
      .map(async (entry) => {
        const from = path.join(UPLOAD_DIR, entry.name);
        const to = path.join(targetDir, entry.name);
        if (!fs.existsSync(to)) await fs.promises.rename(from, to);
      })
  );
}

async function saveGalleries(galleries) {
  await ensureGalleryDirs(galleries);
  await fs.promises.writeFile(GALLERY_FILE, JSON.stringify(galleries, null, 2), "utf8");
}

async function listGalleries() {
  try {
    const galleries = JSON.parse(await fs.promises.readFile(GALLERY_FILE, "utf8"));
    if (Array.isArray(galleries) && galleries.length) {
      await ensureGalleryDirs(galleries);
      await migrateLegacyPhotos(galleries[0].slug);
      return galleries;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await saveGalleries(defaultGalleries);
  await migrateLegacyPhotos(defaultGalleries[0].slug);
  return defaultGalleries;
}

async function createGallery(title) {
  const cleanTitle = String(title || "").trim().slice(0, 80);
  const slug = slugify(cleanTitle);
  if (!cleanTitle || !slug) throw new Error("Vul een geldige galerijnaam in.");

  const galleries = await listGalleries();
  if (galleries.some((gallery) => gallery.slug === slug)) throw new Error("Deze galerij bestaat al.");

  galleries.push({ slug, title: cleanTitle });
  await saveGalleries(galleries);
}

async function deleteGallery(slug) {
  const galleries = await listGalleries();
  const nextGalleries = galleries.filter((gallery) => gallery.slug !== slug);
  if (nextGalleries.length === galleries.length) return;
  if (nextGalleries.length === 0) throw new Error("Je moet minimaal een galerij overhouden.");

  await saveGalleries(nextGalleries);
  await removeCloudinaryGallery(slug);
  const galleryDir = safeGalleryDir(slug);
  if (galleryDir && fs.existsSync(galleryDir)) {
    await fs.promises.rm(galleryDir, { recursive: true, force: true });
  }
}

async function listPhotos(gallerySlug) {
  const galleryDir = safeGalleryDir(gallerySlug);
  if (!galleryDir) return [];

  await fs.promises.mkdir(galleryDir, { recursive: true });
  const entries = await fs.promises.readdir(galleryDir, { withFileTypes: true });
  const localPhotos = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && imageTypes.has(path.extname(entry.name).toLowerCase()))
      .map(async (entry) => {
        const fullPath = path.join(galleryDir, entry.name);
        const stats = await fs.promises.stat(fullPath);
        return {
          source: "local",
          name: entry.name,
          uploadedAt: stats.mtime,
          size: stats.size,
          url: `/photo/${encodeURIComponent(gallerySlug)}/${encodeURIComponent(entry.name)}`,
          downloadUrl: `/download/${encodeURIComponent(gallerySlug)}/${encodeURIComponent(entry.name)}`
        };
      })
  );

  const cloudPhotos = (await listCloudinaryPhotos(gallerySlug)).map((photo) => ({
    ...photo,
    uploadedAt: new Date(photo.uploadedAt || 0),
    url: photo.secureUrl,
    downloadUrl: `/download/${encodeURIComponent(gallerySlug)}/${encodeURIComponent(photo.id)}`
  }));

  return [...cloudPhotos, ...localPhotos].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

async function listGalleryPhotoMap(galleries) {
  const entries = await Promise.all(galleries.map(async (gallery) => [gallery.slug, await listPhotos(gallery.slug)]));
  return Object.fromEntries(entries);
}

function cloudinaryConfigured() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
}

function cloudinarySignature(params) {
  const payload = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return crypto.createHash("sha1").update(`${payload}${CLOUDINARY_API_SECRET}`).digest("hex");
}

function postCloudinary(endpoint, fields) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(fields).toString();
    const req = https.request(
      {
        hostname: "api.cloudinary.com",
        path: `/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}${endpoint}`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { error: { message: text } };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(data.error?.message || "Cloudinary aanvraag mislukt."));
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getCloudinary(endpoint, params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const auth = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString("base64");
    const req = https.request(
      {
        hostname: "api.cloudinary.com",
        path: `/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}${endpoint}?${query}`,
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { error: { message: text } };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(data.error?.message || "Cloudinary lijst ophalen mislukt."));
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

async function readCloudinaryPhotoStore() {
  try {
    const data = JSON.parse(await fs.promises.readFile(CLOUDINARY_PHOTO_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeCloudinaryPhotoStore(store) {
  await fs.promises.writeFile(CLOUDINARY_PHOTO_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function listCloudinaryPhotos(gallerySlug) {
  if (cloudinaryConfigured()) {
    try {
      const prefix = `${CLOUDINARY_BASE_FOLDER}/${gallerySlug}/`;
      const result = await getCloudinary("/resources/image/upload", {
        prefix,
        context: "true",
        max_results: "500",
        direction: "desc"
      });

      return (result.resources || []).map((resource) => {
        const context = resource.context?.custom || resource.context || {};
        return {
          source: "cloudinary",
          id: resource.public_id,
          name: `${path.basename(resource.public_id)}.${resource.format || "jpg"}`,
          publicId: resource.public_id,
          secureUrl: resource.secure_url,
          uploadedAt: resource.created_at || new Date().toISOString(),
          size: resource.bytes || 0,
          uploaderName: context.submitter_name || ""
        };
      });
    } catch (error) {
      console.error("Cloudinary lijst ophalen mislukt:", error.message);
    }
  }

  const store = await readCloudinaryPhotoStore();
  return Array.isArray(store[gallerySlug]) ? store[gallerySlug] : [];
}

async function saveCloudinaryPhoto(gallerySlug, photo) {
  const store = await readCloudinaryPhotoStore();
  store[gallerySlug] = Array.isArray(store[gallerySlug]) ? store[gallerySlug] : [];
  store[gallerySlug].unshift(photo);
  await writeCloudinaryPhotoStore(store);
}

async function removeCloudinaryPhoto(gallerySlug, photoId) {
  if (cloudinaryConfigured() && photoId.includes(`${CLOUDINARY_BASE_FOLDER}/`)) {
    await destroyCloudinaryImage(photoId);
  }

  const store = await readCloudinaryPhotoStore();
  const photos = Array.isArray(store[gallerySlug]) ? store[gallerySlug] : [];
  const photo = photos.find((item) => item.id === photoId);
  store[gallerySlug] = photos.filter((item) => item.id !== photoId);
  await writeCloudinaryPhotoStore(store);
  return photo || null;
}

async function removeCloudinaryGallery(gallerySlug) {
  const store = await readCloudinaryPhotoStore();
  const photos = Array.isArray(store[gallerySlug]) ? store[gallerySlug] : [];
  for (const photo of photos) {
    if (cloudinaryConfigured()) await destroyCloudinaryImage(photo.publicId);
  }
  delete store[gallerySlug];
  await writeCloudinaryPhotoStore(store);
}

async function uploadToCloudinary(gallerySlug, file) {
  if (!cloudinaryConfigured()) throw new Error("Cloudinary is nog niet ingesteld.");

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${CLOUDINARY_BASE_FOLDER}/${gallerySlug}`;
  const uploadParams = { folder, timestamp };
  const signature = cloudinarySignature(uploadParams);
  const dataUri = `data:${file.contentType};base64,${file.data.toString("base64")}`;
  const result = await postCloudinary("/image/upload", {
    file: dataUri,
    folder,
    timestamp,
    api_key: CLOUDINARY_API_KEY,
    signature
  });

  const cleanName = path.basename(file.originalName);
  return {
    source: "cloudinary",
    id: result.public_id,
    name: cleanName,
    publicId: result.public_id,
    secureUrl: result.secure_url,
    uploadedAt: result.created_at || new Date().toISOString(),
    size: result.bytes || file.data.length
  };
}

function cloudinaryContextValue(value) {
  return String(value || "")
    .trim()
    .slice(0, 120)
    .replace(/[|=]/g, " ");
}

async function uploadPendingToCloudinary(file, submitter) {
  if (!cloudinaryConfigured()) throw new Error("Cloudinary is nog niet ingesteld.");

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${CLOUDINARY_BASE_FOLDER}/pending`;
  const context = `submitter_name=${cloudinaryContextValue(submitter.name)}|submitter_email=${cloudinaryContextValue(submitter.email)}`;
  const uploadParams = { context, folder, timestamp };
  const signature = cloudinarySignature(uploadParams);
  const dataUri = `data:${file.contentType};base64,${file.data.toString("base64")}`;

  await postCloudinary("/image/upload", {
    file: dataUri,
    context,
    folder,
    timestamp,
    api_key: CLOUDINARY_API_KEY,
    signature
  });
}

async function listPendingUploads() {
  if (!cloudinaryConfigured()) return [];

  const prefix = `${CLOUDINARY_BASE_FOLDER}/pending/`;
  const result = await getCloudinary("/resources/image/upload", {
    prefix,
    context: "true",
    max_results: "500",
    direction: "desc"
  });

  return (result.resources || []).map((resource) => {
    const context = resource.context?.custom || resource.context || {};
    return {
      id: resource.public_id,
      publicId: resource.public_id,
      name: `${path.basename(resource.public_id)}.${resource.format || "jpg"}`,
      secureUrl: resource.secure_url,
      uploadedAt: resource.created_at || new Date().toISOString(),
      submitterName: context.submitter_name || "Onbekend",
      submitterEmail: context.submitter_email || "Onbekend"
    };
  });
}

async function approvePendingUpload(publicId, gallerySlug, uploaderName = "") {
  if (!cloudinaryConfigured()) throw new Error("Cloudinary is nog niet ingesteld.");

  const galleries = await listGalleries();
  if (!galleries.some((gallery) => gallery.slug === gallerySlug)) throw new Error("Deze galerij bestaat niet.");

  const timestamp = Math.floor(Date.now() / 1000);
  const extensionlessName = path.basename(publicId);
  const toPublicId = `${CLOUDINARY_BASE_FOLDER}/${gallerySlug}/${Date.now()}-${extensionlessName}`;
  const params = { from_public_id: publicId, overwrite: "true", timestamp, to_public_id: toPublicId };
  const signature = cloudinarySignature(params);
  await postCloudinary("/image/rename", {
    ...params,
    api_key: CLOUDINARY_API_KEY,
    signature
  });

  const context = `submitter_name=${cloudinaryContextValue(uploaderName)}`;
  const contextTimestamp = Math.floor(Date.now() / 1000);
  const contextParams = { context, public_id: toPublicId, timestamp: contextTimestamp, type: "upload" };
  await postCloudinary("/image/upload/explicit", {
    ...contextParams,
    api_key: CLOUDINARY_API_KEY,
    signature: cloudinarySignature(contextParams)
  });
}

async function destroyCloudinaryImage(publicId) {
  if (!cloudinaryConfigured() || !publicId) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const params = { invalidate: "true", public_id: publicId, timestamp };
  const signature = cloudinarySignature(params);
  await postCloudinary("/image/destroy", {
    ...params,
    api_key: CLOUDINARY_API_KEY,
    signature
  });
}

function formatDate(value) {
  if (!value) return "Onbekend";

  try {
    return new Intl.DateTimeFormat("nl-NL", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Amsterdam"
    }).format(new Date(value));
  } catch {
    return "Onbekend";
  }
}

async function listDownloads() {
  try {
    const contents = await fs.promises.readFile(DOWNLOAD_LOG_FILE, "utf8");
    return contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort((a, b) => new Date(b.downloadedAt) - new Date(a.downloadedAt))
      .slice(0, 200);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function logDownload(req, gallery, filename) {
  const session = getSession(req);
  const entry = {
    username: session?.username || "Beheerder",
    gallery,
    filename,
    downloadedAt: new Date().toISOString()
  };

  await fs.promises.appendFile(DOWNLOAD_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>${body}</body>
</html>`;
}

function topbar() {
  return `<header class="topbar">
    <a class="brand" href="/gallery"><span>Fetish</span> Social Brabant</a>
    <nav aria-label="Navigatie">
      <a href="/gallery">Galerij</a>
      <a href="/admin">Beheer</a>
      <form action="/logout" method="post"><button class="text-button" type="submit">Uitloggen</button></form>
    </nav>
  </header>`;
}

function renderLogin(error = "") {
  return pageShell(
    "Besloten fotogalerij",
    `<main class="login-shell">
      <section class="poster-hero" aria-label="Fetish Social Brabant foto gallery">
        <img src="/fetish-social-brabant.png" alt="Fetish Social Brabant foto gallery" />
      </section>
      <section class="login-panel" aria-label="Inloggen">
        <p class="eyebrow">Foto gallery</p>
        <h1>Fetish Social Brabant</h1>
        <p class="intro">Bekijk en download de socials foto's in hoge kwaliteit.</p>
        <form class="login-form" action="/login" method="post">
          <label for="username">Naam</label>
          <input id="username" name="username" type="text" autocomplete="name" required autofocus />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
          <button type="submit">Bekijk & download</button>
        </form>
      </section>
    </main>`
  ).replace("<body>", '<body class="login-page">');
}

function renderAdminLogin(error = "") {
  return pageShell(
    "Beheer login",
    `<main class="login-shell compact-login">
      <section class="poster-hero" aria-label="Fetish Social Brabant foto gallery">
        <img src="/fetish-social-brabant.png" alt="Fetish Social Brabant foto gallery" />
      </section>
      <section class="login-panel" aria-label="Beheer inloggen">
        <p class="eyebrow">Beheer</p>
        <h1>Admin toegang</h1>
        <p class="intro">Log in met het beheerderswachtwoord om galerijen, uploads en downloads te bekijken.</p>
        <form class="login-form" action="/admin/login" method="post">
          <label for="admin-password">Beheer password</label>
          <input id="admin-password" name="password" type="password" autocomplete="current-password" required autofocus />
          ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
          <button type="submit">Naar beheer</button>
        </form>
      </section>
    </main>`
  ).replace("<body>", '<body class="login-page">');
}

function renderGallery(galleries, activeGallery, photos, notice = "", error = "") {
  const active = activeGallery || galleries[0];
  const galleryButtons = galleries
    .map(
      (gallery) => `<a class="gallery-tab ${gallery.slug === active.slug ? "is-active" : ""}" href="/gallery?g=${encodeURIComponent(gallery.slug)}">
        <span>${escapeHtml(gallery.title)}</span>
        <small>Bekijk & download</small>
      </a>`
    )
    .join("");

  const content = photos.length
    ? `<section class="photo-grid" aria-label="Foto's">
        ${photos
          .map((photo, index) => {
            const cleanName = photo.name.replace(/^\d+-/, "");
            const photoUrl = photo.url;
            const downloadUrl = photo.downloadUrl;
            return `<article class="photo-card">
              <button class="thumbnail-button" type="button" data-index="${index}" data-src="${photoUrl}" data-name="${escapeHtml(cleanName)}" data-download="${downloadUrl}">
                <img src="${photoUrl}" alt="Foto ${escapeHtml(photo.name)}" loading="lazy" />
              </button>
              ${photo.uploaderName ? `<p class="photo-credit">photo's by: ${escapeHtml(photo.uploaderName)}</p>` : ""}
              <div class="photo-actions">
                <span>${escapeHtml(cleanName)}</span>
                <a href="${downloadUrl}">Download</a>
              </div>
            </article>`;
          })
          .join("")}
      </section>`
    : `<section class="empty-state">
        <h2>Nog geen foto's</h2>
        <p>Upload eerst foto's in deze galerij via beheer, dan verschijnen ze hier als kleine thumbnails.</p>
        <a class="button-link" href="/admin">Naar beheer</a>
      </section>`;

  return pageShell(
    "Foto's bekijken",
    `${topbar()}<main class="page">
      <section class="page-heading">
        <p class="eyebrow">Foto gallery</p>
        <h1>Bekijk & download</h1>
        <p class="section-line">Kies een galerij, open een thumbnail groter en blader door de foto's.</p>
      </section>
      <section class="visitor-submit">
        <div>
          <p class="eyebrow">Foto's insturen</p>
          <h2>Deel jouw foto's</h2>
          <p class="section-line">Je upload komt eerst in beheer terecht. Pas na goedkeuring wordt hij zichtbaar voor iedereen.</p>
        </div>
        <form action="/submit-photos" method="post" enctype="multipart/form-data">
          <label for="submitter-name">Naam</label>
          <p class="field-hint">Deze naam wordt zichtbaar voor alle bezoekers als je foto wordt goedgekeurd.</p>
          <input id="submitter-name" name="name" type="text" required />
          <label for="submitter-email">E-mail</label>
          <p class="field-hint">Je e-mailadres blijft verborgen en is alleen zichtbaar voor beheer.</p>
          <input id="submitter-email" name="email" type="email" required />
          <label for="submitter-photos">Foto's</label>
          <input id="submitter-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required />
          <button type="submit">Insturen</button>
          ${notice ? `<p class="success">${escapeHtml(notice)}</p>` : ""}
          ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        </form>
      </section>
      <section class="gallery-tabs" aria-label="Galerijen">
        ${galleryButtons}
      </section>
      <section class="gallery-title">
        <p class="eyebrow">Geselecteerd</p>
        <h2>${escapeHtml(active.title)}</h2>
      </section>
      ${content}
      <div class="lightbox" id="lightbox" aria-hidden="true">
        <button class="lightbox-close" type="button" aria-label="Sluiten">X</button>
        <button class="lightbox-nav lightbox-prev" type="button" aria-label="Vorige foto">‹</button>
        <figure>
          <img id="lightbox-image" src="" alt="" />
          <figcaption>
            <span id="lightbox-title"></span>
            <a id="lightbox-download" href="#">Download</a>
          </figcaption>
        </figure>
        <button class="lightbox-nav lightbox-next" type="button" aria-label="Volgende foto">›</button>
      </div>
      <script src="/gallery.js"></script>
    </main>`
  );
}

function renderAdmin(galleries, photoMap, downloads, pendingUploads, message = "", error = "") {
  const galleryRows = galleries
    .map((gallery) => {
      const photos = photoMap[gallery.slug] || [];
      const photoRows = photos.length
        ? photos
            .map(
              (photo) => `<article class="manage-row">
                <img src="${escapeHtml(photo.url)}" alt="Foto ${escapeHtml(photo.name)}" loading="lazy" />
                <span>${escapeHtml(photo.name.replace(/^\d+-/, ""))}</span>
                <form action="/admin/delete-photo/${encodeURIComponent(gallery.slug)}/${encodeURIComponent(photo.source === "cloudinary" ? photo.id : photo.name)}" method="post">
                  <button class="danger-button" type="submit">Verwijderen</button>
                </form>
              </article>`
    )
            .join("")
        : `<p class="muted">Nog geen foto's in deze galerij.</p>`;

      return `<section class="admin-gallery">
        <div class="admin-gallery-head">
          <div>
            <p class="eyebrow">Galerij</p>
            <h2>${escapeHtml(gallery.title)}</h2>
          </div>
          <form action="/admin/delete-gallery/${encodeURIComponent(gallery.slug)}" method="post">
            <button class="danger-button" type="submit">Galerij verwijderen</button>
          </form>
        </div>
        <form class="upload-form" action="/admin/upload/${encodeURIComponent(gallery.slug)}" method="post" enctype="multipart/form-data">
          <label for="photos-${escapeHtml(gallery.slug)}">Foto's uploaden in ${escapeHtml(gallery.title)}</label>
          <input id="photos-${escapeHtml(gallery.slug)}" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required />
          <button type="submit">Uploaden</button>
        </form>
        <div class="manage-list" aria-label="Foto's in ${escapeHtml(gallery.title)}">
          ${photoRows}
        </div>
      </section>`;
    })
    .join("");

  const downloadRows = downloads.length
    ? downloads
        .map(
          (entry) => `<article class="download-row">
            <span>${escapeHtml(entry.username || "Onbekend")}</span>
            <span>${escapeHtml(entry.gallery || "Onbekende galerij")}</span>
            <span>${escapeHtml(entry.filename || "Onbekend bestand")}</span>
            <time datetime="${escapeHtml(entry.downloadedAt || "")}">${escapeHtml(formatDate(entry.downloadedAt))}</time>
          </article>`
        )
        .join("")
    : `<p class="muted">Er zijn nog geen downloads geregistreerd.</p>`;

  const galleryOptions = galleries.map((gallery) => `<option value="${escapeHtml(gallery.slug)}">${escapeHtml(gallery.title)}</option>`).join("");
  const pendingRows = pendingUploads.length
    ? pendingUploads
        .map(
          (photo) => `<article class="pending-row">
            <img src="${escapeHtml(photo.secureUrl)}" alt="Ingezonden foto ${escapeHtml(photo.name)}" loading="lazy" />
            <div>
              <span>${escapeHtml(photo.submitterName)}</span>
              <small>${escapeHtml(photo.submitterEmail)}</small>
              <small>${escapeHtml(formatDate(photo.uploadedAt))}</small>
            </div>
            <form action="/admin/approve-submission/${encodeURIComponent(photo.publicId)}" method="post">
              <input type="hidden" name="uploaderName" value="${escapeHtml(photo.submitterName)}" />
              <label for="approve-${escapeHtml(photo.publicId)}">Naar galerij</label>
              <select id="approve-${escapeHtml(photo.publicId)}" name="gallery" required>
                ${galleryOptions}
              </select>
              <button type="submit">Goedkeuren</button>
            </form>
            <form action="/admin/reject-submission/${encodeURIComponent(photo.publicId)}" method="post">
              <button class="danger-button" type="submit">Afwijzen</button>
            </form>
          </article>`
        )
        .join("")
    : `<p class="muted">Er zijn geen nieuwe inzendingen.</p>`;

  return pageShell(
    "Foto's beheren",
    `${topbar()}<main class="page admin-page">
      <section class="page-heading">
        <p class="eyebrow">Beheer</p>
        <h1>Galerijen beheren</h1>
        <p class="section-line">Maak galerijen aan, verwijder galerijen en upload of verwijder foto's per galerij.</p>
      </section>
      <section class="upload-panel">
        <p class="cloudinary-status">${cloudinaryConfigured() ? "Cloudinary opslag is actief." : "Cloudinary is nog niet ingesteld; uploads blijven tijdelijk lokaal."}</p>
        <form action="/admin/create-gallery" method="post">
          <label for="gallery-title">Nieuwe galerij aanmaken</label>
          <input id="gallery-title" name="title" type="text" placeholder="Bijvoorbeeld: Nieuwe social foto's" required />
          <button type="submit">Galerij aanmaken</button>
        </form>
        ${message ? `<p class="success">${escapeHtml(message)}</p>` : ""}
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      </section>
      <section class="upload-panel">
        <form action="/admin/update-visitor-password" method="post">
          <label for="visitor-password">Bezoekerswachtwoord aanpassen</label>
          <input id="visitor-password" name="password" type="password" autocomplete="new-password" minlength="6" required />
          <button type="submit">Wachtwoord opslaan</button>
        </form>
      </section>
      <section class="pending-list" aria-label="Ingezonden foto's">
        <h2>Inzendingen</h2>
        ${pendingRows}
      </section>
      ${galleryRows}
      <section class="download-log" aria-label="Download overzicht">
        <h2>Downloads</h2>
        <div class="download-head" aria-hidden="true">
          <span>Naam</span>
          <span>Galerij</span>
          <span>Foto</span>
          <span>Tijd</span>
        </div>
        ${downloadRows}
      </section>
    </main>`
  );
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error("De upload is te groot. Gebruik maximaal 60 MB per keer."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseUrlEncoded(buffer) {
  return new URLSearchParams(buffer.toString("utf8"));
}

function sanitizeFilename(originalName) {
  const extension = path.extname(originalName).toLowerCase();
  const baseName = path
    .basename(originalName, extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);

  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${baseName || "foto"}${extension}`;
}

function parseMultipart(buffer, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const files = [];
  const fields = {};
  let cursor = 0;

  while (cursor < buffer.length) {
    const partStart = buffer.indexOf(marker, cursor);
    if (partStart === -1) break;

    let contentStart = partStart + marker.length;
    if (buffer.slice(contentStart, contentStart + 2).toString() === "--") break;
    if (buffer.slice(contentStart, contentStart + 2).toString() === "\r\n") contentStart += 2;

    const partEnd = buffer.indexOf(marker, contentStart);
    if (partEnd === -1) break;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), contentStart);
    if (headerEnd !== -1 && headerEnd < partEnd) {
      const headers = buffer.slice(contentStart, headerEnd).toString("latin1");
      const fieldMatch = headers.match(/name="([^"]*)"/i);
      const filenameMatch = headers.match(/filename="([^"]*)"/i);
      const typeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
      const dataEnd = buffer.slice(partEnd - 2, partEnd).toString() === "\r\n" ? partEnd - 2 : partEnd;
      const data = buffer.slice(headerEnd + 4, dataEnd);

      if (filenameMatch && filenameMatch[1]) {
        const originalName = path.basename(filenameMatch[1]);
        const extension = path.extname(originalName).toLowerCase();
        const contentType = typeMatch ? typeMatch[1].trim().toLowerCase() : "";

        if (imageTypes.has(extension) && contentType.startsWith("image/") && data.length > 0) {
          files.push({ originalName, contentType, data });
        }
      } else if (fieldMatch && fieldMatch[1]) {
        fields[fieldMatch[1]] = data.toString("utf8").trim();
      }
    }

    cursor = partEnd;
  }

  return { files, fields };
}

async function saveUploadedPhotos(req, gallerySlug) {
  const galleryDir = safeGalleryDir(gallerySlug);
  if (!galleryDir) throw new Error("Deze galerij bestaat niet.");

  const galleries = await listGalleries();
  if (!galleries.some((gallery) => gallery.slug === gallerySlug)) throw new Error("Deze galerij bestaat niet.");

  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Geen geldige upload ontvangen.");

  const body = await collectBody(req);
  const { files } = parseMultipart(body, boundaryMatch[1] || boundaryMatch[2]);
  if (files.length === 0) throw new Error("Kies minimaal een JPG, PNG, WebP of GIF.");

  if (cloudinaryConfigured()) {
    for (const file of files) {
      await saveCloudinaryPhoto(gallerySlug, await uploadToCloudinary(gallerySlug, file));
    }
    return;
  }

  await fs.promises.mkdir(galleryDir, { recursive: true });
  await Promise.all(files.map((file) => fs.promises.writeFile(path.join(galleryDir, sanitizeFilename(file.originalName)), file.data)));
}

async function saveVisitorSubmission(req) {
  if (!cloudinaryConfigured()) throw new Error("Cloudinary moet actief zijn voor bezoekersinzendingen.");

  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Geen geldige upload ontvangen.");

  const body = await collectBody(req);
  const { files, fields } = parseMultipart(body, boundaryMatch[1] || boundaryMatch[2]);
  const name = String(fields.name || "").trim().slice(0, 80);
  const email = String(fields.email || "").trim().slice(0, 120);

  if (!name) throw new Error("Naam is verplicht.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Vul een geldig e-mailadres in.");
  if (files.length === 0) throw new Error("Kies minimaal een JPG, PNG, WebP of GIF.");

  for (const file of files) {
    await uploadPendingToCloudinary(file, { name, email });
  }
}

async function serveStatic(req, res, pathname) {
  const staticFiles = new Map([
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/gallery.js", ["gallery.js", "application/javascript; charset=utf-8"]],
    ["/fetish-social-brabant.png", ["fetish-social-brabant.png", "image/png"]]
  ]);

  if (!staticFiles.has(pathname)) return false;

  const [fileName, contentType] = staticFiles.get(pathname);
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" });
  fs.createReadStream(path.join(PUBLIC_DIR, fileName)).pipe(res);
  return true;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (await serveStatic(req, res, pathname)) return;

  if (req.method === "GET" && pathname === "/") {
    if (isAuthenticated(req)) redirect(res, "/gallery");
    else sendHtml(res, renderLogin());
    return;
  }

  if (req.method === "POST" && pathname === "/login") {
    const body = await collectBody(req);
    const fields = parseUrlEncoded(body);
    const username = (fields.get("username") || "").trim().slice(0, 80);

    if (!username) {
      sendHtml(res, renderLogin("Vul ook je naam in."), 400);
      return;
    }

    if (await verifyVisitorPassword(fields.get("password"))) {
      res.writeHead(302, { Location: "/gallery", "Set-Cookie": makeSessionCookie({ role: "visitor", username }) });
      res.end();
    } else {
      sendHtml(res, renderLogin("Dat wachtwoord klopt niet."), 401);
    }
    return;
  }

  if (req.method === "POST" && pathname === "/logout") {
    res.writeHead(302, {
      Location: "/",
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    });
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/admin") {
    if (!isAdmin(req)) {
      sendHtml(res, renderAdminLogin(), 401);
      return;
    }

    const galleries = await listGalleries();
    const [photoMap, downloads, pendingUploads] = await Promise.all([listGalleryPhotoMap(galleries), listDownloads(), listPendingUploads()]);
    sendHtml(
      res,
      renderAdmin(galleries, photoMap, downloads, pendingUploads, url.searchParams.get("message") || "", url.searchParams.get("error") || "")
    );
    return;
  }

  if (req.method === "POST" && pathname === "/admin/login") {
    const body = await collectBody(req);
    const fields = parseUrlEncoded(body);

    if (fields.get("password") === ADMIN_PASSWORD) {
      res.writeHead(302, {
        Location: "/admin",
        "Set-Cookie": makeSessionCookie({ role: "admin", username: "Beheerder" })
      });
      res.end();
    } else {
      sendHtml(res, renderAdminLogin("Dat beheerderswachtwoord klopt niet."), 401);
    }
    return;
  }

  if (!isAuthenticated(req)) {
    redirect(res, "/");
    return;
  }

  if (req.method === "POST" && pathname === "/submit-photos") {
    try {
      await saveVisitorSubmission(req);
      redirect(res, "/gallery?message=Foto%27s%20zijn%20ingestuurd%20en%20wachten%20op%20goedkeuring.");
    } catch (error) {
      redirect(res, `/gallery?error=${encodeURIComponent(error.message)}`);
    }
    return;
  }

  if (req.method === "POST" && pathname === "/admin/update-visitor-password") {
    if (!isAdmin(req)) {
      redirect(res, "/admin");
      return;
    }

    try {
      const fields = parseUrlEncoded(await collectBody(req));
      await updateVisitorPassword(fields.get("password"));
      redirect(res, "/admin?message=Bezoekerswachtwoord%20aangepast.");
    } catch (error) {
      redirect(res, `/admin?error=${encodeURIComponent(error.message)}`);
    }
    return;
  }

  if (req.method === "GET" && pathname === "/gallery") {
    const galleries = await listGalleries();
    const requestedSlug = slugify(url.searchParams.get("g") || "");
    const activeGallery = galleries.find((gallery) => gallery.slug === requestedSlug) || galleries[0];
    sendHtml(
      res,
      renderGallery(galleries, activeGallery, await listPhotos(activeGallery.slug), url.searchParams.get("message") || "", url.searchParams.get("error") || "")
    );
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/admin/approve-submission/")) {
    if (!isAdmin(req)) {
      redirect(res, "/admin");
      return;
    }

    try {
      const publicId = pathname.replace("/admin/approve-submission/", "");
      const fields = parseUrlEncoded(await collectBody(req));
      await approvePendingUpload(publicId, slugify(fields.get("gallery") || ""), fields.get("uploaderName") || "");
      redirect(res, "/admin?message=Inzending%20goedgekeurd.");
    } catch (error) {
      redirect(res, `/admin?error=${encodeURIComponent(error.message)}`);
    }
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/admin/reject-submission/")) {
    if (!isAdmin(req)) {
      redirect(res, "/admin");
      return;
    }

    try {
      await destroyCloudinaryImage(pathname.replace("/admin/reject-submission/", ""));
      redirect(res, "/admin?message=Inzending%20afgewezen.");
    } catch (error) {
      redirect(res, `/admin?error=${encodeURIComponent(error.message)}`);
    }
    return;
  }

  if (req.method === "POST" && pathname === "/admin/create-gallery") {
    if (!isAdmin(req)) {
      redirect(res, "/admin");
      return;
    }

    try {
      const fields = parseUrlEncoded(await collectBody(req));
      await createGallery(fields.get("title"));
      redirect(res, "/admin?message=Galerij%20aangemaakt.");
    } catch (error) {
      redirect(res, `/admin?error=${encodeURIComponent(error.message)}`);
    }
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/admin/delete-gallery/")) {
    if (!isAdmin(req)) {
      redirect(res, "/admin");
      return;
    }

    try {
      await deleteGallery(pathname.replace("/admin/delete-gallery/", ""));
      redirect(res, "/admin?message=Galerij%20verwijderd.");
    } catch (error) {
      redirect(res, `/admin?error=${encodeURIComponent(error.message)}`);
    }
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/admin/upload/")) {
    if (!isAdmin(req)) {
      redirect(res, "/admin");
      return;
    }

    try {
      await saveUploadedPhotos(req, pathname.replace("/admin/upload/", ""));
      redirect(res, "/admin?message=Foto's%20zijn%20toegevoegd.");
    } catch (error) {
      redirect(res, `/admin?error=${encodeURIComponent(error.message)}`);
    }
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/admin/delete-photo/")) {
    if (!isAdmin(req)) {
      redirect(res, "/admin");
      return;
    }

    const [, , , gallerySlug, ...filenameParts] = pathname.split("/");
    const photoIdOrFilename = filenameParts.join("/");
    const cloudPhoto = await removeCloudinaryPhoto(gallerySlug, photoIdOrFilename);
    if (cloudPhoto) {
      await destroyCloudinaryImage(cloudPhoto.publicId);
    } else if (!photoIdOrFilename.includes(`${CLOUDINARY_BASE_FOLDER}/`)) {
      const filePath = safeImagePath(gallerySlug, photoIdOrFilename);
      if (filePath && fs.existsSync(filePath)) await fs.promises.unlink(filePath);
    }
    redirect(res, "/admin?message=Foto%20verwijderd.");
    return;
  }

  if (req.method === "GET" && (pathname.startsWith("/photo/") || pathname.startsWith("/download/"))) {
    const [, type, gallerySlug, ...filenameParts] = pathname.split("/");
    const filename = filenameParts.join("/");

    const cloudPhoto = (await listCloudinaryPhotos(gallerySlug)).find((photo) => photo.id === filename);
    if (cloudPhoto) {
      if (type === "download") await logDownload(req, gallerySlug, cloudPhoto.name);
      const attachmentUrl =
        type === "download"
          ? cloudPhoto.secureUrl.replace("/upload/", `/upload/fl_attachment:${encodeURIComponent(cloudPhoto.name.replace(/\.[^.]+$/, ""))}/`)
          : cloudPhoto.secureUrl;
      redirect(res, attachmentUrl);
      return;
    }

    const filePath = safeImagePath(gallerySlug, filename);
    if (!filePath || !fs.existsSync(filePath)) {
      sendText(res, "Niet gevonden", 404);
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": imageTypes.get(extension) };
    if (type === "download") {
      await logDownload(req, gallerySlug, path.basename(filePath));
      headers["Content-Disposition"] = `attachment; filename="${path.basename(filePath).replace(/"/g, "")}"`;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  sendText(res, "Niet gevonden", 404);
}

http
  .createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error(error);
      sendText(res, "Er ging iets mis. Probeer het later opnieuw.", 500);
    });
  })
  .listen(PORT, () => {
    console.log(`Fotogalerij draait op poort ${PORT}`);
  });
