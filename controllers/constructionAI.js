// controllers/constructionAI.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');
const { getZoyaConstructionPrices } = require('../src/ai/priceService');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ── Nigerian construction constants ─────────────────────────
const NIGERIAN_STANDARDS = {
  concreteRatio:     '1:2:4 (Grade 20)',
  blockSize:         '225x450mm (9-inch)',
  cementBagsPerM3:   7.5,
  labourPercent:     0.35,
  wasteFactors: {
    blocks:   0.05,
    tiles:    0.10,
    cement:   0.08,
    steel:    0.05,
    timber:   0.12,
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
function computeBaseQuantities({ projectType, houseType, plotLength, plotWidth, floors }) {
  const plotArea      = plotLength * plotWidth;
  const builtArea     = projectType === 'building' ? plotArea * 0.65 : plotArea;
  const floorArea     = builtArea * floors;
  const perimeter     = 2 * (plotLength + plotWidth);
  const wallHeight    = 3.0;
  const wallArea      = perimeter * wallHeight * floors;
  const foundationM3  = perimeter * 0.6 * 0.9;
  const slabM3        = floorArea * 0.15;
  const columns       = Math.ceil(floorArea / 16);
  const columnM3      = columns * 0.3 * 0.3 * wallHeight * floors;
  const blocksNeeded  = Math.ceil((wallArea / 0.1) * (1 + NIGERIAN_STANDARDS.wasteFactors.blocks));
  const totalConcreteM3 = foundationM3 + slabM3 + columnM3;
  const cementBags    = Math.ceil(totalConcreteM3 * NIGERIAN_STANDARDS.cementBagsPerM3 * (1 + NIGERIAN_STANDARDS.wasteFactors.cement));
  const roofingArea   = builtArea * 1.3;
  const trusses       = Math.ceil(builtArea / 1.2);
  const rebarKg       = Math.ceil(totalConcreteM3 * 80 * (1 + NIGERIAN_STANDARDS.wasteFactors.steel));

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

// ── Shared JSON output schema (used in all prompts) ──────────
const JSON_OUTPUT_SCHEMA = `
Return ONLY a valid JSON object with this EXACT structure. No markdown. No explanation. No text before or after.
{
  "executiveSummary": {
    "totalMaterialCost": 0,
    "totalLabourCost": 0,
    "grandTotal": 0,
    "durationWeeks": 0,
    "costPerM2": 0,
    "confidence": "high|medium|low",
    "assumptions": []
  },
  "phases": {
    "foundation": {
      "items": [{ "description": "", "quantity": 0, "unit": "", "unitPrice": 0, "total": 0 }],
      "subtotal": 0
    },
    "structure":  { "items": [], "subtotal": 0 },
    "roofing":    { "items": [], "subtotal": 0 },
    "finishing":  { "items": [], "subtotal": 0 },
    "electrical": { "items": [], "subtotal": 0 },
    "plumbing":   { "items": [], "subtotal": 0 }
  },
  "topMaterials": [
    { "name": "", "quantity": 0, "unit": "", "cost": 0, "percentOfTotal": 0 }
  ],
  "recommendations": [],
  "clarifyingQuestions": [],
  "warnings": []
}

CRITICAL RULES FOR ALL NUMBERS:
- Every cost field (unitPrice, total, subtotal, totalMaterialCost, etc.) MUST be a plain integer — no ₦ symbol, no commas, no quotes.
- Example correct: "grandTotal": 36500000
- Example WRONG:   "grandTotal": "₦36,500,000"`;

// ── Build system prompt (text path) ─────────────────────────
function buildSystemPrompt(zoyaPrices, quantities, specs) {
  const { projectType, houseType, plotLength, plotWidth, floors, phase, specialReqs, region } = specs;
  const regionMult = NIGERIAN_STANDARDS.regionMultipliers[region] || NIGERIAN_STANDARDS.regionMultipliers.default;

  return `You are Zoya AI, a professional Quantity Surveyor (QS) with 20 years experience in Nigerian construction.

=== STRICT RULES ===
1. Use ONLY the Zoya live prices below. Never invent prices.
2. Apply waste factors: blocks +5%, tiles +10%, cement +8%, steel +5%, timber +12%.
3. Labour = 35% of total material cost.
4. Apply regional multiplier of ${regionMult}x for ${region || 'Nigeria'}.
5. Round ALL quantities UP to nearest whole unit.
6. Costs in plain integers only — no ₦ symbol, no commas in JSON fields.

=== PROJECT SPECIFICATIONS ===
Type: ${projectType.toUpperCase()}
${projectType === 'building' ? `Building: ${houseType} | Plot: ${plotLength}m × ${plotWidth}m | Floors: ${floors}` : `Dimensions: ${plotLength}m × ${plotWidth}m`}
Phase: ${phase}
Special Requirements: ${specialReqs || 'None'}
Region: ${region || 'Nigeria'}

=== PRE-COMPUTED BASE QUANTITIES (do NOT recalculate these) ===
${JSON.stringify(quantities, null, 2)}

Nigerian Standards:
- Concrete mix: ${NIGERIAN_STANDARDS.concreteRatio}
- Block size: ${NIGERIAN_STANDARDS.blockSize}
- Cement: ${NIGERIAN_STANDARDS.cementBagsPerM3} bags/m³
- Labour: ${NIGERIAN_STANDARDS.labourPercent * 100}% of material cost

=== ZOYA LIVE MATERIAL PRICES ===
${JSON.stringify(zoyaPrices, null, 2)}

${JSON_OUTPUT_SCHEMA}`;
}

// ── Build image prompt (SAME structured output required) ─────
function buildImagePrompt(zoyaPrices, quantities, specs) {
  const { projectType, houseType, plotLength, plotWidth, floors, phase, specialReqs, region } = specs;
  const regionMult = NIGERIAN_STANDARDS.regionMultipliers[region] || NIGERIAN_STANDARDS.regionMultipliers.default;

  return `You are Zoya AI, a professional Nigerian Quantity Surveyor analyzing a construction site image.

=== YOUR TASK ===
1. Analyze the image to identify: building style, visible materials, site conditions, construction stage, and any quality indicators.
2. Use your image observations TOGETHER with the project specs and pre-computed quantities to produce a FULLY STRUCTURED cost estimate.
3. If the image shows a different building type or scale than the specs, note it as an assumption and proceed with the specs.
4. You MUST still return the complete structured JSON below — the image gives you context, not an excuse to skip structure.

=== STRICT RULES ===
1. Use ONLY the Zoya live prices below. Never invent prices.
2. Apply waste factors: blocks +5%, tiles +10%, cement +8%, steel +5%, timber +12%.
3. Labour = 35% of total material cost.
4. Apply regional multiplier of ${regionMult}x for ${region || 'Nigeria'}.
5. Round ALL quantities UP to nearest whole unit.
6. Costs in plain integers only — no ₦ symbol, no commas in JSON fields.

=== PROJECT SPECIFICATIONS ===
Type: ${projectType.toUpperCase()}
${projectType === 'building' ? `Building: ${houseType} | Plot: ${plotLength}m × ${plotWidth}m | Floors: ${floors}` : `Dimensions: ${plotLength}m × ${plotWidth}m`}
Phase: ${phase}
Special Requirements: ${specialReqs || 'None'}
Region: ${region || 'Nigeria'}

=== PRE-COMPUTED BASE QUANTITIES (use these, do NOT recalculate) ===
${JSON.stringify(quantities, null, 2)}

=== ZOYA LIVE MATERIAL PRICES ===
${JSON.stringify(zoyaPrices, null, 2)}

${JSON_OUTPUT_SCHEMA}`;
}

// ── Parse structured JSON from Gemini response ───────────────
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
    summary: `📊 ZOYA QS REPORT — ${specs.projectType.toUpperCase()}\nPlot: ${specs.plotLength}m × ${specs.plotWidth}m | Built: ${quantities.builtArea}m²\nMaterials: ${fmtN(materialCost)} | Labour: ${fmtN(labourCost)}\nGRAND TOTAL: ${fmtN(grandTotal)} | ${fmtN(costPerM2)}/m² | ~${durationWeeks} weeks`,
    phaseBreakdown:  phaseText,
    topMaterials:    topMaterialsText,
    recommendations: (recommendations || []).map(r => `• ${r}`).join('\n'),
    questions:       clarifyingQuestions || [],
    warnings:        (warnings || []).map(w => `⚠️ ${w}`).join('\n'),
    assumptions:     (patchedSummary.assumptions || []).map(a => `• ${a}`).join('\n'),
    raw: { ...parsed, executiveSummary: patchedSummary },
  };
}

// ── Build structured error report when JSON parse fails ──────
// Instead of returning raw text, we return a minimal valid structure
// so the frontend always gets consistent data to render.
function buildFallbackReport(rawText, quantities, specs) {
  const fmtN = n => `₦${Number(n || 0).toLocaleString('en-NG')}`;
  console.warn('⚠️ JSON parse failed — building fallback structured report');

  // Try to extract a grand total from the raw text using regex
  const totalMatch = rawText.match(/grand\s*total[^\d]*?([\d,]+)/i);
  const grandTotal = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : 0;
  const materialCost  = Math.round(grandTotal / 1.35);
  const labourCost    = grandTotal - materialCost;
  const costPerM2     = quantities.builtArea > 0 ? Math.round(grandTotal / quantities.builtArea) : 0;

  return {
    summary: `📊 ZOYA QS REPORT — ${specs.projectType.toUpperCase()}\nPlot: ${specs.plotLength}m × ${specs.plotWidth}m\n${grandTotal > 0 ? `GRAND TOTAL: ${fmtN(grandTotal)}` : 'Could not extract totals — see analysis below'}`,
    phaseBreakdown:  rawText, // show raw text as fallback in the UI
    topMaterials:    '',
    recommendations: '• Re-run the analysis for a fully structured report.',
    questions:       [],
    warnings:        '⚠️ Structured parsing failed. Raw AI response shown above.',
    assumptions:     '',
    raw: {
      executiveSummary: {
        totalMaterialCost: materialCost,
        totalLabourCost:   labourCost,
        grandTotal,
        costPerM2,
        durationWeeks:     0,
        confidence:        'low',
        assumptions:       ['Structured parsing failed — figures extracted from raw text.'],
      },
      phases:       {},
      topMaterials: [],
    },
  };
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

    // 3. Build the right prompt depending on whether image is present
    //    Both paths use the SAME JSON output schema — no more unstructured fallback
    const systemPrompt = imageFile
      ? buildImagePrompt(zoyaPrices, quantities, specs)
      : buildSystemPrompt(zoyaPrices, quantities, specs);

    // 4. Model — gemini-2.5-flash supports both image + JSON mode
    const modelName = 'gemini-2.5-flash';
    const model     = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature:      0.2,
        topP:             0.8,
        topK:             40,
        maxOutputTokens:  16384,
        responseMimeType: 'application/json', // force pure JSON on BOTH paths
      },
    });

    // 5. Build content parts
    const parts = [{ text: systemPrompt }];

    if (imageFile) {
      const imageData = fs.readFileSync(imageFile.path).toString('base64');
      parts.push({
        inlineData: {
          data:     imageData,
          mimeType: imageFile.mimetype,
        },
      });
      // Image instruction — just context, NOT a replacement for structure
      parts.push({
        text: measureLand
          ? 'Analyze this image for visible dimensions, measurements, or scale references. Use them to refine quantities. Still return the full structured JSON.'
          : 'Analyze this image for building style, site conditions, material quality, and construction stage. Factor observations into your estimate. Still return the full structured JSON.',
      });
      // Clean up temp file
      fs.unlink(imageFile.path, () => {});
    }

    // 6. Generate
    const result      = await model.generateContent(parts);
    const rawResponse = result.response.text();

    console.log(`📡 Gemini raw response length: ${rawResponse.length} chars`);

    // 7. Parse — same parser for both text and image paths
    const parsed = parseGeminiResponse(rawResponse);

    // 8. Format — if parse succeeded use full report, else build structured fallback
    //    NEVER return raw unstructured text as phaseBreakdown
    const report = parsed
      ? formatReport(parsed, quantities, specs)
      : buildFallbackReport(rawResponse, quantities, specs);

    // 9. Respond — same shape regardless of image or text path
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
        parsedCleanly: !!parsed,   // tells frontend if JSON came back clean
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

Answer concisely and accurately. Show workings if recalculating quantities.
Use Nigerian market prices and standards. Format costs in ₦.`;

    const result = await model.generateContent([{ text: prompt }]);
    res.json({ success: true, response: result.response.text() });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: 'Chat temporarily unavailable.' });
  }
};

module.exports = { analyzeConstruction, chatConstruction };