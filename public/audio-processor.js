// AudioWorklet processor for real-time audio capture
// This runs in a separate thread from the main UI thread

class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input && input.length > 0) {
            const inputChannel = input[0]; // Get first channel (mono)
            
            for (let i = 0; i < inputChannel.length; i++) {
                this.buffer[this.bufferIndex] = inputChannel[i];
                this.bufferIndex++;
                
                // When buffer is full, send it to main thread
                if (this.bufferIndex >= this.bufferSize) {
                    // Convert float32 to 16-bit PCM
                    const pcmData = new Int16Array(this.bufferSize);
                    for (let j = 0; j < this.bufferSize; j++) {
                        pcmData[j] = Math.max(-32768, Math.min(32767, Math.floor(this.buffer[j] * 32768)));
                    }
                    
                    // Send PCM data to main thread
                    this.port.postMessage({
                        type: 'audioData',
                        data: pcmData
                    });
                    
                    // Reset buffer
                    this.bufferIndex = 0;
                }
            }
        }
        
        // Keep the processor alive
        return true;
    }
}

// Register the processor
registerProcessor('audio-capture-processor', AudioCaptureProcessor); 