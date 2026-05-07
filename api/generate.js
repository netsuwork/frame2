export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.FAL_KEY;
  if (!token) {
    return res.status(500).json({ error: 'FAL_KEY not configured in Vercel environment variables.' });
  }

  const { model, prompt, negativePrompt, steps, frames } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  // Map model selection to fal.ai model IDs
  const modelMap = {
    'wan21':  'fal-ai/wan-t2v',
    'ltx':    'fal-ai/ltx-video',
    'cog':    'fal-ai/cogvideox-5b',
    'fast':   'fal-ai/fast-animatediff/t2v',
  };
  const falModel = modelMap[model] || 'fal-ai/wan-t2v';

  try {
    // Step 1 — Submit the job
    const submitRes = await fetch(`https://queue.fal.run/${falModel}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        negative_prompt: negativePrompt || 'blurry, low quality, watermark, distorted',
        num_inference_steps: steps || 20,
        num_frames: frames || 16,
      }),
    });

    if (!submitRes.ok) {
      const err = await submitRes.json().catch(() => ({}));
      return res.status(submitRes.status).json({ error: err.detail || err.error || 'Failed to submit job' });
    }

    const { request_id } = await submitRes.json();
    if (!request_id) return res.status(500).json({ error: 'No request ID returned from fal.ai' });

    // Step 2 — Poll for result (max 3 minutes)
    const maxAttempts = 36; // 36 x 5s = 3 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000)); // wait 5 seconds

      const pollRes = await fetch(`https://queue.fal.run/${falModel}/requests/${request_id}`, {
        headers: { 'Authorization': `Key ${token}` },
      });

      if (!pollRes.ok) continue;

      const result = await pollRes.json();

      if (result.status === 'COMPLETED' || result.video || result.video_url) {
        // Get the video URL
        const videoUrl = result.video?.url || result.video_url || result.output?.video?.url;

        if (!videoUrl) {
          return res.status(500).json({ error: 'Video generated but URL not found in response' });
        }

        // Fetch the video and stream it back
        const videoRes = await fetch(videoUrl);
        const buffer = await videoRes.arrayBuffer();
        res.setHeader('Content-Type', 'video/mp4');
        return res.status(200).send(Buffer.from(buffer));
      }

      if (result.status === 'FAILED') {
        return res.status(500).json({ error: 'Video generation failed on fal.ai' });
      }
    }

    return res.status(504).json({ error: 'Timeout — generation took too long. Try a shorter prompt or fewer frames.' });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
