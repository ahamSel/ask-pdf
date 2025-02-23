const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const OpenAI = require('openai');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for PDF uploads
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

// MongoDB connection
const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'pdfqa';
let db;

// Function to get embeddings from the Python server
async function getEmbeddings(texts) {
    try {
        const response = await axios.post('http://127.0.0.1:3001/embed', {
            texts: texts
        });
        return response.data.embeddings;
    } catch (error) {
        console.error('Error getting embeddings:', error);
        throw error;
    }
}

// Function to calculate hash of PDF content
function calculateHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Connect to MongoDB
async function connectToMongo() {
    try {
        const client = await MongoClient.connect(mongoUrl);
        db = client.db(dbName);
        console.log('Connected to MongoDB');

        // Create indexes
        await db.collection('documents').createIndex({ embedding: 1 });
        await db.collection('documents').createIndex({ documentHash: 1 });
        await db.collection('documents').createIndex({ fileName: 1 });

        // Create text index for basic search backup
        await db.collection('documents').createIndex({ text: 'text' });

        app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
        });
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

// Initialize MongoDB connection
connectToMongo();

// Function to split text into sentences more accurately
function splitIntoSentences(text) {
    // Handle common abbreviations and edge cases
    const prepared = text
        .replace(/([.?!])\s*(?=[A-Z])/g, "$1|")
        .replace(/\.(?=[A-Z][a-z]+\s)/g, ".|")
        .replace(/\s+/g, " ");

    return prepared.split("|").map(s => s.trim()).filter(s => s.length > 0);
}

// Enhanced chunking function with overlap
function chunkText(text, maxLength = 300, overlap = 100) {
    const sentences = splitIntoSentences(text);
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];

        // Skip empty or very short sentences
        if (sentence.length < 3) continue;

        if (currentLength + sentence.length > maxLength && currentChunk.length > 0) {
            // Store the chunk
            chunks.push({
                text: currentChunk.join(" "),
                startIndex: i - currentChunk.length,
                endIndex: i - 1
            });

            // Calculate overlap: keep last sentences that fit within overlap length
            let overlapText = "";
            let overlapSentences = [];
            for (let j = currentChunk.length - 1; j >= 0; j--) {
                const overlapSentence = currentChunk[j];
                if (overlapText.length + overlapSentence.length <= overlap) {
                    overlapSentences.unshift(overlapSentence);
                    overlapText = overlapSentences.join(" ");
                } else {
                    break;
                }
            }

            currentChunk = overlapSentences;
            currentLength = overlapText.length;
        }

        currentChunk.push(sentence);
        currentLength += sentence.length;
    }

    // Add the last chunk if there is one
    if (currentChunk.length > 0) {
        chunks.push({
            text: currentChunk.join(" "),
            startIndex: sentences.length - currentChunk.length,
            endIndex: sentences.length - 1
        });
    }

    return chunks;
}

// Upload route
app.post('/upload', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const dataBuffer = fs.readFileSync(req.file.path);
        const documentHash = calculateHash(dataBuffer);

        // Check if document exists
        const existingDoc = await db.collection('documents').findOne({ documentHash });
        if (existingDoc) {
            await db.collection('documents').deleteMany({ documentHash });
        }

        const data = await pdfParse(dataBuffer);

        // Process text page by page
        const allChunks = [];
        const pageTexts = data.text.split('\f').filter(text => text.trim().length > 0);

        for (let pageNum = 0; pageNum < pageTexts.length; pageNum++) {
            const pageChunks = chunkText(pageTexts[pageNum]);
            pageChunks.forEach(chunk => {
                chunk.pageNumber = pageNum + 1;
                allChunks.push(chunk);
            });
        }

        // Get embeddings for all chunks
        const chunkTexts = allChunks.map(chunk => chunk.text);
        const embeddings = await getEmbeddings(chunkTexts);

        // Store chunks with their embeddings in MongoDB
        const documents = allChunks.map((chunk, index) => ({
            text: chunk.text,
            documentHash,
            fileName: req.file.originalname,
            uploadDate: new Date(),
            index,
            embedding: embeddings[index],
            metadata: {
                totalChunks: allChunks.length,
                chunkIndex: index,
                pageNumber: chunk.pageNumber,
                startIndex: chunk.startIndex,
                endIndex: chunk.endIndex,
                pageCount: data.numpages,
                pdfInfo: data.info
            }
        }));

        const collection = db.collection('documents');
        await collection.insertMany(documents);

        // Clean up
        fs.unlinkSync(req.file.path);

        res.json({
            message: existingDoc ? 'PDF updated successfully' : 'PDF processed successfully',
            chunks: allChunks.length,
            documentHash
        });
    } catch (error) {
        console.error('Error processing PDF:', error);
        res.status(500).json({ error: 'Error processing PDF' });
    }
});

// Add a new route to list uploaded documents
app.get('/documents', async (req, res) => {
    try {
        const documents = await db.collection('documents')
            .aggregate([
                {
                    $group: {
                        _id: '$documentHash',
                        fileName: { $first: '$fileName' },
                        uploadDate: { $first: '$uploadDate' },
                        chunkCount: { $sum: 1 },
                        pageCount: { $first: '$metadata.pageCount' }
                    }
                },
                { $sort: { uploadDate: -1 } }
            ])
            .toArray();

        res.json(documents);
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Error fetching documents' });
    }
});

// Add a route to delete a document
app.delete('/documents/:hash', async (req, res) => {
    try {
        const result = await db.collection('documents')
            .deleteMany({ documentHash: req.params.hash });

        res.json({
            message: 'Document deleted successfully',
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ error: 'Error deleting document' });
    }
});

// Enhanced similar documents function
async function findSimilarDocuments(queryEmbedding, limit = 5) {
    const pipeline = [
        {
            $addFields: {
                similarity: {
                    $reduce: {
                        input: { $range: [0, { $size: "$embedding" }] },
                        initialValue: 0,
                        in: {
                            $add: [
                                "$$value",
                                {
                                    $multiply: [
                                        { $arrayElemAt: ["$embedding", "$$this"] },
                                        { $arrayElemAt: [queryEmbedding, "$$this"] }
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        },
        { $sort: { similarity: -1 } },
        { $limit: limit + 2 }, // Get extra chunks for context
        {
            $group: {
                _id: "$documentHash",
                chunks: {
                    $push: {
                        text: "$text",
                        pageNumber: "$metadata.pageNumber",
                        similarity: "$similarity"
                    }
                }
            }
        }
    ];

    const results = await db.collection('documents').aggregate(pipeline).toArray();

    // Flatten and sort all chunks by similarity
    const allChunks = results.flatMap(doc => doc.chunks)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

    return allChunks;
}

// Enhanced answer generation
async function generateAnswer(question, relevantChunks) {
    try {
        // Sort chunks by page number and create context
        const sortedChunks = relevantChunks.sort((a, b) => a.pageNumber - b.pageNumber);
        const context = sortedChunks.map(chunk =>
            `[Page ${chunk.pageNumber}]: ${chunk.text}`
        ).join('\n\n');

        const prompt = `Based on the following excerpts from a PDF document, please answer the question. Include page references when relevant. If the answer cannot be found in the provided excerpts, say "I cannot find the answer in the provided context."

Context:
${context}

Question: ${question}

Answer:`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that answers questions based on PDF document excerpts. Use page references when citing information. Only use the information from the provided context. If the answer cannot be found in the context, say so."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generating answer:', error);
        throw error;
    }
}

// Question answering route
app.post('/ask', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ error: 'No question provided' });
        }

        // Get embedding for the question
        const questionEmbedding = await getEmbeddings([question]);

        // Find similar documents using vector similarity
        const relevantChunks = await findSimilarDocuments(questionEmbedding[0]);

        if (relevantChunks.length === 0) {
            return res.json({
                answer: 'No relevant information found in the document.',
                context: []
            });
        }

        // Generate answer using GPT
        const answer = await generateAnswer(question, relevantChunks);

        // Return both the answer and the relevant chunks for context
        res.json({
            answer,
            context: relevantChunks.map(chunk => chunk.text)
        });
    } catch (error) {
        console.error('Error processing question:', error);
        res.status(500).json({ error: 'Error processing question' });
    }
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
} 