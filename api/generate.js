export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { model, prompt, parameters, token } = req.body;

  if (!token || !token.startsWith('hf_')) {
    return res.status(401).json({ error: 'Invalid HuggingFace token' });
  }
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  const HF_URL = `https://api-inference.huggingface.co/models/${model}`;

  try {
    const response = await fetch(HF_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: parameters || {},
      }),
    });

    if (!response.ok) {
      let errorData = {};
      try { errorData = await response.json(); } catch {}
      
      const messages = {
        401: 'Invalid token. Check your HuggingFace token.',
        403: 'Access denied. Accept the model license on HuggingFace first.',
        404: 'Model not found or unavailable via free Inference API.',
        429: 'Rate limit hit. Wait a few minutes and try again.',
        503: 'Model is warming up. Wait 30 seconds and try again.',
        500: 'HuggingFace server error. Try again in a moment.',
      };

      return res.status(response.status).json({
        error: messages[response.status] || errorData.error || `Error ${response.status}`
      });
    }

    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('video') || contentType.includes('octet-stream')) {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', 'video/mp4');
      return res.status(200).send(Buffer.from(buffer));
    }

    if (contentType.includes('application/json')) {
      const data = await response.json();
      // Handle different response formats
      if (data.video) {
        const buf = Buffer.from(data.video, 'base64');
        res.setHeader('Content-Type', 'video/mp4');
        return res.status(200).send(buf);
      }
      if (Array.isArray(data) && data[0]?.generated_video) {
        const buf = Buffer.from(data[0].generated_video, 'base64');
        res.setHeader('Content-Type', 'video/mp4');
        return res.status(200).send(buf);
      }
      return res.status(200).json(data);
    }

    // Fallback - treat as binary video
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'video/mp4');
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
