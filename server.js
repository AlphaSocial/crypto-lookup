// server.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Helper function to search multiple sources
async function searchSources(contractAddress) {
    const sources = [
        `https://etherscan.io/token/${contractAddress}`,
        `https://dexscreener.com/ethereum/${contractAddress}`,
        `https://www.dextools.io/app/en/ether/pair-explorer/${contractAddress}`,
        // Add more sources as needed
    ];

    const results = await Promise.all(
        sources.map(async (url) => {
            try {
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 5000
                });
                return { url, html: response.data };
            } catch (error) {
                console.log(`Error fetching ${url}:`, error.message);
                return { url, html: null };
            }
        })
    );

    return results.filter(result => result.html !== null);
}

// Helper function to extract information from HTML
function extractInfo(html, url) {
    const $ = cheerio.load(html);
    const info = {
        name: [],
        website: [],
        twitter: [],
        telegram: [],
        dexscreener: []
    };

    // Extract name possibilities
    $('h1').each((_, el) => info.name.push($(el).text().trim()));
    $('title').each((_, el) => info.name.push($(el).text().trim()));
    
    // Extract links
    $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        
        if (href.includes('twitter.com')) {
            info.twitter.push(href);
        } else if (href.includes('t.me')) {
            info.telegram.push(href);
        } else if (href.includes('dexscreener.com')) {
            info.dexscreener.push(href);
        } else if (
            !href.includes('twitter.com') && 
            !href.includes('t.me') && 
            !href.includes('dexscreener.com') &&
            !href.includes('etherscan.io') &&
            href.startsWith('http')
        ) {
            info.website.push(href);
        }
    });

    return info;
}

// Helper function to find consensus
function findConsensus(allResults) {
    const consensus = {};
    
    // Count occurrences of each value
    for (const field of ['name', 'website', 'twitter', 'telegram', 'dexscreener']) {
        const allValues = allResults.flatMap(r => r[field]);
        const counts = {};
        
        allValues.forEach(value => {
            counts[value] = (counts[value] || 0) + 1;
        });

        // Find most common value that appears more than once
        const sorted = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .filter(([_, count]) => count > 1);

        consensus[field] = sorted.length > 0 ? sorted[0][0] : allValues[0] || null;
    }

    return consensus;
}

app.post('/api/lookup', async (req, res) => {
    try {
        const { contract } = req.body;
        
        if (!contract) {
            return res.status(400).json({ error: 'Contract address is required' });
        }

        // Search multiple sources
        const searchResults = await searchSources(contract);
        
        // Extract information from each source
        const extractedInfo = searchResults.map(result => 
            extractInfo(result.html, result.url)
        );

        // Find consensus among results
        const consensusData = findConsensus(extractedInfo);

        res.json({
            success: true,
            data: consensusData
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});