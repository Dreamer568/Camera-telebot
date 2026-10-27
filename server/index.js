
const express = require("express");
const cors = require("cors"); // <-- ADD THIS
const multer = require("multer");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const TABLE = "image_index";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "UPLOAD_KEY",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const targetChat = String(process.env.TELEGRAM_CHAT_ID);
const telegramApi = `https://api.telegram.org/bot${botToken}`;

app.disable("x-powered-by");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter(req, file, cb) {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG and WebP images are allowed."));
    }

    cb(null, true);
  },
});

// Prototype authentication only. A shared app key can be extracted
// from a mobile binary. Use Supabase Auth/JWT for a public release.
function requireKey(req, res, next) {
  const supplied = Buffer.from(req.get("x-upload-key") || "");
  const expected = Buffer.from(process.env.UPLOAD_KEY);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function extensionFor(mime) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[mime];
}

async function telegramCall(method, options) {
  const response = await fetch(`${telegramApi}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal: AbortSignal.timeout(60000),
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.description || `Telegram ${method} failed`
    );
  }

  return result.result;
}

async function findByHash(hash) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "sha256, telegram_chat_id, telegram_message_id, telegram_file_id, filename, mime_type, file_size, created_at"
    )
    .eq("sha256", hash)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function validHash(hash) {
  return /^[a-f0-9]{64}$/.test(hash);
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Upload the original bytes as a Telegram document.
app.post(
  "/upload",
  requireKey,
  upload.single("photo"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "Provide an image in the photo field.",
      });
    }

    const bytes = req.file.buffer;
    const mime = req.file.mimetype;
    const hash = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");

    const filename = `image-${hash}.${extensionFor(mime)}`;

    try {
      const existing = await findByHash(hash);

      if (existing) {
        return res.json({
          ok: true,
          duplicate: true,
          sha256: hash,
          created_at: existing.created_at,
        });
      }

      // Telegram document upload preserves the original bytes.
      const form = new FormData();
      form.append("chat_id", targetChat);
      form.append("caption", `SHA256: ${hash}`);
      form.append(
        "document",
        new Blob([bytes], { type: mime }),
        filename
      );

      const telegramResponse = await fetch(
        `${telegramApi}/sendDocument`,
        {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60000),
        }
      );

      const telegramResult = await telegramResponse.json();

      if (!telegramResponse.ok || !telegramResult.ok) {
        throw new Error(
          telegramResult.description || "Telegram upload failed"
        );
      }

      const message = telegramResult.result;
      const document = message.document;

      if (!document?.file_id) {
        throw new Error("Telegram did not return a file ID.");
      }

      // Persist references only; the file itself stays in Telegram.
      const record = {
        sha256: hash,
        telegram_chat_id: String(message.chat.id),
        telegram_message_id: message.message_id,
        telegram_file_id: document.file_id,
        filename,
        mime_type: mime,
        file_size: bytes.length,
      };

      const { error } = await supabase
        .from(TABLE)
        .insert(record);

      if (error) {
        // Telegram may have succeeded even though indexing failed.
        // Do not blindly re-send the image; reconcile this case.
        console.error("Index insertion failed:", error.message);

        return res.status(503).json({
          error: "Telegram stored the file, but indexing failed.",
          sha256: hash,
          telegramStored: true,
        });
      }

      return res.status(201).json({
        ok: true,
        duplicate: false,
        sha256: hash,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Upload error:", error.message);

      return res.status(502).json({
        error: "Upload failed.",
        detail: error.message,
        sha256: hash,
      });
    }
  }
);

// Return metadata for the most recent indexed images.
app.get("/images", requireKey, async (req, res) => {
  try {
    const raw = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(raw)
      ? Math.max(1, Math.min(raw, 100))
      : 50;

    const { data, error } = await supabase
      .from(TABLE)
      .select("sha256, filename, mime_type, file_size, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({
      ok: true,
      images: data.map((item) => ({
        ...item,
        url: `/images/${item.sha256}`,
      })),
    });
  } catch (error) {
    console.error("Gallery error:", error.message);
    res.status(500).json({ error: "Could not load gallery." });
  }
});

// Resolve the hash, retrieve the Telegram document, and return its bytes.
app.get("/images/:hash", requireKey, async (req, res) => {
  const hash = req.params.hash;

  if (!validHash(hash)) {
    return res.status(400).json({ error: "Invalid SHA-256 hash." });
  }

  try {
    const record = await findByHash(hash);

    if (!record) {
      return res.status(404).json({ error: "Image not found." });
    }

    const file = await telegramCall("getFile", {
      file_id: record.telegram_file_id,
    });

    if (!file.file_path) {
      throw new Error("Telegram returned no file path.");
    }

    const downloadUrl =
      `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

    const download = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(60000),
    });

    if (!download.ok) {
      throw new Error("Telegram file download failed.");
    }

    const result = Buffer.from(await download.arrayBuffer());

    // Verify the downloaded bytes match the indexed hash.
    const downloadedHash = crypto
      .createHash("sha256")
      .update(result)
      .digest("hex");

    if (downloadedHash !== hash) {
      throw new Error("Downloaded file hash does not match.");
    }

    res.setHeader("Content-Type", record.mime_type);
    res.setHeader("Content-Length", String(result.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).end(result);
  } catch (error) {
    console.error("Retrieval error:", error.message);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Could not retrieve image.",
      });
    }
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    return res.status(
      error.code === "LIMIT_FILE_SIZE" ? 413 : 400
    ).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Maximum image size is 10 MB."
          : "Invalid upload.",
    });
  }

  return res.status(400).json({
    error: error.message || "Invalid request.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Image API listening on port ${PORT}`);
});
