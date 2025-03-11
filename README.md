# Ask PDF

A PDF question-answering system that allows users to upload PDF documents and ask questions about their content. The application uses text chunking, embeddings, and vector similarity search to find relevant information and generate accurate answers.

## Features

- PDF document upload and processing
- Text extraction and chunking
- Semantic search using embeddings
- Question answering with OpenAI's API
- Document history and management
- Clean and intuitive user interface

## Architecture

The application consists of:
- Node.js Express backend server
- Python embedding server using Sentence Transformers
- MongoDB for storing document chunks and embeddings
- HTML/JavaScript frontend with Material UI components

## Prerequisites

- Node.js (v14 or higher)
- Python 3.7+ with pip
- MongoDB (local or Atlas)
- OpenAI API key

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/ahamSel/ask_pdf.git
cd ask_pdf
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Install Python dependencies

```bash
pip install sentence-transformers bottle
```

### 4. Set up environment variables

Create a `.env` file in the root directory based on the provided `.env.example`:

```bash
cp .env.example .env
```

Edit the `.env` file and add your OpenAI API key and MongoDB connection string:

```bash
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017
OPENAI_API_KEY=your_openai_api_key_here
```

### 5. Create uploads directory (if not already present)

```bash
mkdir -p uploads
```

## Running the Application

### 1. Start MongoDB

If using a local MongoDB instance:

```bash
mongod --dbpath /path/to/your/data/directory
```

### 2. Start the embedding server

```bash
python embedding_server.py
```

This will start the embedding server on port 3001.

### 3. Start the main application server

```bash
npm start
```

The application will be available at http://localhost:3000

## Usage

1. Open your browser and navigate to http://localhost:3000
2. Upload a PDF document using the upload button
3. Once processed, the document will appear in your history
4. Select a document and ask questions about its content
5. The system will search for relevant information and generate an answer

## How It Works

1. When a PDF is uploaded, the system:
   - Extracts text from the PDF
   - Splits the text into manageable chunks
   - Generates embeddings for each chunk using the embedding server
   - Stores the chunks and embeddings in MongoDB

2. When a question is asked:
   - The system generates an embedding for the question
   - Finds the most similar chunks using vector similarity search
   - Sends the question and relevant chunks to OpenAI's API
   - Returns the generated answer to the user

## Deployment

For production deployment:

1. Set up a MongoDB Atlas cluster or a production MongoDB server
2. Update the MONGODB_URI in your .env file
3. Deploy both the Node.js server and Python embedding server
4. Ensure proper security measures are in place for API keys

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 