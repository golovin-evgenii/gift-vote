process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let tokenCache = {
  token: null,
  expiresAt: 0
};

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'Gift AI proxy for GigaChat on Vercel is working',
      endpoints: ['/api/quotes', '/api/layouts']
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    if (!process.env.GIGACHAT_AUTH_KEY) {
      throw new Error('GIGACHAT_AUTH_KEY is not set');
    }

    const route = req.query.route;

    if (route === 'quotes') {
      const result = await generateQuotes(req.body.prompt);
      return res.status(200).json(result);
    }

    if (route === 'layouts') {
      const result = await generateLayouts(req.body.prompt, req.body.quote);
      return res.status(200).json(result);
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    return res.status(500).json({
      error: String(error.message || error)
    });
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function generateQuotes(prompt) {
  const system = `
Ты профессиональный копирайтер для персонализированной гравировки на термосе.

Твоя задача — придумать короткие русские фразы для гравировки.

Требования:
- Только русский язык.
- Без латиницы.
- Фразы должны быть персональными, не банальными.
- Не используй длинные поздравления.
- Не используй пошлость, оскорбления, токсичный юмор.
- Длина одной фразы: желательно до 60 символов.
- Фразы должны подходить для гравировки на термосе.
- Учитывай профессию, характер, повод, хобби, юмор и технические ограничения.
- Ответ должен быть только JSON.
- Не используй markdown.
- Не оборачивай ответ в \`\`\`json.

Формат ответа:
{
  "quotes": [
    "Цитата 1",
    "Цитата 2",
    "Цитата 3",
    "Цитата 4",
    "Цитата 5",
    "Цитата 6",
    "Цитата 7",
    "Цитата 8"
  ]
}

Верни ровно 8 вариантов.
`.trim();

  const user = `
Вот анкета клиента и техническое задание:

${prompt}

Придумай 8 вариантов надписей для гравировки.
`.trim();

  return await askGigaChat(system, user, 0.9, 1400);
}

async function generateLayouts(prompt, quote) {
  const system = `
Ты арт-директор и дизайнер гравировок.

Твоя задача — предложить варианты макетов для черно-белой гравировки на термосе.

Важно:
- Макет вертикальный, пропорция 3:4.
- Гравировка белая на черном фоне.
- Без полутонов, градиентов, теней, мелкой штриховки.
- Текст должен быть крупным и читаемым.
- Иконка или символ должен быть лаконичным.
- Не предлагай сложные сцены.
- Не предлагай фотореализм на этапе макета.
- Макет должен быть пригоден для лазерной гравировки.
- Ответ должен быть только JSON.
- Не используй markdown.
- Не оборачивай ответ в \`\`\`json.

Формат ответа:
{
  "layouts": [
    {
      "name": "Название макета",
      "description": "Краткое описание",
      "icon": "★",
      "iconIdea": "Идея иконки",
      "composition": "Описание расположения текста и иконки",
      "align": "center",
      "vertical": "center",
      "caption": "Короткая подпись"
    }
  ]
}

Допустимые значения:
align: "left", "center", "right"
vertical: "top", "center", "bottom"

Верни ровно 4 разных варианта.
`.trim();

  const user = `
Анкета и техническое задание:

${prompt}

Выбранная цитата для гравировки:
"${quote}"

Предложи 4 разных макета под эту цитату.
`.trim();

  return await askGigaChat(system, user, 0.8, 1800);
}

async function askGigaChat(system, user, temperature, maxTokens) {
  const token = await getGigaChatToken();
  const model = process.env.GIGACHAT_MODEL || 'GigaChat';

  const response = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: system
        },
        {
          role: 'user',
          content: user
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GigaChat API error: ${text}`);
  }

  const data = await response.json();
  let raw = data.choices?.[0]?.message?.content;

  if (!raw) {
    throw new Error('Пустой ответ от GigaChat');
  }

  raw = cleanJsonText(raw);

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`GigaChat вернул не JSON: ${raw}`);
  }
}

async function getGigaChatToken() {
  const now = Date.now();

  if (tokenCache.token && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }

  const response = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'RqUID': crypto.randomUUID(),
      'Authorization': `Basic ${process.env.GIGACHAT_AUTH_KEY}`
    },
    body: 'scope=GIGACHAT_API_PERS'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GigaChat OAuth error: ${text}`);
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error(`GigaChat не вернул access_token: ${JSON.stringify(data)}`);
  }

  tokenCache.token = data.access_token;
  tokenCache.expiresAt = data.expires_at || (Date.now() + 25 * 60 * 1000);

  return tokenCache.token;
}

function cleanJsonText(text) {
  let s = String(text || '').trim();

  s = s
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstObject = s.indexOf('{');
  const lastObject = s.lastIndexOf('}');

  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    s = s.slice(firstObject, lastObject + 1);
  }

  return s;
}
