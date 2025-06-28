import fetch, { Headers, Blob } from 'node-fetch';
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Blob = Blob;

import 'dotenv/config';
import http from 'http';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality, MediaResolution } from '@google/genai';

const PORT = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (ws) => {
  console.log('Client connected');

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = 'models/gemini-2.5-flash-preview-native-audio-dialog';
  const config = {
    responseModalities: [Modality.AUDIO],
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr'
        }
      }
    },
    systemInstruction: {
      parts: [{
        text: 'You are Voyage AI Tutor, a helpful and encouraging math tutor. Your role is to help students learn math concepts through conversation. Be patient, supportive, and guide students to discover answers rather than just giving them. Ask follow-up questions to check understanding and provide hints when needed. Keep responses concise and conversational since this is a voice-based interaction. When you receive screenshots, analyze them carefully to understand what the student is working on and provide specific, contextual help based on what you can see in the image.'
      }]
    }
  };

  console.log('Attempting to connect to Gemini live session...');
  console.log('Model:', model);
  console.log('Config:', JSON.stringify(config, null, 2));

  let session = null;
  const responseQueue = [];

  try {
    // Use the Live API connection method with callbacks
    session = await ai.live.connect({
      model: model,
      config: config,
      callbacks: {
        onopen: () => {
          console.log('✅ Gemini live session opened successfully');
        },
        onmessage: (message) => {
          console.log('📨 Received message from Gemini:', JSON.stringify(message, null, 2));
          responseQueue.push(message);
          
          if (message.setupComplete) {
            console.log('✅ Setup completed successfully');
          }
          
          // Handle audio response like in the example
          if (message.serverContent?.modelTurn?.parts) {
            const part = message.serverContent.modelTurn.parts[0];
            
            if (part?.inlineData) {
              console.log('🔊 Audio response received, length:', part.inlineData.data.length);
              console.log('🔊 Audio mime type:', part.inlineData.mimeType);
              // Send audio data as base64 string to client
              ws.send(part.inlineData.data);
            }
            
            if (part?.text) {
              console.log('📝 Text response:', part.text);
            }
          }
        },
        onerror: (error) => {
          console.error('❌ Gemini session error:', error);
        },
        onclose: (event) => {
          console.log('❌ Gemini Session Closed:', event.reason);
        }
      }
    });

    console.log('✅ Gemini live session connected successfully');

  } catch (error) {
    console.error('❌ Failed to connect to Gemini live session:', error);
  }

  ws.on('message', async (message) => {
    try {
      const messageStr = message.toString();
      
      // Try to parse as JSON (new format with type)
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(messageStr);
      } catch (jsonError) {
        // Fallback to old format (raw base64 audio)
        parsedMessage = {
          type: 'audio',
          data: messageStr
        };
      }

      console.log('🎤 Received message from client, type:', parsedMessage.type);

      if (session) {
        if (parsedMessage.type === 'audio') {
          // Handle audio data
          const base64Data = parsedMessage.data;
          console.log('📤 Sending audio to Gemini, length:', base64Data.length);
          
          try {
            await session.sendRealtimeInput({
              audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=16000'
              }
            });
            console.log('✅ Audio sent to Gemini successfully');
          } catch (error) {
            console.error('❌ Error sending audio to Gemini:', error);
          }

        } else if (parsedMessage.type === 'screenshot') {
          // Handle screenshot data
          const imageBase64 = parsedMessage.data;
          const mimeType = parsedMessage.mimeType || 'image/png';
          
          console.log('📷 Sending screenshot to Gemini, length:', imageBase64.length);
          console.log('📷 Image mime type:', mimeType);
          
          try {
            await session.sendRealtimeInput({
              image: {
                data: imageBase64,
                mimeType: mimeType
              }
            });
            console.log('✅ Screenshot sent to Gemini successfully');
          } catch (error) {
            console.error('❌ Error sending screenshot to Gemini:', error);
          }
        }
      } else {
        console.log('❌ No session available to send data');
      }
    } catch (e) {
      console.error('❌ Error processing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (session) {
      session.close();
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
}); 