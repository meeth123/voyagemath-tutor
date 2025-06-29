import React, { useState, useEffect, useRef } from 'react';

// Chrome extension API type declaration
declare const chrome: {
    runtime: {
        getURL: (path: string) => string;
        sendMessage: (message: any, callback: (response: any) => void) => void;
        lastError?: Error;
    };
};

const Popup = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [isTutorSpeaking, setIsTutorSpeaking] = useState(false);
    const [isAiCurrentlySpeaking, setIsAiCurrentlySpeaking] = useState(false);
    const [isUserSpeaking, setIsUserSpeaking] = useState(false);
    const [screenshot, setScreenshot] = useState<string | null>(null);

    const ws = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    
    // Audio playback queue and streaming player
    const audioQueueRef = useRef<Float32Array[]>([]);
    const isPlayingRef = useRef<boolean>(false);
    const aiSpeechTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            // Cleanup on unmount
            if (ws.current) ws.current.close();
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            if (aiSpeechTimeoutRef.current) {
                clearTimeout(aiSpeechTimeoutRef.current);
            }
        };
    }, []);

    // Convert base64 PCM to Float32Array for playback
    const convertPCMToFloat32 = (base64Data: string): Float32Array | null => {
        try {
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const pcmData = new Int16Array(bytes.buffer);
            const float32Data = new Float32Array(pcmData.length);
            
            for (let i = 0; i < pcmData.length; i++) {
                float32Data[i] = pcmData[i] / 32768.0;
            }
            
            return float32Data;
        } catch (error) {
            console.error('Error converting PCM data:', error);
            return null;
        }
    };

    /**
     * Streaming playback processor - plays one chunk and automatically continues to the next
     * This creates a self-perpetuating loop that ensures no audio chunks are lost
     */
    const processPlaybackQueue = () => {
        if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
            console.log('🔇 Playback queue empty - AI finished speaking');
            isPlayingRef.current = false;
            setIsTutorSpeaking(false);
            setIsAiCurrentlySpeaking(false);
            return;
        }

        isPlayingRef.current = true;
        setIsTutorSpeaking(true);
        setIsAiCurrentlySpeaking(true);

        const audioData = audioQueueRef.current.shift();
        if (!audioData) {
            processPlaybackQueue(); // Safeguard - process next chunk
            return;
        }

        console.log(`🔊 Playing audio chunk: ${audioData.length} samples`);

        // Create audio buffer with original Gemini sample rate (24kHz)
        const audioBuffer = audioContextRef.current.createBuffer(1, audioData.length, 24000);
        audioBuffer.getChannelData(0).set(audioData);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        
        // The key: onended automatically processes the next chunk
        // This ensures continuous, gap-free playback
        source.onended = () => {
            console.log('📡 Audio chunk finished, processing next...');
            processPlaybackQueue();
        };
        
        source.start();
    };

    // Handle messages from AudioWorklet (VAD events)
    const handleWorkletMessage = (event: MessageEvent) => {
        const { type, data } = event.data;
        
        switch (type) {
            case 'speechStart':
                console.log('🎤 User started speaking');
                setIsUserSpeaking(true);
                
                // Barge-in: Simply clear the audio queue to interrupt AI
                if (isTutorSpeaking || isAiCurrentlySpeaking) {
                    console.log('🚫 User barge-in detected - clearing audio queue');
                    stopAllPlayback();
                }
                break;
                
            case 'audioData':
                // Send audio data to server using new agentic protocol
                if (ws.current?.readyState === WebSocket.OPEN) {
                    // Convert Float32Array to 16-bit PCM
                    const pcmData = new Int16Array(data.length);
                    for (let i = 0; i < data.length; i++) {
                        pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(data[i] * 32768)));
                    }
                    
                    // Convert to base64 and send using new protocol
                    const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
                    ws.current.send(JSON.stringify({
                        type: 'audio',
                        payload: base64Data
                    }));
                }
                break;
                
            case 'speechEnd':
                console.log('🔇 User finished speaking - sending end_of_utterance');
                setIsUserSpeaking(false);
                
                // Send end_of_utterance signal to trigger agentic processing
                if (ws.current?.readyState === WebSocket.OPEN) {
                    ws.current.send(JSON.stringify({
                        type: 'end_of_utterance'
                    }));
                }
                break;
                
            default:
                console.warn('Unknown worklet message type:', type);
        }
    };

    // Handle audio data from server with new protocol
    const handleAudioDataFromServer = (data: any) => {
        try {
            const response = JSON.parse(data);
            
            if (response.type === 'audio') {
                // If user is currently speaking (barge-in), ignore AI audio
                if (isUserSpeaking) {
                    console.log('🚫 Ignoring AI audio - user is speaking (barge-in)');
                    return;
                }

                const audioData = convertPCMToFloat32(response.payload);
                if (audioData) {
                    console.log(`📥 Received audio chunk: ${audioData.length} samples`);
                    audioQueueRef.current.push(audioData);
                    
                    // If playback loop isn't running, start it
                    if (!isPlayingRef.current) {
                        console.log('🔊 Starting playback loop');
                        processPlaybackQueue();
                    }
                }
            } else if (response.type === 'turn_complete') {
                console.log('✅ Server indicated turn complete');
            }
        } catch (error) {
            // Fallback for old format (raw base64 audio)
            const audioData = convertPCMToFloat32(data);
            if (audioData) {
                console.log(`📥 Received audio chunk (legacy): ${audioData.length} samples`);
                audioQueueRef.current.push(audioData);
                
                if (!isPlayingRef.current) {
                    console.log('🔊 Starting playback loop');
                    processPlaybackQueue();
                }
            }
        }
    };

    // Simplified barge-in logic - just clear the queue
    const stopAllPlayback = () => {
        console.log('🛑 Stopping all playback');
        audioQueueRef.current = []; // Clear queue
        isPlayingRef.current = false;
        setIsTutorSpeaking(false);
        setIsAiCurrentlySpeaking(false);
        
        if (aiSpeechTimeoutRef.current) {
            clearTimeout(aiSpeechTimeoutRef.current);
            aiSpeechTimeoutRef.current = null;
        }
    };

    const handleToggleRecording = async () => {
        if (isRecording) {
            // Stop recording
            if (ws.current) {
                ws.current.close();
                ws.current = null;
            }
            
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            
            if (audioContextRef.current) {
                await audioContextRef.current.close();
                audioContextRef.current = null;
            }
            
            workletNodeRef.current = null;
            stopAllPlayback();
            setIsRecording(false);
            setIsAiCurrentlySpeaking(false);
            setIsUserSpeaking(false);
            setIsTutorSpeaking(false);
            
        } else {
            // Start recording
            setError('');
            setIsLoading(true);

            try {
                // Get microphone access
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        sampleRate: 16000,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                streamRef.current = stream;

                // Create WebSocket connection
                ws.current = new WebSocket('ws://localhost:3001');
                
                ws.current.onopen = async () => {
                    console.log('✅ WebSocket connected');
                    setIsLoading(false);
                    setIsRecording(true);
                    
                    // Handle audio data from server
                    ws.current!.onmessage = (event) => {
                        handleAudioDataFromServer(event.data);
                    };
                    
                    ws.current!.onclose = () => {
                        console.log('🔌 WebSocket disconnected');
                    };
                    
                    ws.current!.onerror = (error) => {
                        console.error('❌ WebSocket error:', error);
                    };

                    // Set up AudioContext and AudioWorklet
                    const audioContext = new AudioContext({ sampleRate: 16000 });
                    audioContextRef.current = audioContext;

                    try {
                        // Load AudioWorklet processor
                        console.log('📡 Loading AudioWorklet processor...');
                        const workletUrl = chrome.runtime.getURL('audio-processor.js');
                        await audioContext.audioWorklet.addModule(workletUrl);
                        
                        // Create AudioWorkletNode with VAD parameters
                        const workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor', {
                            processorOptions: {
                                speechThreshold: 0.015,  // Lowered threshold to catch quieter speech
                                silenceFrames: 188       // ~1.5 seconds of silence (188 frames * 128 samples/frame / 16000 Hz)
                            }
                        });
                        
                        workletNode.port.onmessage = handleWorkletMessage;
                        workletNodeRef.current = workletNode;

                        // Connect audio pipeline
                        const source = audioContext.createMediaStreamSource(stream);
                        source.connect(workletNode);
                        // Note: Don't connect worklet to destination to avoid feedback
                        
                        console.log('✅ AudioWorklet VAD system ready');
                        
                    } catch (workletError) {
                        console.error('❌ AudioWorklet setup failed:', workletError);
                        throw workletError;
                    }
                };
                
                ws.current.onerror = (error) => {
                    console.error('❌ WebSocket connection failed:', error);
                    setError('Failed to connect to server. Make sure the server is running on port 3001.');
                    setIsLoading(false);
                };
                
            } catch (error: any) {
                console.error('❌ Failed to start recording:', error);
                setError(error.message || 'Failed to access microphone');
                setIsLoading(false);
            }
        }
    };

    const handleScreenshot = async () => {
        try {
            console.log('📷 Requesting screenshot...');
            
            // Send message to background script to capture screenshot
            const response = await new Promise<{success: boolean, data?: string, error?: string}>((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'captureScreenshot'
                }, (response) => {
                    // Check if chrome.runtime.lastError occurred
                    if (chrome.runtime.lastError) {
                        console.error('❌ Chrome runtime error:', chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    
                    // Check if response is undefined (common issue)
                    if (!response) {
                        console.error('❌ No response from background script');
                        reject(new Error('No response from background script'));
                        return;
                    }
                    
                    console.log('📷 Background script response:', response);
                    resolve(response);
                });
            });
            
            if (response.success && response.data) {
                console.log('📷 Screenshot captured successfully');
                setScreenshot(response.data);
                
                // Send screenshot to server using new agentic protocol
                if (ws.current?.readyState === WebSocket.OPEN) {
                    ws.current.send(JSON.stringify({
                        type: 'image',
                        payload: {
                            mimeType: 'image/png',
                            data: response.data
                        }
                    }));
                    console.log('📷 Screenshot sent to agentic server');
                } else {
                    console.warn('⚠️ WebSocket not connected, screenshot not sent to AI');
                }
            } else {
                console.error('❌ Screenshot capture failed:', response.error);
                setError(response.error || 'Failed to capture screenshot');
            }
        } catch (error: any) {
            console.error('❌ Screenshot error:', error);
            setError('Failed to capture screenshot: ' + error.message);
        }
    };

    const forceResumeMicrophone = () => {
        console.log('🔧 Force resuming microphone...');
        stopAllPlayback();
        setIsAiCurrentlySpeaking(false);
        setIsUserSpeaking(false);
        setIsTutorSpeaking(false);
    };

    return (
        <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            width: '320px',
            backgroundColor: 'white',
            border: '2px solid #4285f4',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            zIndex: 10000,
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px'
        }}>
            {/* Header */}
            <div style={{
                backgroundColor: '#4285f4',
                color: 'white',
                padding: '12px 16px',
                borderRadius: '10px 10px 0 0',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}>
                <span>🎓</span>
                Voyage AI Tutor
            </div>

            {/* Content */}
            <div style={{ padding: '16px' }}>
                {/* Status indicators */}
                <div style={{ marginBottom: '12px', fontSize: '12px' }}>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px',
                        marginBottom: '4px'
                    }}>
                        <span style={{ 
                            width: '8px', 
                            height: '8px', 
                            borderRadius: '50%', 
                            backgroundColor: isRecording ? '#34a853' : '#ea4335' 
                        }}></span>
                        <span>{isRecording ? 'Connected' : 'Disconnected'}</span>
                    </div>
                    
                    {isUserSpeaking && (
                        <div style={{ color: '#1976d2', fontSize: '11px' }}>
                            🎤 Listening...
                        </div>
                    )}
                    
                    {isTutorSpeaking && (
                        <div style={{ color: '#7b1fa2', fontSize: '11px' }}>
                            🔊 AI Tutor speaking...
                        </div>
                    )}
                </div>

                {/* Main button */}
                <button
                    onClick={handleToggleRecording}
                    disabled={isLoading}
                    style={{
                        width: '100%',
                        padding: '12px',
                        backgroundColor: isRecording ? '#ea4335' : '#4285f4',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        opacity: isLoading ? 0.7 : 1,
                        marginBottom: '12px'
                    }}
                >
                    {isLoading ? 'Connecting...' : isRecording ? '🛑 Stop Session' : '🎙️ Start Voice Session'}
                </button>

                {/* Screenshot button */}
                <button
                    onClick={handleScreenshot}
                    disabled={!isRecording}
                    style={{
                        width: '100%',
                        padding: '8px',
                        backgroundColor: isRecording ? '#34a853' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: isRecording ? 'pointer' : 'not-allowed',
                        marginBottom: '12px'
                    }}
                >
                    📷 Share Screenshot with AI
                </button>

                {/* Screenshot preview */}
                {screenshot && (
                    <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                            Last screenshot sent:
                        </div>
                        <img 
                            src={`data:image/png;base64,${screenshot}`}
                            alt="Screenshot preview"
                            style={{
                                width: '100%',
                                maxHeight: '100px',
                                objectFit: 'contain',
                                border: '1px solid #ddd',
                                borderRadius: '4px'
                            }}
                        />
                    </div>
                )}

                {/* Force resume button (emergency) */}
                {isRecording && (isTutorSpeaking || isAiCurrentlySpeaking) && (
                    <div style={{ marginBottom: '12px' }}>
                        <button 
                            onClick={forceResumeMicrophone}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: '#ff9800',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '11px',
                                cursor: 'pointer',
                                width: '100%'
                            }}
                        >
                            🔧 Force Resume Microphone
                        </button>
                    </div>
                )}

                {/* Error display */}
                {error && (
                    <div style={{
                        backgroundColor: '#ffebee',
                        color: '#c62828',
                        padding: '8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        marginBottom: '8px'
                    }}>
                        ❌ {error}
                    </div>
                )}

                {/* Instructions */}
                <div style={{
                    fontSize: '11px',
                    color: '#666',
                    lineHeight: '1.4'
                }}>
                    <p style={{ margin: '0 0 6px 0' }}>
                        💡 <strong>How to use:</strong>
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '16px' }}>
                        <li>Click "Start Voice Session" to begin</li>
                        <li>Speak naturally - the AI will respond with voice</li>
                        <li>Share screenshots for visual help</li>
                        <li>The AI can see and discuss your screen content</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default Popup;