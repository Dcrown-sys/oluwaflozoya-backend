// controllers/constructionAI.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const { getZoyaConstructionPrices } = require('../src/ai/priceService');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ── Nigerian construction constants ─────────────────────────
const NIGERIAN_STANDARDS = {
  concreteRatio:   '1:2:4 (Grade 20)',
  blockSize:       '225x450mm (9-inch)',
  cementBagsPerM3: 7.5,
  labourPercent:   0.35,
  wasteFactors:    { blocks: 0.05, tiles: 0.10, cement: 0.08, steel: 0.05, timber: 0.12 },
  regionMultipliers: {
    Lagos: 1.20, Abuja: 1.15, PortHarcourt: 1.10,
    Kano: 0.90, Ibadan: 0.95, default: 1.00,
  },
};

// ── Pre-compute quantities ───────────────────────────────────
function computeBaseQuantities({ projectType, plotLength, plotWidth, floors }) {
  const plotArea        = plotLength * plotWidth;
  const builtArea       = projectType === 'building' ? plotArea * 0.65 : plotArea;
  const floorArea       = builtArea * floors;
  const perimeter       = 2 * (plotLength + plotWidth);
  const wallHeight      = 3.0;
  const wallArea        = perimeter * wallHeight * floors;
  const foundationM3    = perimeter * 0.6 * 0.9;
  const slabM3          = floorArea * 0.15;
  const columns         = Math.ceil(floorArea / 16);
  const columnM3        = columns * 0.3 * 0.3 * wallHeight * floors;
  const totalConcreteM3 = foundationM3 + slabM3 + columnM3;
  const blocksNeeded    = Math.ceil((wallArea / 0.1) * (1 + NIGERIAN_STANDARDS.wasteFactors.blocks));
  const cementBags      = Math.ceil(totalConcreteM3 * NIGERIAN_STANDARDS.cementBagsPerM3 * (1 + NIGERIAN_STANDARDS.wasteFactors.cement));
  const roofingArea     = builtArea * 1.3;
  const trusses         = Math.ceil(builtArea / 1.2);
  const rebarKg         = Math.ceil(totalConcreteM3 * 80 * (1 + NIGERIAN_STANDARDS.wasteFactors.steel));

  return {
    plotArea: Math.round(plotArea), builtArea: Math.round(builtArea),
    floorArea: Math.round(floorArea), perimeter: Math.round(perimeter),
    wallArea: Math.round(wallArea), foundationM3: Math.round(foundationM3 * 10) / 10,
    slabM3: Math.round(slabM3 * 10) / 10, columnM3: Math.round(columnM3 * 10) / 10,
    totalConcreteM3: Math.round(totalConcreteM3 * 10) / 10,
    blocksNeeded, cementBags, roofingArea: Math.round(roofingArea),
    trusses, rebarKg, columns, wallHeight, floors,
  };
}

// ── JSON schema for structured estimates ─────────────────────
const QS_JSON_SCHEMA = `
OUTPUT: Return ONLY valid JSON. No markdown. No text outside the JSON.
NUMBERS: All cost fields must be plain integers — no ₦, no commas, no quotes.

{
  "executiveSummary": {
    "totalMaterialCost": 0, "totalLabourCost": 0, "grandTotal": 0,
    "durationWeeks": 0, "costPerM2": 0, "confidence": "medium",
    "assumptions": ["max 4 short assumptions, each under 80 chars"]
  },
  "phases": {
    "foundation": { "items": [{ "description": "", "quantity": 0, "unit": "", "unitPrice": 0, "total": 0 }], "subtotal": 0 },
    "structure":  { "items": [], "subtotal": 0 },
    "roofing":    { "items": [], "subtotal": 0 },
    "finishing":  { "items": [], "subtotal": 0 },
    "electrical": { "items": [], "subtotal": 0 },
    "plumbing":   { "items": [], "subtotal": 0 }
  },
  "topMaterials": [{ "name": "", "quantity": 0, "unit": "", "cost": 0, "percentOfTotal": 0 }],
  "recommendations": [], "clarifyingQuestions": [], "warnings": []
}`;

// ══════════════════════════════════════════════════════════════
// INTENT DETECTION — decides which response mode to use
// ══════════════════════════════════════════════════════════════
function detectIntent(userMessage, hasImage) {
  const msg = (userMessage || '').toLowerCase().trim();

  // Explicit cost/estimate triggers → structured QS estimate
  const estimateTriggers = [
    'how much', 'cost of', 'estimate', 'budget', 'price of building',
    'bill of quantities', 'bq', 'boq', 'how many bags', 'how many blocks',
    'total cost', 'build a', 'construct a', 'analyse', 'analyze my project',
    'full estimate', 'give me a quote', 'calculate cost',
  ];
  if (estimateTriggers.some(t => msg.includes(t))) return 'estimate';

  // Image with measurement/analysis triggers → image analysis (conversational)
  if (hasImage) {
    const imageAnalysisTriggers = [
      'measure', 'size of', 'dimension', 'how big', 'what can fit',
      'what fits', 'suitable for', 'fit on', 'fit in', 'what can i build',
      'what building', 'analyze this', 'analyse this', 'look at this',
      'what do you see', 'describe', 'identify', 'calculate the size',
      'how large', 'what type of building', 'what construction',
    ];
    if (imageAnalysisTriggers.some(t => msg.includes(t))) return 'image_analysis';

    // Image with cost question → structured estimate with image context
    if (estimateTriggers.some(t => msg.includes(t))) return 'estimate';

    // Image with no specific trigger → image analysis by default
    return 'image_analysis';
  }

  // Everything else → conversational
  return 'chat';
}

// ══════════════════════════════════════════════════════════════
// MODE 1: CONVERSATIONAL — general construction questions
// ══════════════════════════════════════════════════════════════
async function handleChat(userMessage, context, zoyaPrices) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  });

  const contextStr = context
    ? `\nPrevious estimate context: ${JSON.stringify(context)}\n`
    : '';

  const prompt = `You are Zoya AI — a friendly, knowledgeable Nigerian construction expert and quantity surveyor with 20 years of experience.

You help people with ALL construction-related questions — not just cost estimates. You can:
- Answer questions about land measurements, plot sizes, and land use
- Explain building regulations, setbacks, and planning rules in Nigeria
- Advise on what types of buildings can fit on a given plot
- Discuss materials, construction methods, timelines
- Help with conversions (feet to metres, plots to m², acres to hectares)
- Explain Nigerian land measurement standards (1 plot = 648m² typically in Lagos, 900m² in Abuja)
- Give general advice on construction projects
- Answer follow-up questions about previous estimates

${contextStr}

Current Zoya market prices (for reference if needed):
${JSON.stringify(zoyaPrices, null, 2)}

User question: ${userMessage}

Answer in a warm, helpful, conversational tone. Be specific and practical. 
Use Nigerian context — reference Lagos, Abuja, Nigerian building codes where relevant.
If the question involves numbers or measurements, show your working clearly.
Format your response nicely using line breaks. Use ₦ for costs.
Do NOT return JSON. Just answer naturally like an expert having a conversation.`;

  const result = await model.generateContent([{ text: prompt }]);
  return {
    type:    'chat',
    content: result.response.text(),
  };
}

// ══════════════════════════════════════════════════════════════
// MODE 2: IMAGE ANALYSIS — conversational image interpretation
// ══════════════════════════════════════════════════════════════
async function handleImageAnalysis(userMessage, imageFile, context, zoyaPrices) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
  });

  const imageData = fs.readFileSync(imageFile.path).toString('base64');
  fs.unlink(imageFile.path, () => {});

  const contextStr = context
    ? `\nPrevious context: ${JSON.stringify(context)}\n`
    : '';

  const prompt = `You are Zoya AI — a friendly, expert Nigerian construction consultant and quantity surveyor.

A user has sent you an image with this question: "${userMessage}"

${contextStr}

Your job is to analyze the image thoroughly and answer the user's question directly and conversationally.

You can:
- Estimate land dimensions from visual cues (road width, car size, tree height, fence posts, shadows)
- Identify building types, styles, and construction stages
- Assess site conditions, topography, soil appearance
- Suggest what types of buildings would fit on a piece of land
- Identify materials used or needed
- Spot potential issues (waterlogging, rocky terrain, slopes)
- Estimate plot sizes using Nigerian land measurement standards:
  * Standard Lagos plot: 60ft × 120ft (18m × 36m) = 648m²
  * Standard Abuja plot: 30m × 30m = 900m²
  * Half plot: 30ft × 120ft = 324m²
  * 1 acre = ~6.25 standard Lagos plots
- If you see a land document, deed, or survey plan, read the measurements directly

Current Zoya market prices (for reference):
${JSON.stringify(zoyaPrices, null, 2)}

Answer the user's specific question first, then provide any additional useful observations.
Be conversational, warm, and practical. Use Nigerian context.
Format with clear line breaks. Use bullet points where helpful.
Do NOT return JSON unless explicitly asked for an estimate.`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { data: imageData, mimeType: imageFile.mimetype } },
  ]);

  return {
    type:    'image_analysis',
    content: result.response.text(),
  };
}

// ══════════════════════════════════════════════════════════════
// MODE 3: STRUCTURED ESTIMATE — full QS report
// ══════════════════════════════════════════════════════════════
async function handleEstimate(specs, imageFile, zoyaPrices) {
  const quantities  = computeBaseQuantities(specs);
  const regionMult  = NIGERIAN_STANDARDS.regionMultipliers[specs.region] || NIGERIAN_STANDARDS.regionMultipliers.default;

  const basePrompt = `You are Zoya AI, a professional Nigerian QS with 20 years experience.

RULES:
1. Use ONLY prices from ZOYA LIVE PRICES. Never invent prices.
2. Waste: blocks+5%, tiles+10%, cement+8%, steel+5%, timber+12%.
3. Labour = 35% of material cost.
4. Regional multiplier: ${regionMult}x for ${specs.region || 'Nigeria'}.
5. Round quantities UP. Plain integers for ALL cost fields — no ₦, no commas.
6. Max 4 assumptions under 80 chars each.
7. Max 8 line items per phase — combine similar items.

PROJECT: ${specs.projectType.toUpperCase()} | ${specs.houseType} | ${specs.plotLength}m×${specs.plotWidth}m | ${specs.floors} floor(s) | ${specs.phase} | ${specs.region || 'Nigeria'}
Special: ${specs.specialReqs || 'None'}

BASE QUANTITIES:
Plot:${quantities.plotArea}m² Built:${quantities.builtArea}m² Concrete:${quantities.totalConcreteM3}m³ Cement:${quantities.cementBags}bags Blocks:${quantities.blocksNeeded} Rebar:${quantities.rebarKg}kg Roofing:${quantities.roofingArea}m²

ZOYA LIVE PRICES:
${JSON.stringify(zoyaPrices, null, 2)}

${QS_JSON_SCHEMA}`;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature:      0.2,
      topP:             0.8,
      topK:             40,
      maxOutputTokens:  65536,
      responseMimeType: 'application/json',
    },
  });

  const parts = [{ text: basePrompt }];

  if (imageFile) {
    const imageData = fs.readFileSync(imageFile.path).toString('base64');
    parts.push({ inlineData: { data: imageData, mimeType: imageFile.mimetype } });
    parts.push({ text: 'Use this image for context (building style, materials, site conditions). Still return complete structured JSON.' });
    fs.unlink(imageFile.path, () => {});
  }

  // Retry up to 2 times on truncation
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result      = await model.generateContent(parts);
    const rawResponse = result.response.text();
    console.log(`📡 Estimate attempt ${attempt} — ${rawResponse.length} chars`);

    const parsed = parseGeminiResponse(rawResponse);
    if (parsed) {
      return { type: 'estimate', parsed, quantities };
    }

    if (attempt < 2) {
      parts.push({ text: 'IMPORTANT: Previous response was truncated. Be more concise — max 5 items per phase, max 3 topMaterials. Return complete valid JSON.' });
    }
  }

  return { type: 'estimate', parsed: null, quantities };
}

// ── Parse JSON with repair ────────────────────────────────────
function parseGeminiResponse(rawText) {
  if (!rawText) return null;
  try { return JSON.parse(rawText.trim()); } catch {}
  try {
    const clean = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch {}
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  // Repair truncated JSON
  try {
    let text = rawText.trim().replace(/,?\s*"[^"]*$/, '').replace(/,?\s*\{[^}]*$/, '');
    text += ']'.repeat(Math.max(0, (text.match(/\[/g) || []).length - (text.match(/\]/g) || []).length));
    text += '}'.repeat(Math.max(0, (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length));
    const repaired = JSON.parse(text);
    console.log('🔧 Repaired truncated JSON');
    return repaired;
  } catch {}
  return null;
}

// ── Format structured estimate into report ────────────────────
function formatEstimateReport(parsed, quantities, specs) {
  if (!parsed) return null;
  const { executiveSummary, phases, topMaterials, recommendations, clarifyingQuestions, warnings } = parsed;
  const fmtN = n => `₦${Number(n || 0).toLocaleString('en-NG')}`;

  const phaseSubtotals = Object.values(phases || {}).map(p => Number(p?.subtotal || 0)).reduce((a, b) => a + b, 0);
  const itemTotals     = Object.values(phases || {}).flatMap(p => (p?.items || []).map(i => Number(i?.total || 0))).reduce((a, b) => a + b, 0);

  const materialCost  = Number(executiveSummary?.totalMaterialCost || 0) || phaseSubtotals || itemTotals;
  const labourCost    = Number(executiveSummary?.totalLabourCost || 0)   || Math.round(materialCost * 0.35);
  const grandTotal    = Number(executiveSummary?.grandTotal || 0)        || (materialCost + labourCost);
  const costPerM2     = Number(executiveSummary?.costPerM2 || 0)         || (quantities.builtArea > 0 ? Math.round(grandTotal / quantities.builtArea) : 0);
  const durationWeeks = Number(executiveSummary?.durationWeeks || 0)     || Math.max(12, Math.round(Math.sqrt(grandTotal / 500000)));

  const patchedSummary = { ...executiveSummary, totalMaterialCost: materialCost, totalLabourCost: labourCost, grandTotal, costPerM2, durationWeeks };

  const phaseText = Object.entries(phases || {}).map(([name, data]) => {
    if (!data?.items?.length) return null;
    const items = data.items.map(i => `  • ${i.description}: ${i.quantity} ${i.unit} @ ${fmtN(i.unitPrice)} = ${fmtN(i.total)}`).join('\n');
    return `▶ ${name.toUpperCase()}\n${items}\n  Subtotal: ${fmtN(data.subtotal)}`;
  }).filter(Boolean).join('\n\n');

  return {
    summary:         `📊 ZOYA QS REPORT — ${specs.projectType.toUpperCase()}\nPlot: ${specs.plotLength}m × ${specs.plotWidth}m | Built: ${quantities.builtArea}m²\nMaterials: ${fmtN(materialCost)} | Labour: ${fmtN(labourCost)}\nGRAND TOTAL: ${fmtN(grandTotal)} | ${fmtN(costPerM2)}/m² | ~${durationWeeks} weeks`,
    phaseBreakdown:  phaseText,
    topMaterials:    (topMaterials || []).map(m => `  • ${m.name}: ${m.quantity} ${m.unit} — ${fmtN(m.cost)} (${m.percentOfTotal}%)`).join('\n'),
    recommendations: (recommendations || []).map(r => `• ${r}`).join('\n'),
    questions:       clarifyingQuestions || [],
    warnings:        (warnings || []).map(w => `⚠️ ${w}`).join('\n'),
    assumptions:     (patchedSummary.assumptions || []).map(a => `• ${a}`).join('\n'),
    raw:             { ...parsed, executiveSummary: patchedSummary },
  };
}

// ══════════════════════════════════════════════════════════════
// MAIN CONTROLLER
// ══════════════════════════════════════════════════════════════
const analyzeConstruction = async (req, res) => {
  try {
    const {
      projectType = 'building',
      houseType   = 'duplex',
      plotLength  = 15,
      plotWidth   = 20,
      floors      = 1,
      phase       = 'complete',
      specialReqs = '',
      region      = '',
      measureLand = false,
    } = req.body;

    const userMessage = specialReqs || '';
    const imageFile   = req.file;

    const specs = {
      projectType, houseType,
      plotLength:  Number(plotLength),
      plotWidth:   Number(plotWidth),
      floors:      Number(floors),
      phase, specialReqs, region,
    };

    // Live prices (used by all modes)
    const zoyaPrices = await getZoyaConstructionPrices(projectType);

    // Detect what the user actually wants
    const intent = detectIntent(userMessage, !!imageFile);
    console.log(`🧠 Intent detected: ${intent} | Message: "${userMessage}" | Image: ${!!imageFile}`);

    // ── Route to correct handler ──────────────────────────────
    if (intent === 'chat') {
      const response = await handleChat(userMessage, null, zoyaPrices);
      return res.json({
        success:      true,
        responseType: 'chat',
        report: {
          summary:        response.content,
          phaseBreakdown: null,
          structured:     null,
        },
        meta: { modelUsed: 'gemini-2.5-flash', intent: 'chat' },
      });
    }

    if (intent === 'image_analysis') {
      const response = await handleImageAnalysis(userMessage, imageFile, null, zoyaPrices);
      return res.json({
        success:      true,
        responseType: 'image_analysis',
        report: {
          summary:        response.content,
          phaseBreakdown: null,
          structured:     null,
        },
        meta: { modelUsed: 'gemini-2.5-flash', intent: 'image_analysis', imageAnalyzed: true },
      });
    }

    // intent === 'estimate' → full structured QS report
    const result    = await handleEstimate(specs, imageFile, zoyaPrices);
    const quantities = result.quantities;

    if (!result.parsed) {
      // Truncation fallback
      return res.json({
        success:      true,
        responseType: 'estimate',
        report: {
          summary:        `📊 Analysis started but response was cut off. Please tap Re-run for a complete estimate.`,
          phaseBreakdown: null,
          structured: {
            executiveSummary: { confidence: 'low', assumptions: ['Response truncated — please re-run.'] },
            phases: {}, topMaterials: [],
          },
        },
        quantities,
        specs,
        meta: { modelUsed: 'gemini-2.5-flash', parsedCleanly: false, intent: 'estimate' },
      });
    }

    const report = formatEstimateReport(result.parsed, quantities, specs);

    return res.json({
      success:      true,
      responseType: 'estimate',
      report: {
        summary:         report.summary,
        phaseBreakdown:  report.phaseBreakdown,
        topMaterials:    report.topMaterials,
        recommendations: report.recommendations,
        warnings:        report.warnings,
        assumptions:     report.assumptions,
        questions:       report.questions,
        structured:      report.raw,
      },
      quantities,
      specs,
      meta: {
        modelUsed:     'gemini-2.5-flash',
        imageAnalyzed: !!imageFile,
        pricesUsed:    true,
        parsedCleanly: true,
        intent:        'estimate',
        region:        region || 'National average',
      },
    });

  } catch (error) {
    console.error('Construction AI error:', error);
    const isQuotaError = error.message?.includes('quota') || error.message?.includes('429');
    res.status(500).json({
      success: false,
      error: isQuotaError
        ? 'AI quota exceeded. Please try again in a few minutes.'
        : 'Zoya AI temporarily unavailable. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : null,
    });
  }
};

// ── Follow-up chat ───────────────────────────────────────────
const chatConstruction = async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message is required' });

    const zoyaPrices = await getZoyaConstructionPrices('building').catch(() => ({}));
    const response   = await handleChat(message, context, zoyaPrices);

    res.json({ success: true, response: response.content });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: 'Chat temporarily unavailable.' });
  }
};

module.exports = { analyzeConstruction, chatConstruction };