import express from 'express';
import axios from 'axios';
import xml2js from 'xml2js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static('public'));

async function getArchiveInfo(identifier) {
    try {
        // Remove leading slash if present
        identifier = identifier.replace(/^\//, '');
        
        // Construct URLs
        const imageUrl = `https://archive.org/download/${identifier}/${identifier}_itemimage.jpg`;
        const xmlUrl = `https://archive.org/download/${identifier}/${identifier}_files.xml`;
        
        // Fetch XML data
        const xmlResponse = await axios.get(xmlUrl);
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xmlResponse.data);
        
        // Find MP3 file
        const files = result.files.file;
        const mp3File = files.find(file => 
            file.$.source === "derivative" && 
            file.$.name.toLowerCase().endsWith('.mp3')
        );
        
        if (!mp3File) {
            throw new Error('MP3 file not found');
        }

        const mp3Url = `https://archive.org/download/${identifier}/${encodeURIComponent(mp3File.$.name)}`;
        
        return {
            identifier,
            imageUrl,
            mp3Url,
            title: mp3File.$.name.replace('.mp3', '')
        };
    } catch (error) {
        console.error('Error fetching archive info:', error);
        throw error;
    }
}

// API endpoint for fetching record data
app.get('/api/record/:identifier', async (req, res) => {
    try {
        const data = await getArchiveInfo(req.params.identifier);
        res.json(data);
    } catch (error) {
        console.error('Error in /api/record endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

server.on('error', (error) => {
    console.error('Server error:', error);
});