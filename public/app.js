// ===== Constants and Initialization =====
const colorThief = new ColorThief();
const ROTATION_SPEED = 0.72; // degrees per frame at 60fps (~7.2 RPM)
const ANIMATION_FRAME_RATE = 50; // ms between animation frames
const PROCESSING_SIZE = 640; // Size for image processing
const OUTPUT_SIZE = 600; // Size for the label output

// OpenCV initialization
const cvReady = new Promise((resolve) => {
    window.onOpenCvReady = () => {
        console.log('OpenCV.js is ready');
        resolve(window.cv);
    };
});

// ===== State Management =====
let currentAnimationIndex = 0;
let animationInterval = null;
let rotationInterval = null;
let totalRotation = 0;
let labelDetected = false;

// ===== Event Listeners =====
document.getElementById('identifier').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loadRecord();
});

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    if (path && path !== '/') {
        const identifier = path.substring(1);
        document.getElementById('identifier').value = identifier;
        loadRecord(identifier);
    }
});

window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    if (path && path !== '/') {
        const identifier = path.substring(1);
        document.getElementById('identifier').value = identifier;
        loadRecord(identifier);
    } else {
        document.getElementById('identifier').value = '';
        document.getElementById('record-container').innerHTML = '';
        document.getElementById('debug-section').style.display = 'none';
        document.title = '78 RPM Jukebox';
    }
});

// ===== Image Processing Functions =====
async function analyzeImage(imageElement) {
    try {
        const cv = await cvReady;
        const { width, height, scaleFactor } = calculateDimensions(imageElement);

        const processCanvas = createProcessCanvas(imageElement, width, height);
        const { src, blur, gray, circles } = processImage(cv, processCanvas);

        if (circles.cols > 0) {
            labelDetected = true;
            const maxCircle = findLargestCircle(circles);
            const outputCanvas = createOutputCanvas();
            const processedImage = processCircle(cv, src, maxCircle, scaleFactor);

            updateUI(processedImage, imageElement, maxCircle, scaleFactor);
            cleanup(cv, [src, blur, gray, circles, ...processedImage.mats]);
        } else {
            cleanup(cv, [src, blur, gray, circles]);
            labelDetected = false;
            showNoCirclesDetected();
        }
    } catch (error) {
        console.error('Error analyzing image:', error);
        labelDetected = false;
        showNoCirclesDetected();
    }

    document.getElementById('debug-section').style.display = 'block';
}

function calculateDimensions(imageElement) {
    const originalWidth = imageElement.width;
    const originalHeight = imageElement.height;
    let width = originalWidth;
    let height = originalHeight;
    let scaleFactor;

    if (width > height) {
        scaleFactor = PROCESSING_SIZE / width;
        width = PROCESSING_SIZE;
        height = Math.round(originalHeight * scaleFactor);
    } else {
        scaleFactor = PROCESSING_SIZE / height;
        height = PROCESSING_SIZE;
        width = Math.round(originalWidth * scaleFactor);
    }

    return { width, height, scaleFactor };
}

function createProcessCanvas(imageElement, width, height) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = PROCESSING_SIZE;
    canvas.height = PROCESSING_SIZE;
    ctx.drawImage(imageElement, 0, 0, width, height);
    return canvas;
}

function processImage(cv, canvas) {
    const src = cv.imread(canvas);
    const blur = new cv.Mat();
    const gray = new cv.Mat();
    const circles = new cv.Mat();

    cv.medianBlur(src, blur, 5);
    cv.cvtColor(blur, gray, cv.COLOR_RGBA2GRAY);

    const params = {
        dp: 1,
        minDist: 200,
        param1: 150,
        param2: 50,
        minRadius: 100,
        maxRadius: 350
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

    return { src, blur, gray, circles };
}

function findLargestCircle(circles) {
    let maxCircle = { x: 0, y: 0, radius: 0 };
    for (let i = 0; i < circles.cols; i++) {
        const x = circles.data32F[i * 3];
        const y = circles.data32F[i * 3 + 1];
        const radius = circles.data32F[i * 3 + 2];
        if (radius > maxCircle.radius) {
            maxCircle = { x, y, radius };
        }
    }
    return maxCircle;
}

function createOutputCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    return canvas;
}

function processCircle(cv, src, maxCircle, scaleFactor) {
    const mask = new cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1);
    const center = new cv.Point(maxCircle.x, maxCircle.y);
    cv.circle(mask, center, maxCircle.radius, [255, 255, 255, 255], -1);

    const dst = new cv.Mat();
    src.copyTo(dst, mask);

    const rect = new cv.Rect(
        Math.max(0, Math.round(maxCircle.x - maxCircle.radius)),
        Math.max(0, Math.round(maxCircle.y - maxCircle.radius)),
        Math.min(
            src.cols - Math.round(maxCircle.x - maxCircle.radius),
            Math.round(maxCircle.radius * 2)
        ),
        Math.min(
            src.rows - Math.round(maxCircle.y - maxCircle.radius),
            Math.round(maxCircle.radius * 2)
        )
    );

    const roi = dst.roi(rect);
    const resized = new cv.Mat();
    const centered = new cv.Mat(OUTPUT_SIZE, OUTPUT_SIZE, cv.CV_8UC4, [0, 0, 0, 0]);

    cv.resize(roi, resized, new cv.Size(OUTPUT_SIZE, OUTPUT_SIZE), 0, 0, cv.INTER_AREA);
    resized.copyTo(centered);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = OUTPUT_SIZE;
    outputCanvas.height = OUTPUT_SIZE;
    cv.imshow(outputCanvas, centered);

    return { canvas: outputCanvas, mats: [mask, dst, roi, resized, centered] };
}

function updateUI(processedImage, originalImage, maxCircle, scaleFactor) {
    const recordImg = document.getElementById('album-art');
    recordImg.src = processedImage.canvas.toDataURL();
    if (labelDetected) {
        recordImg.onload = () => setBackgroundColor(recordImg);
    }

    // Create a canvas to draw the circle on the original image
    const debugCanvas = document.createElement('canvas');
    debugCanvas.width = originalImage.width;
    debugCanvas.height = originalImage.height;
    const ctx = debugCanvas.getContext('2d');

    // Draw the original image
    ctx.drawImage(originalImage, 0, 0);

    // Draw the detected circle
    ctx.strokeStyle = '#00ff00'; // Bright green
    ctx.lineWidth = 10; // Constant thick line
    ctx.beginPath();
    ctx.arc(
        maxCircle.x / scaleFactor,
        maxCircle.y / scaleFactor,
        maxCircle.radius / scaleFactor,
        0,
        Math.PI * 2
    );
    ctx.stroke();

    // Update the debug image
    document.getElementById('originalImage').src = debugCanvas.toDataURL();

    const originalX = Math.round(maxCircle.x / scaleFactor);
    const originalY = Math.round(maxCircle.y / scaleFactor);
    const originalRadius = Math.round(maxCircle.radius / scaleFactor);

    document.getElementById('analysis-results').innerHTML = `
        <h4>Detected Record Circle:</h4>
        <p>Center: (${originalX}, ${originalY})</p>
        <p>Radius: ${originalRadius}px</p>
        <p>Diameter: ${originalRadius * 2}px</p>
        <p>Detected radius before scaling: ${maxCircle.radius}</p>
        <p>Scale factor: ${scaleFactor.toFixed(4)}</p>
    `;
}

function cleanup(cv, mats) {
    mats.forEach((mat) => mat.delete());
}

function showNoCirclesDetected() {
    document.getElementById('analysis-results').innerHTML = '<p>No circles detected</p>';
    console.log('No circles detected');

    // Create and display placeholder label
    const recordTitle = document.querySelector('#record-title h1')?.textContent || 'Unknown Record';
    const placeholderCanvas = createPlaceholderLabel(recordTitle);
    const recordImg = document.getElementById('album-art');
    recordImg.src = placeholderCanvas.toDataURL();

    // Set colors directly since we know them
    const backgroundColor = '#1a4731';
    const textColor = '#ffffff';
    document.body.style.backgroundColor = backgroundColor;
    document.querySelector('h1').style.color = textColor;
}

function createPlaceholderLabel(title) {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');

    // Draw dark green circle
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#1a4731';
    ctx.fill();

    // Get h1 styles
    const h1Element = document.querySelector('h1');
    const h1Styles = window.getComputedStyle(h1Element);
    const fontSize = 36;
    const fontFamily = h1Styles.fontFamily;
    const letterSpacing = '0.3em'; // Add letter spacing

    // Split title on first " - "
    const [topText, ...bottomParts] = title.split(' - ');
    const bottomText = bottomParts.join(' - '); // Rejoin in case there were multiple " - "

    // Add text
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '0.3em';

    // Function to wrap and draw text with letter spacing
    const drawWrappedText = (text, y, maxWidth) => {
        ctx.font = `${fontSize}px ${fontFamily}`;
        text = text.toUpperCase();

        // Split into words and add letter spacing
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        let currentLineWidth = 0;

        // Process each word
        for (let i = 0; i < words.length; i++) {
            const wordWidth = ctx.measureText(words[i]).width;

            if (currentLine === '') {
                currentLine = words[i];
                currentLineWidth = wordWidth;
            } else {
                const lineWidth = currentLineWidth + wordWidth;
                if (lineWidth < maxWidth) {
                    currentLine += ' ' + words[i];
                    currentLineWidth = lineWidth;
                } else {
                    lines.push(currentLine);
                    currentLine = words[i];
                    currentLineWidth = wordWidth;
                }
            }
        }
        lines.push(currentLine);

        const lineHeight = fontSize * 1.2;
        const totalHeight = lines.length * lineHeight;
        const startY = y - totalHeight / 2;

        lines.forEach((line, i) => {
            ctx.fillText(line, OUTPUT_SIZE / 2, startY + i * lineHeight);
        });

        return totalHeight;
    };

    // Draw top and bottom text
    if (topText) {
        drawWrappedText(topText, OUTPUT_SIZE * 0.35, OUTPUT_SIZE * 0.8);
    }
    if (bottomText) {
        drawWrappedText(bottomText, OUTPUT_SIZE * 0.75, OUTPUT_SIZE * 0.8);
    }

    return canvas;
}

// ===== Animation Functions =====
function updateImageLayer() {
    const recordPlatterElement = document.querySelector('#record-platter');
    const platterUrls = JSON.parse(recordPlatterElement.dataset.platterUrls);
    if (!platterUrls?.length) return;

    recordPlatterElement.src = platterUrls[currentAnimationIndex];
    currentAnimationIndex = (currentAnimationIndex + 1) % platterUrls.length;
}

function startImageAnimation() {
    stopImageAnimation();
    currentAnimationIndex = 0;
    updateImageLayer();
    animationInterval = setInterval(updateImageLayer, ANIMATION_FRAME_RATE);
}

function stopImageAnimation() {
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

function updateRotation() {
    totalRotation += ROTATION_SPEED;
    document.querySelector('#album-art').style.transform = `rotate(${totalRotation}deg)`;
}

// ===== Color Processing Functions =====
function findContrastColor(color) {
    const getLuminance = (r, g, b) => {
        const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
            c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        );
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    };

    const getContrastRatio = (l1, l2) => {
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    };

    const bgLuminance = getLuminance(...color);
    const whiteLuminance = getLuminance(255, 255, 255);
    const blackLuminance = getLuminance(0, 0, 0);

    const whiteContrast = getContrastRatio(whiteLuminance, bgLuminance);
    const blackContrast = getContrastRatio(blackLuminance, bgLuminance);

    return whiteContrast > blackContrast ? [255, 255, 255] : [0, 0, 0];
}

function setBackgroundColor(imageElement) {
    try {
        const color = colorThief.getColor(imageElement);
        document.body.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

        const fgColor = findContrastColor(color);
        document.querySelector(
            'h1'
        ).style.color = `rgb(${fgColor[0]}, ${fgColor[1]}, ${fgColor[2]})`;
    } catch (error) {
        console.error('Error setting colors:', error);
    }
}

// ===== Main Record Loading Functions =====
async function loadRecord(providedIdentifier) {
    try {
        const input = document.getElementById('identifier');
        const container = document.getElementById('record-container');
        let identifier = providedIdentifier || input.value.trim();

        // Remove leading slash if present
        identifier = identifier.replace(/^\/+/, '');

        container.innerHTML = '';
        document.getElementById('debug-section').style.display = 'none';

        if (identifier.includes('archive.org')) {
            const match = identifier.match(/archive\.org\/details\/([^\/]+)/);
            if (match) identifier = match[1];
        }

        if (!identifier) {
            showError('Please enter a valid identifier');
            return;
        }

        if (!providedIdentifier) {
            window.history.pushState({}, '', `/${identifier}`);
        }

        const data = await fetchRecordData(identifier);
        setupRecordDisplay(data);
    } catch (error) {
        console.error('Error in loadRecord:', error);
        showError(`Error loading record: ${error.message}`);
    }
}

async function fetchRecordData(identifier) {
    const response = await fetch(`/api/record/${identifier}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch record: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function setupRecordDisplay(data) {
    document.title = `${data.title} - 78 RPM Jukebox`;
    document.querySelector('#record-title').innerHTML = `<h1>${data.title}</h1>`;

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

    document.getElementById('record-container').appendChild(recordElement);
    setupAudioControls(recordElement);
    loadAndProcessImage(data);

    // Focus the audio player
    const audioElement = recordElement.querySelector('audio');
    audioElement.focus();
}

function setupAudioControls(recordElement) {
    const audio = recordElement.querySelector('audio');
    const albumArtElement = recordElement.querySelector('#album-art');

    audio.addEventListener('play', () => {
        rotationInterval = setInterval(updateRotation, 1000 / 60);
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
}

async function loadAndProcessImage(data) {
    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';

    tempImg.onerror = (error) => {
        console.error('Error loading image:', error);
        showError(`Failed to load image from ${data.imageUrl}`);
    };

    tempImg.onload = async () => {
        try {
            const recordPlatterElement = document.querySelector('#record-platter');
            recordPlatterElement.src = '/platter/platter000.png';

            await analyzeImage(tempImg);
            const platterUrls = await loadImageSequences(data.identifier, tempImg.width);
            recordPlatterElement.dataset.platterUrls = JSON.stringify(platterUrls);
        } catch (error) {
            console.error('Error in image analysis:', error);
            showError('Failed to analyze the record image');
        }
    };

    tempImg.src = data.imageUrl;
    document.getElementById('originalImage').src = tempImg.src;
}

async function loadImageSequences(identifier, radius) {
    const platterUrls = [];
    for (let i = 0; i < 30; i++) {
        platterUrls.push(`/platter/platter${i.toString().padStart(3, '0')}.png`);
        const img = new Image();
        img.src = platterUrls[i];
    }
    return platterUrls;
}

function showError(message) {
    const container = document.getElementById('record-container');
    container.innerHTML = `<div class="error">${message}</div>`;
}
