// AudioWorklet processor for real-time audio capture with robust VAD
// This runs in a separate thread from the main UI thread

class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        // VAD Parameters
        this.speechThreshold = options.processorOptions?.speechThreshold || 0.015;
        
            // We will require roughly 1.5 seconds of silence for natural speech pauses.
    // The browser gives us audio in 128-sample frames. At a 16000Hz sample rate,
    // 1.5 seconds of audio is 24000 samples.
    // 24000 samples / 128 samples/frame = 187.5 frames ≈ 188 frames.
    this.requiredSilenceFrames = options.processorOptions?.silenceFrames || 188;

        // VAD State
        this.isSpeaking = false;
        this.isPaused = false;
        this.silentFrameCount = 0;

        console.log('🎙️ Robust VAD initialized - threshold:', this.speechThreshold, 'silence frames:', this.requiredSilenceFrames);

        this.port.onmessage = (event) => {
            if (event.data.type === 'pause') {
                this.isPaused = true;
                console.log('🎙️ VAD paused (AI speaking)');
            } else if (event.data.type === 'resume') {
                this.isPaused = false;
                console.log('🎙️ VAD resumed (AI finished)');
            } else if (event.data.type === 'forceEnd') {
                // Manual override for testing
                if (this.isSpeaking) {
                    this.isSpeaking = false;
                    console.log('🔇 Speech FORCE ENDED (manual override)');
                    this.port.postMessage({ type: 'speechEnd' });
                    this.silentFrameCount = 0;
                }
            }
        };
    }

    process(inputs) {
        if (this.isPaused) {
            return true; // If paused (AI is talking), do nothing.
        }

        const input = inputs[0];
        if (input.length > 0) {
            const inputData = input[0];

            // Calculate volume (RMS)
            let sum = 0.0;
            for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / inputData.length);

            if (rms > this.speechThreshold) {
                // --- Speech Frame Detected ---
                this.silentFrameCount = 0; // Reset silence counter
                if (!this.isSpeaking) {
                    this.isSpeaking = true;
                    console.log('🎤 Speech started (RMS:', rms.toFixed(4), ')');
                    this.port.postMessage({ type: 'speechStart' });
                }
                this.port.postMessage({ type: 'audioData', data: inputData.slice() });
            } else {
                // --- Silence Frame Detected ---
                if (this.isSpeaking) {
                    this.silentFrameCount++;
                    
                    // Debug logging for silence detection
                    if (this.silentFrameCount % 50 === 0) {
                        console.log('🔇 Silence frames:', this.silentFrameCount, '/', this.requiredSilenceFrames, 'RMS:', rms.toFixed(4));
                    }
                    
                    // Continue sending audio data during silence (for complete capture)
                    this.port.postMessage({ type: 'audioData', data: inputData.slice() });
                    
                    if (this.silentFrameCount >= this.requiredSilenceFrames) {
                        // --- Utterance has ended ---
                        this.isSpeaking = false;
                        console.log('🔇 Speech ended after', this.silentFrameCount, 'silent frames');
                        this.port.postMessage({ type: 'speechEnd' });
                        this.silentFrameCount = 0;
                    }
                } else {
                    // Debug: Show background noise levels occasionally
                    if (Math.random() < 0.001) { // ~0.1% of frames
                        console.log('🔇 Background RMS:', rms.toFixed(4), 'threshold:', this.speechThreshold);
                    }
                }
            }
        }
        return true;
    }
}

// Register the processor
registerProcessor('audio-capture-processor', AudioCaptureProcessor); 