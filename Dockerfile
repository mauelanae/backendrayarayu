FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first to install dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your application
COPY . .

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "src/index.js"]
