// Netlify Function: proxy seguro a OpenAI Responses API + limpieza de citas
// Variables de entorno: OPENAI_API_KEY (obligatoria), ASSISTANT_ID (opcional), MODEL (opcional)

const OPENAI_URL = "https://api.openai.com/v1/responses";

function sanitizeCitations(s = "") {
  return String(s)
    .replace(/【\s*\d+:\d+†([^】]+)】/g, "$1") // 6:0†Archivo.pdf → Archivo.pdf
    .replace(/【\s*\d+†([^】]+)】/g, "$1")     // 15†Archivo.pdf   → Archivo.pdf
    .replace(/【[^】]*】/g, "")               // cualquier resto  → (elimina)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

exports.handler = async function (event) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const { text, asst, temperature } = JSON.parse(event.body || "{}");
    if (!text || typeof text !== "string") {
      return {
        statusCode: 400,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Falta 'text' en el body." }),
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "OPENAI_API_KEY no configurada." }),
      };
    }

    const assistantId =
      (asst && asst.startsWith("asst_")) || (process.env.ASSISTANT_ID || "").startsWith("asst_")
        ? asst || process.env.ASSISTANT_ID
        : "";

    const model = process.env.MODEL || "gpt-4o-mini";
    const temp = typeof temperature === "number" ? temperature : 0.4;

    // Enviamos un único turno del usuario (evita 400 con assistant_id)
    const input = [
      {
        role: "user",
        content: [{ type: "input_text", text }],
      },
    ];

    const payload = assistantId
      ? { assistant_id: assistantId, input, temperature: temp }
      : { model, input, temperature: temp };

    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.log("OpenAI error", r.status, data);
      return {
        statusCode: r.status,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      };
    }

    let out = "";
    if (typeof data.output_text === "string") {
      out = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const part of data.output) {
        if (Array.isArray(part.content)) {
          for (const c of part.content) {
            if (typeof c.text === "string") out += (out ? "\n" : "") + c.text;
          }
        }
      }
    }

    out = sanitizeCitations(out);

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ text: out }),
    };
  } catch (e) {
    console.log("Function exception", String(e));
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Error procesando la solicitud." }),
    };
  }
};
