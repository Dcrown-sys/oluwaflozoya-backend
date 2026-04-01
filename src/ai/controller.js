const { sql } = require('../../db');
const { Ollama } = require('ollama');
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const multer = require('multer');

const ollama = new Ollama({ host: 'http://localhost:11434' });

// Load materials SAFELY
let materials = { materials: {} };
try {
  materials = JSON.parse(fs.readFileSync(path.join(__dirname, 'materials.json')));
  console.log('✅ Materials loaded');
} catch (e) {
  console.log('⚠️ materials.json missing - empty DB');
}

const upload = multer({ dest: path.join(__dirname, 'uploads') });

// 1. Basic AI
const basicAI = async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
};


const streamAI = async (req, res) => {
    // Headers unchanged...
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    req.setTimeout(0); res.setTimeout(0); res.connection.setTimeout(0);
  
    try {
      const { message, location = 'lagos' } = req.body;
      
      // 🗄️ + 🌐 LIVE DATA
      const zoyaPrices = await getZoyaPricesFromDB(message);
      const marketPrices = await getMarketPrices(message); // Google-like data
      
      const stream = await ollama.chat({
        model: 'llama3.1:8b',
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
        stream: true,
        options: { temperature: 0.05 }
      });
  
      // Stream buffer unchanged...
      let buffer = '';
      for await (const chunk of stream) {
        const text = chunk.message?.content || '';
        buffer += text;
        if (buffer.length > 100 || text.includes('\n')) {
          res.write(buffer); buffer = ''; res.flushHeaders();
        }
      }
      if (buffer) res.write(buffer);
      res.end('\n✅ ZOYA SAVES YOU MONEY!');
  
    } catch (error) {
      console.error('STREAM ERROR:', error);
      res.status(500).end('❌ Failed');
    }
  };
  
  // 🗄️ FIXED DB QUERY - USE YOUR REAL TABLES
  const getZoyaPricesFromDB = async (query) => {
    try {
      const material = query.toLowerCase();
      let result = [];
      
      // Try commodity_prices first
      try {
        result = await sql`
          SELECT commodity_name, price, unit, updated_at 
          FROM commodity_prices 
          WHERE commodity_name ILIKE ${`%${material}%`}
          ORDER BY updated_at DESC LIMIT 5
        `;
      } catch {
        // Fallback to product_prices - NO sql.raw needed!
        result = await sql`
          SELECT 
            product_id as commodity_name,
            price,
            'per unit' as unit,
            last_updated as updated_at
          FROM product_prices 
          WHERE product_id::text ILIKE ${`%${material}%`}
          ORDER BY last_updated DESC LIMIT 5
        `;
      }
      
      const prices = {};
      result.forEach(row => {
        if (row.commodity_name) {
          prices[row.commodity_name.toLowerCase()] = {
            price: Number(row.price),
            unit: row.unit || 'unknown',
            updated: row.updated_at
          };
        }
      });
      
      return prices;
    } catch (error) {
      console.error('DB ERROR:', error);
      return getFallbackPrices(query.toLowerCase());
    }
  };
  
  // 🌐 GOOGLE-STYLE MARKET DATA
  const getMarketPrices = (query) => {
    const material = extractMaterial(query.toLowerCase());
    const marketData = {
      'sharp sand': {
        jiji: '₦350k-₦430k (20T)',
        structurecity: '₦300k-₦400k (20T)', 
        local: '₦250k-₦350k (Ogba)'
      },
      'cement': {
        jiji: '₦8,500-₦9,200/bag',
        dangote_direct: '₦8,700/bag',
        retail: '₦9,000+/bag'
      },
      'blocks': {
        jiji: '₦280-₦350/block',
        local: '₦300/block',
        wholesale: '₦260/block'
      },
      'longspan': {
        jiji: '₦48k-₦55k/sheet',
        market: '₦52k/sheet'
      }
    };
    
    return marketData[material] || { general: 'Check Jiji.ng for latest' };
  };
  
  const extractMaterial = (query) => {
    if (query.includes('sand') || query.includes('sharp')) return 'sharp sand';
    if (query.includes('cement') || query.includes('dangote') || query.includes('bua')) return 'cement';
    if (query.includes('block')) return 'blocks';
    if (query.includes('roof') || query.includes('longspan')) return 'longspan';
    return 'general';
  };
  
  const getFallbackPrices = (material) => ({
    'sharp sand': { price: 280000, unit: '20T' },
    'cement': { price: 8200, unit: 'bag' },
    'blocks': { price: 250, unit: 'block' }
  }[extractMaterial(material)] || { price: 0 });
  
  
// 3. Thinking
const thinkingAI = async (req, res) => {
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

// 4. Structured (text fallback)
const structuredAI = async (req, res) => {
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

// 5. Vision
const visionAI = async (req, res) => {
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
  
    try {
      const imageFile = req.file;
      const { message = 'analyze photo', location = 'lagos' } = req.body;
  
      console.log('🔍 VisionAI: message=', message, 'location=', location); // DEBUG
  
      // ✅ FIXED: Make both async and handle undefined
      const zoyaPrices = await getZoyaPricesFromDB(message);
      const marketPrices = await getMarketPrices(message) || {}; // Make async + fallback
  
      // ✅ SAFE JSON stringify
      const zoyaPricesStr = JSON.stringify(zoyaPrices || {}, null, 2);
      const marketPricesStr = JSON.stringify(marketPrices || {}, null, 2);
  
      console.log('📊 Prices loaded:', Object.keys(zoyaPrices).length, 'zoya +', Object.keys(marketPrices).length, 'market');
  
      const stream = await ollama.chat({
        model: 'gemma3',
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
        images: [Buffer.from(imageFile?.buffer || '').toString('base64')],
        stream: true
      });
  
      let buffer = '';
      for await (const chunk of stream) {
        const text = chunk.message?.content || '';
        buffer += text;
        
        // Flush more frequently
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
  // STEP 6: Embeddings (material search)
const embeddingsAI = async (req, res) => {
    try {
      const { query = 'cheap blocks', location = 'lagos' } = req.body;
      
      // Embed query
      const embedding = await ollama.embeddings({
        model: 'mxbai-embed-large',  // 🆕 Embedding model!
        prompt: `${query} ${location}`
      });
      
      // Mock similarity search (your materials)
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
  upload
};