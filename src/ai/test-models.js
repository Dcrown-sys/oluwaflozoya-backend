require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testExactModels() {
  console.log('Testing AI Studio models...\n');
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  
  // Exact names from AI Studio
  const studioModels = [
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash-8b-exp',
    'gemini-1.5-pro-002',
    'gemini-1.5-flash-002'
  ];

  for (const modelName of studioModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('test');
      console.log(`✅🎉 ${modelName} WORKS!`);
      return modelName;
    } catch (e) {
      console.log(`❌ ${modelName}`);
    }
  }
  
  console.log('\n🚨 Try OpenAI instead (faster)');
}

testExactModels();