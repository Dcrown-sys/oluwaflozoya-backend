// controllers/constructionAI.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');
const { getZoyaConstructionPrices } = require('../src/ai/priceService');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ── Nigerian construction constants ─────────────────────────
const NIGERIAN_STANDARDS = {
  concreteRatio:     '1:2:4 (Grade 20)',   // standard Nigerian mix
  blockSize:         '225x450mm (9-inch)', // standard Nigerian block
  cementBagsPerM3:   7.5,                  // bags per m³ concrete
  labourPercent:     0.35,                 // labour = 35% of materials
  wasteFactors: {
    blocks:   0.05,  // 5% waste
    tiles:    0.10,  // 10% waste
    cement:   0.08,  // 8% waste
    steel:    0.05,  // 5% waste
    timber:   0.12,  // 12% waste
  },
  regionMultipliers: {
    Lagos:   1.20,
    Abuja:   1.15,
    PortHarcourt: 1.10,
    Kano:    0.90,
    Ibadan:  0.95,
    default: 1.00,
  },
};

// ── Derive key quantities from plot dimensions ───────────────
function computeBaseQuantities({ projectType, houseType, plotLength, plotWidth, floors }) {
  const plotArea    = plotLength * plotWidth;
  // In Nigeria, built-up area is typically 60-70% of plot
  const builtArea   = projectType === 'building' ? plotArea * 0.65 : plotArea;
  const floorArea   = builtArea * floors;
  const perimeter   = 2 * (plotLength + plotWidth);
  const wallHeight  = 3.0; // metres per floor (standard Nigeria)
  const wallArea    = perimeter * wallHeight * floors;
  // Foundation trench: 600mm wide × 900mm deep typical
  const foundationM3 = perimeter * 0.6 * 0.9;

  // Concrete slabs: 150mm thick
  const slabM3     = floorArea * 0.15;
  // Columns: approx 1 per 16m² floor area, 300×300mm
  const columns    = Math.ceil(floorArea / 16);
  const columnM3   = columns * 0.3 * 0.3 * wallHeight * floors;

  // Blocks: 1 block covers ~0.1m² wall area (with mortar)
  const blocksNeeded = Math.ceil((wallArea / 0.1) * (1 + NIGERIAN_STANDARDS.wasteFactors.blocks));

  // Cement bags
  const totalConcreteM3 = foundationM3 + slabM3 + columnM3;
  const cementBags = Math.ceil(totalConcreteM3 * NIGERIAN_STANDARDS.cementBagsPerM3 * (1 + NIGERIAN_STANDARDS.wasteFactors.cement));

  // Roofing (only top floor)
  const roofingArea = builtArea * 1.3; // 30% overhang factor
  const trusses     = Math.ceil(builtArea / 1.2); // truss every 1.2m

  // Rebar: approx 80kg per m³ concrete (Nigerian standard)
  const rebarKg = Math.ceil(totalConcreteM3 * 80 * (1 + NIGERIAN_STANDARDS.wasteFactors.steel));

  return {
    plotArea:       Math.round(plotArea),
    builtArea:      Math.round(builtArea),
    floorArea:      Math.round(floorArea),
    perimeter:      Math.round(perimeter),
    wallArea:       Math.round(wallArea),
    foundationM3:   Math.round(foundationM3 * 10) / 10,
    slabM3:         Math.round(slabM3 * 10) / 10,
    columnM3:       Math.round(columnM3 * 10) / 10,
    totalConcreteM3:Math.round(totalConcreteM3 * 10) / 10,
    blocksNeeded,
    cementBags,
    roofingArea:    Math.round(roofingArea),
    trusses,
    rebarKg,
    columns,
    wallHeight,
    floors,
  };
}

// ── Build a tight, accurate system prompt ────────────────────
function buildSystemPrompt(zoyaPrices, quantities, specs) {
  const { projectType, houseType, plotLength, plotWidth, floors, phase, specialReqs, region } = specs;
  const regionMult = NIGERIAN_STANDARDS.regionMultipliers[region] || NIGERIAN_STANDARDS.regionMultipliers.default;

  return `You are Zoya AI, a professional Quantity Surveyor (QS) with 20 years experience in Nigerian construction.
You specialise in accurate cost estimation using current Nigerian market prices.

=== STRICT RULES FOR ACCURACY ===
1. ALWAYS use the Zoya live prices provided below. Never guess prices.
2. Apply Nigerian standard building codes and practices.
3. Include all waste factors: blocks +5%, tiles +10%, cement +8%, steel +5%, timber +12%.
4. Labour cost = 35% of total material cost (Nigerian market rate).
5. Apply regional price multiplier of ${regionMult}x for ${region || 'this region'}.
6. Round ALL quantities UP to nearest whole unit (never underestimate).
7. State assumptions clearly. If data is missing, ask ONE specific question.
8. Give costs in Naira (₦). Format large numbers with commas (e.g. ₦2,500,000).
9. Never fabricate quantities — use the pre-computed base quantities provided.

=== PROJECT SPECIFICATIONS ===
Type: ${projectType.toUpperCase()}
${projectType === 'building' ? `Building: ${houseType} | Plot: ${plotLength}m × ${plotWidth}m | Floors: ${floors}` : `Dimensions: ${plotLength}m × ${plotWidth}m`}
Phase: ${phase}
Special Requirements: ${specialReqs || 'None stated'}
Region: ${region || 'Nigeria (national average)'}

=== PRE-COMPUTED BASE QUANTITIES (use these, do not recalculate) ===
${JSON.stringify(quantities, null, 2)}

Nigerian Standards Applied:
- Concrete mix: ${NIGERIAN_STANDARDS.concreteRatio}
- Block size: ${NIGERIAN_STANDARDS.blockSize}
- Cement: ${NIGERIAN_STANDARDS.cementBagsPerM3} bags per m³ concrete
- Labour: ${NIGERIAN_STANDARDS.labourPercent * 100}% of material cost

=== ZOYA LIVE MATERIAL PRICES ===
${JSON.stringify(zoyaPrices, null, 2)}

=== OUTPUT FORMAT ===
Return a JSON object with this EXACT structure (no markdown, pure JSON):
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
      "items": [
        { "description": "", "quantity": 0, "unit": "", "unitPrice": 0, "total": 0 }
      ],
      "subtotal": 0
    },
    "structure": { "items": [], "subtotal": 0 },
    "roofing": { "items": [], "subtotal": 0 },
    "finishing": { "items": [], "subtotal": 0 },
    "electrical": { "items": [], "subtotal": 0 },
    "plumbing": { "items": [], "subtotal": 0 }
  },
  "topMaterials": [
    { "name": "", "quantity": 0, "unit": "", "cost": 0, "percentOfTotal": 0 }
  ],
  "recommendations": [],
  "clarifyingQuestions": [],
  "warnings": []
}`;
}

// ── Parse structured JSON from Gemini response ───────────────
function parseGeminiResponse(rawText) {
  try {
    // Strip markdown code fences if present
    const clean = rawText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(clean);
  } catch {
    // Fallback: extract JSON object from text
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}

// ── Format parsed data into human-readable report ────────────
function formatReport(parsed, quantities, specs) {
  if (!parsed) return null;

  const { executiveSummary, phases, topMaterials, recommendations, clarifyingQuestions, warnings } = parsed;
  const fmt = n => `₦${Number(n || 0).toLocaleString()}`;

  // Build phase breakdown text
  const phaseText = Object.entries(phases || {}).map(([phaseName, data]) => {
    if (!data?.items?.length) return null;
    const items = data.items.map(i =>
      `  • ${i.description}: ${i.quantity} ${i.unit} @ ${fmt(i.unitPrice)} = ${fmt(i.total)}`
    ).join('\n');
    return `▶ ${phaseName.toUpperCase()}\n${items}\n  Subtotal: ${fmt(data.subtotal)}`;
  }).filter(Boolean).join('\n\n');

  const topMaterialsText = (topMaterials || []).map(m =>
    `  • ${m.name}: ${m.quantity} ${m.unit} — ${fmt(m.cost)} (${m.percentOfTotal}%)`
  ).join('\n');

  return {
    summary: `
📊 ZOYA QS REPORT — ${specs.projectType.toUpperCase()}
${'═'.repeat(50)}
Plot: ${specs.plotLength}m × ${specs.plotWidth}m | Built Area: ${quantities.builtArea}m² | ${specs.floors} floor(s)

💰 COST SUMMARY
  Materials:  ${fmt(executiveSummary?.totalMaterialCost)}
  Labour:     ${fmt(executiveSummary?.totalLabourCost)}
  ──────────────────────────
  GRAND TOTAL: ${fmt(executiveSummary?.grandTotal)}
  Cost/m²:    ${fmt(executiveSummary?.costPerM2)}
  Duration:   ~${executiveSummary?.durationWeeks} weeks
  Confidence: ${executiveSummary?.confidence?.toUpperCase() || 'MEDIUM'}
`,
    phaseBreakdown: phaseText,
    topMaterials: topMaterialsText,
    recommendations: (recommendations || []).map(r => `• ${r}`).join('\n'),
    questions: clarifyingQuestions || [],
    warnings: (warnings || []).map(w => `⚠️ ${w}`).join('\n'),
    assumptions: (executiveSummary?.assumptions || []).map(a => `• ${a}`).join('\n'),
    raw: parsed,
  };
}

// ── Main controller ──────────────────────────────────────────
const analyzeConstruction = async (req, res) => {
  try {
    const {
      projectType  = 'building',
      houseType    = 'duplex',
      plotLength   = 15,
      plotWidth    = 20,
      floors       = 1,
      phase        = 'complete',
      specialReqs  = '',
      region       = '',
      measureLand  = false,
    } = req.body;

    const imageFile  = req.file;
    const specs      = { projectType, houseType, plotLength: Number(plotLength), plotWidth: Number(plotWidth), floors: Number(floors), phase, specialReqs, region };

    // 1. Get live prices
    const zoyaPrices = await getZoyaConstructionPrices(projectType);

    // 2. Pre-compute quantities (reduces hallucination)
    const quantities = computeBaseQuantities(specs);

    // 3. Build prompt
    const systemPrompt = buildSystemPrompt(zoyaPrices, quantities, specs);

    // 4. Use correct Gemini model
    // gemini-2.5-flash: latest, fast, supports images and JSON mode
    const modelName = 'gemini-2.5-flash';
    const model     = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature:      0.2,   // LOW = factual, not creative
        topP:             0.8,
        topK:             40,
        maxOutputTokens:  8192,
        responseMimeType: 'application/json', // FORCE pure JSON — no markdown backticks
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
      parts.push({
        text: measureLand
          ? '\nAnalyze this image. Extract any visible dimensions, measurements, or scale references. Use them to refine the quantity estimates above.'
          : '\nAnalyze this image for material conditions, site constraints, or quality indicators that affect the cost estimate.',
      });
      // Clean up temp file
      fs.unlink(imageFile.path, () => {});
    }

    // 6. Generate
    const result      = await model.generateContent(parts);
    const rawResponse = result.response.text();

    // 7. Parse structured output
    const parsed  = parseGeminiResponse(rawResponse);
    const report  = formatReport(parsed, quantities, specs);

    // 8. Respond
    res.json({
      success: true,
      report: report
        ? {
            summary:         report.summary,
            phaseBreakdown:  report.phaseBreakdown,
            topMaterials:    report.topMaterials,
            recommendations: report.recommendations,
            warnings:        report.warnings,
            assumptions:     report.assumptions,
            questions:       report.questions,
            structured:      report.raw,       // full structured data for frontend charts
          }
        : {
            // Fallback if JSON parse fails — return raw text
            summary:        '📊 Analysis complete (unstructured)',
            phaseBreakdown: rawResponse,
            questions:      [],
          },
      quantities,   // pre-computed quantities always returned
      specs,
      meta: {
        modelUsed:     modelName,
        imageAnalyzed: !!imageFile,
        landMeasured:  measureLand && !!imageFile,
        pricesUsed:    true,
        region:        region || 'National average',
      },
    });

  } catch (error) {
    console.error('Construction AI error:', error);

    // Friendly error with actionable info
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

// ── Follow-up chat for iterative refinement ──────────────────
// Allows the user to ask follow-up questions about their estimate
const chatConstruction = async (req, res) => {
  try {
    const { message, context } = req.body;
    // context = previously returned specs + structured report

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

Answer concisely and accurately. If the question requires recalculating quantities, show your working.
Use Nigerian market prices and standards. Format costs in ₦.`;

    const result = await model.generateContent([{ text: prompt }]);
    res.json({
      success:  true,
      response: result.response.text(),
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: 'Chat temporarily unavailable.' });
  }
};

module.exports = { analyzeConstruction, chatConstruction };