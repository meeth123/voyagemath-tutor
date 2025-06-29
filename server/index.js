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
        text: `You are Voyage AI Tutor, a helpful and encouraging math tutor.`
      }]
    }
  }
};

// Simplified config for testing connection issues
const SIMPLE_AUDIO_CONFIG = {
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
    // No system instruction to test if that's the issue
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
  let audioMessageCount = 0;
  
  // Periodic logging to track what's happening
  const statusInterval = setInterval(() => {
    console.log(`📊 Status: ${audioMessageCount} audio messages received, buffer size: ${turnAudioBuffer.length}`);
    audioMessageCount = 0; // Reset counter
  }, 5000); // Every 5 seconds

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('📨 Received message type:', data.type);
      
      // Add detailed logging for debugging
      if (data.type !== 'audio') {
        console.log('🔍 Non-audio message details:', {
          type: data.type,
          hasPayload: !!data.payload,
          payloadLength: data.payload ? data.payload.length : 0,
          timestamp: new Date().toISOString()
        });
      }

      if (data.type === 'image') {
        console.log('📷 Received and stored screenshot for this turn');
        turnImage = data.payload;
        return;
      }
      
      if (data.type === 'audio') {
        turnAudioBuffer.push(data.payload);
        audioMessageCount++;
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
          // Test with simplified config first to isolate the issue
          console.log('🔍 Testing connection with simplified config...');
          
          // Add timeout to prevent hanging
          const connectionPromise = genAI.live.connect({
            model: SIMPLE_AUDIO_CONFIG.model,
            config: SIMPLE_AUDIO_CONFIG.config,
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

              onmessage: (response) => {
                console.log('📥 Audio model response received');
                console.log('🔍 Response structure:', JSON.stringify(response, null, 2));
                
                // Handle the response asynchronously but don't block the callback
                setImmediate(async () => {
                  try {
                    await handleAudioModelResponse(response, ws, turnImage);
                  } catch (error) {
                    console.error('❌ Error handling audio model response:', error);
                  }
                });
              }
            }
          });

          // Add 10 second timeout to prevent hanging
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000);
          });

          console.log('⏱️ Attempting connection with 10s timeout...');
          currentAudioSession = await Promise.race([connectionPromise, timeoutPromise]);
          console.log('✅ Connection successful! Session state:', currentAudioSession.state);
          
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
          console.error('🔍 Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack?.substring(0, 500)
          });
          
          // Provide specific error messages based on the type of error
          let errorMessage = "I'm having some technical difficulties. Please try again.";
          if (error.message.includes('timeout')) {
            errorMessage = "The connection is taking too long. This might be a temporary issue with the AI service.";
            console.log('🔍 DIAGNOSIS: Connection timeout - likely API rate limiting or model unavailability');
          } else if (error.message.includes('quota') || error.message.includes('rate')) {
            errorMessage = "The AI service is currently busy. Please wait a moment and try again.";
            console.log('🔍 DIAGNOSIS: Quota or rate limiting issue');
          } else if (error.message.includes('model')) {
            errorMessage = "There's an issue with the AI model. This might be a temporary service problem.";
            console.log('🔍 DIAGNOSIS: Model-specific error - possibly model unavailability');
          }
          
          await speakText(errorMessage, ws);
        }
      }
    } catch (e) {
      console.error('❌ Error in WebSocket message handler:', e);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Client disconnected');
    clearInterval(statusInterval);
    if (currentAudioSession) {
      currentAudioSession.close();
      currentAudioSession = null;
    }
  });
});

/**
 * Handle audio model responses asynchronously to avoid blocking the callback
 */
async function handleAudioModelResponse(response, ws, turnImage) {
  if (response.serverContent?.modelTurn?.parts) {
    const part = response.serverContent.modelTurn.parts[0];
    
    // Intercept a "tool use" request from the AI
    if (part.text) {
      console.log('💬 Audio model text response:', part.text);
      
      try {
        const toolCall = JSON.parse(part.text);
        if (toolCall.tool_use === 'get_screenshot_analysis') {
          console.log('🔧 Audio model requested screenshot analysis');
          
          // Note: We'll let the session close naturally after the tool call

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

/**
 * A robust helper function to have the audio model speak a given text (Text-to-Speech).
 * It now waits for the session to be fully open before sending the text prompt.
 */
async function speakText(text, ws) {
  console.log(`🤖 AI Speaking: "${text}"`);
  try {
    const ttsSession = await genAI.live.connect({
      model: AUDIO_MODEL_CONFIG.model,
      config: AUDIO_MODEL_CONFIG.config,
      callbacks: {
        onopen: () => {
          console.log('✅ TTS session opened');
        },
        
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
          ttsSession.close();
        },
        
        onclose: () => {
          console.log('🔌 TTS session closed');
        }
      }
    });

    // This promise will only resolve once the session's state is 'open'
    await new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (ttsSession.state === 'open') {
          clearInterval(checkInterval);
          resolve();
        } else if (ttsSession.state === 'closed' || ttsSession.state === 'error') {
          clearInterval(checkInterval);
          reject(new Error(`TTS Session failed to open. State: ${ttsSession.state}`));
        }
      }, 50); // Check every 50ms
    });

    console.log('📤 Sending text to audio model for TTS...');
    // Now that we know the session is open, it's safe to send the text
    await ttsSession.sendText(text);

  } catch (e) {
      console.error('❌ Error in speakText function:', e);
  }
}

server.listen(PORT, () => {
  console.log(`🚀 Agentic Orchestrator Server running on http://localhost:${PORT}`);
  console.log('🎯 Ready to handle audio + vision requests');
}); 