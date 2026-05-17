// controllers/constructionAI.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');
const { getZoyaConstructionPrices } = require('../src/ai/priceService');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ── Nigerian construction constants ─────────────────────────
const NIGERIAN_STANDARDS = {
  concreteRatio:   '1:2:4 (Grade 20)',
  blockSize:       '225x450mm (9-inch)',
  cementBagsPerM3: 7.5,
  labourPercent:   0.35,
  wasteFactors: {
    blocks: 0.05,
    tiles:  0.10,
    cement: 0.08,
    steel:  0.05,
    timber: 0.12,
  },
  regionMultipliers: {
    Lagos:        1.20,
    Abuja:        1.15,
    PortHarcourt: 1.10,
    Kano:         0.90,
    Ibadan:       0.95,
    default:      1.00,
  },
};

// ── Derive key quantities from plot dimensions ───────────────
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
  const blocksNeeded    = Math.ceil((wallArea / 0.1) * (1 + NIGERIAN_STANDARDS.wasteFactors.blocks));
  const totalConcreteM3 = foundationM3 + slabM3 + columnM3;
  const cementBags      = Math.ceil(totalConcreteM3 * NIGERIAN_STANDARDS.cementBagsPerM3 * (1 + NIGERIAN_STANDARDS.wasteFactors.cement));
  const roofingArea     = builtArea * 1.3;
  const trusses         = Math.ceil(builtArea / 1.2);
  const rebarKg         = Math.ceil(totalConcreteM3 * 80 * (1 + NIGERIAN_STANDARDS.wasteFactors.steel));

  return {
    plotArea:        Math.round(plotArea),
    builtArea:       Math.round(builtArea),
    floorArea:       Math.round(floorArea),
    perimeter:       Math.round(perimeter),
    wallArea:        Math.round(wallArea),
    foundationM3:    Math.round(foundationM3 * 10) / 10,
    slabM3:          Math.round(slabM3 * 10) / 10,
    columnM3:        Math.round(columnM3 * 10) / 10,
    totalConcreteM3: Math.round(totalConcreteM3 * 10) / 10,
    blocksNeeded,
    cementBags,
    roofingArea:     Math.round(roofingArea),
    trusses,
    rebarKg,
    columns,
    wallHeight,
    floors,
  };
}

// ── Shared JSON output schema ────────────────────────────────
// IMPORTANT: kept intentionally compact to reduce output token count.
// Fewer tokens in the schema = more tokens left for actual data.
const JSON_OUTPUT_SCHEMA = `
OUTPUT: Return ONLY valid JSON. No markdown, no text before or after.
NUMBERS: All cost fields must be plain integers — no ₦, no commas, no quotes.
Good: "grandTotal": 36500000   Bad: "grandTotal": "₦36,500,000"

{
  "executiveSummary": {
    "totalMaterialCost": 0,
    "totalLabourCost": 0,
    "grandTotal": 0,
    "durationWeeks": 0,
    "costPerM2": 0,
    "confidence": "medium",
    "assumptions": ["max 4 short assumptions"]
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
  "recommendations": [],
  "clarifyingQuestions": [],
  "warnings": []
}`;

// ── Build system prompt ──────────────────────────────────────
function buildSystemPrompt(zoyaPrices, quantities, specs) {
  const { projectType, houseType, plotLength, plotWidth, floors, phase, specialReqs, region } = specs;
  const regionMult = NIGERIAN_STANDARDS.regionMultipliers[region] || NIGERIAN_STANDARDS.regionMultipliers.default;

  return `You are Zoya AI, a professional Nigerian QS with 20 years experience.

RULES:
1. Use ONLY prices from ZOYA LIVE PRICES below.
2. Waste: blocks+5%, tiles+10%, cement+8%, steel+5%, timber+12%.
3. Labour = 35% of material cost.
4. Regional multiplier: ${regionMult}x for ${region || 'Nigeria'}.
5. Round quantities UP. Plain integers for all cost fields.
6. Keep assumptions array to MAX 4 items, each under 80 chars.
7. Keep each phase to MAX 8 line items — combine similar items.

PROJECT: ${projectType.toUpperCase()} | ${houseType} | ${plotLength}m×${plotWidth}m | ${floors} floor(s) | ${phase} phase | ${region || 'Nigeria'}
Special: ${specialReqs || 'None'}

BASE QUANTITIES (do not recalculate):
Plot:${quantities.plotArea}m² Built:${quantities.builtArea}m² Concrete:${quantities.totalConcreteM3}m³ Cement:${quantities.cementBags}bags Blocks:${quantities.blocksNeeded} Rebar:${quantities.rebarKg}kg Roofing:${quantities.roofingArea}m²

ZOYA LIVE PRICES:
${JSON.stringify(zoyaPrices, null, 2)}

${JSON_OUTPUT_SCHEMA}`;
}

// ── Build image prompt ───────────────────────────────────────
function buildImagePrompt(zoyaPrices, quantities, specs) {
  const { projectType, houseType, plotLength, plotWidth, floors, phase, specialReqs, region } = specs;
  const regionMult = NIGERIAN_STANDARDS.regionMultipliers[region] || NIGERIAN_STANDARDS.regionMultipliers.default;

  return `You are Zoya AI, a professional Nigerian QS analyzing a construction image.

TASK: Use the image for context (building style, materials, site conditions). Then produce a FULL structured cost estimate using the specs and quantities below. The image is context only — you must still return complete JSON.

RULES:
1. Use ONLY prices from ZOYA LIVE PRICES below.
2. Waste: blocks+5%, tiles+10%, cement+8%, steel+5%, timber+12%.
3. Labour = 35% of material cost.
4. Regional multiplier: ${regionMult}x for ${region || 'Nigeria'}.
5. Round quantities UP. Plain integers for all cost fields.
6. Keep assumptions to MAX 4 items, each under 80 chars.
7. Keep each phase to MAX 8 line items — combine similar items.

PROJECT: ${projectType.toUpperCase()} | ${houseType} | ${plotLength}m×${plotWidth}m | ${floors} floor(s) | ${phase} phase | ${region || 'Nigeria'}
Special: ${specialReqs || 'None'}

BASE QUANTITIES (do not recalculate):
Plot:${quantities.plotArea}m² Built:${quantities.builtArea}m² Concrete:${quantities.totalConcreteM3}m³ Cement:${quantities.cementBags}bags Blocks:${quantities.blocksNeeded} Rebar:${quantities.rebarKg}kg Roofing:${quantities.roofingArea}m²

ZOYA LIVE PRICES:
${JSON.stringify(zoyaPrices, null, 2)}

${JSON_OUTPUT_SCHEMA}`;
}

// ── Parse JSON — handles truncation by closing open braces ──
function parseGeminiResponse(rawText) {
  if (!rawText) return null;

  // Try 1: direct parse
  try { return JSON.parse(rawText.trim()); } catch {}

  // Try 2: strip markdown fences
  try {
    const clean = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch {}

  // Try 3: extract first complete { } block
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  // Try 4: attempt to repair truncated JSON by closing open brackets
  try {
    let text = rawText.trim();
    // Remove trailing incomplete line (often mid-string)
    text = text.replace(/,?\s*"[^"]*$/, '');
    text = text.replace(/,?\s*\{[^}]*$/, '');

    // Count and close unclosed braces/brackets
    const opens  = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;
    const aopens  = (text.match(/\[/g) || []).length;
    const acloses = (text.match(/\]/g) || []).length;

    // Close arrays first, then objects
    text += ']'.repeat(Math.max(0, aopens - acloses));
    text += '}'.repeat(Math.max(0, opens - closes));

    const repaired = JSON.parse(text);
    console.log('🔧 Repaired truncated JSON successfully');
    return repaired;
  } catch {}

  return null;
}

// ── Format parsed data into report ──────────────────────────
function formatReport(parsed, quantities, specs) {
  if (!parsed) return null;
  const { executiveSummary, phases, topMaterials, recommendations, clarifyingQuestions, warnings } = parsed;
  const fmtN = n => `₦${Number(n || 0).toLocaleString('en-NG')}`;

  const phaseSubtotals = Object.values(phases || {})
    .map(p => Number(p?.subtotal || 0)).reduce((a, b) => a + b, 0);
  const itemTotals = Object.values(phases || {})
    .flatMap(p => (p?.items || []).map(i => Number(i?.total || 0)))
    .reduce((a, b) => a + b, 0);

  const materialCost  = Number(executiveSummary?.totalMaterialCost || 0) || phaseSubtotals || itemTotals;
  const labourCost    = Number(executiveSummary?.totalLabourCost || 0)   || Math.round(materialCost * 0.35);
  const grandTotal    = Number(executiveSummary?.grandTotal || 0)        || (materialCost + labourCost);
  const costPerM2     = Number(executiveSummary?.costPerM2 || 0)         || (quantities.builtArea > 0 ? Math.round(grandTotal / quantities.builtArea) : 0);
  const durationWeeks = Number(executiveSummary?.durationWeeks || 0)     || Math.max(12, Math.round(Math.sqrt(grandTotal / 500000)));

  const patchedSummary = {
    ...executiveSummary,
    totalMaterialCost: materialCost,
    totalLabourCost:   labourCost,
    grandTotal,
    costPerM2,
    durationWeeks,
  };

  const phaseText = Object.entries(phases || {}).map(([phaseName, data]) => {
    if (!data?.items?.length) return null;
    const items = data.items.map(i =>
      `  • ${i.description}: ${i.quantity} ${i.unit} @ ${fmtN(i.unitPrice)} = ${fmtN(i.total)}`
    ).join('\n');
    return `▶ ${phaseName.toUpperCase()}\n${items}\n  Subtotal: ${fmtN(data.subtotal)}`;
  }).filter(Boolean).join('\n\n');

  const topMaterialsText = (topMaterials || []).map(m =>
    `  • ${m.name}: ${m.quantity} ${m.unit} — ${fmtN(m.cost)} (${m.percentOfTotal}%)`
  ).join('\n');

  return {
    summary:         `📊 ZOYA QS REPORT — ${specs.projectType.toUpperCase()}\nPlot: ${specs.plotLength}m × ${specs.plotWidth}m | Built: ${quantities.builtArea}m²\nMaterials: ${fmtN(materialCost)} | Labour: ${fmtN(labourCost)}\nGRAND TOTAL: ${fmtN(grandTotal)} | ${fmtN(costPerM2)}/m² | ~${durationWeeks} weeks`,
    phaseBreakdown:  phaseText,
    topMaterials:    topMaterialsText,
    recommendations: (recommendations || []).map(r => `• ${r}`).join('\n'),
    questions:       clarifyingQuestions || [],
    warnings:        (warnings || []).map(w => `⚠️ ${w}`).join('\n'),
    assumptions:     (patchedSummary.assumptions || []).map(a => `• ${a}`).join('\n'),
    raw: { ...parsed, executiveSummary: patchedSummary },
  };
}

// ── Fallback when JSON is unrecoverable ──────────────────────
function buildFallbackReport(rawText, quantities, specs) {
  const fmtN = n => `₦${Number(n || 0).toLocaleString('en-NG')}`;
  console.warn('⚠️ JSON unrecoverable — building fallback');

  const totalMatch = rawText.match(/grand\s*total[^\d]*?([\d,]+)/i);
  const grandTotal    = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : 0;
  const materialCost  = Math.round(grandTotal / 1.35);
  const labourCost    = grandTotal - materialCost;
  const costPerM2     = quantities.builtArea > 0 ? Math.round(grandTotal / quantities.builtArea) : 0;

  return {
    summary:         `📊 ZOYA QS REPORT — ${specs.projectType.toUpperCase()}\nPlot: ${specs.plotLength}m × ${specs.plotWidth}m\n${grandTotal > 0 ? `GRAND TOTAL: ${fmtN(grandTotal)}` : 'Re-run for full estimate'}`,
    phaseBreakdown:  '⚠️ Response was cut off. Please tap "Re-run Analysis" for a complete breakdown.',
    topMaterials:    '',
    recommendations: '• Re-run the analysis for a fully structured report.',
    questions:       [],
    warnings:        '⚠️ AI response was truncated. Tap re-run for complete results.',
    assumptions:     '',
    raw: {
      executiveSummary: {
        totalMaterialCost: materialCost,
        totalLabourCost:   labourCost,
        grandTotal,
        costPerM2,
        durationWeeks:     0,
        confidence:        'low',
        assumptions:       ['Response truncated — re-run for full structured estimate.'],
      },
      phases:       {},
      topMaterials: [],
    },
  };
}

// ── Call Gemini with retry on truncation ─────────────────────
async function callGeminiWithRetry(model, parts, quantities, specs, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result      = await model.generateContent(parts);
    const rawResponse = result.response.text();

    console.log(`📡 Attempt ${attempt} — response length: ${rawResponse.length} chars`);

    const parsed = parseGeminiResponse(rawResponse);
    if (parsed) {
      console.log(`✅ Parsed successfully on attempt ${attempt}`);
      return { parsed, rawResponse };
    }

    // If truncated and we have retries left, add an explicit length warning
    if (attempt < maxRetries) {
      console.warn(`⚠️ Attempt ${attempt} truncated — retrying with stricter token limit hint`);
      // Append a reminder to the last text part to be more concise
      const lastTextIdx = [...parts].map(p => p.text).lastIndexOf(
        parts.filter(p => p.text).pop()?.text
      );
      // Add conciseness reminder to parts for retry
      parts = [
        ...parts,
        { text: 'IMPORTANT: Your previous response was truncated. Be MORE CONCISE. Max 5 items per phase. Max 3 topMaterials. Still return complete valid JSON.' },
      ];
    }
  }

  return { parsed: null, rawResponse: '' };
}

// ── Main controller ──────────────────────────────────────────
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

    const imageFile = req.file;
    const specs     = {
      projectType,
      houseType,
      plotLength:  Number(plotLength),
      plotWidth:   Number(plotWidth),
      floors:      Number(floors),
      phase,
      specialReqs,
      region,
    };

    // 1. Live prices
    const zoyaPrices = await getZoyaConstructionPrices(projectType);

    // 2. Pre-compute quantities
    const quantities = computeBaseQuantities(specs);

    // 3. Build prompt
    const systemPrompt = imageFile
      ? buildImagePrompt(zoyaPrices, quantities, specs)
      : buildSystemPrompt(zoyaPrices, quantities, specs);

    // 4. Model config
    // FIX: increased maxOutputTokens from 16384 → 65536 to prevent truncation.
    // gemini-2.5-flash supports up to 65536 output tokens.
    const modelName = 'gemini-2.5-flash';
    const model     = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature:      0.2,
        topP:             0.8,
        topK:             40,
        maxOutputTokens:  65536,          // ← was 16384, now 65536
        responseMimeType: 'application/json',
      },
    });

    // 5. Build content parts
    let parts = [{ text: systemPrompt }];

    if (imageFile) {
      const imageData = fs.readFileSync(imageFile.path).toString('base64');
      parts.push({
        inlineData: { data: imageData, mimeType: imageFile.mimetype },
      });
      parts.push({
        text: measureLand
          ? 'Use image dimensions/measurements to refine quantities. Return complete structured JSON.'
          : 'Use image for context (style, materials, conditions). Return complete structured JSON.',
      });
      fs.unlink(imageFile.path, () => {});
    }

    // 6. Generate with retry on truncation
    const { parsed, rawResponse } = await callGeminiWithRetry(model, parts, quantities, specs);

    // 7. Format
    const report = parsed
      ? formatReport(parsed, quantities, specs)
      : buildFallbackReport(rawResponse, quantities, specs);

    // 8. Respond
    res.json({
      success: true,
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
        modelUsed:     modelName,
        imageAnalyzed: !!imageFile,
        landMeasured:  measureLand && !!imageFile,
        pricesUsed:    true,
        parsedCleanly: !!parsed,
        region:        region || 'National average',
      },
    });

  } catch (error) {
    console.error('Construction AI error:', error);
    const isQuotaError = error.message?.includes('quota') || error.message?.includes('429');
    const isModelError = error.message?.includes('model') || error.message?.includes('404');
    res.status(500).json({
      success: false,
      error: isQuotaError
        ? 'AI quota exceeded. Please try again in a few minutes.'
        : isModelError
        ? 'AI model configuration error. Please contact support.'
        : 'Zoya Engineering AI temporarily unavailable.',
      details: process.env.NODE_ENV === 'development' ? error.message : null,
    });
  }
};

// ── Follow-up chat ───────────────────────────────────────────
const chatConstruction = async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message is required' });

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    });

    const contextStr = context
      ? `Previous estimate context:\n${JSON.stringify(context, null, 2)}\n\n`
      : '';

    const prompt = `You are Zoya AI, a professional Nigerian Quantity Surveyor.
${contextStr}
User question: ${message}

Answer concisely. Show workings if recalculating. Use Nigerian prices. Format costs in ₦.`;

    const result = await model.generateContent([{ text: prompt }]);
    res.json({ success: true, response: result.response.text() });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: 'Chat temporarily unavailable.' });
  }
};

module.exports = { analyzeConstruction, chatConstruction };