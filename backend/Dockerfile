FROM node:20-alpine

WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the backend code
COPY . .

# Expose the API port
EXPOSE 5000

# Start the Node.js server
CMD ["node", "server.js"]
