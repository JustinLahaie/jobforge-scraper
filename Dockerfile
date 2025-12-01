# Use official Node.js image with Playwright pre-installed
FROM mcr.microsoft.com/playwright:v1.57.0-focal

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "server.js"]
