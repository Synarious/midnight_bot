# Dashboard Dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies including dev for build
RUN npm install

# Copy application files
COPY . .

# Build the React frontend
RUN npm run build

# Expose dashboard port
EXPOSE 3002

# Run the dashboard server
CMD ["node", "server.js"]
