# Dashboard Dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose dashboard port
EXPOSE 3001

# Run the dashboard server
CMD ["node", "server.js"]
