from bottle import route, run, request, response
from sentence_transformers import SentenceTransformer
import numpy as np
import json

# Load the model
print("Loading model...")
model = SentenceTransformer('all-MiniLM-L6-v2')
print("Model loaded!")


@route('/embed', method='POST')
def embed():
    try:
        data = request.json
        if not data or 'texts' not in data:
            response.status = 400
            return {'error': 'No texts provided'}

        texts = data['texts']
        if not isinstance(texts, list):
            texts = [texts]

        # Generate embeddings
        embeddings = model.encode(texts)

        # Convert to list format (numpy arrays aren't JSON serializable)
        embeddings_list = embeddings.tolist()

        return {'embeddings': embeddings_list}
    except Exception as e:
        response.status = 500
        return {'error': str(e)}


print("Starting embedding server on port 3001...")
run(host='127.0.0.1', port=3001)
