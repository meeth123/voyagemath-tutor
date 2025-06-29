import fetch, { Headers, Blob } from 'node-fetch';
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Blob = Blob;

import 'dotenv/config';
import { GoogleGenAI, Modality } from '@google/genai';

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

console.log('🧪 Testing Gemini Live API connection...');

// Test 1: Minimal configuration
const testMinimalConnection = async () => {
  console.log('\n🔬 Test 1: Minimal Configuration');
  try {
    const session = await Promise.race([
      genAI.live.connect({
        model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
        config: {
          responseModalities: [Modality.AUDIO]
        },
        callbacks: {
          onopen: () => console.log('✅ Minimal config: Connection opened'),
          onerror: (error) => console.error('❌ Minimal config error:', error),
          onclose: () => console.log('🔌 Minimal config: Connection closed'),
          onmessage: (response) => console.log('📨 Minimal config response:', Object.keys(response))
        }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 15 seconds')), 15000))
    ]);
    
    console.log('✅ Minimal connection successful');
    session.close();
  } catch (error) {
    console.error('❌ Minimal connection failed:', error.message);
  }
};

// Test 2: With voice config
const testWithVoiceConfig = async () => {
  console.log('\n🔬 Test 2: With Voice Configuration');
  try {
    const session = await Promise.race([
      genAI.live.connect({
        model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                voiceName: 'Zephyr' 
              } 
            } 
          }
        },
        callbacks: {
          onopen: () => console.log('✅ Voice config: Connection opened'),
          onerror: (error) => console.error('❌ Voice config error:', error),
          onclose: () => console.log('🔌 Voice config: Connection closed'),
          onmessage: (response) => console.log('📨 Voice config response:', Object.keys(response))
        }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 15 seconds')), 15000))
    ]);
    
    console.log('✅ Voice config connection successful');
    session.close();
  } catch (error) {
    console.error('❌ Voice config connection failed:', error.message);
  }
};

// Test 3: With system instruction
const testWithSystemInstruction = async () => {
  console.log('\n🔬 Test 3: With System Instruction');
  try {
    const session = await Promise.race([
      genAI.live.connect({
        model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                voiceName: 'Zephyr' 
              } 
            } 
          },
          systemInstruction: {
            parts: [{
              text: `You are a helpful math tutor.`
            }]
          }
        },
        callbacks: {
          onopen: () => console.log('✅ System instruction: Connection opened'),
          onerror: (error) => console.error('❌ System instruction error:', error),
          onclose: () => console.log('🔌 System instruction: Connection closed'),
          onmessage: (response) => console.log('📨 System instruction response:', Object.keys(response))
        }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 15 seconds')), 15000))
    ]);
    
    console.log('✅ System instruction connection successful');
    session.close();
  } catch (error) {
    console.error('❌ System instruction connection failed:', error.message);
  }
};

// Test 4: API Key validation
const testAPIKey = () => {
  console.log('\n🔬 Test 4: API Key Validation');
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ No GEMINI_API_KEY found in environment');
    return false;
  }
  
  if (process.env.GEMINI_API_KEY.length < 20) {
    console.error('❌ GEMINI_API_KEY seems too short');
    return false;
  }
  
  console.log('✅ API Key appears to be present and properly formatted');
  console.log('🔍 API Key length:', process.env.GEMINI_API_KEY.length);
  console.log('🔍 API Key prefix:', process.env.GEMINI_API_KEY.substring(0, 10) + '...');
  return true;
};

// Run all tests
const runAllTests = async () => {
  console.log('🚀 Starting comprehensive Gemini Live API diagnostics...\n');
  
  // Test API key first
  if (!testAPIKey()) {
    console.log('\n❌ API Key test failed - stopping other tests');
    return;
  }
  
  // Run connection tests
  await testMinimalConnection();
  await testWithVoiceConfig();
  await testWithSystemInstruction();
  
  console.log('\n🏁 All tests completed');
};

runAllTests().catch(console.error); 