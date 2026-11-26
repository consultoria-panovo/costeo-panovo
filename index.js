const express = require("express");
const sql = require("mssql");
const app = express();
app.disable("x-powered-by");

// --- Seguridad: solo el proxy (edge function sap-proxy) puede llamar esta API ---
// La llave vive en la variable de entorno API_KEY de Render; nunca en el código.
const crypto = require("crypto");
function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY;
  if (!expected) {
    // Falla cerrado: sin llave configurada no se sirve nada.
    console.error("API_KEY no configurada; solicitud rechazada");
    return res.status(503).json({ error: "service_unavailable" });
  }
  const given = req.get("x-api-key") || "";
  // Compara hashes de longitud fija para que el tiempo no revele la llave.
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
app.use(requireApiKey);

// Configuración desde variables de ambiente
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// Endpoint para leer MM60
app.get("/mm60", async (req, res) => {
  try {
    const pool = await sql.connect(config);

    const result = await pool.request().query(`
      SELECT MATNR, WERKS, MAKTX, LAEDA, MTART, MATKL, MEINS, PREIS, WAERS
      FROM MM60
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("Error en " + req.path + ":", err.message);
    res.status(500).json({ error: "internal_error" });
  }
});

app.listen(3000, () => {
  console.log("API Costeo-Panovo MM60 corriendo en puerto 3000");
});
