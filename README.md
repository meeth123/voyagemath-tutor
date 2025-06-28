# Voyage AI Tutor - Chrome Extension

A Chrome extension that provides real-time voice-based math tutoring using Google's Gemini AI with native audio dialog capabilities.

## Features

- 🎙️ **Real-time Voice Conversation**: Talk directly with an AI math tutor
- 🧮 **Math-focused Tutoring**: Specialized prompts for mathematical learning
- 🎧 **High-quality Audio**: Uses Gemini's native audio dialog model for natural conversations
- 🔄 **Live Audio Processing**: Real-time PCM audio streaming with proper sample rate conversion
- 🌐 **Floating Panel UI**: Non-intrusive interface that overlays on any webpage

## Architecture

### Frontend (Chrome Extension)
- **React + TypeScript** for the UI components
- **WebSocket client** for real-time communication
- **Web Audio API** for microphone capture and audio playback
- **Content script** injection for floating panel interface

### Backend (Node.js Server)
- **Express + WebSocket** server for handling connections
- **Google Gemini AI** integration with Live API
- **Real-time audio processing** with PCM format conversion
- **Audio streaming** between browser and Gemini

## Prerequisites

- **Node.js** v20+ (required for Gemini SDK)
- **Chrome Browser** (for extension development/testing)
- **Google AI Studio API Key** (for Gemini access)

## Installation

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd voyagemath-tutor
```

### 2. Install Dependencies
```bash
# Install main project dependencies
npm install

# Install server dependencies
cd server
npm install
cd ..
```

### 3. Set Up Environment Variables
Create a `.env` file in the `server/` directory:
```bash
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3001
```

### 4. Build the Extension
```bash
npm run build
```

### 5. Load Extension in Chrome
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `dist/` folder from this project

## Usage

### 1. Start the Backend Server
```bash
cd server
node index.js
```

### 2. Use the Extension
1. Click the Voyage AI Tutor extension icon in Chrome
2. Click "Start Listening" to begin voice conversation
3. Speak your math questions naturally
4. The AI tutor will respond with voice guidance

## Technical Details

### Audio Processing
- **Input**: Browser captures 16kHz PCM audio from microphone
- **Transport**: WebSocket streaming to Node.js server
- **AI Processing**: Gemini Live API with native audio dialog model
- **Output**: 24kHz PCM audio resampled to browser's native rate

### Chrome Extension Architecture
```
Background Script → Content Script → Floating Panel (React)
                    ↓
                WebSocket Connection
                    ↓
                Node.js Server ↔ Gemini AI
```

### Key Components
- `src/popup/Popup.tsx` - Main React component with voice interface
- `src/content.tsx` - Content script for panel injection
- `src/background.ts` - Extension background worker
- `server/index.js` - WebSocket server with Gemini integration

## Development

### Build Commands
```bash
npm run build          # Build extension for production
npm run dev           # Development build with watch mode
```

### Project Structure
```
voyagemath-tutor/
├── src/
│   ├── popup/Popup.tsx    # Main React component
│   ├── content.tsx        # Content script
│   └── background.ts      # Background worker
├── server/
│   ├── index.js          # WebSocket server
│   ├── package.json      # Server dependencies
│   └── .env              # Environment variables
├── public/
│   ├── manifest.json     # Extension manifest
│   ├── content.css       # Styling
│   └── icons/            # Extension icons
└── dist/                 # Built extension files
```

## API Integration

This project uses Google's **Gemini 2.5 Flash Preview** with the native audio dialog model:
- Model: `gemini-2.5-flash-preview-native-audio-dialog`
- Voice: Zephyr configuration
- Audio format: PCM 16-bit/24kHz
- Real-time streaming via Live API

## Troubleshooting

### Common Issues

1. **"Address already in use" error**
   ```bash
   lsof -ti:3001 | xargs kill -9  # Kill process on port 3001
   ```

2. **Audio not working**
   - Check microphone permissions in Chrome
   - Ensure server is running on port 3001
   - Verify Gemini API key is valid

3. **Extension not loading**
   - Rebuild with `npm run build`
   - Check Chrome developer console for errors
   - Verify manifest.json syntax

### Debug Logging
The extension and server provide detailed console logging for debugging audio processing and API communication.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Google Gemini AI team for the native audio dialog capabilities
- Chrome Extensions API documentation
- Web Audio API community resources 