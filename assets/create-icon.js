/**
 * Programmatic Icon Generation for Electron System Tray
 * 
 * Technical Context:
 * - Canvas 2.11.x+ requires Python 3.x and build tools for native compilation
 * - Electron 28.x changed nativeImage.createFromBuffer() behavior
 * - macOS template icons require specific formatting for dark mode compatibility
 * 
 * Migration Considerations:
 * - Canvas alternatives: Skia-Canvas (faster), node-canvas (stable)
 * - Future Electron 30.x may deprecate some nativeImage methods
 */

const fs = require('fs');
const path = require('path');

// Fallback SVG icon generation (no native dependencies)
function createSVGIcon() {
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <!-- Ollama-inspired icon: neural network node representation -->
    <circle cx="8" cy="8" r="6" fill="none" stroke="#000" stroke-width="2"/>
    <circle cx="8" cy="8" r="3" fill="#000"/>
    <circle cx="8" cy="8" r="1" fill="#fff"/>
    <!-- Connection nodes -->
    <circle cx="3" cy="8" r="1" fill="#000"/>
    <circle cx="13" cy="8" r="1" fill="#000"/>
    <circle cx="8" cy="3" r="1" fill="#000"/>
    <circle cx="8" cy="13" r="1" fill="#000"/>
    <!-- Connecting lines -->
    <line x1="4" y1="8" x2="5" y2="8" stroke="#000" stroke-width="1"/>
    <line x1="11" y1="8" x2="12" y2="8" stroke="#000" stroke-width="1"/>
    <line x1="8" y1="4" x2="8" y2="5" stroke="#000" stroke-width="1"/>
    <line x1="8" y1="11" x2="8" y2="12" stroke="#000" stroke-width="1"/>
</svg>`;

    return svgContent;
}

// PNG fallback using Node.js Buffer manipulation
function createPNGIcon() {
    // Simple 16x16 PNG header with black circle
    // This is a minimal PNG implementation for fallback
    const width = 16;
    const height = 16;
    
    // PNG signature + IHDR chunk for 16x16 RGBA
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdrChunk = Buffer.from([
        0x00, 0x00, 0x00, 0x0D, // chunk length
        0x49, 0x48, 0x44, 0x52, // chunk type: IHDR
        0x00, 0x00, 0x00, 0x10, // width: 16
        0x00, 0x00, 0x00, 0x10, // height: 16
        0x08, // bit depth: 8
        0x06, // color type: RGBA
        0x00, // compression: deflate
        0x00, // filter: none
        0x00, // interlace: none
        0x8D, 0xB6, 0xC5, 0x2C  // CRC
    ]);
    
    // Simple black circle data (simplified for demo)
    // In production, would use proper PNG encoding library
    const placeholder = Buffer.alloc(100); // Placeholder for demo
    
    return Buffer.concat([pngSignature, ihdrChunk]);
}

// Check if Canvas is available and functional
async function checkCanvasAvailability() {
    try {
        const canvas = require('canvas');
        
        // Test canvas creation - this will fail if native compilation failed
        const testCanvas = canvas.createCanvas(16, 16);
        const ctx = testCanvas.getContext('2d');
        
        // Simple draw test
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 16, 16);
        
        // Test buffer generation
        const buffer = testCanvas.toBuffer('image/png');
        
        console.log('✅ Canvas module functional');
        return { available: true, canvas };
    } catch (error) {
        console.warn('⚠️  Canvas module not available:', error.message);
        return { available: false, error };
    }
}

// Create tray icon with multiple fallback strategies
async function createTrayIcon() {
    const canvasStatus = await checkCanvasAvailability();
    
    if (canvasStatus.available) {
        try {
            // Use Canvas for high-quality icon generation
            const { canvas } = canvasStatus;
            const canvasEl = canvas.createCanvas(16, 16);
            const ctx = canvasEl.getContext('2d');
            
            // Clear background (transparent)
            ctx.clearRect(0, 0, 16, 16);
            
            // Draw Ollama-inspired icon
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(8, 8, 6, 0, 2 * Math.PI);
            ctx.fill();
            
            // Inner circle
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(8, 8, 3, 0, 2 * Math.PI);
            ctx.fill();
            
            // Generate PNG buffer
            const pngBuffer = canvasEl.toBuffer('image/png');
            
            // Save PNG file
            fs.writeFileSync(path.join(__dirname, 'icon.png'), pngBuffer);
            console.log('✅ Generated PNG icon using Canvas');
            
            return 'icon.png';
        } catch (error) {
            console.error('Canvas icon generation failed:', error);
        }
    }
    
    // Fallback to SVG
    const svgContent = createSVGIcon();
    fs.writeFileSync(path.join(__dirname, 'icon.svg'), svgContent);
    console.log('✅ Generated SVG icon (fallback)');
    
    return 'icon.svg';
}

// Execute icon creation
if (require.main === module) {
    createTrayIcon()
        .then(iconFile => {
            console.log(`Icon created: ${iconFile}`);
            process.exit(0);
        })
        .catch(error => {
            console.error('Icon creation failed:', error);
            process.exit(1);
        });
}

module.exports = { createTrayIcon, checkCanvasAvailability };
