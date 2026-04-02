const { sql } = require('../../db');
const { Ollama } = require('ollama');
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const multer = require('multer');
const cheerio = require('cheerio');

const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434' });

// Load materials SAFELY
let materials = { materials: {} };
try {
  materials = JSON.parse(fs.readFileSync(path.join(__dirname, 'materials.json')));
  console.log('✅ Materials loaded');
} catch (e) {
  console.log('⚠️ materials.json missing - empty DB');
}

const upload = multer({ 
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB for images
});

// 1. Basic AI (unchanged)
const basicAI = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  try {
    const { message, location = 'lagos' } = req.body;
    const response = await ollama.chat({
      model: 'llama3.1:8b',
      messages: [{
        role: 'system',
        content: `Zoya Construction AI. Prices: ${JSON.stringify(materials)}`
      }, {
        role: 'user',
        content: message || '3 bedroom bungalow'
      }]
    });
    res.json({
      success: true,
      answer: response.message.content,
      model: 'llama3.1:8b'
    });
  } catch (error) {
    console.error('basicAI error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ✅ FIXED streamAI - Full CORS + async marketPrices
const streamAI = async (req, res) => {
  // ✅ COMPLETE CORS HEADERS
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked'
  });
  
  req.setTimeout(0); 
  res.setTimeout(0); 
  res.connection.setTimeout(0);

  try {
    const { message, location = 'lagos' } = req.body;
    
    // 🗄️ + 🌐 LIVE DATA
    const zoyaPrices = await getZoyaPricesFromDB(message);
    const marketPrices = await getMarketPrices(message); // ✅ Now async
    
    const stream = await ollama.chat({
      model: 'llama3.1:8b', // ✅ Your model
      messages: [
        {
          role: 'system',
          content: `🏗️ ZOYA PRICE WARRIOR - DB vs MARKET

**ZOYA DATABASE** (Live):
${JSON.stringify(zoyaPrices, null, 2)}

**MARKET RESEARCH** (Google/Jiji 2024):
${JSON.stringify(marketPrices, null, 2)}

**FORMAT**:
SHARP SAND 20T:
├── Jiji.ng: ₦350k-₦430k
├── Structurecity: ₦300k-₦400k  
└── ZOYA DB: ₦250k ✓ SAVE 30%!

**BUILD YOUR HOUSE**:
Use ZOYA = SAVE ₦XM on total project!

**ZOYA WINS**:
🚚 24hr insured delivery
✅ Factory direct pricing
📦 Bulk discounts 5-15%

📞 +2348063203385`
        },
        { role: 'user', content: `${message} | ${location}\n\nCompare MARKET vs ZOYA DB.` }
      ],
      stream: true, // ✅ Your streaming
      options: { temperature: 0.05 }
    });

    // Stream buffer unchanged
    let buffer = '';
    for await (const chunk of stream) {
      const text = chunk.message?.content || '';
      buffer += text;
      if (buffer.length > 100 || text.includes('\n')) {
        res.write(buffer); 
        buffer = ''; 
        res.flushHeaders();
      }
    }
    if (buffer) res.write(buffer);
    res.end('\n✅ ZOYA SAVES YOU MONEY!');
    
  } catch (error) {
    console.error('STREAM ERROR:', error);
    res.status(500).end('❌ Stream failed - check Ollama connection');
  }
};

/// 🗄️ ZOYA LIVE DB (Your original)
const getZoyaPricesFromDB = async (query) => {
    const searchTerms = [
      query.toLowerCase(),
      'cement', 'blocks', 'sand', 'gravel', 'steel', 'rod', 
      'roofing', 'tiles', 'wiring', 'pipes', 'paint', 'timber'
    ];
    
    let allPrices = {};
    
    for (const term of searchTerms) {
      try {
        const result = await sql`
          SELECT commodity_name, price, unit, updated_at 
          FROM commodity_prices 
          WHERE commodity_name ILIKE ${`%${term}%`}
          ORDER BY updated_at DESC LIMIT 5
        `;
        
        result.forEach(row => {
          if (row.commodity_name && !allPrices[row.commodity_name.toLowerCase()]) {
            allPrices[row.commodity_name.toLowerCase()] = {
              price: Number(row.price),
              unit: row.unit || 'unit',
              updated: row.updated_at
            };
          }
        });
      } catch (e) {}
    }
    
    return allPrices;
  };
  // 🌐 LIVE MARKET DATA (Jiji + Google - NO FALLBACKS)
  const getMarketPrices = async (query) => {
    try {
      const material = query.toLowerCase().replace(/ /g, '+');
      const searchTerms = [
        `${material}+price+jiji+ng`,
        `${material}+price+lagos+nigeria`,
        `${material}+current+price+2024`
      ];
  
      const results = {};
      
      // 🔍 JIJI.NG (Primary)
      for (const term of searchTerms) {
        try {
          const { data } = await axios.get(`https://www.jiji.ng/search?query=${term}`, {
            timeout: 8000,
            headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          
          const $ = cheerio.load(data);
          const prices = [];
          
          $('[data-testid="price"], .b5mXOf, .c8nI2d, .qaY6re').each((i, el) => {
            const text = $(el).text();
            const match = text.match(/₦?([\d,]+\.?[\d]*)/);
            if (match) {
              const num = parseFloat(match[1].replace(/,/g, ''));
              if (num > 0 && num < 10000000) prices.push(num);
            }
          });
  
          if (prices.length >= 3) {
            results.jiji = {
              avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
              min: Math.min(...prices),
              max: Math.max(...prices),
              samples: prices.length
            };
            break;
          }
        } catch (e) {
          continue;
        }
      }
  
      // 🔍 GOOGLE SHOPPING (Backup)
      if (!results.jiji) {
        try {
          const { data } = await axios.get(`https://www.google.com/search?q=${material}+price+nigeria&tbm=shop`, {
            timeout: 8000,
            headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          const $ = cheerio.load(data);
          const prices = [];
          
          $('.a8Pemb.OddQPe, .HRLxBb').each((i, el) => {
            const text = $(el).text();
            const match = text.match(/₦?([\d,]+\.?[\d]*)/);
            if (match) {
              const num = parseFloat(match[1].replace(/,/g, ''));
              if (num > 0 && num < 10000000) prices.push(num);
            }
          });
  
          if (prices.length >= 2) {
            results.google = {
              avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
              min: Math.min(...prices),
              max: Math.max(...prices),
              samples: prices.length
            };
          }
        } catch (e) {
          // Silent fail
        }
      }
  
      return results; // ✅ STRICT: Empty {} if no live data
      
    } catch (error) {
      console.error('LIVE MARKET ERROR:', error.message);
      return {}; // ✅ NO FALLBACKS
    }
  };
  

// 3. Thinking (unchanged)
const thinkingAI = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { message = '3 bedroom bungalow' } = req.body;
    const response = await ollama.chat({
      model: 'llama3.1:8b',
      messages: [{
        role: 'system',
        content: 'Zoya AI. Think step-by-step.'
      }, {
        role: 'user',
        content: message
      }],
      think: true
    });
    res.json({
      success: true,
      thinking: response.message.thinking || '',
      answer: response.message.content
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 4. Structured (unchanged)
const structuredAI = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { message = '3 bedroom bungalow' } = req.body;
    const response = await ollama.chat({
      model: 'llama3.1:8b',
      messages: [{
        role: 'user',
        content: `${message}. List materials with prices.`
      }]
    });
    res.json({
      success: true,
      estimate: response.message.content
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ FIXED visionAI - Full CORS + image buffer
const visionAI = async (req, res) => {
  // ✅ COMPLETE CORS HEADERS
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked'
  });

  try {
    const imageFile = req.file;
    const { message = 'analyze photo', location = 'lagos' } = req.body;

    console.log('🔍 VisionAI: message=', message, 'location=', location, 'hasImage=', !!imageFile);

    const zoyaPrices = await getZoyaPricesFromDB(message);
    const marketPrices = await getMarketPrices(message); // ✅ Now async

    const zoyaPricesStr = JSON.stringify(zoyaPrices || {}, null, 2);
    const marketPricesStr = JSON.stringify(marketPrices || {}, null, 2);

    console.log('📊 Prices loaded:', Object.keys(zoyaPrices).length, 'zoya +', Object.keys(marketPrices).length, 'market');

    const stream = await ollama.chat({
      model: 'gemma3', // ✅ Your model unchanged
      messages: [
        {
          role: 'system',
          content: `👁️🏗️ ZOYA VISION + LIVE DB PRICES

**ZOYA DB** (${Object.keys(zoyaPrices || {}).length} items):
${zoyaPricesStr}

**MARKET**:
${marketPricesStr}

FORMAT:
**PHOTO**: 2-story duplex
**MARKET**: ₦80M
**ZOYA**: ₦45M ✓ SAVE 44%!

BOM:
Cement: 850×[DB PRICE]=₦7M
Blocks: 12,500×[DB PRICE]=₦3.1M

📞 ZOYA: +234-XXX-XXXXXX`
        },
        { 
          role: 'user', 
          content: `${String(message || 'analyze photo')} | ${String(location || 'lagos')}\nPHOTO:` 
        }
      ],
      images: imageFile?.buffer ? [Buffer.from(imageFile.buffer).toString('base64')] : [], // ✅ FIXED buffer
      stream: true // ✅ Your streaming unchanged
    });

    let buffer = '';
    for await (const chunk of stream) {
      const text = chunk.message?.content || '';
      buffer += text;
      
      if (buffer.length > 50 || text.includes('\n\n') || text.includes('**')) {
        res.write(buffer);
        buffer = '';
        res.flushHeaders();
      }
    }
    
    if (buffer) {
      res.write(buffer);
      res.flushHeaders();
    }
    
    res.end('\n✅ ZOYA VISION + DB COMPLETE');
    
  } catch (error) {
    console.error('💥 VisionAI ERROR:', error);
    res.status(500).end(`❌ VisionAI failed: ${error.message}`);
  }
};

// 6. Embeddings (unchanged)
const embeddingsAI = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { query = 'cheap blocks', location = 'lagos' } = req.body;
    const embedding = await ollama.embeddings({
      model: 'mxbai-embed-large',
      prompt: `${query} ${location}`
    });
    
    const matches = materials.materials.blocks || [];
    const bestMatch = Object.keys(matches)[0] || 'No matches';
    
    res.json({
      success: true,
      query,
      best_material: bestMatch,
      price: materials.materials.blocks?.[bestMatch]?.[location],
      embedding_length: embedding.embedding.length,
      status: 'Embeddings ready'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  basicAI,
  streamAI,
  thinkingAI,
  structuredAI,
  visionAI,
  embeddingsAI,
  upload
};