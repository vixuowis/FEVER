const fs = require('fs');
const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
});

const key = env.QVERIS_API_KEY || env.MAAS_API_KEY;
const url = env.QVERIS_BASE_URL ? env.QVERIS_BASE_URL.replace(/"/g, '') + '/chat/completions' : env.MAAS_API_URL;
const model = env.MAAS_MODEL || 'glm-5.1';

console.log("URL:", url);
console.log("Model:", model);
console.log("Key length:", key ? key.length : 0);

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`
  },
  body: JSON.stringify({
    model: model,
    messages: [{ role: 'system', content: 'You are a bot.' }, { role: 'user', content: 'Say hello in valid JSON format {"msg": "hello"}' }]
  })
}).then(res => res.text()).then(text => console.log("Response:", text)).catch(err => console.error("Error:", err));
