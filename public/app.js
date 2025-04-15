// OpenCV initialization promise
let cvReady = new Promise((resolve) => {
    window.onOpenCvReady = () => {
        console.log('OpenCV.js is ready');
        resolve(window.cv);
    };
});

const colorThief = new ColorThief();

// Handle Enter key in the input field
document.getElementById('identifier').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loadRecord();
    }
});

// Load record from URL path when page loads
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    if (path && path !== '/') {
        // Remove leading slash and load the record
        const identifier = path.substring(1);
        document.getElementById('identifier').value = identifier;
        loadRecord(identifier);
    }
});

let currentAnimationIndex = 0;
let animationInterval = null;


async function analyzeImage(imageElement) {
    try {        
        // Wait for OpenCV to be ready
        const cv = await cvReady;
        
        // Store original dimensions
        const originalWidth = imageElement.width;
        const originalHeight = imageElement.height;
        
        console.log('Original dimensions:', originalWidth, 'x', originalHeight);
        
        // Calculate resize dimensions to fit within 640x640
        let width = originalWidth;
        let height = originalHeight;
        let scaleFactor;

        const size = 640;

        if (width > height) {
            scaleFactor = size / width;
            width = size;
            height = Math.round(originalHeight * scaleFactor);
        } else {
            scaleFactor = size / height;
            height = size;
            width = Math.round(originalWidth * scaleFactor);
        }
        
        // Create a square canvas for processing (use the larger dimension)
        const processCanvas = document.createElement('canvas');
        const processCtx = processCanvas.getContext('2d');
        processCanvas.width = size;
        processCanvas.height = size;
        
        // Draw resized image centered in the square canvas
        processCtx.drawImage(imageElement, 0, 0, width, height);

        // Get image data for OpenCV
        let src = cv.imread(processCanvas);
        let blur = new cv.Mat();
        let gray = new cv.Mat();
        
        // Apply median blur (equivalent to cv2.medianBlur)
        cv.medianBlur(src, blur, 5);
        
        // Convert to grayscale
        cv.cvtColor(blur, gray, cv.COLOR_RGBA2GRAY);
        
        // Detect circles
        let circles = new cv.Mat();
        // Create parameters object for HoughCircles
        const params = {
            dp: 1,
            minDist: 200,
            param1: 150,    // Lowered from 150 to detect more edges
            param2: 50,     // Lowered from 70 to be more lenient in detection
            minRadius: 100, // Lowered from 150 to detect smaller labels
            maxRadius: 350  // Increased from 320 to handle larger labels
        };
        
        cv.HoughCircles(
            gray,
            circles,
            cv.HOUGH_GRADIENT,
            params.dp,
            params.minDist,
            params.param1,
            params.param2,
            params.minRadius,
            params.maxRadius
        );

        // Process results
        if (circles.cols > 0) {
            // Find the circle with maximum radius
            let maxCircle = { x: 0, y: 0, radius: 0 };
            for (let i = 0; i < circles.cols; i++) {
                const x = circles.data32F[i * 3];
                const y = circles.data32F[i * 3 + 1];
                const radius = circles.data32F[i * 3 + 2];
                
                if (radius > maxCircle.radius) {
                    maxCircle = { x, y, radius };
                }
            }

            // Create a square output canvas
            const outputSize = 600;  // Fixed size for the label
            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = outputSize;
            outputCanvas.height = outputSize;

            // Create a mask for the circle at its detected position
            let mask = new cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1);
            let center = new cv.Point(maxCircle.x, maxCircle.y);
            cv.circle(mask, center, maxCircle.radius, [255, 255, 255, 255], -1);

            // Create output matrix
            let dst = new cv.Mat();
            src.copyTo(dst, mask);

            // Create a rect for the region of interest around the circle
            let rect = new cv.Rect(
                Math.max(0, Math.round(maxCircle.x - maxCircle.radius)),
                Math.max(0, Math.round(maxCircle.y - maxCircle.radius)),
                Math.min(src.cols - Math.round(maxCircle.x - maxCircle.radius), Math.round(maxCircle.radius * 2)),
                Math.min(src.rows - Math.round(maxCircle.y - maxCircle.radius), Math.round(maxCircle.radius * 2))
            );

            // Extract the region of interest
            let roi = dst.roi(rect);

            // Create a Mat for the resized image with padding to center it
            let resized = new cv.Mat();

            // Create a black background Mat with alpha channel
            let centered = new cv.Mat(outputSize, outputSize, cv.CV_8UC4, [0, 0, 0, 0]);
            
            // Resize the ROI to fit exactly in the output size
            cv.resize(roi, resized, new cv.Size(outputSize, outputSize), 0, 0, cv.INTER_AREA);
            
            // Copy the resized image directly to the centered Mat
            resized.copyTo(centered);

            // Show the result
            cv.imshow(outputCanvas, centered);

            // Replace the original image with the isolated label
            const recordImg = document.getElementById('album-art');
            recordImg.src = outputCanvas.toDataURL();
            
            // Set up event listener to extract color once the image is loaded
            recordImg.onload = () => {
                setBackgroundColor(recordImg);
            };
            
            // Show original image in debug section
            const originalImg = document.getElementById('originalImage');
            originalImg.src = imageElement.src;
            
            // Clean up the additional matrices
            mask.delete();
            dst.delete();
            roi.delete();
            resized.delete();
            centered.delete();

            // Scale back to original image size using the inverse of our scale factor
            const originalX = Math.round(maxCircle.x / scaleFactor);
            const originalY = Math.round(maxCircle.y / scaleFactor);
            const originalRadius = Math.round(maxCircle.radius / scaleFactor);
            
            // Display analysis results
            const resultsDiv = document.getElementById('analysis-results');
            resultsDiv.innerHTML = `
                <h4>Detected Record Circle:</h4>
                <p>Center: (${originalX}, ${originalY})</p>
                <p>Radius: ${originalRadius}px</p>
                <p>Diameter: ${originalRadius * 2}px</p>
                <p>Detected radius before scaling: ${maxCircle.radius}</p>
                <p>Scale factor: ${scaleFactor.toFixed(4)}</p>
            `;
        } else {
            document.getElementById('analysis-results').innerHTML = '<p>No circles detected</p>';
            console.log('No circles detected');
        }

        // Show the debug section
        document.getElementById('debug-section').style.display = 'block';

        // Clean up
        src.delete();
        blur.delete();
        gray.delete();
        circles.delete();

    } catch (error) {
        console.error('Error analyzing image:', error);
        document.getElementById('analysis-results').innerHTML = '<p class="error">Error analyzing image</p>';
    }
}

function updateImageLayer() {
    const recordPlatterElement = document.querySelector('#record-platter');
    const platterUrls = JSON.parse(recordPlatterElement.dataset.platterUrls);

    if (!platterUrls || !platterUrls.length) return;

    recordPlatterElement.src = platterUrls[currentAnimationIndex];
    
    // Increment indices
    currentAnimationIndex = (currentAnimationIndex + 1) % platterUrls.length;
}

function startImageAnimation() {
    stopImageAnimation(); // Clear any existing animation
    currentAnimationIndex = 0;
    updateImageLayer(); // Show initial frame
    animationInterval = setInterval(updateImageLayer, 50); // Faster animation (50ms)
}

function stopImageAnimation() {
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

async function loadRecord(providedIdentifier) {
    try {
        const input = document.getElementById('identifier');
        const container = document.getElementById('record-container');
        let identifier = providedIdentifier || input.value.trim();
        
        // Clear previous content
        container.innerHTML = '';
        document.getElementById('debug-section').style.display = 'none';
        
        // Extract identifier from full URL if provided
        if (identifier.includes('archive.org')) {
            const match = identifier.match(/archive\.org\/details\/([^\/]+)/);
            if (match) {
                identifier = match[1];
            }
        }
        
        if (!identifier) {
            showError('Please enter a valid identifier');
            return;
        }

        // Update URL without reloading the page
        if (!providedIdentifier) {
            window.history.pushState({}, '', `/${identifier}`);
        }
        
        console.log('Fetching record data for:', identifier);
        const response = await fetch(`/api/record/${identifier}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch record: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Received record data:', data);
        
        if (!data.imageUrl) {
            throw new Error('No image URL provided in the record data');
        }
        
        // Update page title
        document.title = data.title + ' - 78 RPM Jukebox';
        document.querySelector('#record-title').innerHTML = `<h1>${data.title}</h1>`;
        
        // Create record display
        const recordElement = document.createElement('div');
        recordElement.className = 'record';
        recordElement.innerHTML = `
            <div class="image-container">
                <img id="record-platter">
                <img id="album-art" alt="Album label art">
            </div>
            <audio controls>
                <source src="${data.mp3Url}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
        `;
        
        container.appendChild(recordElement);

        // Set up audio event listeners for rotation and animation
        const audio = recordElement.querySelector('audio');
        const albumArtElement = recordElement.querySelector('#album-art');
        const recordPlatterElement = document.querySelector('#record-platter');

        audio.addEventListener('play', () => {
            rotationInterval = setInterval(updateRotation, 1000/60); // 60fps
            startImageAnimation();
        });

        audio.addEventListener('pause', () => {
            clearInterval(rotationInterval);
            stopImageAnimation();
        });

        audio.addEventListener('ended', () => {
            clearInterval(rotationInterval);
            stopImageAnimation();
        });

        // Add rotation tracking variables
        let totalRotation = 0;
        let rotationInterval;
        const ROTATION_SPEED = 0.72; // degrees per frame at 60fps (~7.2 RPM)

        function updateRotation() {
            totalRotation += ROTATION_SPEED;
            albumArtElement.style.transform = `rotate(${totalRotation}deg)`;
        }

        // Set up temporary image for processing
        console.log('Loading image from URL:', data.imageUrl);
        const tempImg = new Image();
        tempImg.crossOrigin = "anonymous";
        
        // Add error handling for image load
        tempImg.onerror = (error) => {
            console.error('Error loading image:', error);
            showError(`Failed to load image from ${data.imageUrl}`);
        };
        
        tempImg.onload = async () => {
            try {
                console.log('Image loaded successfully, dimensions:', tempImg.width, 'x', tempImg.height);

                recordPlatterElement.src = "/platter/platter000.png"

                await analyzeImage(tempImg);
                
                // After analyzing and setting up the base image, load and add the sequences
                const platterUrls = await loadImageSequences(identifier, tempImg.width);

                // Store URLs in variables accessible to the event listeners
                recordPlatterElement.dataset.platterUrls = JSON.stringify(platterUrls);

            } catch (error) {
                console.error('Error in image analysis:', error);
                showError('Failed to analyze the record image');
            }
        };
        
        tempImg.src = data.imageUrl;
        
    } catch (error) {
        console.error('Error in loadRecord:', error);
        showError(`Error loading record: ${error.message}`);
    }
}

async function loadImageSequences(identifier, radius) {
    const platterUrls = [];
    
    try {
        // Load platter images (numbered 000-029)
        for (let i = 0; i < 30; i++) {
            platterUrls.push(`/platter/platter${i.toString().padStart(3, '0')}.png`);
            let img = new Image();
            img.src = platterUrls[i];
        }

        console.log(`Loaded ${platterUrls.length} platter images`);
        return platterUrls;
    } catch (error) {
        console.error('Error loading image sequences:', error);
        return platterUrls;
    }
}

function showError(message) {
    const container = document.getElementById('record-container');
    container.innerHTML = `<div class="error">${message}</div>`;
}

// Handle browser back/forward buttons
window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    if (path && path !== '/') {
        const identifier = path.substring(1);
        document.getElementById('identifier').value = identifier;
        loadRecord(identifier);
    } else {
        // Clear the display if we're back at the root
        document.getElementById('identifier').value = '';
        document.getElementById('record-container').innerHTML = '';
        document.getElementById('debug-section').style.display = 'none';
        document.title = '78 RPM Jukebox';
    }
});

function findContrastColor(color) {
    // Convert RGB values to relative luminance
    function getLuminance(r, g, b) {
        let [rs, gs, bs] = [r/255, g/255, b/255].map(c => {
            return c <= 0.03928 ? c/12.92 : Math.pow((c + 0.055)/1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    // Calculate contrast ratio between two luminances
    function getContrastRatio(l1, l2) {
        let lighter = Math.max(l1, l2);
        let darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    }

    // Get luminance of background color
    const bgLuminance = getLuminance(color[0], color[1], color[2]);
    
    // Test white and black foreground colors
    const whiteLuminance = getLuminance(255, 255, 255);
    const blackLuminance = getLuminance(0, 0, 0);
    
    const whiteContrast = getContrastRatio(whiteLuminance, bgLuminance);
    const blackContrast = getContrastRatio(blackLuminance, bgLuminance);

    // Return white or black based on which provides better contrast
    return whiteContrast > blackContrast ? [255, 255, 255] : [0, 0, 0];
}

function setBackgroundColor(imageElement) {
    // Get the dominant color
    const color = colorThief.getColor(imageElement);

    try {
        document.body.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        } catch (error) {
        console.error('Error setting background color:', error);
        }
    try {
        const fgColor = findContrastColor(color);

        console.log('Setting font color:', fgColor);
        document.querySelector('h1').style.color = `rgb(${fgColor[0]}, ${fgColor[1]}, ${fgColor[2]})`;
        } catch (error) {
        console.error('Error setting font color:', error);
        }
}