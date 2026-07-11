// Netlify Function: envía el documento a Mindee y devuelve enseguida
// el identificador del trabajo (no espera al resultado — eso lo hace
// mindee-status.js, llamado repetidamente desde el navegador).
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const API_KEY = process.env.MINDEE_API_KEY;
  const MODEL_ID = process.env.MINDEE_MODEL_INVOICE;
  if (!API_KEY || !MODEL_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Faltan MINDEE_API_KEY o MINDEE_MODEL_INVOICE en Netlify.' }) };
  }
  try {
    const { base64, mime } = JSON.parse(event.body);
    if (!base64) return { statusCode: 400, body: JSON.stringify({ error: 'Falta base64.' }) };

    const fileBuffer = Buffer.from(base64, 'base64');
    const boundary = '----MindeeBoundary' + Date.now();
    const preamble =
      `--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\n${MODEL_ID}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="documento"\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`;
    const closing = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(preamble, 'utf-8'), fileBuffer, Buffer.from(closing, 'utf-8')]);

    console.log('Mindee enqueue: enviando documento, tamaño', fileBuffer.length, 'bytes');
    const enqueueRes = await fetch('https://api-v2.mindee.net/v2/inferences/enqueue', {
      method: 'POST',
      headers: { Authorization: API_KEY, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    const enqueueJson = await enqueueRes.json();
    console.log('Mindee enqueue: respuesta', enqueueRes.status, JSON.stringify(enqueueJson));
    if (!enqueueRes.ok) {
      return { statusCode: enqueueRes.status, body: JSON.stringify({ error: enqueueJson }) };
    }
    const jobId = enqueueJson?.job?.id;
    const pollingUrl = enqueueJson?.job?.polling_url || `https://api-v2.mindee.net/v2/jobs/${jobId}`;
    if (!jobId) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Mindee no devolvió job id.', raw: enqueueJson }) };
    }
    return { statusCode: 200, body: JSON.stringify({ jobId, pollingUrl }) };
  } catch (e) {
    console.log('Mindee enqueue: excepción', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
