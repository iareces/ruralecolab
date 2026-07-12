// Netlify Function: consulta UNA vez el estado de un trabajo de Mindee.
// El navegador la llama repetidamente cada 1,5s hasta que llega el
// resultado (o falla). Cada llamada es rápida, nunca se acerca al
// límite de tiempo de una función.
//
// Importante: cuando el trabajo YA está listo, Mindee no devuelve un
// pequeño objeto "job.status" — devuelve directamente el resultado
// completo bajo la clave "inference". Por eso comprobamos primero si
// existe "inference" antes de mirar el estado del job.
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
    console.log('Mindee status: tiene inference?', !!pollJson?.inference, '| job.status:', pollJson?.job?.status);

    // Caso 1: el resultado ya viene completo directamente
    if (pollJson?.inference?.result) {
      return { statusCode: 200, body: JSON.stringify({ status: 'done', resultado: pollJson }) };
    }

    // Caso 2: viene envuelto en un objeto "job" con su propio estado
    const status = pollJson?.job?.status;
    if (status === 'Success' || status === 'Processed') {
      const resultUrl = pollJson?.job?.result_url || `https://api-v2.mindee.net/v2/inferences/${pollJson.job.id}`;
      const resRes = await fetch(resultUrl, { headers: { Authorization: API_KEY } });
      const resultado = await resRes.json();
      return { statusCode: 200, body: JSON.stringify({ status: 'done', resultado }) };
    }
    if (status === 'Failed') {
      return { statusCode: 200, body: JSON.stringify({ status: 'failed', error: pollJson?.job?.error || 'Proceso fallido' }) };
    }

    // Si Mindee respondió con un error real (404, etc.) durante la espera, no lo tratamos
    // como fallo definitivo salvo que sea claramente un error — seguimos esperando.
    if (pollJson?.status && pollJson.status >= 400 && pollJson?.code) {
      console.log('Mindee status: respuesta de error mientras esperábamos:', JSON.stringify(pollJson));
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'waiting' }) };
  } catch (e) {
    console.log('Mindee status: excepción', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
