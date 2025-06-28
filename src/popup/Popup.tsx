import React, { useState, useEffect, useRef } from 'react';

const Popup = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const ws = useRef<WebSocket | null>(null);
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        return () => {
            // Cleanup on unmount
            if (ws.current) ws.current.close();
            if (mediaRecorder.current) mediaRecorder.current.stop();
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const playAudioBuffer = async (audioData: Float32Array) => {
        try {
            // Create or reuse audio context
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext();
            }
            
            const audioContext = audioContextRef.current;
            
            // Resume context if suspended
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            
            // Create audio buffer
            const audioBuffer = audioContext.createBuffer(1, audioData.length, audioContext.sampleRate);
            const channelData = audioBuffer.getChannelData(0);
            channelData.set(audioData);
            
            // Create and play audio source immediately
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            // Add gain control
            const gainNode = audioContext.createGain();
            gainNode.gain.value = 0.8;
            
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // Play immediately
            source.start();
            
            console.log(`Playing audio buffer: ${audioData.length} samples at ${audioContext.sampleRate}Hz`);
            
        } catch (error) {
            console.error('Error playing audio buffer:', error);
        }
    };



    const convertPCMToFloat32 = (base64Data: string): Float32Array | null => {
        try {
            // Decode base64 to binary
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Gemini sends 24kHz PCM, we need to resample to browser's sample rate
            const sourceSampleRate = 24000;
            const dataView = new DataView(bytes.buffer);
            const numSourceSamples = bytes.length / 2;
            
            // Get or create audio context to know target sample rate
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext();
            }
            const targetSampleRate = audioContextRef.current.sampleRate;
            
            console.log(`Converting PCM: ${numSourceSamples} samples from ${sourceSampleRate}Hz to ${targetSampleRate}Hz`);
            
            // Calculate resampled length
            const resampledLength = Math.floor(numSourceSamples * targetSampleRate / sourceSampleRate);
            const float32Data = new Float32Array(resampledLength);
            
            // Resample with linear interpolation
            for (let i = 0; i < resampledLength; i++) {
                const sourceIndex = i * sourceSampleRate / targetSampleRate;
                const index = Math.floor(sourceIndex);
                const fraction = sourceIndex - index;
                
                let sample1 = 0, sample2 = 0;
                
                // Get first sample
                if (index * 2 < bytes.length - 1) {
                    sample1 = dataView.getInt16(index * 2, true) / 32768.0;
                }
                
                // Get second sample for interpolation
                if ((index + 1) * 2 < bytes.length - 1) {
                    sample2 = dataView.getInt16((index + 1) * 2, true) / 32768.0;
                }
                
                // Linear interpolation
                float32Data[i] = sample1 + (sample2 - sample1) * fraction;
            }
            
            console.log(`Resampled PCM: ${bytes.length} bytes -> ${resampledLength} samples at ${targetSampleRate}Hz`);
            return float32Data;
            
        } catch (error) {
            console.error('Error converting PCM data:', error);
            return null;
        }
    };

    const handleAudioData = async (base64Data: string) => {
        const audioData = convertPCMToFloat32(base64Data);
        if (audioData) {
            // Play audio immediately without queueing
            await playAudioBuffer(audioData);
        }
    };

    const handleToggleRecording = async () => {
        if (isRecording) {
            // Stop recording
            console.log('Stopping recording...');
            if (mediaRecorder.current) {
                mediaRecorder.current.stop();
            }
            if (ws.current) {
                ws.current.close();
            }

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
                
                ws.current.onopen = () => {
                    console.log('WebSocket connected successfully');
                    setIsLoading(false);
                    setIsRecording(true);

                    // Handle audio response from server
                    ws.current!.onmessage = (event) => {
                        console.log('Received audio response from server, length:', event.data.length);
                        handleAudioData(event.data);
                    };

                    // Use AudioWorklet for real-time PCM capture
                    const audioContext = new AudioContext({ sampleRate: 16000 });
                    const source = audioContext.createMediaStreamSource(stream);
                    
                    // Create a ScriptProcessorNode for audio processing (fallback method)
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
                    
                    console.log('Recording started with PCM format');
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