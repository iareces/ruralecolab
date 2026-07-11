// Netlify Function: consulta UNA vez el estado de un trabajo de Mindee.
// El navegador la llama repetidamente cada 1,5s hasta que el estado
// sea "Success"/"Processed" (o "Failed"). Cada llamada es rápida,
// así que nunca se acerca al límite de tiempo de una función.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  const API_KEY = process.env.MINDEE_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta MINDEE_API_KEY en Netlify.' }) };
  }
  try {
    const { pollingUrl } = JSON.parse(event.body);
    if (!pollingUrl) return { statusCode: 400, body: JSON.stringify({ error: 'Falta pollingUrl.' }) };

    const pollRes = await fetch(pollingUrl, { headers: { Authorization: API_KEY } });
    const pollJson = await pollRes.json();
    const status = pollJson?.job?.status;
    console.log('Mindee status:', status, JSON.stringify(pollJson));

    if (status === 'Success' || status === 'Processed') {
      const resultUrl = pollJson?.job?.result_url || `https://api-v2.mindee.net/v2/inferences/${pollJson.job.id}`;
      const resRes = await fetch(resultUrl, { headers: { Authorization: API_KEY } });
      const resultado = await resRes.json();
      return { statusCode: 200, body: JSON.stringify({ status: 'done', resultado }) };
    }
    if (status === 'Failed') {
      return { statusCode: 200, body: JSON.stringify({ status: 'failed', error: pollJson?.job?.error || 'Proceso fallido' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ status: 'waiting' }) };
  } catch (e) {
    console.log('Mindee status: excepción', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
