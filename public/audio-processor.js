// AudioWorklet processor for real-time audio capture
// This runs in a separate thread from the main UI thread

class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        // VAD (Voice Activity Detection) parameters
        this.speechThreshold = options.processorOptions?.speechThreshold || 0.02;
        this.silenceDelay = options.processorOptions?.silenceDelay || 1000; // 1 second
        
        // VAD state
        this.isSpeaking = false;
        this.silenceTimer = null;
        this.consecutiveSilenceFrames = 0;
        this.silenceFramesThreshold = Math.floor(this.silenceDelay / (128 / 16000 * 1000)); // Convert ms to frames
        
        console.log('AudioWorklet VAD initialized with threshold:', this.speechThreshold, 'silence delay:', this.silenceDelay + 'ms');
        
        this.port.onmessage = (event) => {
            // Handle messages from main thread if needed (e.g., threshold updates)
            if (event.data.type === 'updateThreshold') {
                this.speechThreshold = event.data.threshold;
                console.log('VAD threshold updated to:', this.speechThreshold);
            }
        };
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input.length > 0) {
            const inputData = input[0]; // First channel
            
            // Calculate RMS (Root Mean Square) for voice activity detection
            let sum = 0.0;
            for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / inputData.length);
            
            if (rms > this.speechThreshold) {
                // --- SPEECH DETECTED ---
                if (!this.isSpeaking) {
                    this.isSpeaking = true;
                    this.consecutiveSilenceFrames = 0;
                    console.log('🎤 Speech started (RMS:', rms.toFixed(4), ')');
                    this.port.postMessage({ type: 'speechStart' });
                }
                
                // Reset silence counter
                this.consecutiveSilenceFrames = 0;
                
                // Send audio data to main thread
                this.port.postMessage({ 
                    type: 'audioData', 
                    data: inputData.slice() // Copy the array
                });
                
            } else if (this.isSpeaking) {
                // --- SILENCE DETECTED DURING SPEECH ---
                this.consecutiveSilenceFrames++;
                
                // Continue sending audio data even during brief silence
                this.port.postMessage({ 
                    type: 'audioData', 
                    data: inputData.slice()
                });
                
                // Check if silence has lasted long enough to end speech
                if (this.consecutiveSilenceFrames >= this.silenceFramesThreshold) {
                    this.isSpeaking = false;
                    this.consecutiveSilenceFrames = 0;
                    console.log('🔇 Speech ended after', this.silenceDelay + 'ms silence');
                    this.port.postMessage({ type: 'speechEnd' });
                }
            }
            // If not speaking and no speech detected, do nothing (don't send audio)
        }
        
        return true; // Keep processor alive
    }
}

// Register the processor
registerProcessor('audio-capture-processor', AudioCaptureProcessor); 