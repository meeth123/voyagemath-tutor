import fetch, { Headers, Blob } from 'node-fetch';
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Blob = Blob;

import 'dotenv/config';
import http from 'http';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';

const PORT = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Agentic WebSocket server is running');
});
const wss = new WebSocketServer({ server });

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- AGENTIC MODEL CONFIGURATIONS ---

// 1. Config for the primary, low-latency AUDIO model
const AUDIO_MODEL_CONFIG = {
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
        text: `You are Voyage AI Tutor, a helpful and encouraging math tutor. 

IMPORTANT: You have a special tool available called "get_screenshot_analysis". 

If the user asks you to look at something on their screen, analyze an image, help with a specific problem they're showing you, or mentions "this" referring to visual content, you MUST respond with ONLY a JSON object in this exact format:

{"tool_use": "get_screenshot_analysis", "question_for_vision_model": "Describe what you see and help with the specific question"}

Do NOT say anything else when using the tool - just return the JSON.

For all other conversational interactions, respond normally as a friendly, encouraging math tutor using your voice.`
      }]
    }
  }
};

// 2. Config for the powerful VISION model
const VISION_MODEL_CONFIG = {
  model: 'gemini-1.5-flash-latest',
  generationConfig: {
    temperature: 0.7,
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 2048,
  }
};

// --- WEBSOCKET & ORCHESTRATION LOGIC ---

wss.on('connection', (ws) => {
  console.log('🔗 Client connected to agentic server');
  
  let turnAudioBuffer = [];
  let turnImage = null;
  let currentAudioSession = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('📨 Received message type:', data.type);

      if (data.type === 'image') {
        console.log('📷 Received and stored screenshot for this turn');
        turnImage = data.payload;
        return;
      }
      
      if (data.type === 'audio') {
        turnAudioBuffer.push(data.payload);
        return;
      }
      
      if (data.type === 'end_of_utterance') {
        console.log('🔇 User finished speaking. Starting agentic flow...');
        
        if (turnAudioBuffer.length === 0) {
          console.log('⚠️ No audio data received');
          return;
        }

        const combinedAudioData = turnAudioBuffer.join('');
        turnAudioBuffer = []; // Clear buffer for next turn
        
        console.log('🤖 Connecting to audio model...');

        // --- Agentic Flow: Step 1 - Initial call to the Audio Model ---
        try {
          currentAudioSession = await genAI.live.connect({
            model: AUDIO_MODEL_CONFIG.model,
            config: AUDIO_MODEL_CONFIG.config,
            callbacks: {
              onopen: () => {
                console.log('✅ Audio model session opened');
              },
              
              onerror: (error) => {
                console.error('❌ Audio model session error:', error);
              },
              
              onclose: () => {
                console.log('🔌 Audio model session closed');
              },

              onmessage: async (response) => {
                console.log('📥 Audio model response received');
                
                if (response.serverContent?.modelTurn?.parts) {
                  const part = response.serverContent.modelTurn.parts[0];
                  
                  // Intercept a "tool use" request from the AI
                  if (part.text) {
                    console.log('💬 Audio model text response:', part.text);
                    
                    try {
                      const toolCall = JSON.parse(part.text);
                      if (toolCall.tool_use === 'get_screenshot_analysis') {
                        console.log('🔧 Audio model requested screenshot analysis');
                        
                        // Close the audio session since we're switching to vision
                        if (currentAudioSession) {
                          currentAudioSession.close();
                          currentAudioSession = null;
                        }

                        // --- Agentic Flow: Step 2 - Call the Vision Model ---
                        if (!turnImage) {
                          console.log('❌ No screenshot available for analysis');
                          await speakText("You asked me to look at the screen, but I don't have a screenshot. Please share one first by clicking the screenshot button.", ws);
                          return;
                        }
                        
                        console.log('👁️ Calling vision model for analysis...');
                        const visionModel = genAI.getGenerativeModel(VISION_MODEL_CONFIG);
                        
                        const visionPrompt = [
                          {
                            text: `You are a math tutor analyzing a screenshot. The user's question/context is: "${toolCall.question_for_vision_model}". 

Please provide a detailed analysis of what you see in the image, focusing on any math problems, equations, diagrams, or educational content. Be specific about numbers, operations, and mathematical concepts you observe.

Your response will be read aloud to the user, so write in a conversational, helpful tone as if you're speaking directly to them.`
                          },
                          { 
                            inlineData: {
                              mimeType: turnImage.mimeType,
                              data: turnImage.data
                            }
                          }
                        ];
                        
                        try {
                          const result = await visionModel.generateContent(visionPrompt);
                          const analysisText = await result.response.text();
                          console.log('👁️ Vision model analysis completed');
                          console.log('📝 Analysis:', analysisText.substring(0, 200) + '...');

                          // --- Agentic Flow: Step 3 - Speak the analysis ---
                          await speakText(analysisText, ws);
                          
                          turnImage = null; // Clear image after use
                          return;
                          
                        } catch (visionError) {
                          console.error('❌ Vision model error:', visionError);
                          await speakText("I'm having trouble analyzing the screenshot right now. Could you try taking another screenshot or describe what you're seeing?", ws);
                          return;
                        }
                      }
                    } catch (parseError) {
                      // Not a valid JSON tool call - treat as regular text response
                      console.log('💬 Regular text response, converting to speech');
                      await speakText(part.text, ws);
                      return;
                    }
                  }
                  
                  // If it's a standard audio response, stream it back to the client
                  if (part.inlineData) {
                    console.log('🔊 Streaming audio response to client');
                    ws.send(JSON.stringify({ 
                      type: 'audio', 
                      payload: part.inlineData.data 
                    }));
                  }
                }
                
                if (response.serverContent?.turnComplete) {
                  console.log('✅ Audio model turn complete');
                  ws.send(JSON.stringify({ type: 'turn_complete' }));
                }
              }
            }
          });
          
          // Send the audio data to the model
          console.log('📤 Sending audio to model, length:', combinedAudioData.length);
          await currentAudioSession.sendRealtimeInput({
            audio: {
              data: combinedAudioData,
              mimeType: 'audio/pcm;rate=16000'
            }
          });
          
        } catch (error) {
          console.error('❌ Error in agentic flow:', error);
          await speakText("I'm having some technical difficulties. Please try again.", ws);
        }
      }
    } catch (e) {
      console.error('❌ Error in WebSocket message handler:', e);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Client disconnected');
    if (currentAudioSession) {
      currentAudioSession.close();
      currentAudioSession = null;
    }
  });
});

/**
 * Helper function to convert text to speech using the audio model
 */
async function speakText(text, ws) {
  console.log(`🗣️ Converting text to speech: "${text.substring(0, 100)}..."`);
  
  try {
    const ttsSession = await genAI.live.connect({
      model: AUDIO_MODEL_CONFIG.model,
      config: AUDIO_MODEL_CONFIG.config,
      callbacks: {
        onmessage: (response) => {
          if (response.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
            console.log('🔊 Sending TTS audio to client');
            ws.send(JSON.stringify({ 
              type: 'audio', 
              payload: response.serverContent.modelTurn.parts[0].inlineData.data 
            }));
          }
          if (response.serverContent?.turnComplete) {
            console.log('✅ TTS turn complete');
            ws.send(JSON.stringify({ type: 'turn_complete' }));
            ttsSession.close();
          }
        },
        
        onerror: (error) => {
          console.error('❌ TTS session error:', error);
        }
      }
    });
    
    await ttsSession.sendRealtimeInput({
      text: text
    });
    
  } catch (error) {
    console.error('❌ Error in text-to-speech:', error);
  }
}

server.listen(PORT, () => {
  console.log(`🚀 Agentic Orchestrator Server running on http://localhost:${PORT}`);
  console.log('🎯 Ready to handle audio + vision requests');
}); 