const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const { getZoyaConstructionPrices } = require('./priceService');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const analyzeConstruction = async (req, res) => {
  try {
    const { 
      houseType = 'duplex',
      plotLength = 15, 
      plotWidth = 20,
      floors = 1,
      phase = 'foundation' 
    } = req.body;
    const imageFile = req.file;

    const zoyaPrices = await getZoyaConstructionPrices(houseType);
    const plotArea = plotLength * plotWidth;

    // 🔥 YOUR WORKING MODEL FROM CURL TEST
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    let prompt = `🏗️ ZOYA ENGINEERING AI - MATERIAL TAKEOFF

PROJECT SPECS:
- Type: ${houseType}
- Plot: ${plotLength}x${plotWidth}m (${plotArea}m²)
- Floors: ${floors}
- Phase: ${phase}

ZOYA LIVE PRICES:
${JSON.stringify(zoyaPrices, null, 2)}

ENGINEERING CALCULATIONS:
FOUNDATION: Concrete=${plotArea}×0.8×1.2m³
Cement: concrete×7 bags/m³
Blocks: perimeter×1.5m×12 blocks/m²

FORMAT AS PROFESSIONAL QS REPORT:
📐 ${houseType} ${phase}
CONCRETE: X m³ @ ₦X = ₦X
CEMENT: X bags @ ₦X = ₦X
BLOCKS: X @ ₦X = ₦X
TOTAL: ₦X MILLION`;

    const parts = [{ text: prompt }];
    
    if (imageFile) {
      parts.push({
        inlineData: {
          data: fs.readFileSync(imageFile.path).toString('base64'),
          mimeType: imageFile.mimetype
        }
      });
    }

    const result = await model.generateContent(parts);
    
    res.json({
      success: true,
      engineeringTakeoff: result.response.text(),
      livePrices: zoyaPrices,
      specs: { houseType, plotLength, plotWidth, floors, phase, plotArea },
      modelUsed: "gemini-3-flash-preview"
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { analyzeConstruction };