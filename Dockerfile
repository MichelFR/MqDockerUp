FROM node:18-alpine

# Install 'tini g++ make py3-pip'
RUN apk add --no-cache tini g++ make py3-pip

# Create and set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Specify the command to run
CMD ["npm", "run", "start"]