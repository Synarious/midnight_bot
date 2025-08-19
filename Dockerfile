# Use an official Node.js runtime as a parent image
# Using '-alpine' is a good practice for smaller image sizes
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install app dependencies using npm ci for faster, reliable builds
RUN npm ci --only=production

# Copy the rest of your application's code into the container
COPY . .

# Command to run your bot when the container launches
CMD ["node", "index.js"]