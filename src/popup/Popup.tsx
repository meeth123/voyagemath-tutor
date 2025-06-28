import React, { useState, useEffect, useRef } from 'react';

const Popup = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const ws = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBufferQueue = useRef<Float32Array[]>([]);
    const isPlayingRef = useRef(false);
    const nextPlayTimeRef = useRef(0);

    useEffect(() => {
        return () => {
            // Cleanup on unmount
            if (ws.current) ws.current.close();
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    // Improved audio buffer playback with proper browser resampling
    const playAudioBuffer = async (audioData: Float32Array) => {
        try {
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext();
                nextPlayTimeRef.current = 0;
            }
            
            const audioContext = audioContextRef.current;
            
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            // Define the source sample rate from Gemini (24kHz)
            const sourceSampleRate = 24000;

            // Create an AudioBuffer with the original sample rate
            // Let the browser handle resampling automatically
            const audioBuffer = audioContext.createBuffer(
                1, // mono channel
                audioData.length,
                sourceSampleRate // Gemini's original sample rate
            );

            // Set the audio data
            audioBuffer.getChannelData(0).set(audioData);

            // Create source and connect to destination
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            // Add gain control for volume management
            const gainNode = audioContext.createGain();
            gainNode.gain.value = 0.8;
            
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // Schedule playback to avoid gaps (jitter buffer)
            const currentTime = audioContext.currentTime;
            const playTime = Math.max(currentTime, nextPlayTimeRef.current);
            
            source.start(playTime);
            nextPlayTimeRef.current = playTime + audioBuffer.duration;
            
            console.log(`Scheduled audio: ${audioData.length} samples at ${playTime}s, duration: ${audioBuffer.duration}s`);
            
        } catch (error) {
            console.error('Error playing audio buffer:', error);
        }
    };

    // Process audio queue with jitter buffering
    const processAudioQueue = async () => {
        if (isPlayingRef.current || audioBufferQueue.current.length === 0) {
            return;
        }
        
        isPlayingRef.current = true;
        
        // Process all queued audio chunks
        while (audioBufferQueue.current.length > 0) {
            const audioData = audioBufferQueue.current.shift();
            if (audioData) {
                await playAudioBuffer(audioData);
                // Small delay to prevent overwhelming the audio context
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }
        
        isPlayingRef.current = false;
    };

    // Simplified PCM conversion without manual resampling
    const convertPCMToFloat32 = (base64Data: string): Float32Array | null => {
        try {
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const dataView = new DataView(bytes.buffer);
            const float32Data = new Float32Array(bytes.length / 2);

            // Convert 16-bit PCM to Float32 (no resampling - let browser handle it)
            for (let i = 0; i < float32Data.length; i++) {
                float32Data[i] = dataView.getInt16(i * 2, true) / 32768.0;
            }

            console.log(`Converted PCM: ${bytes.length} bytes -> ${float32Data.length} samples`);
            return float32Data;

        } catch (error) {
            console.error('Error converting PCM data:', error);
            return null;
        }
    };

    // Handle incoming audio with buffering
    const handleAudioData = (base64Data: string) => {
        const audioData = convertPCMToFloat32(base64Data);
        if (audioData) {
            // Add to buffer queue for smooth playback
            audioBufferQueue.current.push(audioData);
            processAudioQueue();
        }
    };

    // Modern audio capture using AudioWorklet (fallback to ScriptProcessor if needed)
    const setupAudioCapture = async (stream: MediaStream) => {
        try {
            const audioContext = new AudioContext({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(stream);
            
            // Try to use AudioWorklet first (modern approach)
            try {
                console.log('Loading AudioWorklet processor...');
                await audioContext.audioWorklet.addModule('/audio-processor.js');
                
                const workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor');
                
                // Handle messages from the AudioWorklet
                workletNode.port.onmessage = (event) => {
                    if (event.data.type === 'audioData' && ws.current?.readyState === WebSocket.OPEN) {
                        const pcmData = event.data.data;
                        
                        // Convert to base64
                        const uint8Array = new Uint8Array(pcmData.buffer);
                        const base64Data = btoa(String.fromCharCode(...uint8Array));
                        
                        ws.current.send(base64Data);
                    }
                };
                
                // Connect the audio pipeline
                source.connect(workletNode);
                // Note: AudioWorklet doesn't need to connect to destination for processing
                
                console.log('AudioWorklet setup completed successfully');
                
            } catch (workletError: any) {
                console.log('AudioWorklet failed, using ScriptProcessor fallback:', workletError.message);
                
                // Fallback to ScriptProcessor
                const processor = audioContext.createScriptProcessor(4096, 1, 1);
                
                processor.onaudioprocess = (event) => {
                    if (ws.current?.readyState === WebSocket.OPEN) {
                        const inputBuffer = event.inputBuffer;
                        const inputData = inputBuffer.getChannelData(0);
                        
                        // Convert float32 to 16-bit PCM
                        const pcmData = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                            pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)));
                        }
                        
                        // Convert to base64
                        const uint8Array = new Uint8Array(pcmData.buffer);
                        const base64Data = btoa(String.fromCharCode(...uint8Array));
                        
                        ws.current.send(base64Data);
                    }
                };
                
                source.connect(processor);
                processor.connect(audioContext.destination);
                
                console.log('ScriptProcessor fallback setup completed');
            }
            
        } catch (error) {
            console.error('Error setting up audio capture:', error);
            throw error;
        }
    };

    const handleToggleRecording = async () => {
        if (isRecording) {
            // Stop recording
            console.log('Stopping recording...');
            if (ws.current) {
                ws.current.close();
            }
            // Clear audio queue and reset timing
            audioBufferQueue.current = [];
            nextPlayTimeRef.current = 0;
            setIsRecording(false);
        } else {
            // Start recording
            console.log('Starting recording...');
            setError('');
            setIsLoading(true);

            try {
                console.log('Requesting microphone access...');
                
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        sampleRate: 16000,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true
                    } 
                });
                
                console.log('Microphone access granted');
                console.log('Connecting to WebSocket...');
                
                ws.current = new WebSocket('ws://localhost:3001');
                
                ws.current.onopen = async () => {
                    console.log('WebSocket connected successfully');
                    setIsLoading(false);
                    setIsRecording(true);

                    // Handle audio response from server
                    ws.current!.onmessage = (event) => {
                        console.log('Received audio response from server, length:', event.data.length);
                        handleAudioData(event.data);
                    };

                    // Setup improved audio capture
                    await setupAudioCapture(stream);
                };
                
                ws.current.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    setError('Connection error');
                    setIsLoading(false);
                };
                
                ws.current.onclose = () => {
                    console.log('WebSocket connection closed');
                    setIsRecording(false);
                };
                
            } catch (error: any) {
                console.error('Error starting recording:', error);
                setError('Failed to start recording: ' + error.message);
                setIsLoading(false);
            }
        }
    };

    return (
        <div>
            <h1>Voyage AI Tutor</h1>
            <p>Click the button and start speaking.</p>
            <button onClick={handleToggleRecording} disabled={isLoading}>
                {isLoading ? 'Connecting...' : (isRecording ? 'Stop Listening' : 'Start Listening')}
            </button>
            {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        </div>
    );
};

export default Popup;