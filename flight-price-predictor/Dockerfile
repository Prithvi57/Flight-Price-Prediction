# Production Dockerfile for Flight Price Predictor
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install build dependencies for native modules if needed
RUN apk add --no-cache python3 make g++

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
