require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  try {
    console.log('🔍 DISCOVERING YOUR MODELS...\n');
    
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    
    // Try both API versions
    const apiVersions = ['v1beta', 'v1'];
    
    for (const apiVersion of apiVersions) {
      console.log(`=== API Version: ${apiVersion} ===`);
      
      try {
        const testGenAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY, { 
          apiVersion 
        });
        
        // Test common models
        const modelsToTest = [
          'gemini-pro',
          'gemini-1.0-pro',
          'gemini-1.5-flash',
          'gemini-1.5-pro',
          'gemini-pro-vision',
          'gemini-1.5-flash-latest',
          'gemini-1.5-pro-latest'
        ];
        
        for (const modelName of modelsToTest) {
          try {
            const model = testGenAI.getGenerativeModel({ model: modelName });
            await model.generateContent('test');
            console.log(`✅ ${modelName} (v${apiVersion}) - WORKING! 🎉`);
            return { modelName, apiVersion }; // Found one!
          } catch (e) {
            // Silent fail
          }
        }
      } catch (e) {
        console.log(`❌ API v${apiVersion} failed`);
      }
    }
    
    console.log('\n❌ No models found. Check API key at aistudio.google.com');
    
  } catch (error) {
    console.error('ERROR:', error.message);
  }
}

listModels();