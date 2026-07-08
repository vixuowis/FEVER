import fs from 'fs';
const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
});

const key = env.MAAS_API_KEY;
const url = env.MAAS_API_URL.replace(/"/g, '');
const model = env.MAAS_MODEL ? env.MAAS_MODEL.split(' ')[0] : 'glm-5.1';

console.log("URL:", url);
console.log("Model:", model);

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'system', content: 'You are a bot.' }, { role: 'user', content: 'Say hello in valid JSON format {"msg": "hello"}' }]
    })
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response:", text);
} catch (err) {
  console.error("Error:", err);
}
