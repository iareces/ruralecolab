// Netlify Function: proxy hacia Mindee (evita el bloqueo CORS del navegador
// y saca la API key de Mindee del código visible en el cliente).
//
// Variables de entorno necesarias en Netlify (Site configuration → Environment variables):
//   MINDEE_API_KEY         → tu clave de Mindee
//   MINDEE_MODEL_INVOICE   → el model_id de tu modelo "Invoice"

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const API_KEY = process.env.MINDEE_API_KEY;
  const MODEL_ID = process.env.MINDEE_MODEL_INVOICE;

  if (!API_KEY || !MODEL_ID) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Faltan las variables de entorno MINDEE_API_KEY o MINDEE_MODEL_INVOICE en Netlify.' })
    };
  }

  try {
    const { base64, mime } = JSON.parse(event.body);
    if (!base64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el campo base64 en la petición.' }) };
    }

    const fileBuffer = Buffer.from(base64, 'base64');
    const boundary = '----MindeeBoundary' + Date.now();
    const preamble =
      `--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${MODEL_ID}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="documento"\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`;
    const closing = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(preamble, 'utf-8'), fileBuffer, Buffer.from(closing, 'utf-8')]);

    // 1) Enviar el documento a la cola de Mindee
    const enqueueRes = await fetch('https://api-v2.mindee.net/v2/inferences/enqueue', {
      method: 'POST',
      headers: {
        Authorization: API_KEY,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });
    const enqueueJson = await enqueueRes.json();
    if (!enqueueRes.ok) {
      return { statusCode: enqueueRes.status, body: JSON.stringify({ error: enqueueJson }) };
    }

    const jobId = enqueueJson?.job?.id;
    const pollingUrl = enqueueJson?.job?.polling_url || `https://api-v2.mindee.net/v2/jobs/${jobId}`;
    if (!jobId) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Mindee no devolvió un job id.', raw: enqueueJson }) };
    }

    // 2) Sondear el resultado (Mindee suele tardar 1-3 segundos)
    let resultado = null;
    for (let i = 0; i < 7; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      const pollRes = await fetch(pollingUrl, { headers: { Authorization: API_KEY } });
      const pollJson = await pollRes.json();
      const status = pollJson?.job?.status;

      if (status === 'Success' || status === 'Processed') {
        const resultUrl = pollJson?.job?.result_url || `https://api-v2.mindee.net/v2/inferences/${pollJson.job.id}`;
        const resRes = await fetch(resultUrl, { headers: { Authorization: API_KEY } });
        resultado = await resRes.json();
        break;
      }
      if (status === 'Failed') {
        return { statusCode: 500, body: JSON.stringify({ error: pollJson?.job?.error || 'El proceso de Mindee falló.' }) };
      }
    }

    if (!resultado) {
      return { statusCode: 202, body: JSON.stringify({ pending: true, jobId, mensaje: 'Mindee sigue procesando, tardó más de lo esperado.' }) };
    }

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
